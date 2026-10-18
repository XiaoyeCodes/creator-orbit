// Controlled workers + real Python prepare. Validation/media are synthetic;
// these tests verify scheduling and queue isolation, not real AI image quality.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createAtlas,atomic}=require('../lib/atlas.cjs');
const {completeTopic}=require('../lib/topics.cjs');
const runtime=require('../lib/runtime.cjs');
const {makeServer}=require('../server.cjs');
const root=path.resolve(__dirname,'..'),sleep=()=>new Promise(r=>setTimeout(r,15));
async function until(fn){for(let n=0;n<300;n++){if(fn())return;await sleep()}assert.fail('fixture timed out')}
function assets(job){const m=JSON.parse(fs.readFileSync(job.manifest));m.content_pages=0;m.images=[{path:'00_fixture.png',copy_path:'raw_generated/page.md'}];
 fs.writeFileSync(path.join(job.project,'00_fixture.png'),'SYNTHETIC '+job.id);fs.writeFileSync(path.join(job.project,'raw_generated/page.md'),'Synthetic page');
 fs.writeFileSync(path.join(job.project,m.full_text_path),'Synthetic factual basis');fs.writeFileSync(path.join(job.project,m.caption_path),'# '+job.topic+'\n\n隔离调度测试文案。');atomic(job.manifest,m)}
