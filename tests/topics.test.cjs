const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {parseTopics,readTopics,saveTopics}=require('../lib/topics.cjs');
const {createAtlas,dateShanghai,atomic}=require('../lib/atlas.cjs');const {makeServer}=require('../server.cjs');
const ROOT=path.resolve(__dirname,'..');
const text='# 我的选题\n\n|Status|Topic|Category|\n|-|-|-|\n|已生成|上篇|知识|\n|TODO|下一篇|知识|\n|TODO|后续篇|自然|\n';
function setup(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-queue-'));const file=path.join(dir,'topics.md');fs.writeFileSync(file,text);return {dir,file,close:()=>fs.rmSync(dir,{recursive:true,force:true})}}
test('queue parser handles BOM, CRLF, escaped pipes, lowercase TODO, reordered headers and exhausted queues',()=>{
 const items=parseTopics('\uFEFF# 主题\r\n|Category|Topic|Status|\r\n|:-|--:|-|\r\n|自然|岩石\\|矿物|todo|\r\n');
 assert.deepEqual(items.map(({line,...item})=>item),[{status:'TODO',topic:'岩石|矿物',category:'自然'}]);
 assert.equal(parseTopics(text.replaceAll('TODO','已生成')).filter(x=>x.status==='TODO').length,0);
 for(const invalid of ['没有表格',text.replace('|-|-|-|','|x|x|x|'),text.replace('|TODO|下一篇|知识|','|TODO|下一篇|'),text.replace('TODO','待生成'),text.replace('下一篇','')])assert.throws(()=>parseTopics(invalid));
});
test('saving preserves exact Markdown and backs up bytes; stale edits, malformed input and helper locks never overwrite',()=>{
 const f=setup();try{const before=readTopics(f.file),updated='\uFEFF'+text.replace('下一篇','新选题').replaceAll('\n','\r\n');
  const saved=saveTopics(f.file,{revision:before.revision,text:updated},path.join(f.dir,'backups'));
  assert.equal(saved.next.topic,'新选题');assert.equal(fs.readFileSync(f.file,'utf8'),updated);assert.equal(fs.readFileSync(saved.backupPath,'utf8'),text);
  assert.throws(()=>saveTopics(f.file,{revision:before.revision,text},f.dir),/其他窗口/);
  assert.throws(()=>saveTopics(f.file,{revision:saved.revision,text:'bad'},f.dir),/三列/);
  fs.writeFileSync(f.file+'.shiguang.lock','other process');assert.throws(()=>saveTopics(f.file,{revision:saved.revision,text},f.dir),/其他任务/);
  assert.equal(fs.readFileSync(f.file,'utf8'),updated);
 }finally{f.close()}
});
test('edited first TODO is used by actual prepare even when an older production job is ready today',async()=>{
 const f=setup();let complete;const done=new Promise(r=>complete=r);
 const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:async()=>({available:true}),exportAccess:async()=>{},launch:()=>({done,cancel:async()=>complete()})});
 try{
  m.updateQueue({revision:m.queueConfig().revision,text});
  const project=path.join(f.dir,'old'),manifest=path.join(project,'raw_generated','manifest.json');atomic(manifest,{});
  // The old result is a synthetic job record, not media evidence.
  atomic(path.join(f.dir,'jobs','old.json'),{id:'old',mode:'production',status:'ready',date:dateShanghai(),project,manifest,topic:'上篇',createdAt:new Date().toISOString()});
  const n=createAtlas({root:ROOT,dataRoot:f.dir,detect:async()=>({available:true}),exportAccess:async()=>{},launch:()=>({done,cancel:async()=>complete()})});
  const job=await n.create('production');assert.equal(job.topic,'下一篇');assert.notEqual(job.id,'old');
  assert.throws(()=>n.updateQueue({revision:n.queueConfig().revision,text}),/任务正在运行/);
  await n.cancel(job.id);await new Promise(r=>setTimeout(r,40));assert.throws(()=>n.updateQueue({revision:n.queueConfig().revision,text}),/未完成的正式任务/);
  assert.equal(fs.readFileSync(n.queue,'utf8'),text);
 }finally{complete();await new Promise(r=>setTimeout(r,40));f.close()}
});
test('queue HTTP editing uses revision checks, reflects external edits, and enforces request tokens',async()=>{
 const f=setup();const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:async()=>({available:true})});const server=makeServer({atlas:m});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const b=await(await fetch(base+'/api/bootstrap')).json();const q=await(await fetch(base+'/api/queue')).json();assert.equal(q.path,m.queue);
  const post=(body,token=b.token)=>fetch(base+'/api/queue',{method:'POST',headers:{'Content-Type':'application/json','X-Orbit-Token':token},body:JSON.stringify(body)});
  assert.equal((await post({text,revision:q.revision},'bad')).status,403);
  let r=await post({text,revision:q.revision});assert.equal(r.status,200);const saved=await r.json();assert.equal(saved.next.topic,'下一篇');
  fs.writeFileSync(m.queue,text.replace('下一篇','编辑器里的新主题'));
  assert.equal((await post({text,revision:saved.revision})).status,409);
  const fresh=await(await fetch(base+'/api/bootstrap')).json();assert.equal(fresh.queueConfig.next.topic,'编辑器里的新主题');
  assert.equal((await post({text:'x'.repeat(330*1024),revision:saved.revision})).status,413);
 }finally{await new Promise(r=>server.close(r));f.close()}
});
