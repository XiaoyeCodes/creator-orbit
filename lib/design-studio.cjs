'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const runtime=require('./runtime.cjs');
const {createAccessSync}=require('./media-access.cjs');
const {atomic,safeFile,inside}=require('./atlas.cjs');
const {loadCatalog,validateTopic,snapshotPages,hash,filenames}=require('./design-studio-content.cjs');
const ACTIVE=new Set(['queued','generating','validating']);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function dimensions(file){const b=fs.readFileSync(file);if(b.length<24||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw fail('素材不是有效PNG');return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)}}
function createStudio({root=path.resolve(__dirname,'..'),dataRoot=path.join(root,'data','design-studio'),catalog=null,detect=runtime.detect,launch=null,execute=runtime.run,exportAccess=project=>runtime.exportAccess(root,project),syncAccess=null,desktop=payload=>runtime.desktop(root,payload),sampleDir=path.resolve(root,'..','output','design-studio','2026-10-18-bookstore-commute')}={}){
 const jobRoot=path.join(dataRoot,'jobs'),workRoot=path.join(dataRoot,'works'),editRoot=path.join(dataRoot,'edits');
 const jobs=new Map(),active=new Map();let closing=false,starting=false,capabilities=null,capAt=0;
 const syncMedia=syncAccess||createAccessSync(exportAccess);
 for(const dir of [jobRoot,workRoot,editRoot])fs.mkdirSync(dir,{recursive:true});
 const source=()=>typeof catalog==='function'?catalog():catalog||loadCatalog(root);
 for(const name of fs.readdirSync(jobRoot).filter(n=>n.endsWith('.json'))){try{const j=read(path.join(jobRoot,name));if(!/^[a-zA-Z0-9-]+$/.test(j.id)||!inside(workRoot,j.project))continue;snapshotPages(j.snapshot);if(ACTIVE.has(j.status)){j.status='interrupted';j.message='上次创作中断，已有图片保留，可以继续。';atomic(path.join(jobRoot,name),j)}jobs.set(j.id,j)}catch{}}
 const persist=j=>{j.updatedAt=new Date().toISOString();atomic(path.join(jobRoot,j.id+'.json'),j)};
 const event=(j,message)=>{j.message=message;j.events=(j.events||[]).concat({time:new Date().toISOString(),message}).slice(-30);persist(j)};
 const get=id=>{const j=jobs.get(id);if(!j)throw fail('作品不存在',404);return j};
 function effective(base){const file=path.join(editRoot,base.id+'.json');let t=structuredClone(base);if(fs.existsSync(file)){const edit=read(file);t={...t,...edit.fields}}validateTopic(t);t.revision=hash(t);return t}
 function topicView(t){const related=[...jobs.values()].filter(j=>j.topicId===t.id);const ready=related.find(j=>j.status==='ready');return {...t,status:related.some(j=>ACTIVE.has(j.status))?'generating':ready?'ready':'prepared',...(ready?{sampleJobId:ready.id}:{})}}
 function topics(){return source().topics.map(t=>topicView(effective(t)))}
 function topic(id){const t=source().topics.find(t=>t.id===id);if(!t)throw fail('选题不存在',404);return topicView(effective(t))}
 async function capability(){if(!capabilities||Date.now()-capAt>60000){capabilities=await detect();capAt=Date.now()}return capabilities}
 function view(j){const pages=snapshotPages(j.snapshot);let images=[];for(const page of pages){const filename=page.filename;try{const file=safeFile(j.project,filename);images.push({name:filename,index:page.index,role:page.role,title:page.title,url:`/api/studio/jobs/${j.id}/assets/${filename}`,...dimensions(file)})}catch{}}
  const t=j.snapshot;return {id:j.id,topicId:j.topicId,revision:t.revision,title:j.title,status:j.status,message:[j.message,j.accessWarning].filter(Boolean).join(' '),accessWarning:j.accessWarning||null,createdAt:j.createdAt,updatedAt:j.updatedAt,images,pages,pageCount:pages.length,schemaVersion:t.schemaVersion??1,variantLabel:j.variantLabel||t.variantLabel||null,compareWithJobId:j.compareWithJobId||t.compareWithJobId||null,design:t.design,caption:{title:t.title,body:t.caption,tags:t.tags},project:j.project,events:j.events||[],review:j.review||null,ready:j.status==='ready',sample:!!j.sample};
 }
 const list=()=>[...jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(view);
 async function refreshMedia(id){await Promise.all((id?[get(id)]:[...jobs.values()]).map(async j=>{try{await syncMedia(j.project);j.accessWarning=null}catch(e){j.accessWarning=e.message}}))}
 async function progress(id){await refreshMedia(id);return view(get(id))}
 function importSample(){
  if(!sampleDir||jobs.has('sample-bookstore'))return;
  const original=['01_封面.png','02_结构细节.png','03_内部分区.png','04_书店场景.png'];
  if(!original.every(n=>fs.existsSync(path.join(sampleDir,n))))return;
  const base=source().topics.find(t=>t.id==='DS001');if(!base)return;
  const t=effective(base),project=path.join(workRoot,'sample-bookstore');fs.mkdirSync(project,{recursive:true});
  original.forEach((name,i)=>fs.copyFileSync(path.join(sampleDir,name),path.join(project,filenames[i])));
  const captionFile=path.join(sampleDir,'主题与发布文案.txt');
  if(fs.existsSync(captionFile)){const text=fs.readFileSync(captionFile,'utf8'),title=text.match(/小红书标题：\s*\r?\n([^\r\n]+)/),body=text.match(/正文：\s*\r?\n([\s\S]*?)\r?\n标签：/),tags=text.match(/标签：\s*\r?\n([^\r\n]+)/);if(title)t.title=title[1].trim();if(body)t.caption=body[1].trim();if(tags)t.tags=tags[1].trim().split(/\s+/).map(x=>x.replace(/^#/,''));}
  const reviewed=path.join(sampleDir,'生成与核对记录.json');if(fs.existsSync(reviewed))fs.copyFileSync(reviewed,path.join(project,'sample-provenance.json'));
  const originalPrompts=path.join(sampleDir,'逐图提示词.txt');if(fs.existsSync(originalPrompts)){fs.copyFileSync(originalPrompts,path.join(project,'sample-original-prompts.txt'));const parts=fs.readFileSync(originalPrompts,'utf8').split(/={10,}\r?\n[1-4]\. [^\r\n]+\r?\n={10,}\r?\n/).slice(1);if(parts.length===4){fs.mkdirSync(path.join(project,'prompts'),{recursive:true});parts.forEach((p,i)=>{t.pages[i].prompt=p.trim();fs.writeFileSync(path.join(project,'prompts',filenames[i].replace('.png','.txt')),p.trim(),'utf8')})}}
  atomic(path.join(project,'topic.json'),t);fs.writeFileSync(path.join(project,'caption.txt'),t.title+'\n\n'+t.caption+'\n\n'+t.tags.map(x=>'#'+x).join(' '),'utf8');
  const now=new Date().toISOString(),j={id:'sample-bookstore',topicId:t.id,title:t.title,snapshot:t,project,sample:true,status:'ready',createdAt:now,events:[],review:{status:'逐图检查通过',source:'本聊天已实际生成并逐张检查的通勤包样稿'}};jobs.set(j.id,j);event(j,'已导入四张通勤包原图与完整样稿。');
 }
 async function bootstrap(){importSample();await refreshMedia();const {profile}=source(),all=topics();return {version:1,profile,categories:profile.categories.map(c=>({...c,count:all.filter(t=>t.category===c.id).length})),stats:{total:all.length,ready:all.filter(t=>t.status==='ready').length,pending:all.filter(t=>t.status==='prepared').length},topics:all,jobs:list(),capabilities:await capability()}}
 function updateTopic(id,input){
  if(!input||typeof input!=='object')throw fail('选题内容无效');const current=topic(id);if(input.revision!==current.revision)throw fail('这篇选题已在其他窗口修改。请保留当前草稿，刷新后再保存。',409);
  const allowed=['title','caption','tags','pages'];if(Object.keys(input).some(k=>!allowed.includes(k)&&k!=='revision'))throw fail('只能修改发布标题、正文、标签和图片提示词');
  const next={...current};for(const key of allowed)if(Object.hasOwn(input,key))next[key]=input[key];
  validateTopic(next);next.pages.forEach((p,i)=>{if(typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>16000)throw fail(`第${i+1}张提示词为空或过长`);p.filename=filenames[i]});
  const file=path.join(editRoot,id+'.json');if(fs.existsSync(file))fs.copyFileSync(file,path.join(editRoot,id+'.'+Date.now()+'.backup.json'));
  atomic(file,{fields:Object.fromEntries(allowed.map(k=>[k,next[k]])),updatedAt:new Date().toISOString()});return topic(id);
 }
 function instructions(j){const pages=snapshotPages(j.snapshot),names=pages.map(p=>p.filename),count=pages.length,master=names[0];return `你在执行用户授权的偏爱日常设计所单篇图片创作。只处理本篇，禁止发布、登录、联系别人、修改应用或其他任务。\n工作目录：${j.project}\n先读取 topic.json、caption.txt 与 prompts/ 下${count}份完整提示词。用户已准备好文案与设计，不要改写这些文件。\n`+
  `使用当前真正可调用的内置 image_gen 工具，不用API Key、HTTP生图接口、SVG/HTML/Pillow合成替代。一次调用只生成一张。工具不可用时写 blocker.txt，说明实际错误并停止，不假装成功。\n`+
  `先检查已有图片、generation.json和review.json，保留已经合格的图片，只补缺失或重做不合格页。先生成并实际查看${master}，以其为唯一同款外观基准；生成其余${count-1}张时必须实际通过referenced_image_paths传入${master}。页序：${pages.map(p=>`${p.index}. ${p.role}（${p.title}）`).join('；')}。必须保留概念和AI标记。\n`+
  `每张实际传给工具的提示词须保存到prompts/对应原文件，不得删去题材细节。工具完成后把真实PNG复制为 ${names.join('、')}；禁止把${count}页拼成一张。需要检查中文、同款轮廓、材质、锚点、人物/空间比例与文案对应。发现错误只修相应页。\n`+
  `每次工具调用立即保存 generation.json，格式 {"images":[{"filename":"${master}","tool":"image_gen","original_path":"工具实际返回的原图路径","prompt_file":"prompts/${master.replace('.png','.txt')}","referenced_image_paths":[],"sha256":"真实文件哈希"}]}；第2–${count}页的referenced_image_paths必须包含实际${master}绝对路径。文件名按对应页写，记录实际传入的参数，不可补造调用证据。\n`+
  `全部完成后必须逐张实际查看并写review.json：{"verdict":"pass","captionSha256":"caption.txt的真实SHA256","pages":[{"filename":"${master}","sha256":"真实PNG的SHA256","checked":true,"observations":"说明实际看见的文字/结构/一致性，逐页具体记录"}]}。${count}页一条不少，未实际看图不可签通过。\n`+
  `所有图片为3:4，宽至少768像素；只用Pillow读取尺寸、解码核验或原字节复制，不编辑图片。文件和质量检查结束后直接退出；不得更新服务器状态或另外启动任务。`;
 }
 function launchCodex(j,prompt){
  const executable=runtime.findCodex();if(!executable)throw fail('未找到Codex，请检查创作环境',503);
  fs.writeFileSync(path.join(j.project,'generation-instructions.txt'),prompt,'utf8');
  const args=['exec','--ignore-user-config','--sandbox','workspace-write','--skip-git-repo-check','--ephemeral','--json','-c','approval_policy="never"','-c','features.multi_agent=false','-C',j.project,'-o',path.join(j.project,'generation-result.txt'),'-'];
  if(process.platform==='win32')args.splice(args.length-1,0,'-c','windows.sandbox="elevated"');
  const child=spawn(executable,args,{cwd:j.project,env:runtime.cleanEnv(),windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  const out=fs.createWriteStream(path.join(j.project,`generation-${Date.now()}.jsonl`)),err=fs.createWriteStream(path.join(j.project,'generation-stderr.log'),{flags:'a'});child.stdout.pipe(out);child.stderr.pipe(err);let tail='',buffer='';
  child.stderr.on('data',x=>{tail=(tail+x).slice(-2000)});child.stdout.on('data',x=>{buffer+=x.toString();let pos;while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);try{const row=JSON.parse(line);if(row.type==='item.completed'&&row.item?.type==='agent_message'&&ACTIVE.has(j.status))event(j,row.item.text.slice(0,700));if(row.type==='turn.failed')tail=row.error?.message||tail}catch{}}if(buffer.length>4000000)buffer=buffer.slice(-1000000)});
  child.stdin.on('error',()=>{});child.stdin.end(prompt);
  return {done:new Promise((resolve,reject)=>{child.on('error',e=>{out.end();err.end();reject(e)});child.on('close',code=>{out.end();err.end();code===0?resolve():reject(new Error(tail||`图片生成进程退出 (${code})`))})}),cancel:()=>new Promise(resolve=>{if(!child.pid)return resolve();if(process.platform==='win32'){const kill=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.on('error',()=>{child.kill();resolve()});kill.on('close',resolve)}else{child.kill();resolve()}})};
 }
 async function validate(j){
  const pages=snapshotPages(j.snapshot),names=pages.map(p=>p.filename),count=pages.length;
  const expectedCaption=j.snapshot.title+'\n\n'+j.snapshot.caption+'\n\n'+j.snapshot.tags.map(x=>'#'+x).join(' ');
  if(fs.readFileSync(path.join(j.project,'caption.txt'),'utf8')!==expectedCaption)throw fail('生成过程改变了已确认文案，请恢复稿件后继续');
  pages.forEach((page,i)=>{if(fs.readFileSync(path.join(j.project,'prompts',page.filename.replace('.png','.txt')),'utf8')!==page.prompt)throw fail(`第${i+1}张图片提示词与稿件快照不一致`)});
  if(!fs.existsSync(path.join(j.project,'generation.json'))||!fs.existsSync(path.join(j.project,'review.json')))throw fail('图片或逐图检查记录不完整，可继续补齐。');
  const records=read(path.join(j.project,'generation.json')),review=read(path.join(j.project,'review.json'));
  if(review.verdict!=='pass'||review.captionSha256!==sha(path.join(j.project,'caption.txt')))throw fail('文案检查记录与当前稿件不一致');
  if(!Array.isArray(records.images)||!Array.isArray(review.pages)||records.images.length!==count||review.pages.length!==count)throw fail(`需要完整的${count}图生成与检查记录`);
  const hashes=new Set();for(let i=0;i<count;i++){
   const name=names[i],file=safeFile(j.project,name),d=dimensions(file),digest=sha(file),entry=records.images.find(x=>x.filename===name),check=review.pages.find(x=>x.filename===name);
   if(d.width<768||Math.abs(d.width/d.height-.75)>.015)throw fail(`${name}尺寸不符合3:4竖图要求`);
   if(hashes.has(digest))throw fail('不同页面不能重复使用同一张图');hashes.add(digest);
   if(entry?.tool!=='image_gen'||entry.sha256!==digest||typeof entry.original_path!=='string'||!entry.original_path||check?.sha256!==digest||check.checked!==true||typeof check.observations!=='string'||check.observations.trim().length<8)throw fail(`${name}缺少真实生成或逐图检查记录`);
   if(entry.prompt_file!==`prompts/${name.replace('.png','.txt')}`)throw fail(`${name}提示词记录不一致`);
   if(i>0&&(!Array.isArray(entry.referenced_image_paths)||!entry.referenced_image_paths.some(p=>typeof p==='string'&&path.resolve(p)===path.join(j.project,names[0]))))throw fail(`${name}未使用主视觉参考`);
  }
  await execute(runtime.pythonBinary(),['-c','from PIL import Image\nimport sys\nfor p in sys.argv[1:]:\n im=Image.open(p); im.verify()\n',...names.map(n=>path.join(j.project,n))],{cwd:j.project,timeout:30000});
  j.review={status:'逐图检查通过',pages:review.pages};return true;
 }
 async function run(j){let handle,timer;try{
   const count=snapshotPages(j.snapshot).length;
   j.status='generating';event(j,`正在生成主视觉；后续${count-1}图会引用同一设计。`);
   handle=(launch||launchCodex)(j,instructions(j));active.get(j.id).handle=handle;
   timer=setTimeout(()=>{if(ACTIVE.has(j.status)){j.status='interrupted';event(j,'本轮超过45分钟，已保留素材，可继续。');void handle.cancel()}},45*60000);timer.unref();
   await handle.done;if(!ACTIVE.has(j.status))return;
   await syncMedia(j.project);if(!ACTIVE.has(j.status))return;
   j.status='validating';event(j,`图片生成结束，正在核对${count}图、参考输入和检查记录。`);await validate(j);
   if(j.status!=='validating')return;j.status='ready';event(j,`${count}张图片和发布文案已就绪。`);
  }catch(e){if(ACTIVE.has(j.status)){j.status='failed';event(j,e.message||'生成失败，已有文件保留')}}finally{clearTimeout(timer);await refreshMedia(j.id);active.delete(j.id);persist(j)}}
 async function create({topicId,revision}={}){
  if(closing)throw fail('服务正在关闭',503);if(starting||active.size)throw fail('设计所已有一篇正在创作，请等待完成或停止后再开始。',409);
  starting=true;try{const t=topic(topicId);if(revision!==t.revision)throw fail('稿件已变化，请先保存并刷新当前版本再生成。',409);if([...jobs.values()].some(j=>j.topicId===topicId&&j.snapshot.revision===t.revision&&['failed','interrupted','cancelled'].includes(j.status)))throw fail('此版本已有未完成作品，请继续该作品；修改并保存稿件后，也可另开新作品。',409);
   const caps=await capability();if(closing)throw fail('服务正在关闭',503);if(!caps.available)throw fail(caps.reason||'创作环境未就绪',503);
   const id=crypto.randomUUID(),project=path.join(workRoot,id);fs.mkdirSync(path.join(project,'prompts'),{recursive:true});
   const snapshot=structuredClone(t);delete snapshot.status;delete snapshot.sampleJobId;
   atomic(path.join(project,'topic.json'),snapshot);fs.writeFileSync(path.join(project,'caption.txt'),t.title+'\n\n'+t.caption+'\n\n'+t.tags.map(x=>'#'+x).join(' '),'utf8');t.pages.forEach((p,i)=>fs.writeFileSync(path.join(project,'prompts',filenames[i].replace('.png','.txt')),p.prompt,'utf8'));
   const now=new Date().toISOString(),j={id,topicId,title:t.title,snapshot,project,status:'queued',createdAt:now,events:[]};jobs.set(id,j);persist(j);const entry={handle:null,done:null};active.set(id,entry);entry.done=run(j);return view(j);
  }finally{starting=false}
 }
 async function retry(id){if(closing)throw fail('服务正在关闭',503);if(starting||active.size)throw fail('请先等待当前创作结束',409);const j=get(id);if(!['failed','interrupted','cancelled'].includes(j.status))throw fail('当前作品无需恢复',409);starting=true;try{const caps=await capability();if(closing)throw fail('服务正在关闭',503);if(!caps.available)throw fail(caps.reason||'创作环境未就绪',503);const entry={handle:null,done:null};active.set(id,entry);entry.done=run(j);return view(j)}finally{starting=false}}
 async function cancel(id){const j=get(id);if(!active.has(id))throw fail('这篇作品当前没有运行',409);j.status='cancelled';event(j,'已停止，现有图文保留，可继续生成。');const entry=active.get(id);await entry?.handle?.cancel();await entry?.done;return view(j)}
 async function close(){closing=true;await Promise.all([...active].map(async([id,entry])=>{const j=get(id);j.status='interrupted';event(j,'服务关闭，已有素材保留。');await entry.handle?.cancel();await entry.done}))}
 async function asset(id,name){const j=get(id);if(!snapshotPages(j.snapshot).some(p=>p.filename===name))throw fail('素材不存在',404);try{await syncMedia(j.project)}catch(e){e.status=503;throw e}return safeFile(j.project,name)}
 function exportCatalog(){const {profile}=source();return {version:1,exportedAt:new Date().toISOString(),profile,topics:topics()}}
 async function openFolder(id){return desktop({action:'open-folder',folder:get(id).project})}
 return {bootstrap,topics,topic,updateTopic,create,retry,cancel,close,list,get,view,asset,exportCatalog,openFolder,capability,validate,importSample,refreshMedia,progress,dataRoot};
}
module.exports={createStudio,dimensions};
