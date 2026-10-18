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
test('same test snapshot cannot run twice and cancellation preserves production queue',async()=>{const f=fixture(),fake=fakeLaunch();const manager=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:fake.launch});const before=fs.readFileSync(manager.queue);try{const pending=manager.create('test');await assert.rejects(manager.create('test'),/这篇任务正在运行/);const j=await pending;assert.equal(j.topic,'世界水果图鉴');assert.equal(j.status,'generating');assert.equal(j.mode,'test');assert.equal(manager.queueItems().find(x=>x.status==='TODO').topic,j.topic);await assert.rejects(manager.publish(j.id),/未通过完整验收/);await manager.cancel(j.id);await until(()=>manager.get(j.id).status==='cancelled');assert.deepEqual(fs.readFileSync(manager.queue),before);await assert.rejects(manager.create('invalid'),/未知任务/)}finally{await manager.close();await new Promise(r=>setTimeout(r,50));f.cleanup()}});
test('missing assets cannot become ready, restart and retry retain the same content directory',async()=>{const f=fixture(),fake=fakeLaunch();const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:fake.launch});try{const j=await m.create('test');fake.resolve();await until(()=>m.get(j.id).status==='failed');assert.match(m.get(j.id).message,/content_pages|全部图片/);const fake2=fakeLaunch();const m2=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:fake2.launch});const retried=await m2.retry(j.id);assert.equal(retried.id,j.id);assert.equal(retried.project,j.project);await m2.close();await new Promise(r=>setTimeout(r,40));assert.equal(m2.get(j.id).status,'interrupted')}finally{await m.close();f.cleanup()}});
test('failed auth never starts or prepares a job',async()=>{const f=fixture();let launches=0;const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:async()=>({available:false,reason:'请登录 ChatGPT'}),launch:()=>launches++});try{await assert.rejects(m.create(),/请登录/);assert.equal(launches,0);assert.equal(m.list().length,0)}finally{f.cleanup()}});
test('generation rejects a stale selected queue instead of silently generating another topic',async()=>{
 const f=fixture();let launches=0;const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,launch:()=>launches++});
 try{const before=m.queueConfig();m.updateQueue({revision:before.revision,action:{type:'next',line:before.items.filter(x=>x.status==='TODO')[1].line}});await assert.rejects(m.create('production',{queueRevision:before.revision}),/选题顺序已变化/);assert.equal(launches,0);assert.equal(m.list().length,0)}finally{f.cleanup()}
});

test('new tasks ask Codex to plan 1–11 single-subject images from text and expose the actual plan',async()=>{
 const f=fixture(),fake=fakeLaunch();let instruction='';
 const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:(job,prompt)=>{instruction=prompt;return fake.launch()}});
 try{
  const job=await m.create('test');assert.equal(job.imageCountPolicy,'single-subject-v1');
  assert.equal(job.imageCopyPolicy,'encyclopedia-v2');assert.match(job.project,/encyclopedia-v2/);
  assert.match(instruction,/图中可见文字采用百科条目式科普介绍/);
  assert.match(instruction,/讲清楚就结束/);assert.match(instruction,/生图前连读整组page-copy/);assert.match(instruction,/这个示例不用于图片介绍/);
  assert.match(instruction,/【图中可见文字】与【绘制与核查要求，仅供执行、不渲染】/);
  assert.match(instruction,/不把完整底稿、来源笔记、反例或审查说明整体作为图中文字输入/);
  assert.match(instruction,/小红书发布短文继续按自己的文案策略组织/);
  assert.equal(job.captionPolicy,'reader-narrative-v2');assert.match(job.project,/reader-narrative-v2/);
  assert.match(instruction,/--caption-policy reader-narrative-v2/);assert.match(instruction,/每项一句空泛概括/);
  assert.match(instruction,/事实、研究解释和作者归纳/);assert.match(instruction,/700–950字/);assert.match(instruction,/caption_review/);
  assert.match(instruction,/无需逐项列全/);assert.match(instruction,/数量计划必须依据完整底稿/);assert.match(instruction,/reader_review/);
  assert.doesNotMatch(instruction,/每项用紧凑的两至三句/);
  assert.match(instruction,/1–11 张图片/);assert.match(instruction,/1张封面＋10张流派介绍/);assert.match(instruction,/本图唯一介绍对象/);assert.match(instruction,/一次工具调用只产出这一张图/);assert.match(instruction,/single_subject_per_page/);assert.doesNotMatch(instruction,/允许每页分组讲多个对象/);assert.match(instruction,/根据当天实际正文/);
  assert.match(instruction,/--image-count-policy single-subject-v1/);assert.doesNotMatch(instruction,/普通图鉴采用四个代表对象/);
  assert.match(instruction,/画面干净通透，采用柔和、均匀的画面/);assert.match(instruction,/--visual-policy photoreal-v2/);assert.match(instruction,/主体采用高写实摄影质感/);assert.match(instruction,/不继承其插画画法/);
  assert.match(instruction,/--image-label-policy none-v1/);assert.match(instruction,/图中不显示任何AI来源字样或生成标记/);assert.equal(job.imageLabelPolicy,'none-v1');assert.equal(job.visualStyle,'photoreal');
  const state=m.get(job.id),manifest=JSON.parse(fs.readFileSync(state.manifest,'utf8'));
  manifest.content_pages=6;manifest.quantity_plan={basis:'content_adaptive',expected:6,rationale:'Six separate sections in the fixture article.'};atomic(state.manifest,manifest);
  const view=await m.progress(job.id);assert.equal(view.expectedImages,7);assert.equal(view.quantityPlan.contentPages,6);
  manifest.content_pages=0;manifest.quantity_plan.expected=0;atomic(state.manifest,manifest);assert.equal((await m.progress(job.id)).expectedImages,1);
  manifest.content_pages=10;manifest.quantity_plan.expected=10;atomic(state.manifest,manifest);assert.equal((await m.progress(job.id)).expectedImages,11);
  await m.cancel(job.id);
 }finally{await m.close();await new Promise(r=>setTimeout(r,50));f.cleanup()}
});

