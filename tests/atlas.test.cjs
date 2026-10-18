const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {createAtlas,inside,safeFile,parseCaption,dateShanghai,atomic}=require('../lib/atlas.cjs');
const {makeServer}=require('../server.cjs');const {cleanEnv}=require('../lib/runtime.cjs');
const ROOT=path.resolve(__dirname,'..');
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-tests-'));return {dir,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})}}
function fakeLaunch(){let resolve;const done=new Promise(r=>resolve=r);return {launch:()=>({done,cancel:async()=>resolve()}),resolve:()=>resolve()}}
const caps=async()=>({available:true,loggedIn:true,python:true});
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}assert.fail('Timed out')}

test('caption parsing keeps title/body/tag boundaries and Unicode',()=>{
 assert.deepEqual(parseCaption('# 水果的另一面\n\n正文\n\n#水果 #百科'),{title:'水果的另一面',body:'正文\n\n#水果 #百科',text:'# 水果的另一面\n\n正文\n\n#水果 #百科'});
 assert.match(dateShanghai(),/^\d{4}-\d{2}-\d{2}$/);
});
test('paths reject siblings, traversal, absolute paths, and missing assets',()=>{const f=fixture();try{fs.writeFileSync(path.join(f.dir,'ok.png'),'fixture');assert.equal(inside(f.dir,f.dir+'-other/a'),false);assert.throws(()=>safeFile(f.dir,'../outside'));assert.throws(()=>safeFile(f.dir,path.join(f.dir,'ok.png')));assert.equal(safeFile(f.dir,'ok.png'),path.join(f.dir,'ok.png'))}finally{f.cleanup()}});
test('API credentials are not inherited by Codex generation',()=>{const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='UNIT_TEST_NOT_A_KEY';assert.equal(cleanEnv().OPENAI_API_KEY,undefined);if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous});
test('only first TODO is prepared, parallel requests rejected, cancellation preserves production queue',async()=>{const f=fixture(),fake=fakeLaunch();const manager=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:fake.launch});const before=fs.readFileSync(manager.queue);try{const pending=manager.create('test');await assert.rejects(manager.create('test'),/已有任务/);const j=await pending;assert.equal(j.topic,'世界水果图鉴');assert.equal(j.status,'generating');assert.equal(j.mode,'test');assert.equal(manager.queueItems().find(x=>x.status==='TODO').topic,j.topic);await assert.rejects(manager.publish(j.id),/未通过完整验收/);await manager.cancel(j.id);await until(()=>manager.get(j.id).status==='cancelled');assert.deepEqual(fs.readFileSync(manager.queue),before);await assert.rejects(manager.create('invalid'),/未知任务/)}finally{await manager.close();await new Promise(r=>setTimeout(r,50));f.cleanup()}});
test('missing assets cannot become ready, restart and retry retain the same content directory',async()=>{const f=fixture(),fake=fakeLaunch();const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:fake.launch});try{const j=await m.create('test');fake.resolve();await until(()=>m.get(j.id).status==='failed');assert.match(m.get(j.id).message,/content_pages/);const fake2=fakeLaunch();const m2=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:fake2.launch});const retried=await m2.retry(j.id);assert.equal(retried.id,j.id);assert.equal(retried.project,j.project);await m2.close();await new Promise(r=>setTimeout(r,40));assert.equal(m2.get(j.id).status,'interrupted')}finally{await m.close();f.cleanup()}});
test('failed auth never starts or prepares a job',async()=>{const f=fixture();let launches=0;const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:async()=>({available:false,reason:'请登录 ChatGPT'}),launch:()=>launches++});try{await assert.rejects(m.create(),/请登录/);assert.equal(launches,0);assert.equal(m.list().length,0)}finally{f.cleanup()}});

