// Structural fixtures; injected launcher/validator, never evidence of actual AI review.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createAtlas,atomic}=require('../lib/atlas.cjs');
const review=require('../lib/content-review.cjs');
const runtime=require('../lib/runtime.cjs');
const root=path.resolve(__dirname,'..');
const delay=()=>new Promise(r=>setTimeout(r,15));
async function until(fn){for(let i=0;i<250;i++){if(fn())return;await delay()}assert.fail('fixture timed out')}
function populate(job){
 const manifest=JSON.parse(fs.readFileSync(job.manifest));
 manifest.content_pages=0;manifest.images=[{index:0,role:'cover',path:'00_fixture.png',copy_path:'raw_generated/page.md'}];
 fs.writeFileSync(path.join(job.project,'00_fixture.png'),'SYNTHETIC pixels; not generated media');
 fs.writeFileSync(path.join(job.project,'raw_generated/page.md'),'Synthetic page copy');
 fs.writeFileSync(path.join(job.project,manifest.caption_path),'# 测试标题\n\n测试正文，说明结构测试如何工作。\n#测试');
 fs.writeFileSync(path.join(job.project,manifest.full_text_path),'Synthetic factual basis');atomic(job.manifest,manifest);
}
function readerEvidence(){return {question:'结构夹具问题',takeaway:'结构夹具收获',opening_excerpt:'测试正文，说明结构测试如何工作。',answer_excerpt:'说明结构测试如何工作。',explanation:'Synthetic progression evidence, not real editorial QA.',coverage:'Synthetic coverage evidence.',reading_notes:'Synthetic notes only.',checks:{title_promise_delivered:true,narrative_progression:true,concrete_explanations:true}}}
function report(job,changes={}){
 const out=review.outputs(job);
 atomic(path.join(job.project,job.contentReview.reportPath),{runId:job.contentReview.runId,status:'passed',summary:'SYNTHETIC structural pass; not AI QA.',checks:Object.fromEntries(review.CHECKS.map(k=>[k,true])),files:out.files,pages:out.manifest.images.map(im=>({path:im.path,observations:'Synthetic observation; not a real image review.'})),sources:[{url:'https://example.com/fixture',claim:'Fixture only'}],issues:[],reader_review:readerEvidence(),...changes});
}
function fixture(launch){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-review-test-')),calls=[];
 const atlas=createAtlas({root,dataRoot:dir,detect:async()=>({available:true}),exportAccess:async()=>{},launch,
  execute:async(binary,args,options)=>{calls.push(args);if(args.includes('validate')&&calls.failNextValidation){calls.failNextValidation--;throw Error('Injected host validation failure')}return args.includes('validate')||args.includes('commit')?{stdout:'{"valid":true}'}:runtime.run(binary,args,options)}});
 return {atlas,calls,dir,cleanup:async()=>{await atlas.close();await delay();fs.rmSync(dir,{recursive:true,force:true})}};
}
test('platform limits accept exact Unicode boundaries and count tags/newlines',()=>{
 assert.equal(review.captionMetrics({title:'题'.repeat(20),body:'😀'.repeat(1000)}).body,1000);
 assert.equal(review.enforceLimits({title:'题'.repeat(20),body:'文'.repeat(1000)}).valid,true);
 assert.throws(()=>review.enforceLimits({title:'题'.repeat(21),body:'正文'}),/20/);
 assert.throws(()=>review.enforceLimits({title:'标题',body:'文'.repeat(998)+'\n#标签'}),/1000/);
 assert.equal(review.captionMetrics({title:'标题',body:'甲\r\n乙'}).body,3);
});
test('enabled review launches separately, fixes copy, backs up originals and blocks stale report',async()=>{
 const stages=[];const f=fixture((job,instruction)=>{stages.push(job.status);
  if(job.status==='generating')populate(job);else{assert.match(instruction,/独立内容复审/);assert.match(instruction,/图片底部百科介绍复审/);assert.match(instruction,/连读整组图片的末句/);assert.match(instruction,/讲清楚就结束/);assert.match(instruction,/无必要的纠偏式结尾/);assert.match(instruction,/当前图中文字策略：encyclopedia-v2/);assert.match(instruction,/不按关键词判定/);assert.match(instruction,/仅重生成受影响页/);const m=review.outputs(job).manifest;fs.appendFileSync(path.join(job.project,m.caption_path),'\n修正后的说明');report(job,{issues:[{description:'Fixture typo',correction:'Fixture correction',status:'fixed'}]})}
  return {done:Promise.resolve(),cancel:async()=>{}}});
 try{const j=await f.atlas.create('test');await until(()=>f.atlas.get(j.id).status==='ready');const saved=f.atlas.get(j.id);
  assert.deepEqual(stages,['generating','reviewing']);assert.equal(saved.contentReview.issueCount,1);assert.equal(f.calls.filter(a=>a.includes('commit')).length,1);
  const old=path.join(saved.project,path.dirname(saved.contentReview.reportPath),'originals',review.outputs(saved).manifest.caption_path);
  assert.doesNotMatch(fs.readFileSync(old,'utf8'),/修正后的说明/);
  const originalFile=path.join(saved.project,review.outputs(saved).manifest.caption_path);fs.appendFileSync(originalFile,'\n后续变更');
  await assert.rejects(f.atlas.ready(j.id),/成品发生变化/);assert.equal(saved.status,'failed');
 }finally{await f.cleanup()}
});
test('disabled review skips the extra session and still enforces publication limits',async()=>{
 const stages=[];const f=fixture(job=>{stages.push(job.status);populate(job);return {done:Promise.resolve(),cancel:async()=>{}}});
 try{await assert.rejects(f.atlas.create('test',{reviewEnabled:'false'}),/布尔/);const j=await f.atlas.create('test',{reviewEnabled:false});await until(()=>f.atlas.get(j.id).status==='ready');assert.deepEqual(stages,['generating']);assert.equal(f.atlas.view(f.atlas.get(j.id)).reviewEnabled,false);
  fs.writeFileSync(path.join(j.project,review.outputs(f.atlas.get(j.id)).manifest.caption_path),'# 标题\n\n'+'字'.repeat(1001));
  await assert.rejects(f.atlas.ready(j.id),/成品发生变化/);
 }finally{await f.cleanup()}
});
test('blocked or absent review prevents commit; retry resumes review without regenerating',async()=>{
 let reviewCount=0,generated=0;const f=fixture(job=>{if(job.status==='generating'){generated++;populate(job)}else{reviewCount++;if(reviewCount===1)report(job,{status:'blocked',issues:[{description:'Unresolved',status:'open'}]});else report(job)}return {done:Promise.resolve(),cancel:async()=>{}}});
 try{const before=fs.readFileSync(f.atlas.queue),j=await f.atlas.create('test');await until(()=>f.atlas.get(j.id).status==='failed');assert.equal(f.calls.filter(a=>a.includes('commit')).length,0);assert.deepEqual(fs.readFileSync(f.atlas.queue),before);
  await f.atlas.retry(j.id);await until(()=>f.atlas.get(j.id).status==='ready');assert.equal(generated,1);assert.equal(reviewCount,2);
 }finally{await f.cleanup()}
});
test('missing review report fails closed',async()=>{
 const f=fixture(job=>{if(job.status==='generating')populate(job);return {done:Promise.resolve(),cancel:async()=>{}}});
 try{const j=await f.atlas.create('test');await until(()=>f.atlas.get(j.id).status==='failed');assert.equal(f.calls.filter(a=>a.includes('commit')).length,0)}finally{await f.cleanup()}
});
test('review cancellation retains files and does not commit',async()=>{
 let end;const f=fixture(job=>{if(job.status==='generating'){populate(job);return {done:Promise.resolve(),cancel:async()=>{}}}return {done:new Promise(r=>end=r),cancel:async()=>end()}});
 try{const j=await f.atlas.create('test');await until(()=>f.atlas.get(j.id).status==='reviewing');await assert.rejects(f.atlas.create('test'),/这篇任务正在运行/);await f.atlas.cancel(j.id);await delay();assert.equal(f.atlas.get(j.id).status,'cancelled');assert.ok(fs.existsSync(path.join(j.project,'00_fixture.png')));assert.equal(f.calls.filter(a=>a.includes('commit')).length,0)}finally{await f.cleanup()}
});
test('report rejects missing pages, unresolved issues, wrong run and altered image bytes',async()=>{
 const f=fixture(job=>{populate(job);return {done:Promise.resolve(),cancel:async()=>{}}});
 try{const j=await f.atlas.create('test',{reviewEnabled:false});await until(()=>f.atlas.get(j.id).status==='ready');const job=f.atlas.get(j.id);job.contentReview=review.prepareReview(job);
  for(const change of [{pages:[]},{issues:[{status:'open'}]},{runId:'other'},{sources:[]}]){report(job,change);assert.throws(()=>review.verifyReview(job),/复审未通过/)}
  report(job);fs.appendFileSync(path.join(job.project,'00_fixture.png'),'modified');assert.throws(()=>review.verifyReview(job),/报告与当前图文不一致/);
 }finally{await f.cleanup()}
});
test('manual review HTTP endpoint requires token and runs on an existing complete work',async()=>{
 const phases=[];const f=fixture(job=>{phases.push(job.status);if(job.status==='generating')populate(job);else report(job);return {done:Promise.resolve(),cancel:async()=>{}}});
 const {makeServer}=require('../server.cjs');const server=makeServer({atlas:f.atlas});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{const j=await f.atlas.create('test',{reviewEnabled:false});await until(()=>f.atlas.get(j.id).status==='ready');
  const b=await(await fetch(base+'/api/bootstrap')).json();assert.equal(b.publishingLimits.maxBodyChars,1000);
  const post=token=>fetch(base+'/api/jobs/'+j.id+'/content-review',{method:'POST',headers:{'Content-Type':'application/json','X-Orbit-Token':token},body:'{}'});
  assert.equal((await post('wrong')).status,403);assert.equal((await post(b.token)).status,200);
  await until(()=>f.atlas.get(j.id).status==='ready');assert.deepEqual(phases,['generating','reviewing']);assert.equal(f.atlas.get(j.id).reviewEnabled,true);
 }finally{await new Promise(r=>server.close(r));await f.cleanup()}
});
test('continuing a completed generation can enable review without regenerating images',async()=>{
 const phases=[];let stop;const f=fixture(job=>{phases.push(job.status);if(job.status==='generating'){populate(job);return {done:new Promise(r=>stop=r),cancel:async()=>stop()}}report(job);return {done:Promise.resolve(),cancel:async()=>{}}});
 try{const first=await f.atlas.create('production',{reviewEnabled:false});await f.atlas.cancel(first.id);await delay();await delay();
  const next=await f.atlas.startContentReview(first.id);assert.equal(next.id,first.id);await until(()=>f.atlas.get(first.id).status==='ready');
  assert.deepEqual(phases,['generating','reviewing']);assert.equal(f.atlas.get(first.id).reviewEnabled,true);
 }finally{await f.cleanup()}
});
test('valid review can retry host validation without another Codex session',async()=>{
 const phases=[];const f=fixture(job=>{phases.push(job.status);if(job.status==='generating')populate(job);else report(job);return {done:Promise.resolve(),cancel:async()=>{}}});
 f.calls.failNextValidation=1;
 try{const j=await f.atlas.create('test');await until(()=>f.atlas.get(j.id).status==='failed');assert.equal(f.atlas.get(j.id).contentReview.status,'passed');assert.equal(f.calls.filter(a=>a.includes('commit')).length,0);
  await f.atlas.retry(j.id);assert.equal(f.atlas.get(j.id).status,'ready');assert.deepEqual(phases,['generating','reviewing']);
 }finally{await f.cleanup()}
});