test('caption policy reaches host validation and legacy retry preserves its policy',async()=>{
 const f=fixture(),fake=fakeLaunch(),calls=[];
 const runtime=require('../lib/runtime.cjs');let instruction='';
 const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:fake.launch,execute:async(binary,args,options)=>{calls.push(args);return runtime.run(binary,args,options)}});
 let recovered;
 try{
  const job=await m.create('test',{reviewEnabled:false});fake.resolve();await until(()=>m.get(job.id).status==='failed');
  const validation=calls.find(args=>args.includes('validate'));
  assert.ok(validation);assert.equal(validation[validation.indexOf('--caption-policy')+1],'reader-narrative-v2');
  // Simulate a persisted older job without changing its images or manifest.
  const saved=m.get(job.id);delete saved.captionPolicy;delete saved.imageCopyPolicy;atomic(path.join(f.dir,'jobs',job.id+'.json'),saved);
  const next=fakeLaunch();recovered=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:(_,prompt)=>{instruction=prompt;return next.launch()}});
  const retried=await recovered.retry(job.id);assert.equal(retried.captionPolicy,'legacy');assert.equal(retried.imageCopyPolicy,'legacy');assert.match(instruction,/旧图不因风格升级自动重画/);
  assert.match(instruction,/--caption-policy legacy/);assert.doesNotMatch(instruction,/【用户要求的专业解读文案】/);
 }finally{await recovered?.close();await m.close();await new Promise(r=>setTimeout(r,60));f.cleanup()}
});

test('v1 retry retains its saved writing policy and original generation guidance',async()=>{
 const f=fixture(),fake=fakeLaunch();let recovered,instruction='';
 const m=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:fake.launch});
 try{
  const j=await m.create('test',{reviewEnabled:false});await m.cancel(j.id);await new Promise(r=>setTimeout(r,50));
  const saved=m.get(j.id);saved.captionPolicy='reader-analysis-v1';atomic(path.join(f.dir,'jobs',j.id+'.json'),saved);
  const next=fakeLaunch();recovered=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:(_,text)=>{instruction=text;return next.launch()}});
  const result=await recovered.retry(j.id);assert.equal(result.captionPolicy,'reader-analysis-v1');
  assert.match(instruction,/--caption-policy reader-analysis-v1/);assert.match(instruction,/每项用紧凑的两至三句/);
  assert.doesNotMatch(instruction,/新策略另须保存caption_review.reader_review/);
 }finally{await recovered?.close();await m.close();await new Promise(r=>setTimeout(r,50));f.cleanup()}
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
  assert.equal(recovered.captionPolicy,'reader-narrative-v2');assert.match(instruction,/--caption-policy reader-narrative-v2/);
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
  const response=await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-Orbit-Token':token},body:JSON.stringify({mode:'test',visualStyle:'illustration',testTopic:'测试',reviewEnabled:false})});
  assert.equal(response.status,202);assert.deepEqual(captured,[{mode:'test',visualStyle:'illustration',testTopic:'测试',reviewEnabled:false}]);
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