test('new tasks ask Codex to plan 4–8 total images from text and expose the actual plan',async()=>{
 const f=fixture(),fake=fakeLaunch();let instruction='';
 const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:(job,prompt)=>{instruction=prompt;return fake.launch()}});
 try{
  const job=await m.create('test');assert.equal(job.imageCountPolicy,'content-adaptive');
  assert.match(instruction,/4–8 张图片.*1 张封面/);assert.match(instruction,/根据当天实际正文/);
  assert.match(instruction,/--image-count-policy content-adaptive/);assert.doesNotMatch(instruction,/普通图鉴采用四个代表对象/);
  assert.match(instruction,/画面干净通透，采用柔和、均匀的画面/);assert.match(instruction,/--visual-policy photoreal-v2/);assert.match(instruction,/主体采用高写实摄影质感/);assert.match(instruction,/不继承其插画画法/);
  assert.match(instruction,/--image-label-policy none-v1/);assert.match(instruction,/图中不显示任何AI来源字样或生成标记/);assert.equal(job.imageLabelPolicy,'none-v1');assert.equal(job.visualStyle,'photoreal');
  const state=m.get(job.id),manifest=JSON.parse(fs.readFileSync(state.manifest,'utf8'));
  manifest.content_pages=6;manifest.quantity_plan={basis:'content_adaptive',expected:6,rationale:'Six separate sections in the fixture article.'};atomic(state.manifest,manifest);
  const view=await m.progress(job.id);assert.equal(view.expectedImages,7);assert.equal(view.quantityPlan.contentPages,6);
  await m.cancel(job.id);
 }finally{await m.close();await new Promise(r=>setTimeout(r,50));f.cleanup()}
});

test('style choices persist across recovery and use separate test projects',async()=>{
 const f=fixture(),first=fakeLaunch();let instruction='';
 const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:(_,prompt)=>{instruction=prompt;return first.launch()}});
 let m2;
 try{
  await assert.rejects(m.create('test',{visualStyle:'unknown'}),/未知生图风格/);
  await assert.rejects(m.create('test',{visualStyle:null}),/未知生图风格/);
  assert.equal(m.list().length,0);
  const illustrated=await m.create('test',{visualStyle:'illustration'});
  assert.equal(illustrated.visualPolicy,'illustration-v1');assert.equal(illustrated.visualStyle,'illustration');
  assert.match(instruction,/精致自然的博物志插画风格/);assert.doesNotMatch(instruction,/主体采用高写实摄影质感/);
  assert.match(instruction,/图中不显示任何AI来源字样/);
  await m.close();await new Promise(r=>setTimeout(r,50));
  const second=fakeLaunch();m2=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:(_,prompt)=>{instruction=prompt;return second.launch()}});
  assert.equal(m2.get(illustrated.id).visualStyle,'illustration');
  const recovered=await m2.create('test',{visualStyle:'illustration'});
  assert.equal(recovered.id,illustrated.id);assert.equal(recovered.visualPolicy,'illustration-v1');
  await m2.cancel(recovered.id);await new Promise(r=>setTimeout(r,60));
  const photo=await m2.create('test',{visualStyle:'photoreal'});
  assert.equal(photo.visualStyle,'photoreal');assert.notEqual(photo.project,illustrated.project);
  assert.match(instruction,/主体采用高写实摄影质感/);
 }finally{await m2?.close();await m.close();await new Promise(r=>setTimeout(r,60));f.cleanup()}
});

