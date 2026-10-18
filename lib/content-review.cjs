const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const imageCopy=require('../config/image-copy.json');
const limits=require('../config/publishing-limits.json');
const captionQuality=require('../config/caption-quality.json');
const CHECKS=['facts_checked','image_text_read','caption_image_consistent','all_issues_resolved'];
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function local(project,name){
 if(typeof name!=='string'||path.isAbsolute(name))throw new Error('复审文件路径无效');
 const file=path.resolve(project,name),rel=path.relative(project,file);
 if(!rel||rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel)||!fs.statSync(file).isFile())throw new Error('复审文件必须位于作品内');
 const real=path.relative(fs.realpathSync(project),fs.realpathSync(file));
 if(real.startsWith('..'+path.sep)||real==='..'||path.isAbsolute(real))throw new Error('复审文件不能链接到作品之外');
 return file;
}
function read(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))}
function captionMetrics(caption){
 const count=text=>Array.from(text.replace(/\r\n?/g,'\n').trim()).length;
 const title=count(caption.title),body=count(caption.body);
 return {title,body,maxTitle:limits.maxTitleChars,maxBody:limits.maxBodyChars,valid:title>0&&body>0&&title<=limits.maxTitleChars&&body<=limits.maxBodyChars};
}
function enforceLimits(caption){const m=captionMetrics(caption);if(!m.valid)throw new Error(`小红书字数超限或文案为空：标题 ${m.title}/${m.maxTitle}，正文与标签 ${m.body}/${m.maxBody}；请精简后再发布`);return m}
function outputs(job){
 const m=read(job.manifest);
 if(!Number.isInteger(m.content_pages)||!Array.isArray(m.images)||m.images.length!==m.content_pages+1)throw new Error('请先完成全部图片，再进行内容复审');
 const names=[path.relative(job.project,job.manifest),m.caption_path,m.full_text_path,...m.images.map(i=>i.path),...m.images.map(i=>i.copy_path)];
 return {manifest:m,files:[...new Set(names)].map(name=>({path:name,sha256:hash(local(job.project,name))}))};
}
function prepareReview(job){
 const before=outputs(job),runId=crypto.randomUUID(),dir=path.join(job.project,'raw_generated','reviews',runId);
 fs.mkdirSync(dir,{recursive:true});
 for(const file of before.files){const target=path.join(dir,'originals',file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(local(job.project,file.path),target)}
 fs.writeFileSync(path.join(dir,'input.json'),JSON.stringify({runId,createdAt:new Date().toISOString(),files:before.files},null,2));
 return {runId,status:'running',reportPath:path.relative(job.project,path.join(dir,'report.json')),startedAt:new Date().toISOString()};
}
function verifyReaderReview(review,caption){
 const fail=message=>{throw new Error('内容复审未通过：阅读复审'+message)};
 if(!review||!['question','takeaway','explanation','coverage','reading_notes'].every(key=>typeof review[key]==='string'&&review[key].trim()))fail('缺少具体阅读证据');
 const body=caption.trim().split(/\r?\n/).slice(1).join('\n').replace(/(?<!\S)#[^\s#]+/g,'').trim();
 if(typeof review.opening_excerpt!=='string'||!review.opening_excerpt.trim()||!body.startsWith(review.opening_excerpt))fail('未引用实际正文开头');
 if(typeof review.answer_excerpt!=='string'||!review.answer_excerpt.trim()||!body.includes(review.answer_excerpt))fail('未引用实际正文答案');
 if(!captionQuality.readerChecks.every(key=>review.checks?.[key]===true))fail('标题兑现、推进或具体解释未通过');
}
function verifyReview(job){
 const run=job.contentReview;
 if(!run?.runId||!run.reportPath)throw new Error('缺少独立 Codex 复审记录');
 const report=read(local(job.project,run.reportPath)),after=outputs(job);
 const fail=message=>{throw new Error('内容复审未通过：'+message)};
 if(report.runId!==run.runId||report.status!=='passed')fail('报告未通过或属于其他运行');
 if(typeof report.summary!=='string'||!report.summary.trim())fail('缺少结论');
 if(!CHECKS.every(key=>report.checks?.[key]===true))fail('缺少实际图文核查签核');
 if(!Array.isArray(report.files)||report.files.length!==after.files.length||!after.files.every(file=>report.files.filter(r=>r.path===file.path&&r.sha256===file.sha256).length===1))fail('文件已修改，报告与当前图文不一致');
 if(!Array.isArray(report.pages)||report.pages.length!==after.manifest.images.length||!after.manifest.images.every(im=>report.pages.filter(p=>p.path===im.path&&typeof p.observations==='string'&&p.observations.trim()).length===1))fail('没有逐张检查实际图片');
 if(!Array.isArray(report.sources)||!report.sources.length||!report.sources.every(s=>typeof s.claim==='string'&&s.claim.trim()&&/^https?:\/\//.test(s.url)))fail('缺少事实核查来源');
 if(!Array.isArray(report.issues)||report.issues.some(i=>i.status!=='fixed'||typeof i.description!=='string'||!i.description.trim()||typeof i.correction!=='string'||!i.correction.trim()))fail('仍有未解决的问题或缺少修订说明');
 if(job.captionPolicy===captionQuality.id)verifyReaderReview(report.reader_review,fs.readFileSync(local(job.project,after.manifest.caption_path),'utf8'));
 return {status:'passed',summary:report.summary,issueCount:report.issues.length,completedAt:new Date().toISOString()};
}
function reviewInstructions(job,root){
 const pictureReading=`\n【图片底部百科介绍复审】当前图中文字策略：${job.imageCopyPolicy||'legacy'}。${imageCopy.prompt}\n${imageCopy.reviewGuidance.map((rule,index)=>`${index+1}. ${rule}`).join('\n')}\n`;
 const reading=job.captionPolicy===captionQuality.id?`\n【独立阅读复审】\n${captionQuality.reviewGuidance.map((rule,index)=>`${index+1}. ${rule}`).join('\n')}\n按 ${path.join(root,'docs','caption-quality.md')} 的 reader_review 结构，在独立报告顶层保存 reader_review，不能只保留 manifest 中的生成自评。\n`:'';
 return `\n【当前阶段：独立内容复审，优先执行本段】这不是重新生成整篇的任务。你是新会话中的复审者，不采信上一会话的自评作为事实。全部图文已保存，请实际打开每张最终PNG，逐字检查标题、标注、时间、关系、事实与可读性，再核对发布文案、完整底稿、来源、每页copy和数量计划。网络检索可靠来源核实关键事实，区分确定事实、解释和争议，不能只读文字稿代替看图。\n用户已授权你修正错误：文案错误直接改原文；图片错误用内置image_gen从授权参考底稿重新生成对应页，保留其他合格页，禁止本地叠字或修图合成。保持本任务的风格、1–11张分页策略与图内标记要求。宿主已备份原文件，勿删除备份。修正后同步实际调用证据、图片SHA256、page-copy、逐页QA、caption_review和正文引用；实际复看修订稿，未解决的问题不得签通过。\n小红书普通图文最高标题${limits.maxTitleChars}字、正文含标签${limits.maxBodyChars}字；超过时由你精简，禁止程序截断。结合上下文审查文风，不把“再次”“最后”等正常用词当作错误，不因措辞偏好重画合格图片。旧会话日志中的禁词规则已废止，不得恢复执行；若仅文字记录与合格图片不一致，应按实际图中文字修正记录，不重画图片；不要因为沙箱无法启动Python就停止事实复审，记录该工具限制，宿主会独立执行完整验证。\n${pictureReading}${reading}必须读取 ${path.join(root,'docs','content-review.md')}，按schema把本轮报告写入 ${path.join(job.project,job.contentReview.reportPath)}。runId=${job.contentReview.runId}。至少逐页记录实际观察、核实来源及修正了什么；没有错误时issues=[]，不编造修改。报告files须绑定最终manifest、文案、完整底稿、每张图片和copy的真实SHA256。生成阶段已完成，不操作队列或commit，不操作发布网站。未解决时status=blocked并如实记录。复审后结束，由宿主验收与提交。\n`;
}
module.exports={limits,captionMetrics,enforceLimits,prepareReview,verifyReview,reviewInstructions,outputs,CHECKS};