test('review and manual publication persist separately from preparation, reject invalid transitions and can be undone',async()=>{
 const f=fixture(),project=path.join(f.dir,'output'),manifest=path.join(project,'raw_generated','manifest.json');atomic(manifest,{});
 atomic(path.join(f.dir,'jobs','unit.json'),{id:'unit',project,manifest,status:'generating',topic:'STATE FIXTURE',mode:'production',date:dateShanghai(),createdAt:new Date().toISOString()});
 let m=createAtlas({root:ROOT,dataRoot:f.dir,exportAccess:async()=>{}});const server=makeServer({atlas:m});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  m.get('unit').status='failed';assert.throws(()=>m.review('unit'),/尚未就绪/);
  assert.throws(()=>m.publication('unit',{published:true}),/先完成/);
  m.get('unit').status='ready';assert.throws(()=>m.publication('unit',{published:true}),/先完成/);
  m.get('unit').publishPreparedAt=new Date().toISOString();assert.equal(m.view(m.get('unit')).publication,null);
  const b=await(await fetch(base+'/api/bootstrap')).json();
  const post=(action,body,token=b.token)=>fetch(base+'/api/jobs/unit/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Orbit-Token':token},body:JSON.stringify(body)});
  assert.equal((await post('review',{},'wrong')).status,403);
  assert.equal((await post('review',{})).status,200);assert.ok(m.get('unit').reviewedAt);
  for(const url of ['javascript:alert(1)','https://evil.example/x','https://user:pass@www.xiaohongshu.com/x'])assert.equal((await post('publication',{published:true,url})).status,400);
  assert.equal((await post('publication',{published:true,url:'https://www.xiaohongshu.com/explore/fixture'})).status,200);
  assert.equal(m.get('unit').status,'ready');assert.equal(m.get('unit').publication.source,'manual');
  const reloaded=createAtlas({root:ROOT,dataRoot:f.dir});assert.ok(reloaded.view(reloaded.get('unit')).reviewedAt);assert.equal(reloaded.get('unit').publication.url,'https://www.xiaohongshu.com/explore/fixture');
  assert.equal((await post('publication',{published:false})).status,200);assert.equal(m.get('unit').publication,null);assert.ok(m.get('unit').reviewedAt);
 }finally{await new Promise(r=>server.close(r));f.cleanup()}
});

test('same-day regeneration creates a separate production directory while preserving the old job',async()=>{
 const f=fixture(),fake=fakeLaunch(),m=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:fake.launch});
 // Fixture is an archived record, not a generated image or quality assertion.
 const topic=m.queueConfig().next.topic,project=path.join(f.dir,'archived'),manifest=path.join(project,'raw_generated','manifest.json');atomic(manifest,{});
 atomic(path.join(f.dir,'jobs','old.json'),{id:'old',project,manifest,status:'ready',topic,mode:'production',date:dateShanghai(),createdAt:new Date().toISOString()});
 const n=createAtlas({root:ROOT,dataRoot:f.dir,detect:caps,exportAccess:async()=>{},launch:fake.launch});
 try{const job=await n.create('production');assert.notEqual(job.id,'old');assert.notEqual(job.project,project);assert.ok(job.project.includes(path.join('任务',job.id)));assert.equal(n.get('old').status,'ready');assert.equal(fs.readFileSync(manifest,'utf8'),'{}\n');await n.cancel(job.id)}finally{await n.close();await new Promise(r=>setTimeout(r,50));f.cleanup()}
});


test('historical machine errors become readable without hiding unrelated messages',()=>{
 const {displayMessage}=require('../lib/atlas.cjs');
 assert.match(displayMessage(JSON.stringify({ok:false,error:'Forbidden copy wording in full_text_path: 再次'})),/该规则现已移除/);
 assert.match(displayMessage(JSON.stringify({ok:false,error:'Caption body and tags exceed the 1000-character limit or are empty'})),/1000 字/);
 assert.match(displayMessage(JSON.stringify({ok:false,error:'Missing image fixture'})),/Missing image fixture/);
 assert.equal(displayMessage('正常进度保持不变'),'正常进度保持不变');
 assert.equal(displayMessage('{"ok":true}'),'{"ok":true}');
});
