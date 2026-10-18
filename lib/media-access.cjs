const fs=require('node:fs');
const path=require('node:path');

// Check as the host user: sandbox ACL changes alone are not proof of readability.
function unreadableFiles(project){
 const blocked=[];
 function visit(file){
  let fd;
  try{
   const stat=fs.lstatSync(file);
   if(stat.isSymbolicLink())return;
   if(stat.isDirectory()){for(const name of fs.readdirSync(file))visit(path.join(file,name));return}
   if(!stat.isFile())return;
   fd=fs.openSync(file,'r');fs.readSync(fd,Buffer.alloc(1),0,1,0);
  }catch(e){if(e.code!=='ENOENT')blocked.push({file,error:e.code||e.message})}
  finally{if(fd!==undefined)fs.closeSync(fd)}
 }
 visit(project);return blocked;
}

function createAccessSync(exportAccess,{inspect=unreadableFiles,retryDelay=10000}={}){
 const pending=new Map(),failures=new Map();
 return function sync(project){
  if(pending.has(project))return pending.get(project);
  const previous=failures.get(project);
  if(previous&&Date.now()-previous.time<retryDelay)return Promise.reject(previous.error);
  const task=Promise.resolve().then(async()=>{
   if(!inspect(project).length){failures.delete(project);return}
   await exportAccess(project);
   const remaining=inspect(project);
   if(remaining.length)throw new Error('素材读取权限尚未恢复：'+remaining.slice(0,3).map(x=>path.basename(x.file)).join('、')+'。请稍后刷新重试。');
   failures.delete(project);
  }).catch(error=>{failures.set(project,{time:Date.now(),error});throw error}).finally(()=>pending.delete(project));
  pending.set(project,task);return task;
 };
}
module.exports={unreadableFiles,createAccessSync};
