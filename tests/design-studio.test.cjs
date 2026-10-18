'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createStudio}=require('../lib/design-studio.cjs');
const {loadCatalog,filenames}=require('../lib/design-studio-content.cjs');
const {makeServer}=require('../server.cjs');
const ROOT=path.resolve(__dirname,'..');
const sample=path.resolve(ROOT,'..','output','design-studio','2026-10-18-bookstore-commute');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(options={}){
 const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-design-test-'));
 const loaded=loadCatalog(ROOT);const catalog={profile:loaded.profile,topics:[loaded.topics[0]]};
 const manager=createStudio({root:ROOT,dataRoot,catalog,sampleDir:null,detect:async()=>({available:true}),exportAccess:async()=>{},...options});
 return {manager,dataRoot,async cleanup(){await manager.close();assert.equal(path.dirname(dataRoot),os.tmpdir());assert.ok(path.basename(dataRoot).startsWith('orbit-design-test-'));fs.rmSync(dataRoot,{recursive:true,force:true})}};
}
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}assert.fail('Timed out')}
function controlled(){let finish;return {launch:()=>({done:new Promise(r=>finish=r),cancel:async()=>finish()}),finish:()=>finish()}}
test('studio edits persist and stale revisions cannot overwrite another tab',async()=>{
 const f=fixture();try{const t=f.manager.topics()[0];const changed=f.manager.updateTopic(t.id,{revision:t.revision,title:'周五下班，去逛书店',caption:t.caption+'\n这是一次设计讨论。'});assert.notEqual(changed.revision,t.revision);assert.throws(()=>f.manager.updateTopic(t.id,{revision:t.revision,title:'不能覆盖'}),e=>e.status===409);assert.equal(f.manager.topic(t.id).title,changed.title);
  const again=createStudio({root:ROOT,dataRoot:f.dataRoot,catalog:loadCatalog(ROOT),sampleDir:null});assert.equal(again.topic(t.id).title,changed.title);await again.close();
  assert.throws(()=>f.manager.updateTopic(t.id,{revision:changed.revision,title:'标题'.repeat(20)}),/20字/);assert.throws(()=>f.manager.updateTopic(t.id,{revision:changed.revision,project:'outside'}),/只能修改/);
 }finally{await f.cleanup()}
});
test('generation snapshots are immutable, single-flight, cancellable and resumable',async()=>{
 const control=controlled(),f=fixture({launch:control.launch});try{const t=f.manager.topics()[0];const j=await f.manager.create({topicId:t.id,revision:t.revision});assert.equal(j.status,'generating');await assert.rejects(f.manager.create({topicId:t.id,revision:t.revision}),e=>e.status===409);
  f.manager.updateTopic(t.id,{revision:t.revision,title:'新的编辑标题'});assert.equal(f.manager.get(j.id).snapshot.title,t.title);assert.equal(JSON.parse(fs.readFileSync(path.join(j.project,'topic.json'),'utf8')).title,t.title);
  await f.manager.cancel(j.id);assert.equal(f.manager.get(j.id).status,'cancelled');const resumed=await f.manager.retry(j.id);assert.equal(resumed.id,j.id);assert.equal(resumed.project,j.project);control.finish();await until(()=>f.manager.get(j.id).status==='failed');assert.match(f.manager.get(j.id).message,/检查记录/);
  const changed=await f.manager.create({topicId:t.id,revision:f.manager.topic(t.id).revision});assert.notEqual(changed.id,j.id);assert.notEqual(changed.project,j.project);assert.equal(f.manager.get(j.id).snapshot.title,t.title);assert.equal(f.manager.get(changed.id).snapshot.title,'新的编辑标题');await f.manager.cancel(changed.id);
  await assert.rejects(f.manager.create({topicId:t.id,revision:f.manager.topic(t.id).revision}),/未完成/);
 }finally{await f.cleanup()}
});
test('image validation rejects missing master reference and accepts complete real PNG set',async()=>{
 const control=controlled(),f=fixture({launch:control.launch});try{const t=f.manager.topics()[0],j=await f.manager.create({topicId:t.id,revision:t.revision});const originals=['01_封面.png','02_结构细节.png','03_内部分区.png','04_书店场景.png'];
  if(!originals.every(n=>fs.existsSync(path.join(sample,n)))){await f.manager.cancel(j.id);return}
  originals.forEach((n,i)=>fs.copyFileSync(path.join(sample,n),path.join(j.project,filenames[i])));
  const records={images:filenames.map((filename,i)=>({filename,tool:'image_gen',original_path:path.join(sample,originals[i]),sha256:digest(path.join(j.project,filename)),prompt_file:`prompts/${filename.replace('.png','.txt')}`,referenced_image_paths:[]}))};
  const review={verdict:'pass',captionSha256:digest(path.join(j.project,'caption.txt')),pages:filenames.map(filename=>({filename,sha256:digest(path.join(j.project,filename)),checked:true,observations:'Isolated fixture uses the four previously generated sample PNGs.'}))};
  fs.writeFileSync(path.join(j.project,'generation.json'),JSON.stringify(records));fs.writeFileSync(path.join(j.project,'review.json'),JSON.stringify(review));await assert.rejects(f.manager.validate(f.manager.get(j.id)),/主视觉参考/);
  records.images.forEach((entry,i)=>{if(i)entry.referenced_image_paths=[path.join(j.project,filenames[0])]});fs.writeFileSync(path.join(j.project,'generation.json'),JSON.stringify(records));control.finish();await until(()=>f.manager.get(j.id).status==='ready');assert.equal(f.manager.list()[0].images.length,4);
  await assert.rejects(f.manager.asset(j.id,'../caption.txt'),/不存在/);await assert.rejects(f.manager.asset(j.id,'caption.txt'),/不存在/);
 }finally{await f.cleanup()}
});
test('cancelling during media access repair stays cancelled and still repairs partial output',async()=>{
 let entered=0,release;const gate=new Promise(r=>release=r),control=controlled();
 const f=fixture({launch:control.launch,syncAccess:async()=>{entered++;if(entered===1)await gate}});
 try{const t=f.manager.topics()[0],j=await f.manager.create({topicId:t.id,revision:t.revision});control.finish();await until(()=>entered===1);const stopping=f.manager.cancel(j.id);assert.equal(f.manager.get(j.id).status,'cancelled');release();await stopping;assert.equal(f.manager.get(j.id).status,'cancelled');assert.ok(entered>=2);assert.ok(!f.manager.get(j.id).events.some(e=>e.message.includes('正在核对四图')))}finally{release();await f.cleanup()}
});
test('shutdown during capability detection rejects a pending new creation',async()=>{
 let release;const gate=new Promise(r=>release=r),control=controlled(),f=fixture({detect:()=>gate,launch:control.launch});
 try{const t=f.manager.topics()[0],creation=f.manager.create({topicId:t.id,revision:t.revision});const rejection=assert.rejects(creation,/正在关闭/);await f.manager.close();release({available:true});await rejection;assert.equal(f.manager.list().length,0)}finally{release({available:true});await f.cleanup()}
});
test('studio API shares CSRF validation, rejects cross-site and exports complete per-topic prompts',async()=>{
 const f=fixture(),atlas={refreshMedia:async()=>{},capability:async()=>({available:true}),queueItems:()=>[],queueConfig:()=>({items:[]}),list:()=>[]};const server=makeServer({atlas,studio:f.manager});
 try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const b=await (await fetch(base+'/api/studio/bootstrap')).json();assert.ok(b.token);assert.equal(b.topics[0].pages.length,4);assert.ok(b.topics[0].pages.every(p=>p.prompt.includes(b.topics[0].theme)));
  const t=b.topics[0],url=base+'/api/studio/topics/'+t.id;assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:t.revision,title:'缺少验证'})})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-orbit-token':b.token,origin:'https://example.com'},body:'{}'})).status,403);
  const saved=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-orbit-token':b.token},body:JSON.stringify({revision:t.revision,title:'包袋新提案'})});assert.equal(saved.status,200);
  const exported=await (await fetch(base+'/api/studio/export')).json();assert.equal(exported.topics[0].title,'包袋新提案');assert.ok(exported.topics[0].pages[1].prompt.includes('01_cover.png'));
 }finally{await f.cleanup();await new Promise(r=>server.close(r))}
});
