// Isolated UI integration test. All media is synthetic, desktop actions are stubbed.
// Run: PLAYWRIGHT_MODULE=<path-to-playwright> node tests/workspace.browser.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createAtlas,atomic,dateShanghai}=require('../lib/atlas.cjs');
const {makeServer}=require('../server.cjs');
const runtime=require('../lib/runtime.cjs');
const root=path.resolve(__dirname,'..'),dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-workspace-ui-'));
const artifacts=path.join(root,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
const now=new Date().toISOString(),yesterday=new Date(Date.now()-86400000).toISOString();
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function seed(id,topic,options={}){const project=path.join(dataRoot,'fixtures',id),manifest=path.join(project,'raw_generated','manifest.json');atomic(manifest,{caption_path:'caption.md',content_pages:1,images:[{path:'00_cover.png'},{path:'01_content.png'}]});fs.writeFileSync(path.join(project,'caption.md'),'# '+topic+'\n\n这是隔离浏览器测试的文案，不是真实生成内容。\n#测试');fs.writeFileSync(path.join(project,'00_cover.png'),png);fs.writeFileSync(path.join(project,'01_content.png'),png);atomic(path.join(dataRoot,'jobs',id+'.json'),{id,topic,project,manifest,status:'ready',mode:'production',createdAt:now,date:dateShanghai(),events:[],...options})}
seed('review-fixture','待检查作品');seed('publish-fixture','昨天的待发布作品',{createdAt:yesterday,reviewedAt:yesterday});seed('test-fixture','测试风格作品',{mode:'test'});seed('failed-fixture','失败待恢复作品',{status:'failed',message:'测试故障：连接中断',createdAt:yesterday});
const desktopCalls=[];
const atlas=createAtlas({root,dataRoot,detect:async()=>({available:true}),exportAccess:async()=>{},desktop:async payload=>{desktopCalls.push(payload);return {browser:true,folder:true,caption:true,preview:true,clipboard:true}},execute:async(binary,args,options)=>args.includes('validate')||args.includes('commit')?{stdout:'{"valid":true}'}:runtime.run(binary,args,options),launch:()=>{let resolveRun;return {done:new Promise(resolve=>resolveRun=resolve),cancel:async()=>resolveRun()}}});
atlas.updateQueue({revision:atlas.queueConfig().revision,text:'# Browser fixture only\n\n|Status|Topic|Category|\n|-|-|-|\n|TODO|选题甲|自然|\n|TODO|选题乙|生活|\n|已生成|待检查作品|自然|\n'});
const server=makeServer({atlas});
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});const page=await browser.newPage({viewport:{width:1512,height:1100},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#atlas?view=today');await page.getByRole('button',{name:'生成本篇图文',exact:true}).waitFor();
 assert.match(await page.locator('.aw-output-plan').innerText(),/专业解读文案/);
 assert.equal(await page.getByRole('checkbox',{name:/Codex 内容复审/}).isChecked(),true);
 await page.getByRole('checkbox',{name:/Codex 内容复审/}).uncheck();await page.reload();await page.locator('.aw-output-plan').waitFor();
 assert.equal(await page.getByRole('checkbox',{name:/Codex 内容复审/}).isChecked(),false);
 assert.match(await page.locator('.aw-output-plan').innerText(),/1–11/);assert.match(await page.locator('.aw-output-plan').innerText(),/每张介绍一个对象/);assert.equal(await page.locator('.aw-recent-grid .aw-record').count(),4);await page.locator('[data-recent-filter=today]').click();assert.equal(await page.locator('.aw-recent-grid .aw-record').count(),2);await page.getByRole('radio',{name:/清晰插画/}).check();assert.equal(await page.getByRole('radio',{name:/清晰插画/}).isChecked(),true);assert.equal(await page.locator('.aw-topic-title h2').innerText(),'选题甲');
 await page.locator('.aw-advanced summary').click();await page.locator('#aw-mode').selectOption('test');assert.equal(await page.getByRole('button',{name:'生成测试图文',exact:true}).count(),1);await page.locator('#aw-mode').selectOption('production');await page.locator('.aw-advanced summary').click();
 await page.getByRole('button',{name:'全部待发布 1 →',exact:true}).click();assert.equal(await page.locator('.aw-record').count(),1);assert.match(await page.locator('.aw-record').innerText(),/昨天的待发布作品/);
 await page.getByRole('button',{name:'去发布',exact:false}).click();await page.locator('.atlas-publish-guide').waitFor();assert.equal(atlas.get('publish-fixture').publication,undefined);assert.equal(desktopCalls.length,1);assert.equal(desktopCalls[0].folder,atlas.get('publish-fixture').project);
 await page.getByRole('button',{name:'标记已发布',exact:true}).click();await page.locator('dialog[open] input[name=url]').fill('https://www.xiaohongshu.com/explore/browser-fixture');await page.getByRole('button',{name:'确认已在小红书发布',exact:true}).click();await page.locator('.aw-publication').waitFor();assert.equal(atlas.get('publish-fixture').publication.source,'manual');
 await page.getByRole('button',{name:'编辑发布记录',exact:true}).click();await page.getByRole('button',{name:'撤销发布标记',exact:true}).click();await page.getByRole('button',{name:'标记已发布',exact:true}).waitFor();assert.equal(atlas.get('publish-fixture').publication,null);
 await page.getByRole('button',{name:'返回作品库',exact:false}).click();assert.equal(await page.locator('[data-status=publish]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-status=all]').click();await page.locator('#aw-query').fill('待检查作品');await page.locator('.aw-record [data-job=review-fixture]').first().click();await page.getByRole('button',{name:'检查完成，准备发布',exact:true}).click();await page.getByRole('button',{name:'去小红书发布',exact:true}).waitFor();assert.ok(atlas.get('review-fixture').reviewedAt);assert.equal(atlas.get('review-fixture').publication,undefined);
 await page.getByRole('button',{name:'复制标题',exact:true}).click();assert.equal(desktopCalls.at(-1).text,'待检查作品');
 await page.locator('[data-atlas-image]').first().click();await page.locator('dialog[open] [data-size]').filter({hasText:'1 × 1'}).waitFor();await page.getByRole('button',{name:'100% 原图',exact:true}).click();assert.equal(await page.locator('dialog.is-native').count(),1);await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
 await page.getByRole('button',{name:'返回作品库',exact:false}).click();assert.equal(await page.locator('#aw-query').inputValue(),'待检查作品');
 await page.locator('#aw-query').fill('不存在');assert.match(await page.locator('#aw-library-results').innerText(),/没有符合条件/);
 await page.locator('#aw-query').fill('');await page.locator('#aw-kind').selectOption('test');assert.equal(await page.locator('.aw-record').count(),1);
 await page.locator('.aw-tabs [data-workspace=topics]').click();
 await page.getByRole('button',{name:'添加选题',exact:false}).click();await page.locator('dialog[open] input[name=topic]').fill('新选题 | 兼容符号');await page.locator('dialog[open] input[name=category]').fill('知识');await page.getByRole('button',{name:'保存选题',exact:true}).click();await page.locator('.aw-topic-row').filter({hasText:'新选题 | 兼容符号'}).waitFor();assert.equal(atlas.queueConfig().items.at(-1).topic,'新选题 | 兼容符号');
 const newRow=page.locator('.aw-topic-row').filter({hasText:'新选题 | 兼容符号'});await newRow.getByRole('button',{name:'设为下一篇',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.aw-topic-info strong')?.textContent==='新选题 | 兼容符号');assert.equal(atlas.queueConfig().next.topic,'新选题 | 兼容符号');
 await newRow.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('dialog[open] input[name=category]').fill('新的分类');await page.getByRole('button',{name:'保存选题',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));assert.equal(atlas.queueConfig().next.category,'新的分类');
 await newRow.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('dialog[open] input[name=topic]').fill('需要保留的草稿');atlas.updateQueue({revision:atlas.queueConfig().revision,action:{type:'add',topic:'外部新选题',category:'外部'}});await page.getByRole('button',{name:'保存选题',exact:true}).click();await page.locator('dialog[open] [data-error]').filter({hasText:'其他窗口'}).waitFor();assert.equal(await page.locator('dialog[open] input[name=topic]').inputValue(),'需要保留的草稿');await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();await page.reload();await page.locator('.aw-topic-row').first().waitFor();
 await page.locator('.aw-tabs [data-workspace=today]').click();await page.getByRole('button',{name:'更换选题',exact:true}).click();await page.locator('[data-choice]').filter({hasText:'选题乙'}).click();await page.waitForFunction(()=>document.querySelector('.aw-topic-title h2')?.textContent==='选题乙');assert.equal(atlas.queueConfig().next.topic,'新选题 | 兼容符号');
 await page.getByRole('button',{name:'生成本篇图文',exact:true}).click();await page.locator('.aw-running').waitFor();assert.equal(atlas.list().find(j=>j.status==='generating').topic,'选题乙');
 assert.equal(atlas.list().find(j=>j.status==='generating').reviewEnabled,false);
 // Create a second real scheduler task from the UI while the first worker stays active.
 assert.equal(await page.getByRole('radio',{name:/摄影写实/}).isEnabled(),true);await page.getByRole('radio',{name:/摄影写实/}).check();
 await page.getByRole('button',{name:'更换选题',exact:true}).click();assert.equal(await page.locator('[data-choice]').filter({hasText:'选题乙'}).count(),0);await page.locator('[data-choice]').filter({hasText:'选题甲'}).click();
 await page.getByRole('button',{name:'生成本篇图文',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.aw-running').length===2);
 assert.equal(atlas.queueConfig().concurrency.running,2);assert.equal(atlas.list().find(j=>j.topic==='选题甲').visualStyle,'photoreal');
 await page.screenshot({path:path.join(artifacts,'workspace-parallel-fixture.png'),fullPage:true});
 // Old work remains selected while another job advances in the background.
 await page.locator('.aw-tabs [data-workspace=library]').click();await page.locator('#aw-kind').selectOption('production');await page.locator('.aw-record [data-job=review-fixture]').first().click();await page.waitForTimeout(3300);assert.match(page.url(),/job=review-fixture/);assert.equal(await page.locator('.aw-detail-heading h2').innerText(),'待检查作品');
 await page.reload();await page.locator('.aw-detail-heading').waitFor();assert.equal(await page.locator('.aw-detail-heading h2').innerText(),'待检查作品');
 // An unfinished formal job can be parked from the UI without losing files.
 const stopped=atlas.list().find(j=>j.status==='generating'&&j.topic==='选题乙');await atlas.cancel(stopped.id);await page.waitForTimeout(150);
 await page.goto(base+'/#atlas?view=today');await page.locator('.aw-pending-notice').waitFor();
 assert.equal(await page.getByRole('radio',{name:/摄影写实/}).isEnabled(),true);
 assert.equal(await page.getByRole('button',{name:'暂存，开始新创作',exact:true}).isEnabled(),true);
 const queueBeforePark=fs.readFileSync(atlas.queue);
 await page.getByRole('button',{name:'暂存，开始新创作',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.aw-pending-notice'));
 assert.equal(atlas.get(stopped.id).status,'parked');assert.deepEqual(fs.readFileSync(atlas.queue),queueBeforePark);
 assert.equal(atlas.queueConfig().concurrency.running,1);assert.equal(atlas.list().find(j=>j.topic==='选题甲').status,'generating');
 const remaining=atlas.list().find(j=>j.status==='generating');await atlas.cancel(remaining.id);await page.waitForTimeout(150);atlas.park(remaining.id);await page.reload();
 await page.getByRole('button',{name:'更换选题',exact:true}).click();await page.locator('[data-choice]').filter({hasText:'选题甲'}).click();
 await page.getByRole('button',{name:'生成本篇图文',exact:true}).waitFor();
 assert.equal(await page.getByRole('radio',{name:/摄影写实/}).isEnabled(),true);await page.getByRole('radio',{name:/摄影写实/}).check();
 assert.equal(await page.locator('.aw-topic-title h2').innerText(),'选题甲');assert.equal(await page.locator('.aw-pending-notice').count(),0);
 await page.locator('.aw-tabs [data-workspace=topics]').click();assert.equal(await page.getByRole('button',{name:'添加选题',exact:false}).isEnabled(),true);
 await page.locator('.aw-tabs [data-workspace=library]').click();await page.locator('[data-status=parked]').click();assert.equal(await page.locator('.aw-record').count(),2);
 await page.getByRole('button',{name:'查看暂存作品',exact:false}).first().click();await page.getByRole('button',{name:'继续生成',exact:true}).waitFor();assert.match(await page.locator('.aw-test-notice').innerText(),/不会自动修改当前选题进度/);
 await page.locator('.aw-tabs [data-workspace=library]').click();await page.locator('[data-status=all]').click();
 for(const width of [2560,1920,1512,1024,768,390]){
  await page.setViewportSize({width,height:1000});
  for(const view of ['today','library','topics']){await page.locator('.aw-tabs [data-workspace='+view+']').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${view} overflows at ${width}`)}
  await page.goto(base+'/#atlas?view=library&job=review-fixture');await page.locator('.aw-detail-heading').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`detail overflows at ${width}`);
 }
 await page.screenshot({path:path.join(artifacts,'workspace-mobile-fixture.png'),fullPage:true});
 await page.setViewportSize({width:1512,height:1100});await page.locator('.aw-tabs [data-workspace=today]').click();await page.screenshot({path:path.join(artifacts,'workspace-today-fixture.png'),fullPage:true});
 const empty=await browser.newPage();await empty.route('**/api/bootstrap',async route=>{const response=await route.fetch(),data=await response.json();data.jobs=[];data.queue=[];data.queueConfig={items:[],revision:'empty',pending:null,locked:false};await route.fulfill({response,json:data})});await empty.goto(base+'/#atlas?view=today');await empty.getByText('还没有待创作选题',{exact:true}).waitFor();assert.equal(await empty.getByRole('button',{name:'生成本篇图文',exact:true}).isDisabled(),true);await empty.locator('.aw-tabs [data-workspace=library]').click();await empty.getByText('作品库还是空的',{exact:true}).waitFor();await empty.close();
 const unavailable=await browser.newPage();await unavailable.route('**/api/bootstrap',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'隔离服务故障'})}));await unavailable.goto(base+'/#atlas');await unavailable.getByText(/连接本机服务失败/).waitFor();assert.equal(await unavailable.getByRole('button',{name:'重新连接',exact:true}).count(),1);await unavailable.close();
 const legacy=await browser.newPage();await legacy.route('**/api/bootstrap',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({token:'legacy-token',jobs:[],queue:[]})}));await legacy.goto(base+'/#atlas');await legacy.getByText(/本机服务版本较旧/).waitFor();assert.equal(await legacy.locator('[data-aw=generate]').count(),0);await legacy.close();
 assert.deepEqual(errors,[]);console.log('PASS: navigation, history filters, detail identity, review, publish preparation, manual marking/undo, copy, queue forms, independent topic selection, parallel generation, per-job cancel/park, background progress, deep links and six responsive widths.');
}finally{await browser?.close();await atlas.close();await new Promise(r=>setTimeout(r,80));await new Promise(r=>server.close(r));if(path.dirname(dataRoot)!==os.tmpdir()||!path.basename(dataRoot).startsWith('orbit-workspace-ui-'))throw new Error('Unexpected fixture path');fs.rmSync(dataRoot,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