test('v2 independent review rejects missing or invented reading evidence and accepts v1 reports',async()=>{
 const f=fixture(job=>{populate(job);return {done:Promise.resolve(),cancel:async()=>{}}});
 try{
  const j=await f.atlas.create('test',{reviewEnabled:false});await until(()=>f.atlas.get(j.id).status==='ready');const job=f.atlas.get(j.id);
  job.contentReview=review.prepareReview(job);
  for(const evidence of [undefined,{...readerEvidence(),opening_excerpt:'说明结构测试'},
   {...readerEvidence(),answer_excerpt:'不存在的答案'},{...readerEvidence(),answer_excerpt:'#测试'},
   {...readerEvidence(),reading_notes:''},{...readerEvidence(),checks:{title_promise_delivered:true}}]){
   report(job,{reader_review:evidence});assert.throws(()=>review.verifyReview(job),/阅读复审/);
  }
  report(job);assert.equal(review.verifyReview(job).status,'passed');
  const instruction=review.reviewInstructions(job,root);assert.match(instruction,/独立阅读复审/);assert.match(instruction,/正文可选择重点案例/);assert.match(instruction,/表达编辑完成后核实/);
  job.captionPolicy='reader-analysis-v1';report(job,{reader_review:undefined});assert.equal(review.verifyReview(job).status,'passed');
  assert.doesNotMatch(review.reviewInstructions(job,root),/【独立阅读复审】/);
 }finally{await f.cleanup()}
});

test('failed reading review blocks commit until a fresh independent review resolves it',async()=>{
 let attempts=0;const stages=[];
 const f=fixture(job=>{stages.push(job.status);if(job.status==='generating')populate(job);else{attempts++;report(job,{reader_review:attempts===1?{...readerEvidence(),checks:{...readerEvidence().checks,narrative_progression:false}}:readerEvidence()})}return {done:Promise.resolve(),cancel:async()=>{}}});
 try{
  const j=await f.atlas.create('test');await until(()=>f.atlas.get(j.id).status==='failed');
  assert.equal(f.calls.filter(args=>args.includes('commit')).length,0);
  await f.atlas.retry(j.id);await until(()=>f.atlas.get(j.id).status==='ready');
  assert.deepEqual(stages,['generating','reviewing','reviewing']);assert.equal(attempts,2);
 }finally{await f.cleanup()}
});
