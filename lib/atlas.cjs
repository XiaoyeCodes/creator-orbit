const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const runtime=require('./runtime.cjs');
const {createAccessSync}=require('./media-access.cjs');
const {readTopics,saveTopics,editTopics,completeTopic}=require('./topics.cjs');
const imageQuality=require('../config/image-quality.json');
const imagePlanning=require('../config/image-planning.json');
const imageCopy=require('../config/image-copy.json');
const captionQuality=require('../config/caption-quality.json');
const captionV1=require('../config/caption-quality-v1.json');
const contentReview=require('./content-review.cjs');
const ACTIVE=new Set(['queued','generating','reviewing','validating']);
const json=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n','utf8');fs.renameSync(tmp,file)}
function inside(root,file){const rel=path.relative(path.resolve(root),path.resolve(file));return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)}
function safeFile(root,relative){if(typeof relative!=='string'||path.isAbsolute(relative))throw new Error('无效文件路径');const target=path.resolve(root,relative);if(!inside(root,target)||!fs.existsSync(target)||!inside(fs.realpathSync(root),fs.realpathSync(target)))throw new Error('文件不在当前素材目录');return target}
function dateShanghai(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function parseCaption(text){const lines=text.trim().split(/\r?\n/);let first=lines.findIndex(l=>l.trim());let title=(lines[first]||'').replace(/^#{1,6}\s*/, '').replace(/^标题[:：]\s*/,'').trim();let body=lines.slice(first+1).join('\n').replace(/^\s*(?:#{1,6}[ \t]+正文[:：]?|正文[:：])[ \t]*\n/,'').replace(/^#{1,6}\s*(?:标签|话题标签)\s*$/gm,'').trim();return {title,body,text}}
function displayMessage(message){
 if(typeof message!=='string')return message;
 let detail;try{const parsed=JSON.parse(message);if(parsed.ok!==false||typeof parsed.error!=='string')return message;detail=parsed.error}catch{return message}
 if(detail.startsWith('Forbidden copy wording'))return '旧版措辞检查曾误拦截正常用词。该规则现已移除，继续处理可重新验收已有素材。';
 if(detail.includes('1000-character'))return '正文与标签超出 1000 字或内容为空，请修正文案后重新验收。';
 if(detail.includes('20-character'))return '标题超出 20 字或标题为空，请修正后重新验收。';
 if(detail.includes('Caption review hashes do not match'))return '文案在审查后发生变化，需要重新复审以核对当前版本。';
 return '图文验收未通过：'+detail;
}
function createAtlas({root=path.resolve(__dirname,'..'),dataRoot=path.join(root,'data'),execute=runtime.run,detect=runtime.detect,desktop=(payload)=>runtime.desktop(root,payload),launch=null,exportAccess=(project)=>runtime.exportAccess(root,project),maxConcurrent=3}={}){
 const skill=path.join(root,'.agents','skills','shiguang-atlas'),queue=path.join(dataRoot,'主题','topics.md'),jobRoot=path.join(dataRoot,'jobs'),outputRoot=path.join(dataRoot,'文案');
 fs.mkdirSync(path.dirname(queue),{recursive:true});fs.mkdirSync(jobRoot,{recursive:true});
 if(!fs.existsSync(queue))fs.copyFileSync(path.join(skill,'assets','topics.snapshot.md'),queue);
 if(!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>8)throw new Error('并发数需为 1–8');
 const jobs=new Map(),active=new Map(),startingOperations=new Set();let closing=false,creating=false,creationChain=Promise.resolve(),capabilities=null,capabilityAt=0;
 const syncAccess=createAccessSync(exportAccess);
 async function refreshMedia(id){
  const targets=id?[get(id)]:[...jobs.values()];
  await Promise.all(targets.map(async job=>{try{await syncAccess(job.project);job.accessWarning=null}catch(e){job.accessWarning=e.message}}));
 }
 for(const file of fs.readdirSync(jobRoot).filter(x=>x.endsWith('.json'))){try{const job=json(path.join(jobRoot,file));if(!/^[\w-]+$/.test(job.id)||!inside(dataRoot,job.project))continue;if(ACTIVE.has(job.status)){job.status='interrupted';if(job.contentReview?.status==='running')job.contentReview.status='interrupted';job.message='上次生成中断；点击继续生成，从已有文件恢复。';atomic(path.join(jobRoot,file),job)}jobs.set(job.id,job)}catch{}}
 const persist=job=>{job.updatedAt=new Date().toISOString();atomic(path.join(jobRoot,job.id+'.json'),job)};
 async function capability(force=false){if(force||!capabilities||Date.now()-capabilityAt>60000){capabilities=await detect();capabilityAt=Date.now()}return capabilities}
 function legacyPending(){
  const registry=path.join(path.dirname(queue),'.'+path.basename(queue)+'.shiguang-state.json');
  if(!fs.existsSync(registry))return null;
  const record=json(registry);if(!['in_progress','prepared','validated'].includes(record.status))return null;
  const receipt=path.join(path.dirname(record.manifest),'commit-receipt.json');
  if(fs.existsSync(receipt)&&json(receipt).committed===true)return null;
  const job=[...jobs.values()].find(j=>path.resolve(j.manifest)===path.resolve(record.manifest));
  return {topic:record.topic,category:record.category,manifest:record.manifest,jobId:job?.id||null,status:job?.status||null,message:displayMessage(job?.message)||null,legacy:true};
 }
 function queueConfig(){
  const config=readTopics(queue),legacy=legacyPending();
  const reservations=[...jobs.values()].filter(j=>j.mode==='production'&&j.queueReservation&&!j.queueDetached&&j.queueUpdate?.status!=='committed').map(j=>({topic:j.topic,category:j.queueReservation.category,jobId:j.id,status:j.status,message:displayMessage(j.message)}));
  if(legacy)reservations.push(legacy);
  const items=config.items.map(item=>{const reservation=reservations.find(r=>r.topic===item.topic&&r.category===item.category);return {...item,reserved:!!reservation,reservedJobId:reservation?.jobId||null}});
  const available=items.filter(item=>item.status==='TODO'&&!reservations.some(r=>r.topic===item.topic&&r.category===item.category));
  const pending=reservations.find(r=>!r.jobId||['failed','interrupted','cancelled','parked'].includes(r.status))||null;
  return {...config,items,pending,reservations,nextAvailable:available[0]||null,available,concurrency:{max:maxConcurrent,running:active.size,starting:creating?1:0},locked:active.size>0||creating||reservations.length>0,lockReason:active.size||creating?'任务正在运行，选题配置暂不可编辑；仍可选择其他选题生成':reservations.length?'有未完成的正式任务，可继续处理，或暂存后编辑配置':''};
 }
 function reserveSlot(job){
  if(active.has(job.id))throw Object.assign(new Error('这篇任务正在运行，请勿重复启动'),{status:409});
  if(active.size>=maxConcurrent)throw Object.assign(new Error(`已达到同时运行 ${maxConcurrent} 篇的上限，请等待一篇完成`),{status:409});
  active.set(job.id,{handle:null,done:null});
 }
 function startJob(job,options){const entry=active.get(job.id);entry.done=executeJob(job,options);return entry.done}
 function startOperation(action){
  if(closing)return Promise.reject(Object.assign(new Error('本地服务正在关闭，请重新打开工作台'),{status:503}));
  const operation=Promise.resolve().then(action);startingOperations.add(operation);
  operation.then(()=>startingOperations.delete(operation),()=>startingOperations.delete(operation));return operation;
 }
 function syncQueue(id){
  const job=get(id);if(job.status!=='ready')throw Object.assign(new Error('图文验收完成后才能同步选题'),{status:409});
  if(!job.queueReservation||job.queueDetached||job.queueUpdate?.status==='committed')return view(job);
  if(legacyPending()){job.queueUpdate={status:'waiting',message:'等待旧版任务释放选题登记后自动同步'};persist(job);return view(job)}
  try{
   const config=readTopics(queue);if(config.error)throw new Error(config.error);
   const change=completeTopic(config.text,job.queueReservation);
   if(!change.alreadyCompleted){
    job.queueReservation.completedRow=change.completedRow;job.queueUpdate={status:'committing'};persist(job);
    saveTopics(queue,{text:change.text,revision:config.revision},path.join(dataRoot,'主题','backups'));
   }
   job.queueUpdate={status:'committed',at:new Date().toISOString(),message:'已同步本篇选题'};persist(job);
  }catch(e){job.queueUpdate={status:'conflict',message:e.message};persist(job)}
  return view(job);
 }
 function reconcileQueues(){for(const job of jobs.values())if(job.status==='ready'&&job.queueReservation&&!job.queueDetached&&job.queueUpdate?.status!=='committed')syncQueue(job.id)}
 function queueItems(){return queueConfig().items}
 function updateQueue(input){const config=queueConfig();if(config.locked)throw Object.assign(new Error(config.lockReason),{status:409});if(input.action){if(input.revision!==config.revision)throw Object.assign(new Error('选题已在其他窗口修改，请刷新后重试；未保存的表单仍保留'),{status:409});input={revision:input.revision,text:editTopics(config.text,input.action)}}return {...saveTopics(queue,input,path.join(dataRoot,'主题','backups')),locked:false,lockReason:'',pending:null}}
 async function openQueue(){return desktop({action:'open-file',file:queue})}

 function park(id){
  const job=get(id),fail=message=>Object.assign(new Error(message),{status:409});
  if(active.has(id)||creating)throw fail('任务正在运行或准备中，请先停止或等待完成后再暂存');
  if(job.queueDetached&&job.status==='parked'&&!queueConfig().pending)return view(job);
  if(job.mode!=='production'||!['failed','interrupted','cancelled','parked'].includes(job.status))throw fail('只有未完成且已停止的正式任务可以暂存');
  if(job.queueReservation){
   if(!job.queueDetached){job.parkedFrom={status:job.status,message:job.message};job.parkedAt=new Date().toISOString()}
   job.queueDetached=true;job.status='parked';event(job,'已暂存，已有素材保留，可创作其他选题；恢复后不自动修改选题。');return view(job);
  }
  const registry=path.join(path.dirname(queue),'.'+path.basename(queue)+'.shiguang-state.json'),lock=queue+'.shiguang.lock';let fd;
  try{fd=fs.openSync(lock,'wx')}catch(e){if(e.code==='EEXIST')throw fail('选题正在被其他任务使用，请稍后重试');throw e}
  try{
   const record=fs.existsSync(registry)?json(registry):null;
   if(!record||path.resolve(record.manifest)!==path.resolve(job.manifest)||!['in_progress','prepared','validated','parked'].includes(record.status))throw fail('本篇已不占用当前选题，请刷新后重试');
   const receipt=path.join(path.dirname(job.manifest),'commit-receipt.json');
   if(fs.existsSync(receipt)&&json(receipt).committed===true)throw fail('本篇已提交选题进度，请刷新状态');
   const backup=path.join(dataRoot,'主题','backups',Date.now()+'-'+crypto.randomUUID()+'.state.json');atomic(backup,record);
   // Persist detachment before releasing the shared registry. Future retries must
   // never commit this old snapshot over a different task's queue or registry.
   if(!job.queueDetached){job.parkedFrom={status:job.status,message:job.message};job.parkedAt=new Date().toISOString()}
   job.queueDetached=true;job.status='parked';event(job,'已暂存，图文素材保留在作品库。可继续处理；完成后不自动推进当前选题。');
   atomic(registry,{...record,status:'parked',parkedAt:job.parkedAt,jobId:job.id});
   return view(job);
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);reconcileQueues()}
 }

 function event(job,message){message=displayMessage(message);job.message=message;job.events=(job.events||[]).concat({time:new Date().toISOString(),message}).slice(-45);persist(job)}
 function manifest(job){try{return json(job.manifest)}catch{return null}}
 function view(job){const m=manifest(job);let images=[];try{images=fs.readdirSync(job.project).filter(x=>/^\d{2}_.+\.png$/i.test(x)).sort().map(name=>({name,url:`/api/jobs/${job.id}/assets/${encodeURIComponent(name)}`,dimensions:job.validation?.dimensions?.find(d=>d.path===name)||null}))}catch{}
 let caption=null;if(m?.caption_path)try{caption=parseCaption(fs.readFileSync(safeFile(job.project,m.caption_path),'utf8'))}catch{}
 return {id:job.id,topic:job.topic,mode:job.mode,status:job.status,queueUpdate:job.queueUpdate||null,queueDetached:job.queueDetached===true,parkedAt:job.parkedAt||null,parkedFrom:job.parkedFrom||null,message:displayMessage(job.message),accessWarning:job.accessWarning||null,date:job.date,createdAt:job.createdAt,updatedAt:job.updatedAt,events:(job.events||[]).map(e=>({...e,message:displayMessage(e.message)})),images,caption,captionMetrics:caption?contentReview.captionMetrics(caption):null,reviewEnabled:job.reviewEnabled===true,contentReview:job.contentReview?{status:job.contentReview.status,summary:job.contentReview.summary||null,issueCount:job.contentReview.issueCount||0}:null,expectedImages:Number.isInteger(m?.content_pages)&&m.content_pages>=0?m.content_pages+1:null,quantityPlan:m?.quantity_plan?.rationale?{rationale:m.quantity_plan.rationale,contentPages:m.content_pages}:null,imageCountPolicy:job.imageCountPolicy||'skill',imageCopyPolicy:job.imageCopyPolicy||'legacy',captionPolicy:job.captionPolicy||'legacy',visualPolicy:job.visualPolicy||'legacy',visualStyle:job.visualStyle||(job.visualPolicy===imageQuality.photorealId?'photoreal':'illustration'),imageLabelPolicy:job.imageLabelPolicy||'legacy',project:job.project,dimensionPolicy:'prompt-strong',validation:job.validation||null,publishPreparedAt:job.publishPreparedAt||null,reviewedAt:job.reviewedAt||null,publication:job.publication||null,ready:job.status==='ready'};
 }
 const python=()=>runtime.pythonBinary();
 async function workflow(action,job){const r=await execute(python(),[path.join(root,'scripts','workflow_bridge.py'),action,'--manifest',job.manifest,'--dimension-policy','prompt-strong','--image-count-policy',job.imageCountPolicy||'skill','--visual-policy',job.visualPolicy||'legacy','--image-label-policy',job.imageLabelPolicy||'legacy','--caption-policy',job.captionPolicy||'legacy'],{cwd:root,timeout:120000});return JSON.parse(r.stdout)}
 function prompt(job){const writing=job.captionPolicy===captionQuality.id?captionQuality:job.captionPolicy===captionV1.id?captionV1:null;return `你正在执行用户授权的 ORBIT 本机图文生成任务。只生成这一篇，禁止操作小红书、登录、云盘、发送消息或修改应用代码。不得启动子代理。\n`+
 `任务模式：${job.mode}。主题：${job.topic}。日期：${job.date}（Asia/Shanghai）。宿主可用 Python 完整路径：${python()}；Node：${process.execPath}。若沙箱中 py 找不到，使用完整路径，不要遍历其他磁盘寻找 Python。文件写入也可用 PowerShell .NET 或 apply_patch。\n`+
 `请读取并应用 ${path.join(skill,'SKILL.md')} 及其 references。任务已由服务完成 prepare，不要再次 prepare，不要执行 commit，不要修改队列/登记文件。只写当前项目目录 ${job.project}。实际 manifest：${job.manifest}。\n`+
 `【措辞规则覆盖】不设置禁用词或词语黑名单，也不按关键词拦截。允许正常事实叙述（例如“再次统一”“最后一位”）、引用与内部审查记录。不要为替换正常词语重画图片。此规则优先于旧Skill的词语黑名单；事实、字数、逐页检查和证据完整性仍须通过。\n`+
 `【图片中的百科介绍】当前图中文字策略：${job.imageCopyPolicy||'legacy'}。所有本次新生成或确需修正的图页，使用以下图中文字规范；旧图不因风格升级自动重画。\n${imageCopy.prompt}\n${imageCopy.guidance.map((rule,index)=>`${index+1}. ${rule}`).join('\n')}\n这些要求针对图中文字，尤其底部介绍；小红书发布短文继续按自己的文案策略组织。\n`+
 `【恢复已有任务】先检查目录、manifest、已有提示词和 codex-*.jsonl 记录。对已有完整图片实际看图、核对原始文件与工具输入，保留合格素材，仅补齐缺失或不合格部分。若只是缺少 QA 或 manifest，应复核证据后补齐记录，不重新生成全部图片。不允许凭空补造调用记录。\n`+
 `【用户明确覆盖的尺寸要求】每次图像提示词仍用 Skill 的原文前缀，把 1086×1448、3:4 作为强要求。但内置工具没有尺寸实参，用户已确认写进提示词即可：真实返回其他尺寸时，保留原图，在 QA 和 final-report.md 中报告实际尺寸，不以这个差异单独判失败；不得缩放/裁切/本地叠字。仅本条覆盖原 Skill 的固定尺寸硬性失败规则，其余质量要求完整保留。\n`+
 ([imageQuality.id,imageQuality.photorealId,imageQuality.illustrationId].includes(job.visualPolicy)?`【用户明确覆盖的清晰度与质感要求】每张封面及内容图的实际 image_gen prompt 都必须原样包含这段文字：${imageQuality.prompt}\n补充执行要求：${imageQuality.guidance} 这条优先于底稿的做旧颗粒和固定底部字数要求。逐页实际查看文字可读性、噪点与边缘；未达到要求时记录问题并从底稿修正，不以提示词包含文字冒充视觉验收。\n`:'')+
 (job.visualPolicy===imageQuality.photorealId?`【用户最新覆盖的写实风格】每张实际 image_gen prompt 还必须原样包含：${imageQuality.photorealPrompt}\n${imageQuality.photorealGuidance} 本条优先于 Skill、参考图和旧记录中的博物志插画、动漫或水彩画风；只继承参考图信息布局。逐页实际检查是否仍明显插画化，如不符合写实目标，记录并修正。\n`:'')+
 (job.visualPolicy===imageQuality.illustrationId?`【用户选择的清晰插画风格】每张实际 image_gen prompt 必须原样包含：${imageQuality.illustrationPrompt}\n沿用参考图的信息结构与博物志插画语言，清理旧主体和栏目文字。每页保持风格一致，同时遵守清晰度与正文准确性要求。\n`:'')+
 (job.imageLabelPolicy===imageQuality.noLabelId?`【用户明确覆盖的图内标记要求】每张实际 image_gen prompt 必须原样包含：${imageQuality.noLabelPrompt}\n这条覆盖参考图、旧记录和其他风格指引中的AI标记要求。page-copy只写真正要出现在图中的正文，不写AI来源标记；来源、复原说明、调用证据仍保留在raw_generated。逐页实际检查四角、页脚、图片小窗和正文，若仍出现此类字样，从原底稿修正；不能以提示词合规代替看图检查。\n`:'')+
 `【执行】使用当前实际可调用的内置 image_gen.imagegen 工具，禁止 OpenAI SDK、HTTP 图像 API、外部生成器、API Key。不是调用 image_gen.py。先实际查看全部七张参考图，每张内容页真实传入选中的 referenced_image_paths；封面独立生成。若图片工具缺失或调用失败，保存真实失败到 raw_generated/blocker.md 后停止，不用 SVG/HTML/Pillow 合成图冒充。可用 Pillow 只测量和解码，或原字节复制已生成文件。必须得到并保存真正 PNG 文件。\n`+
 (job.imageCountPolicy===imagePlanning.id?`【用户最新覆盖的数量与分页规则】根据当天实际正文，由你推理决定总共 1–11 张图片，禁止按旧的4–8张上限压缩或合并独立对象。只有一个对象且一张足够讲清时，可用1张完整介绍图兼封面（content_pages=0）；否则1张独立封面＋1–10张内容图。每张内容图只介绍一个独立对象，一页一个流派/物种/人物/产品/独立数据卡片，不把“儒家与墨家”等多个对象并排或拼贴在同一页。封面可以展示目录，但不能用封面的合集代替内页介绍；同一对象的特点、结构、代表人物、影响等细节可同页呈现。先核实来源并完成full_text、列出全部介绍对象，再决定页数。十大哲学流派应为1张封面＋10张流派介绍，共11张。超过10个必须完整覆盖的对象时，停止并说明需要分篇，不合并、不擅自删项或改题。\n每张介绍图（单图任务包括封面）的实际image_gen prompt必须原样包含：${imagePlanning.prompt}\n另单独写一行“本图唯一介绍对象：对象名称”并换行；对象名称必须与数量计划完全一致。一次工具调用只产出这一张图，不批量拼接多个对象卡片，不把多页缩进同一张长图。逐页实际看图，确认没有合并其他介绍对象；在对应qa.page_reviews[].checks中签核single_subject_per_page=true并描述观察，不可自动填充。\n第一张图生成前，保存raw_generated/quantity-plan.md及manifest中的single_subject计划，按 ${path.join(root,'docs','adaptive-image-plan.md')} 的schema列出subjects、逐页covered_items及正文原文引用。此条优先于原Skill、旧数量规则和参考图的多对象布局。\n`:job.imageCountPolicy==='content-adaptive'?`【用户明确覆盖的数量规则】根据当天实际正文，由你推理决定总共 4–8 张图片，包含 1 张封面，即 3–7 张内容页。先核实来源并完成 full_text，再按知识点、信息密度、叙事顺序和可读性分配页面，不固定为四页，不凑图。第一张图生成前，必须写明每页标题、正文依据、覆盖内容及选用这个数量的理由，保存到 raw_generated/quantity-plan.md 并同步 manifest。请读取 ${path.join(root,'docs','adaptive-image-plan-legacy.md')}，严格采用其中 content_adaptive 数量计划结构。若标题含“十大”等数量，完整保留所承诺的对象，允许每页分组讲多个对象，不把对象个数等同图片数。天然集合不得漏项。此条覆盖原 Skill 的内容页范围及一对象一页规则，其余质量要求保留。\n`:`【恢复旧任务】保留这篇原有数量计划，按原 Skill 完成缺失页面；不要因新任务的数量策略而重新生成既有合格图片。\n`)+
 `完成文案与数量计划后再逐张生成，保证发布文案与每页内容一致。保留每页完整的实际 tool inputs、参考输入证明、时间窗、原始输出 SHA256，不编造 call id。最后实际查看每张成品并对照参考和来源，补全 manifest 的真实 QA 签核。新增事实也必须核实。输出 manifest schema 见 references/manifest-schema.md，数量计划优先遵守本任务的用户覆盖规则。\n`+
 (writing?`【用户要求的专业解读文案】${writing.prompt}\n${writing.guidance.map((rule,index)=>`${index+1}. ${rule}`).join('\n')}\n按 ${path.join(root,'docs','caption-quality.md')} 保存caption_review：至少三处不同正文解读原文与底稿原文、实际复读说明、最终文件SHA256及逐项审查。先确认文案有知识增量再生图，禁止用自动填充的签核或名词清单冒充专业解读。本条覆盖旧参考文案的写法，不改变事实核查与一对象一图规则。当前文案策略：${job.captionPolicy}；按对应版本验收。${job.captionPolicy===captionQuality.id?"新策略另须保存caption_review.reader_review，记录主问题、收获、开头与答案原文、推进说明、覆盖说明及实际编辑记录；允许正文选择案例，以完整底稿规划全部图片。":""}\n`:'')+
 `小红书文案第一行使用 '# 标题'，接着正文与标签，标题不超过20个中文字符，正文加标签尽量不超过1000字。内部来源和 QA 写 raw_generated，不混入发布文案。阶段进度可写 raw_generated/progress.json={"stage":"核实来源/撰写文案/生成图片/逐页质检","message":"实际进度"}。\n`+
 `失败时保留已经完成的成果，记录 raw_generated/blocker.md 以及 raw_generated/final-report.md；成功前运行 python "${path.join(root,'scripts','workflow_bridge.py')}" validate --manifest "${job.manifest}" --dimension-policy prompt-strong --image-count-policy ${job.imageCountPolicy||'skill'} --visual-policy ${job.visualPolicy||'legacy'} --image-label-policy ${job.imageLabelPolicy||'legacy'} --caption-policy ${job.captionPolicy||'legacy'}。如环境无法运行验证可保留文件由宿主重跑，不捏造成功。验证通过后写 final-report.md 并结束，由宿主独立验证和提交。不要为了通过脚本伪造 QA 或工具证据。`;
 }
 function launchCodex(job,instruction){
  job.lastError=null;const phasePrefix=job.status==='reviewing'?'review':'codex';fs.writeFileSync(path.join(job.project,'raw_generated',phasePrefix+'-instructions.md'),instruction,'utf8');
  const executable=runtime.findCodex();if(!executable)throw new Error('未找到 Codex CLI');
  const args=['exec','--ignore-user-config','--sandbox','workspace-write','--skip-git-repo-check','--ephemeral','--json','-c','approval_policy="never"','-c','features.multi_agent=false','-c','web_search="live"','-C',job.project,'-o',path.join(job.project,'raw_generated',phasePrefix+'-final.md'),'-'];
  if(process.platform==='win32')args.splice(args.length-1,0,'-c','windows.sandbox="elevated"');
  const child=spawn(executable,args,{cwd:job.project,env:runtime.cleanEnv(),windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  const stdout=fs.createWriteStream(path.join(job.project,'raw_generated',`${phasePrefix}-${Date.now()}.jsonl`));const stderr=fs.createWriteStream(path.join(job.project,'raw_generated','codex-stderr.log'),{flags:'a'});
  child.stdout.pipe(stdout);child.stderr.pipe(stderr);let tail='',buffer='';child.stderr.on('data',x=>{tail=(tail+x.toString()).slice(-5000)});
  child.stdout.on('data',chunk=>{buffer+=chunk.toString();let pos;while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);try{const item=JSON.parse(line);if(item.type==='thread.started'){job.codexThreadId=item.thread_id;persist(job)}if(item.type==='item.completed'&&item.item?.type==='agent_message'&&typeof item.item.text==='string'&&['generating','reviewing'].includes(job.status)){event(job,item.item.text.slice(0,900))}if(item.type==='turn.failed'){job.lastError=item.error?.message||'Codex 执行失败';persist(job)}}catch{}}if(buffer.length>8000000)buffer=buffer.slice(-1000000)});
  child.stdin.on('error',()=>{});child.stdin.end(instruction);
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{stdout.end();stderr.end();code===0?resolve():reject(new Error(job.lastError||tail||`Codex 退出 (${code})`))})});
  return {done,cancel:()=>new Promise(resolve=>{if(!child.pid)return resolve();if(process.platform==='win32'){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>{child.kill();resolve()});killer.on('close',resolve)}else{child.kill('SIGTERM');resolve()}})};
 }
 async function finish(job){await syncAccess(job.project);job.status='validating';event(job,'Codex 任务已结束，正在独立验收产物完整性、参考输入与逐页检查记录。');if(job.reviewEnabled)Object.assign(job.contentReview,contentReview.verifyReview(job));job.validation=await workflow('validate',job);contentReview.enforceLimits(view(job).caption);const receipt=path.join(job.project,'raw_generated','commit-receipt.json');if(job.queueDetached)job.receipt={committed:false,production_queue_written:false,reason:'parked-independent-work'};else if(!fs.existsSync(receipt))job.receipt=await workflow('commit',job);else job.receipt=json(receipt);job.status='ready';event(job,job.queueDetached?'暂存作品验收完成，可准备发布；当前选题进度未改变。':'图文验收完成，可预览素材并准备发布。');reconcileQueues()}
 async function phase(job,name,instruction){
  job.status=name;event(job,name==='reviewing'?'Codex 正在逐张复审图片与文案，发现问题将修正并复验。':'Codex 已开始工作：核实来源、撰写文案，并调用内置 GPT 生图。');
  const handle=(launch||launchCodex)(job,instruction);active.get(job.id).handle=handle;
  const timer=setTimeout(()=>{job.status='interrupted';event(job,'本阶段超过45分钟，已保存素材，可继续。');void handle.cancel()},45*60*1000);
  try{await handle.done}finally{clearTimeout(timer);if(active.get(job.id)?.handle===handle)active.get(job.id).handle=null}
 }
 async function executeJob(job,{reviewOnly=false}={}){
  const accessTimer=setInterval(()=>void refreshMedia(job.id),3000);accessTimer.unref();
  try{
   if(!reviewOnly&&!job.generationComplete){await phase(job,'generating',prompt(job));if(['cancelled','interrupted'].includes(job.status))return;try{contentReview.outputs(job);job.generationComplete=true}catch(e){job.generationComplete=false;if(job.reviewEnabled)throw e}persist(job)}
   if(job.reviewEnabled){job.contentReview=contentReview.prepareReview(job);persist(job);await phase(job,'reviewing',prompt(job)+contentReview.reviewInstructions(job,root));if(['cancelled','interrupted'].includes(job.status))return;Object.assign(job.contentReview,contentReview.verifyReview(job));persist(job)}
   await finish(job);
  }catch(e){await refreshMedia(job.id);if(!['cancelled','interrupted'].includes(job.status)){job.status='failed';if(job.contentReview?.status==='running')job.contentReview.status='failed';event(job,e.message)}}
  finally{clearInterval(accessTimer);if(job.contentReview?.status==='running'&&['cancelled','interrupted'].includes(job.status))job.contentReview.status=job.status;await refreshMedia(job.id);active.delete(job.id);persist(job)}
 }
 function startContentReview(id){return startOperation(()=>reviewOne(id))}
 async function reviewOne(id){
  const job=get(id);contentReview.outputs(job);
  if(creating)throw Object.assign(new Error('另一篇任务正在准备，请稍后重试'),{status:409});reserveSlot(job);let started=false;
  try{const caps=await capability(true);if(!caps.available)throw new Error(caps.reason);
   job.reviewEnabled=true;job.captionPolicy=captionQuality.id;job.generationComplete=true;job.reviewedAt=null;job.publishPreparedAt=null;
   job.status='queued';event(job,'已安排独立内容复审，原始图文将备份。');started=true;startJob(job,{reviewOnly:true});return view(job);
  }finally{if(!started)active.delete(id)}
 }
 function create(mode='production',options={}){
  return startOperation(()=>{const task=creationChain.then(()=>createOne(mode,options));creationChain=task.catch(()=>{});return task});
 }
 async function createOne(mode,options){
  if(!['test','production'].includes(mode))throw new Error('未知任务模式');
  const reviewEnabled=options.reviewEnabled===undefined?true:options.reviewEnabled;
  if(typeof reviewEnabled!=='boolean')throw new Error('内容复审开关必须为布尔值');
  const visualStyle=options.visualStyle===undefined?'photoreal':options.visualStyle;
  if(!['photoreal','illustration'].includes(visualStyle))throw Object.assign(new Error('未知生图风格'),{status:400});
  if(active.size>=maxConcurrent)throw Object.assign(new Error(`已达到同时运行 ${maxConcurrent} 篇的上限，请等待一篇完成`),{status:409});
  creating=true;try{
   const caps=await capability(true);if(!caps.available)throw Object.assign(new Error(caps.reason),{status:503});
   const config=queueConfig(),date=dateShanghai();if(config.error)throw new Error(config.error);
   if(options.queueRevision!==undefined&&options.queueRevision!==config.revision)throw Object.assign(new Error('选题顺序已变化，请刷新并确认本次选题后再生成'),{status:409});
   if(options.testTopic!==undefined&&mode!=='test')throw new Error('指定测试选题仅用于独立测试');
   const requested=mode==='test'?options.testTopic:options.topic;
   if(requested!==undefined&&typeof requested!=='string')throw new Error('指定选题必须为文字');
   const choices=config.items.filter(x=>x.status==='TODO'&&(requested===undefined||x.topic===requested)&&(options.topicCategory===undefined||x.category===options.topicCategory));
   let chosen=requested===undefined?(mode==='test'?config.next:config.nextAvailable):choices[0];
   if(!chosen)throw new Error(mode==='test'?'测试选题必须来自当前待办队列':'没有未占用的待办选题，请查看作品库或添加选题');
   if(config.items.filter(x=>x.topic===chosen.topic&&x.category===chosen.category).length!==1)throw new Error('选题与分类存在重复，请先在配置中区分');
   if(mode==='production'&&config.reservations.some(r=>r.topic===chosen.topic&&r.category===chosen.category))throw Object.assign(new Error('这个选题已有未完成任务，请在作品库继续或先暂存'),{status:409});
   const id=crypto.randomUUID(),cell=x=>x.replace(/\\/g,'\\\\').replace(/\|/g,'\\|');
   let sourceQueue=queue,queueReservation=null;
   if(mode==='production'||requested!==undefined){
    const key=mode==='production'?id:crypto.createHash('sha256').update(config.revision+'\n'+chosen.topic).digest('hex').slice(0,20);
    sourceQueue=path.join(dataRoot,mode==='production'?'任务选题':'测试选题',key,'topics.md');
    if(!fs.existsSync(sourceQueue)){fs.mkdirSync(path.dirname(sourceQueue),{recursive:true});fs.writeFileSync(sourceQueue,'# 独立任务选题快照\n\n|Status|Topic|Category|\n|-|-|-|\n|TODO|'+cell(chosen.topic)+'|'+cell(chosen.category)+'|\n','utf8')}
    if(mode==='production')queueReservation={topic:chosen.topic,category:chosen.category,row:config.text.split(/\r\n|\n|\r/)[chosen.line-1]};
   }
   if(mode==='test'){
    const completed=[...jobs.values()].find(j=>j.mode===mode&&j.date===date&&j.status==='ready'&&j.imageCountPolicy===imagePlanning.id&&j.imageCopyPolicy===imageCopy.id&&j.captionPolicy===captionQuality.id&&j.reviewEnabled===reviewEnabled&&j.visualStyle===visualStyle&&j.imageLabelPolicy===imageQuality.noLabelId&&j.topic===chosen.topic&&fs.existsSync(path.join(j.project,'raw_generated','queue.snapshot.md'))&&fs.readFileSync(path.join(j.project,'raw_generated','queue.snapshot.md')).equals(fs.readFileSync(sourceQueue)));
    if(completed)return view(completed);
   }
   const productionRoot=path.join(outputRoot,'任务',id);
   const args=[path.join(skill,'scripts','workflow.py'),'prepare','--queue',sourceQueue,'--output-root',mode==='test'?path.join(dataRoot,'测试结果',visualStyle+'-'+imageQuality.noLabelId+'-'+imagePlanning.id+'-'+captionQuality.id+'-'+imageCopy.id+(reviewEnabled?'-review':'-no-review')):productionRoot,'--date',date];if(mode==='test')args.push('--test-mode');
   const prep=JSON.parse((await execute(python(),args,{cwd:root})).stdout);if(!inside(dataRoot,prep.project)||!inside(prep.project,prep.manifest))throw new Error('任务目录不在当前数据区');
   let job=[...jobs.values()].find(j=>path.resolve(j.manifest)===path.resolve(prep.manifest));
   if(!job){job={id,mode,date,project:prep.project,manifest:prep.manifest,topic:prep.topic,queueReservation,reviewEnabled:prep.resumed?false:reviewEnabled,imageCountPolicy:prep.resumed?'skill':imagePlanning.id,imageCopyPolicy:prep.resumed?'legacy':imageCopy.id,captionPolicy:prep.resumed?'legacy':captionQuality.id,visualPolicy:prep.resumed?'legacy':visualStyle==='photoreal'?imageQuality.photorealId:imageQuality.illustrationId,visualStyle:prep.resumed?'illustration':visualStyle,imageLabelPolicy:prep.resumed?'legacy':imageQuality.noLabelId,createdAt:new Date().toISOString(),events:[]};jobs.set(job.id,job)}
   if(job.queueDetached)throw new Error('本篇已暂存，请从作品库继续处理');reserveSlot(job);
   if(options.reviewEnabled!==undefined){job.reviewEnabled=reviewEnabled;if(reviewEnabled){job.captionPolicy=captionQuality.id;try{contentReview.outputs(job);job.generationComplete=true}catch{}}}
   job.status='queued';event(job,prep.resumed?'继续上次未完成的主题，保留已有成果。':'已安排独立任务，Codex 将按正文规划 1–11 张图片。');startJob(job);return view(job);
  }finally{creating=false}
 }
 function retry(id){return startOperation(()=>retryOne(id))}
 async function retryOne(id){
  const job=get(id);if(creating)throw Object.assign(new Error('另一篇任务正在准备，请稍后重试'),{status:409});
  if(active.has(id))throw Object.assign(new Error('这篇任务正在运行'),{status:409});
  if(!['failed','interrupted','cancelled','parked'].includes(job.status))throw new Error('该任务无需重试');reserveSlot(job);let started=false;
  try{
   if(job.reviewEnabled&&job.contentReview?.status==='passed'){try{await finish(job);return view(job)}catch(e){event(job,'复审成果尚未通过宿主验收：'+e.message)}}
   const existing=manifest(job);if(!job.reviewEnabled&&existing?.images?.length===existing?.content_pages+1&&existing?.qa?.checks?.all_images_visually_reviewed===true){try{await finish(job);return view(job)}catch(e){event(job,'现有素材尚未通过复验，继续原任务：'+e.message)}}
   const caps=await capability(true);if(!caps.available)throw new Error(caps.reason);job.status='queued';event(job,'继续生成，复用本篇已有素材和来源。');started=true;startJob(job);return view(job);
  }catch(e){job.status='failed';event(job,e.message);throw e}finally{if(!started)active.delete(id)}
 }
 function get(id){const job=jobs.get(id);if(!job)throw Object.assign(new Error('任务不存在'),{status:404});return job}
 async function cancel(id){const job=get(id),entry=active.get(id);if(!entry?.handle||!['queued','generating','reviewing'].includes(job.status))throw new Error('任务不在可停止阶段；验收与提交期间请等待完成');job.status='cancelled';event(job,'本篇任务已停止，已有成果保留，其他任务继续运行。');await entry.handle.cancel();return view(job)}
 async function ready(id){const job=get(id);if(job.status!=='ready')throw Object.assign(new Error('图文还未通过完整验收，不能准备发布'),{status:409});try{contentReview.enforceLimits(view(job).caption);if(job.reviewEnabled)contentReview.verifyReview(job);job.validation=await workflow('validate',job)}catch(e){job.status='failed';event(job,'成品复验失败：'+e.message);throw new Error('成品发生变化或不完整，已阻止发布准备。请查看任务记录。')}const m=manifest(job),images=m.images.map(i=>safeFile(job.project,i.path)),caption=parseCaption(fs.readFileSync(safeFile(job.project,m.caption_path),'utf8'));return {job,images,caption}}
 async function publish(id){const {job,images,caption}=await ready(id);const captionFile=path.join(job.project,'raw_generated','发布文案.txt');fs.writeFileSync(captionFile,caption.title+'\r\n\r\n'+caption.body,'utf8');const result=await desktop({action:'prepare-publish',folder:job.project,captionFile,files:images,text:images.map(x=>'"'+x+'"').join(' ')});job.publishPreparedAt=new Date().toISOString();persist(job);return {...result,published:false,message:'发布准备已执行。上传与最终发布请在小红书页面确认。',paths:images}}
 function review(id){const job=get(id);if(job.status!=='ready')throw Object.assign(new Error('图文尚未就绪，不能完成检查'),{status:409});if(!job.reviewedAt){job.reviewedAt=new Date().toISOString();persist(job)}return view(job)}
 function publication(id,input){
  const job=get(id);if(typeof input.published!=='boolean')throw new Error('请指定发布标记');
  if(!input.published){job.publication=null;persist(job);return view(job)}
  if(job.status!=='ready'||!job.reviewedAt)throw Object.assign(new Error('请先完成图文检查，再标记已发布'),{status:409});
  let url='';if(input.url!==undefined&&typeof input.url!=='string')throw new Error('作品链接格式不正确');
  if(input.url?.trim()){url=input.url.trim();let parsed;try{parsed=new URL(url)}catch{throw new Error('请输入完整的 https 作品链接')}
   if(parsed.protocol!=='https:'||parsed.username||parsed.password||url.length>2048||!['xiaohongshu.com','www.xiaohongshu.com','xhslink.com','www.xhslink.com'].includes(parsed.hostname))throw new Error('请填写小红书或 xhslink.com 的 https 作品链接');}
  job.publication={source:'manual',markedAt:job.publication?.markedAt||new Date().toISOString(),url};persist(job);return view(job);
 }
 async function copy(id,kind){const {images,caption}=await ready(id);if(!['title','body','paths'].includes(kind))throw new Error('未知复制类型');const text=kind==='paths'?images.map(x=>'"'+x+'"').join(' '):caption[kind];const result=await desktop({action:'copy',text,files:kind==='paths'?images:[]});return {...result,text}}
 async function openFolder(id){const job=get(id);await syncAccess(job.project);return desktop({action:'open-folder',folder:job.project})}
 async function asset(id,name){const job=get(id);if(!/^\d{2}_[^/\\]+\.png$/i.test(name))throw new Error('无效图片');const file=safeFile(job.project,name);try{await syncAccess(job.project)}catch(e){e.status=503;throw e}return file}
 function list(){return [...jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(view)}
 async function progress(id){const job=get(id);await refreshMedia(id);if(ACTIVE.has(job.status))try{const p=json(path.join(job.project,'raw_generated','progress.json'));if(typeof p.message==='string'&&p.message!==job.progressMessage){job.progressMessage=p.message;event(job,p.message.slice(0,400))}}catch{}return view(job)}
 async function close(){
  closing=true;await Promise.allSettled([...startingOperations]);
  const entries=[...active.entries()];for(const [id] of entries){const job=get(id);if(job.status!=='validating'){job.status='interrupted';event(job,'本地服务关闭，已保存当前进度。')}}
  await Promise.allSettled(entries.map(async([,entry])=>{await entry.handle?.cancel();await entry.done}));
 }
 reconcileQueues();
 return {capability,queueItems,queueConfig,updateQueue,openQueue,park,syncQueue,create,retry,cancel,publish,review,startContentReview,publication,copy,openFolder,asset,list,progress,refreshMedia,close,get,view,ready,dataRoot,queue};
}
module.exports={createAtlas,inside,safeFile,parseCaption,dateShanghai,atomic,displayMessage};
