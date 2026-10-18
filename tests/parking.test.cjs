// Isolated lifecycle fixtures, not evidence of real generation or visual QA.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createAtlas,atomic}=require('../lib/atlas.cjs');
const {makeServer}=require('../server.cjs');
const runtime=require('../lib/runtime.cjs');
const root=path.resolve(__dirname,'..');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function settled(m,id){for(let n=0;n<150;n++){if(m.get(id).status==='failed'&&!m.queueConfig().lockReason.includes('任务正在运行'))return;await wait(20)}throw Error('fixture did not settle')}
function setup(){
 const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-park-'));let resolve;
 const options={root,dataRoot,detect:async()=>({available:true}),exportAccess:async()=>{},launch:()=>({done:new Promise(r=>resolve=r),cancel:async()=>resolve?.()})};
 return {dataRoot,options,finish:()=>resolve(),cleanup:()=>{assert.equal(path.dirname(dataRoot),os.tmpdir());assert.ok(path.basename(dataRoot).startsWith('orbit-park-'));fs.rmSync(dataRoot,{recursive:true,force:true})}};
}
test('park frees queue editing, preserves files and TODO, enforces HTTP token, survives restart',async()=>{
 const f=setup(),m=createAtlas(f.options);let server;
 try{
  const j=await m.create('production',{reviewEnabled:false}),before=fs.readFileSync(m.queue),registry=path.join(path.dirname(m.queue),'.topics.md.shiguang-state.json');
  assert.throws(()=>m.park(j.id),/任务正在运行/);
  f.finish();await settled(m,j.id);
  const manifest=fs.readFileSync(m.get(j.id).manifest);
  assert.equal(m.queueConfig().pending.jobId,j.id);
  assert.equal(fs.existsSync(registry),false);
  server=makeServer({atlas:m});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const {token}=await(await fetch(base+'/api/bootstrap')).json();
  const post=key=>fetch(base+'/api/jobs/'+j.id+'/park',{method:'POST',headers:{'Content-Type':'application/json','X-Orbit-Token':key},body:'{}'});
  assert.equal((await post('bad')).status,403);assert.equal(m.queueConfig().locked,true);
  const response=await post(token);assert.equal(response.status,200);const parked=await response.json();
  assert.equal(parked.status,'parked');assert.equal(parked.queueDetached,true);assert.equal(parked.parkedFrom.status,'failed');assert.ok(parked.parkedFrom.message);
  assert.equal(m.queueConfig().locked,false);assert.equal(m.queueConfig().pending,null);
  assert.deepEqual(fs.readFileSync(m.queue),before);assert.deepEqual(fs.readFileSync(m.get(j.id).manifest),manifest);
  const reloaded=createAtlas(f.options);assert.equal(reloaded.get(j.id).status,'parked');assert.equal(reloaded.queueConfig().locked,false);
  assert.equal(reloaded.park(j.id).status,'parked');
  const config=reloaded.queueConfig(),other=config.items.filter(x=>x.status==='TODO')[1];
  reloaded.updateQueue({revision:config.revision,action:{type:'next',line:other.line}});
  assert.equal(reloaded.queueConfig().next.topic,other.topic);
 }finally{await m.close();if(server)await new Promise(r=>server.close(r));await wait(60);f.cleanup()}
});
test('resuming parked work never commits over the newer production queue or registry',async()=>{
 const f=setup(),m=createAtlas(f.options);let reloaded;
 try{
  const first=await m.create('production',{reviewEnabled:false});f.finish();await settled(m,first.id);m.park(first.id);
  const config=m.queueConfig(),other=config.items.filter(x=>x.status==='TODO')[1];m.updateQueue({revision:config.revision,action:{type:'next',line:other.line}});
  const next=await m.create('production',{reviewEnabled:false});assert.equal(next.topic,other.topic);assert.notEqual(next.project,first.project);f.finish();await settled(m,next.id);
  const registry=path.join(f.dataRoot,'任务选题',next.id,'.topics.md.shiguang-state.json'),beforeQueue=fs.readFileSync(m.queue),beforeRegistry=fs.readFileSync(registry);
  // Complete synthetic assets make retry use host validation; validator is
  // explicitly stubbed here to isolate queue-commit behavior.
  const manifest=JSON.parse(fs.readFileSync(m.get(first.id).manifest));manifest.content_pages=0;manifest.images=[{path:'00_fixture.png'}];manifest.caption_path='caption.md';manifest.qa={checks:{all_images_visually_reviewed:true}};atomic(m.get(first.id).manifest,manifest);fs.writeFileSync(path.join(first.project,'caption.md'),'# 隔离状态测试\n\n不是生成成果。');
  const calls=[];reloaded=createAtlas({...f.options,execute:async(binary,args,opts)=>{calls.push(args);return args.includes('validate')?{stdout:'{"valid":true}'}:runtime.run(binary,args,opts)}});
  const result=await reloaded.retry(first.id);assert.equal(result.status,'ready');assert.equal(result.queueDetached,true);
  assert.ok(calls.some(args=>args.includes('validate')));assert.ok(!calls.some(args=>args.includes('commit')));
  assert.equal(reloaded.get(first.id).receipt.production_queue_written,false);
  assert.deepEqual(fs.readFileSync(m.queue),beforeQueue);assert.deepEqual(fs.readFileSync(registry),beforeRegistry);
  assert.equal(reloaded.queueConfig().pending.jobId,next.id);
  assert.throws(()=>reloaded.park(first.id),/只有未完成/);
 }finally{await reloaded?.close();await m.close();await wait(60);f.cleanup()}
});
test('same-topic fresh creation after parking uses a new directory and selected style',async()=>{
 const f=setup(),m=createAtlas(f.options);
 try{
  const old=await m.create('production',{reviewEnabled:false,visualStyle:'illustration'});f.finish();await settled(m,old.id);m.park(old.id);
  const manifest=fs.readFileSync(m.get(old.id).manifest);
  const next=await m.create('production',{reviewEnabled:false,visualStyle:'photoreal'});
  assert.equal(next.topic,old.topic);assert.notEqual(next.project,old.project);assert.equal(next.visualStyle,'photoreal');assert.deepEqual(fs.readFileSync(m.get(old.id).manifest),manifest);
  assert.equal(m.get(old.id).status,'parked');
 }finally{await m.close();await wait(60);f.cleanup()}
});