function setup(maxConcurrent=3){
 const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-parallel-')),workers=new Map();
 const options={root,dataRoot,maxConcurrent,detect:async()=>({available:true}),exportAccess:async()=>{},
  execute:(binary,args,opts)=>args.includes('validate')||args.includes('commit')?Promise.resolve({stdout:'{"valid":true}'}):runtime.run(binary,args,opts),
  launch:job=>{let resolve,reject;const worker={done:new Promise((r,j)=>{resolve=r;reject=j}),cancel:async()=>{worker.cancelled=true;resolve()},finish:()=>resolve(),fail:()=>reject(Error('Injected worker failure'))};workers.set(job.id,worker);return worker}};
 let atlas=createAtlas(options);atlas.updateQueue({revision:atlas.queueConfig().revision,text:'\uFEFF# 并行测试\r\n\r\n|Status|Topic|Category|\r\n|-|-|-|\r\n|TODO|甲|测试|\r\n|TODO|乙|测试|\r\n|TODO|丙|测试|\r\n|TODO|丁|测试|\r\n'});
 return {get atlas(){return atlas},workers,dataRoot,options,reload:()=>atlas=createAtlas(options),
  complete:id=>{assets(atlas.get(id));workers.get(id).finish()},idle:()=>until(()=>atlas.queueConfig().concurrency.running===0),
  cleanup:async()=>{await atlas.close();assert.equal(path.dirname(dataRoot),os.tmpdir());assert.ok(path.basename(dataRoot).startsWith('orbit-parallel-'));fs.rmSync(dataRoot,{recursive:true,force:true})}};
}
const production={reviewEnabled:false};
test('three simultaneous requests get distinct workers; out-of-order completion updates only each own row',async()=>{
 const f=setup();try{
  const before=fs.readFileSync(f.atlas.queue,'utf8'),jobs=await Promise.all([0,1,2].map(()=>f.atlas.create('production',production)));
  assert.deepEqual(jobs.map(j=>j.topic),['甲','乙','丙']);assert.equal(new Set(jobs.map(j=>j.project)).size,3);assert.equal(f.workers.size,3);
  assert.equal(f.atlas.queueConfig().concurrency.running,3);assert.equal(f.atlas.queueConfig().nextAvailable.topic,'丁');
  await assert.rejects(f.atlas.create('production',production),/上限/);await assert.rejects(f.atlas.retry(jobs[0].id),/正在运行/);
  f.complete(jobs[1].id);await until(()=>f.atlas.get(jobs[1].id).queueUpdate?.status==='committed');
  assert.equal(fs.readFileSync(f.atlas.queue,'utf8'),before.replace('|TODO|乙|','|已生成|乙|'));
  assert.equal(f.atlas.get(jobs[0].id).status,'generating');assert.equal(f.atlas.get(jobs[2].id).status,'generating');
  f.complete(jobs[2].id);f.complete(jobs[0].id);await f.idle();
  assert.deepEqual(f.atlas.queueConfig().items.map(x=>x.status),['已生成','已生成','已生成','TODO']);
  for(const j of jobs){assert.equal(f.atlas.get(j.id).status,'ready');assert.equal(f.atlas.view(f.atlas.get(j.id)).caption.title,j.topic)}
 }finally{await f.cleanup()}
});
test('cancel, failure, retry and parking only affect their own workers and reservations',async()=>{
 const f=setup();try{
  const a=await f.atlas.create('production',{...production,visualStyle:'illustration'}),b=await f.atlas.create('production',production);
  await assert.rejects(f.atlas.create('production',{...production,topic:a.topic}),/未完成任务/);
  await f.atlas.cancel(a.id);await until(()=>f.atlas.queueConfig().concurrency.running===1);
  assert.equal(f.workers.get(a.id).cancelled,true);assert.equal(f.workers.get(b.id).cancelled,undefined);
  await f.atlas.retry(a.id);assert.equal(f.atlas.get(a.id).visualStyle,'illustration');assert.equal(f.atlas.get(a.id).project,a.project);
  f.workers.get(a.id).fail();await until(()=>f.atlas.queueConfig().concurrency.running===1);assert.equal(f.atlas.get(a.id).status,'failed');
  f.atlas.park(a.id);assert.equal(f.atlas.get(b.id).status,'generating');assert.equal(f.atlas.queueConfig().nextAvailable.topic,'甲');
  const c=await f.atlas.create('production',production);assert.equal(c.topic,'甲');assert.notEqual(c.project,a.project);
  f.complete(b.id);f.complete(c.id);await f.idle();assert.equal(f.atlas.get(a.id).status,'parked');
 }finally{await f.cleanup()}
});
test('manual review shares concurrency capacity and does not cancel another generation',async()=>{
 const f=setup(2);try{
  const a=await f.atlas.create('production',production);f.complete(a.id);await f.idle();
  const b=await f.atlas.create('production',production);await f.atlas.startContentReview(a.id);
  assert.equal(f.atlas.get(a.id).status,'reviewing');assert.equal(f.atlas.queueConfig().concurrency.running,2);
  await assert.rejects(f.atlas.create('production',production),/上限/);
  await f.atlas.cancel(a.id);await until(()=>f.atlas.queueConfig().concurrency.running===1);
  assert.equal(f.atlas.get(b.id).status,'generating');f.complete(b.id);await f.idle();
 }finally{await f.cleanup()}
});
test('close interrupts all active workers; restart keeps files and reservations without occupying slots',async()=>{
 const f=setup();try{
  const jobs=await Promise.all([1,2,3].map(()=>f.atlas.create('production',production)));
  assets(f.atlas.get(jobs[0].id));const before=fs.readFileSync(f.atlas.queue);await f.atlas.close();f.reload();
  assert.equal(f.atlas.queueConfig().concurrency.running,0);assert.equal(f.atlas.queueConfig().reservations.length,3);
  for(const j of jobs)assert.equal(f.atlas.get(j.id).status,'interrupted');assert.deepEqual(fs.readFileSync(f.atlas.queue),before);
  assert.equal(fs.readFileSync(path.join(jobs[0].project,'00_fixture.png'),'utf8'),'SYNTHETIC '+jobs[0].id);
  await f.atlas.retry(jobs[0].id);assert.equal(f.atlas.get(jobs[0].id).status,'generating');
  assert.equal((await f.atlas.create('production',production)).topic,'丁');
 }finally{await f.cleanup()}
});
test('external queue changes cause a recoverable conflict and never destroy completed assets',async()=>{
 const f=setup();try{
  const original=fs.readFileSync(f.atlas.queue,'utf8'),j=await f.atlas.create('production',production);
  fs.writeFileSync(f.atlas.queue,original.replace('|TODO|甲|','|TODO|甲改名|'));const edited=fs.readFileSync(f.atlas.queue);
  f.complete(j.id);await f.idle();assert.equal(f.atlas.get(j.id).status,'ready');assert.equal(f.atlas.get(j.id).queueUpdate.status,'conflict');assert.deepEqual(fs.readFileSync(f.atlas.queue),edited);
  fs.writeFileSync(f.atlas.queue,original);f.atlas.syncQueue(j.id);assert.equal(f.atlas.get(j.id).queueUpdate.status,'committed');
  // Crash after queue write, before marking the job committed: restart is idempotent.
  f.atlas.get(j.id).queueUpdate={status:'committing'};atomic(path.join(f.dataRoot,'jobs',j.id+'.json'),f.atlas.get(j.id));
  fs.appendFileSync(f.atlas.queue,'\r\n外部补充说明');const committed=fs.readFileSync(f.atlas.queue);await f.atlas.close();f.reload();
  assert.equal(f.atlas.get(j.id).queueUpdate.status,'committed');assert.deepEqual(fs.readFileSync(f.atlas.queue),committed);
 }finally{await f.cleanup()}
});
test('shutdown during preparation waits for accepted requests, stops their workers and rejects new work',async()=>{
 const f=setup();try{
  const pending=f.atlas.create('production',production),closed=f.atlas.close(),j=await pending;await closed;
  assert.equal(f.atlas.get(j.id).status,'interrupted');assert.equal(f.workers.get(j.id).cancelled,true);
  assert.equal(f.atlas.queueConfig().concurrency.running,0);await assert.rejects(f.atlas.create('production',production),/正在关闭/);
 }finally{await f.cleanup()}
});
test('legacy shared-queue job defers new completions until parked, then reconciles without a lock conflict',async()=>{
 const f=setup();try{
  const project=path.join(f.dataRoot,'legacy'),manifest=path.join(project,'raw_generated','manifest.json');atomic(manifest,{});
  atomic(path.join(f.dataRoot,'jobs','legacy.json'),{id:'legacy',topic:'甲',mode:'production',status:'cancelled',project,manifest,createdAt:new Date().toISOString()});
  atomic(path.join(path.dirname(f.atlas.queue),'.topics.md.shiguang-state.json'),{topic:'甲',category:'测试',manifest,status:'prepared'});
  await f.atlas.close();f.reload();const j=await f.atlas.create('production',production);assert.equal(j.topic,'乙');
  f.complete(j.id);await f.idle();assert.equal(f.atlas.get(j.id).queueUpdate.status,'waiting');
  f.atlas.park('legacy');assert.equal(f.atlas.get(j.id).queueUpdate.status,'committed');
  assert.deepEqual(f.atlas.queueConfig().items.map(x=>x.status),['TODO','已生成','TODO','TODO']);
 }finally{await f.cleanup()}
});
test('completion preserves BOM, mixed newlines, escaped pipes and extra columns; rejects ambiguous edits',()=>{
 const row='| 自然 | 甲\\|乙 | todo | 原备注 |',text='\uFEFF# 说明\r\n\n|Category|Topic|Status|备注|\r\n|-|-|-|-|\n'+row+'\r\n|自然|丙|TODO|其他|\n',r={topic:'甲|乙',category:'自然',row};
 const result=completeTopic(text,r);assert.equal(result.text,text.replace('todo','已生成'));
 assert.equal(completeTopic(result.text,{...r,completedRow:result.completedRow}).alreadyCompleted,true);
 for(const changed of [text.replace('甲\\|乙','新名字'),text+row+'\n',text.replace('原备注','修改备注')])assert.throws(()=>completeTopic(changed,r),/冲突/);
});
test('HTTP topic selection is explicit and queue reconciliation requires the request token',async()=>{
 const f=setup(),server=makeServer({atlas:f.atlas});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;try{
  const b=await(await fetch(base+'/api/bootstrap')).json();assert.equal(b.queueConfig.concurrency.max,3);
  const headers={'Content-Type':'application/json','X-Orbit-Token':b.token};
  const result=await fetch(base+'/api/jobs',{method:'POST',headers,body:JSON.stringify({...production,mode:'production',topic:'丙',topicCategory:'测试',queueRevision:b.queueConfig.revision})});assert.equal(result.status,202);const j=await result.json();assert.equal(j.topic,'丙');
  f.complete(j.id);await f.idle();const url=base+'/api/jobs/'+j.id+'/sync-queue';
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'X-Orbit-Token':'wrong'},body:'{}'})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,200);
 }finally{await new Promise(r=>server.close(r));await f.cleanup()}
});
