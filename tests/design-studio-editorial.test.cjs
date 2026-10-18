'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {createStudio}=require('../lib/design-studio.cjs');
const {loadCatalog,snapshotPages,validateTopic}=require('../lib/design-studio-content.cjs');
const ROOT=path.resolve(__dirname,'..'),roles=['cover','design','detail','interior','styling','journal'];
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value),'utf8');
// Deliberately synthetic PNG fixtures, stored only under an isolated temporary directory.
function png(color){
 const chunk=(name,data)=>{const body=Buffer.concat([Buffer.from(name),data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}const header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([header,body,tail])};
 const header=Buffer.alloc(13);header.writeUInt32BE(768,0);header.writeUInt32BE(1024,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc((768*3+1)*1024,color);for(let y=0;y<1024;y++)pixels[y*(768*3+1)]=0;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
function fixture(options={}){
 const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-editorial-test-')),catalog=loadCatalog(ROOT);
 const original=structuredClone(catalog.topics.find(t=>t.id==='DS003'));
 const snapshot={...structuredClone(original),schemaVersion:2,title:'包已经很努力了',caption:'独立六图概念设计稿，不修改原题。AI 辅助生成，尚未打样。',revision:'isolated-editorial-v2',pages:roles.map((role,i)=>({role,title:'测试页'+(i+1),focus:'隔离测试图片内容',filename:`0${i+1}_${role}.png`,prompt:'隔离测试的完整提示词，页面角色：'+role}))};
 const persistJob=(id,snap,extra={})=>{const project=path.join(dataRoot,'works',id);fs.mkdirSync(path.join(project,'prompts'),{recursive:true});const job={id,topicId:'DS003',title:snap.title,snapshot:snap,project,status:'ready',createdAt:'2026-10-18T00:00:00.000Z',events:[],...extra};fs.mkdirSync(path.join(dataRoot,'jobs'),{recursive:true});write(path.join(dataRoot,'jobs',id+'.json'),job);return job};
 const old=persistJob('old-four',original),job=persistJob('new-six',snapshot,{variantLabel:'六图编辑版',compareWithJobId:old.id});
 const caption=snapshot.title+'\n\n'+snapshot.caption+'\n\n'+snapshot.tags.map(t=>'#'+t).join(' ');fs.writeFileSync(path.join(job.project,'caption.txt'),caption,'utf8');
 for(const [i,page]of snapshot.pages.entries()){fs.writeFileSync(path.join(job.project,page.filename),png(20+i*30));fs.writeFileSync(path.join(job.project,'prompts',page.filename.replace('.png','.txt')),page.prompt,'utf8')}
 const generation={images:snapshot.pages.map((page,i)=>({filename:page.filename,tool:'image_gen',original_path:path.join(job.project,page.filename),prompt_file:'prompts/'+page.filename.replace('.png','.txt'),referenced_image_paths:i?[path.join(job.project,snapshot.pages[0].filename)]:[],sha256:digest(path.join(job.project,page.filename))}))};
 const review={verdict:'pass',captionSha256:digest(path.join(job.project,'caption.txt')),pages:snapshot.pages.map(page=>({filename:page.filename,sha256:digest(path.join(job.project,page.filename)),checked:true,observations:'Synthetic isolated fixture validates snapshot plumbing, not real generated content.'}))};
 write(path.join(job.project,'generation.json'),generation);write(path.join(job.project,'review.json'),review);
 const manager=createStudio({root:ROOT,dataRoot,catalog:{profile:catalog.profile,topics:[original]},sampleDir:null,detect:async()=>({available:true}),syncAccess:async()=>{},...options});
 return {dataRoot,manager,job:manager.get(job.id),old,original,generation,review,async cleanup(){await manager.close();assert.equal(path.dirname(dataRoot),os.tmpdir());assert.ok(path.basename(dataRoot).startsWith('orbit-editorial-test-'));fs.rmSync(dataRoot,{recursive:true,force:true})}};
}

test('six-page work exposes its own snapshot and images while the original catalog stays four-page',async()=>{
 const f=fixture();try{
  const view=f.manager.view(f.job);assert.equal(view.schemaVersion,2);assert.equal(view.pageCount,6);assert.equal(view.variantLabel,'六图编辑版');assert.equal(view.compareWithJobId,'old-four');
  assert.deepEqual(view.pages.map(p=>p.role),roles);assert.deepEqual(view.images.map(p=>p.index),[1,2,3,4,5,6]);assert.equal(view.pages[5].prompt,f.job.snapshot.pages[5].prompt);assert.deepEqual(view.design,f.job.snapshot.design);assert.equal(view.caption.body,f.job.snapshot.caption);
  const old=f.manager.view(f.manager.get(f.old.id));assert.equal(old.schemaVersion,1);assert.equal(old.pageCount,4);assert.equal(old.caption.body,f.original.caption);assert.deepEqual(old.pages.map(p=>p.prompt),f.original.pages.map(p=>p.prompt));
  const topic=f.manager.topic('DS003');assert.equal(topic.pages.length,4);assert.deepEqual(topic.pages,f.original.pages);assert.throws(()=>validateTopic(f.job.snapshot),/四张/);
  assert.equal(await f.manager.asset(f.job.id,'06_journal.png'),path.join(f.job.project,'06_journal.png'));await assert.rejects(f.manager.asset(f.old.id,'06_journal.png'),/不存在/);
  await assert.rejects(f.manager.asset(f.job.id,'../caption.txt'),/不存在/);await assert.rejects(f.manager.asset(f.job.id,'05_styling.png?x=1'),/不存在/);
 }finally{await f.cleanup()}
});

test('six-page validation checks every page, master references, immutable prompts and PNG decode',async()=>{
 const f=fixture();try{
  assert.equal(await f.manager.validate(f.job),true);assert.equal(f.job.review.pages.length,6);
  f.generation.images.pop();write(path.join(f.job.project,'generation.json'),f.generation);await assert.rejects(f.manager.validate(f.job),/完整的6图/);
  const last=f.job.snapshot.pages[5];f.generation.images.push({filename:last.filename,tool:'image_gen',original_path:path.join(f.job.project,last.filename),prompt_file:'prompts/'+last.filename.replace('.png','.txt'),referenced_image_paths:[],sha256:digest(path.join(f.job.project,last.filename))});write(path.join(f.job.project,'generation.json'),f.generation);await assert.rejects(f.manager.validate(f.job),/06_journal.png未使用主视觉参考/);
  f.generation.images[5].referenced_image_paths=[path.join(f.job.project,'01_cover.png')];write(path.join(f.job.project,'generation.json'),f.generation);
  fs.writeFileSync(path.join(f.job.project,'prompts','06_journal.txt'),'changed','utf8');await assert.rejects(f.manager.validate(f.job),/第6张图片提示词/);
  fs.writeFileSync(path.join(f.job.project,'prompts','06_journal.txt'),last.prompt,'utf8');assert.equal(await f.manager.validate(f.job),true);
 }finally{await f.cleanup()}
});

test('snapshot page plans reject traversal, duplicate names, unknown versions and malformed roles',async()=>{
 const f=fixture();try{
  for(const filename of ['../06_journal.png','sub/06_journal.png','sub\\06_journal.png','C:\\06_journal.png','06_journal.PNG','06_journal.svg','06_journal.png:other','01_cover.png']){const snapshot=structuredClone(f.job.snapshot);snapshot.pages[5].filename=filename;assert.throws(()=>snapshotPages(snapshot),/文件名/,filename)}
  assert.throws(()=>snapshotPages({...f.job.snapshot,schemaVersion:3}),/版本/);
  assert.throws(()=>snapshotPages({...f.job.snapshot,pages:f.job.snapshot.pages.slice(0,4)}),/6张/);
  const wrong=structuredClone(f.job.snapshot);wrong.pages[5].role='scene';assert.throws(()=>snapshotPages(wrong),/信息不完整/);
  const legacy=structuredClone(f.original);legacy.pages.forEach(p=>delete p.filename);assert.deepEqual(snapshotPages(legacy).map(p=>p.filename),f.original.pages.map(p=>p.filename));
 }finally{await f.cleanup()}
});

test('retry instructions honor the independent six-page snapshot',async()=>{
 let received='',finish;const f=fixture({launch:(job,instructions)=>{received=instructions;return {done:new Promise(resolve=>finish=resolve),cancel:async()=>finish()}}});
 try{f.job.status='interrupted';await f.manager.retry(f.job.id);assert.match(received,/prompts\/ 下6份完整提示词/);assert.match(received,/06_journal.png/);assert.match(received,/6\. journal/);assert.doesNotMatch(received,/四页|02–04|后续三图/);await f.manager.cancel(f.job.id)}finally{await f.cleanup()}
});
