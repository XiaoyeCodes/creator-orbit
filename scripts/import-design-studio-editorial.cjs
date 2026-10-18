'use strict';
// Import one already generated and reviewed six-page work without opening live managers.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createStudio}=require('../lib/design-studio.cjs');
const {snapshotPages,hash}=require('../lib/design-studio-content.cjs');
const {atomic,safeFile,inside}=require('../lib/atlas.cjs');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9-]+$/.test(id)&&id.length<=100;

async function importEditorial({id,root=path.resolve(__dirname,'..')}={}){
 if(!validId(id))throw new Error('请提供有效作品 id，仅允许字母、数字和连字符');
 root=path.resolve(root);
 const dataRoot=path.join(root,'data','design-studio'),workRoot=path.join(dataRoot,'works'),jobRoot=path.join(dataRoot,'jobs');
 const project=path.join(workRoot,id),jobFile=path.join(jobRoot,id+'.json');
 if(fs.existsSync(jobFile))throw new Error('作品 id 已存在，禁止覆盖：'+id);
 const topicFile=safeFile(workRoot,id+'/topic.json'),snapshot=read(topicFile);
 if(snapshot.schemaVersion!==2)throw new Error('只允许导入 schemaVersion:2 的独立六图作品');
 const pages=snapshotPages(snapshot);
 if(!/^DS\d{3}$/.test(snapshot.id)||typeof snapshot.title!=='string'||!snapshot.title.trim()||[...snapshot.title].length>20||typeof snapshot.caption!=='string'||!snapshot.caption.trim())throw new Error('作品编号、标题或正文无效');
 if(!Array.isArray(snapshot.tags)||!snapshot.tags.length||snapshot.tags.length>10||snapshot.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>30||t.includes('#')))throw new Error('作品标签无效');
 if([...snapshot.caption+'\n'+snapshot.tags.map(t=>'#'+t).join(' ')].length>1000)throw new Error('正文和标签超过1000字');
 const variantLabel=snapshot.variantLabel,compareWithJobId=snapshot.compareWithJobId;
 if(typeof variantLabel!=='string'||!variantLabel.trim()||variantLabel.length>80)throw new Error('缺少有效 variantLabel');
 if(!validId(compareWithJobId)||compareWithJobId===id)throw new Error('缺少有效 compareWithJobId');
 const comparisonFile=safeFile(jobRoot,compareWithJobId+'.json'),comparison=read(comparisonFile);
 if(comparison.id!==compareWithJobId||comparison.topicId!==snapshot.id||comparison.snapshot?.id!==snapshot.id||comparison.status!=='ready'||!inside(workRoot,comparison.project))throw new Error('关联原作必须是同一选题的现有 ready 作品');
 snapshotPages(comparison.snapshot);
 // Resolve every required file before validation so a symlink cannot escape this work.
 for(const filename of ['caption.txt','generation.json','review.json',...pages.map(p=>p.filename),...pages.map(p=>'prompts/'+p.filename.replace('.png','.txt'))])safeFile(project,filename);
 delete snapshot.revision;snapshot.revision=hash(snapshot);
 const now=new Date().toISOString(),job={id,topicId:snapshot.id,title:snapshot.title,snapshot,project,variantLabel,compareWithJobId,status:'ready',createdAt:now,updatedAt:now,events:[{time:now,message:'独立六图编辑版已完成逐图检查，原作保留以供对比。'}],message:'六张图片和发布文案已就绪，可与原版对比。'};
 const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-editorial-import-'));
 let manager;
 try{
  manager=createStudio({root,dataRoot:temporaryRoot,catalog:{profile:{categories:[]},topics:[]},sampleDir:null,syncAccess:async()=>{}});
  await manager.validate(job);
 }finally{
  if(manager)await manager.close();
  if(path.dirname(temporaryRoot)!==os.tmpdir()||!path.basename(temporaryRoot).startsWith('orbit-editorial-import-'))throw new Error('临时校验目录边界异常');
  fs.rmSync(temporaryRoot,{recursive:true,force:true});
 }
 if(fs.existsSync(jobFile))throw new Error('作品 id 已存在，禁止覆盖：'+id);
 // A same-directory hard link publishes the complete JSON atomically and fails if
 // another process claimed this id during validation; rename would overwrite it.
 const staged=path.join(jobRoot,`.${id}.${crypto.randomUUID()}.pending`);
 try{atomic(staged,job);fs.linkSync(staged,jobFile)}finally{if(fs.existsSync(staged))fs.unlinkSync(staged)}
 return {id:job.id,topicId:job.topicId,status:job.status,pageCount:pages.length,variantLabel,compareWithJobId,revision:snapshot.revision,jobFile,project};
}

if(require.main===module){
 const args=process.argv.slice(2);
 if(args.length!==1){process.stderr.write('用法：node scripts/import-design-studio-editorial.cjs <作品id>\n');process.exitCode=1}
 else importEditorial({id:args[0]}).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1});
}
module.exports={importEditorial};