test('HTTP forwards selected generation style and test topic',async()=>{
 const captured=[];const server=makeServer({atlas:{refreshMedia:async()=>{},capability:caps,queueItems:()=>[],queueConfig:()=>({}),list:()=>[],create:async(mode,options)=>{captured.push({mode,...options});return {id:'fixture'};}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 // Explicit HTTP routing fixture, no image tool or production data is used.
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const {token}=await(await fetch(base+'/api/bootstrap')).json();
  const response=await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-Orbit-Token':token},body:JSON.stringify({mode:'test',visualStyle:'illustration',testTopic:'测试'})});
  assert.equal(response.status,202);assert.deepEqual(captured,[{mode:'test',visualStyle:'illustration',testTopic:'测试'}]);
 }finally{await new Promise(r=>server.close(r))}
});

test('explicit test topics use isolated snapshots and never rewrite the formal queue',async()=>{
 const f=fixture(),fake=fakeLaunch();const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:fake.launch});
 try{const original=fs.readFileSync(m.queue),topic=m.queueItems().filter(x=>x.status==='TODO')[1].topic;
  await assert.rejects(m.create('production',{testTopic:topic}),/独立测试/);
  await assert.rejects(m.create('test',{testTopic:'not-in-queue'}),/待办队列/);
  const job=await m.create('test',{testTopic:topic});assert.equal(job.topic,topic);assert.equal(m.get(job.id).visualPolicy,'photoreal-v2');assert.deepEqual(fs.readFileSync(m.queue),original);
  await m.cancel(job.id);
 }finally{await m.close();await new Promise(r=>setTimeout(r,50));f.cleanup()}
});
test('ready delivery uses ordered absolute paths, separate text copies, never claims published',async()=>{
 const f=fixture(),project=path.join(f.dir,'output'),manifest=path.join(project,'raw_generated','manifest.json');let calls=[];fs.mkdirSync(path.dirname(manifest),{recursive:true});
 // Synthetic structure fixture only: validator is injected. This is NOT generated media or QA.
 const files=['00_封面_测试.png','01_测试.png'];for(const name of files)fs.writeFileSync(path.join(project,name),'UNIT_TEST_ONLY');fs.writeFileSync(path.join(project,'测试_小红书文案.md'),'# 测试标题\n\n测试正文\n#测试');atomic(manifest,{caption_path:'测试_小红书文案.md',images:files.map(x=>({path:x}))});
 atomic(path.join(f.dir,'jobs','unit.json'),{id:'unit',project,manifest,status:'ready',topic:'UNIT TEST ONLY',mode:'test',date:dateShanghai(),createdAt:new Date().toISOString()});
 const m=createAtlas({root:ROOT,dataRoot:f.dir,execute:async()=>({stdout:'{"valid":true}'}),desktop:async p=>{calls.push(p);return {clipboard:true,folder:true,caption:true,browser:true}}});
 try{const result=await m.publish('unit');assert.equal(result.published,false);assert.deepEqual(calls[0].files,files.map(x=>path.join(project,x)));assert.equal(calls[0].text,files.map(x=>'"'+path.join(project,x)+'"').join(' '));await m.copy('unit','title');assert.equal(calls[1].text,'测试标题');await m.copy('unit','body');assert.equal(calls[2].text,'测试正文\n#测试');assert.equal(m.get('unit').status,'ready');assert.ok(fs.readFileSync(calls[0].captionFile,'utf8').includes('测试正文'))}finally{f.cleanup()}
});
test('HTTP blocks cross-origin commands, missing tokens, oversized JSON, private paths and unsupported methods',async()=>{
 const f=fixture(),m=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps}),server=makeServer({atlas:m});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{const b=await(await fetch(base+'/api/bootstrap')).json();assert.ok(b.token);assert.equal((await fetch(base+'/api/bootstrap',{headers:{Origin:'https://evil.example'}})).status,403);assert.equal((await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);assert.equal((await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-Orbit-Token':b.token},body:'not-json'})).status,400);assert.equal((await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-Orbit-Token':b.token},body:JSON.stringify({x:'x'.repeat(17000)})})).status,413);assert.equal((await fetch(base+'/data/主题/topics.md')).status,404);assert.equal((await fetch(base+'/.agents/skills/shiguang-atlas/SKILL.md')).status,404);assert.equal((await fetch(base+'/api/jobs/missing')).status,404);assert.equal((await fetch(base+'/',{method:'DELETE'})).status,405);assert.equal(await new Promise(resolve=>require('node:http').get(base+'/',{headers:{Host:'attacker.example'}},r=>{r.resume();resolve(r.statusCode)})),403);assert.equal((await fetch(base+'/')).status,200)}finally{await new Promise(r=>server.close(r));f.cleanup()}
});
