const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function cells(line){
 const marks=[];
 for(let i=0;i<line.length;i++)if(line[i]==='|'){
  let slashes=0;for(let j=i-1;j>=0&&line[j]==='\\';j--)slashes++;
  if(slashes%2===0)marks.push(i);
 }
 if(!marks.length)return [];
 const bounds=[-1,...marks,line.length];let parts=bounds.slice(0,-1).map((n,i)=>line.slice(n+1,bounds[i+1]));
 if(!line.slice(0,marks[0]).trim())parts.shift();
 if(!line.slice(marks.at(-1)+1).trim())parts.pop();
 return parts.map(x=>x.trim().replace(/\\\|/g,'|'));
}
function parseTopics(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>256*1024||text.includes('\0'))throw fail('配置必须是 256 KB 以内的 Markdown 文本');
 const lines=text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/),items=[];let header=null,saw=false;
 for(let index=0;index<lines.length;index++){
  const row=cells(lines[index]),lower=row.map(x=>x.toLowerCase());
  if(!header){
   if(!['status','topic','category'].every(k=>lower.includes(k)))continue;
   if(new Set(lower).size!==lower.length)throw fail(`第 ${index+1} 行有重复列名`);
   const separator=cells(lines[index+1]||'');
   if(separator.length!==row.length||!separator.every(x=>/^:?-+:?$/.test(x)))throw fail(`第 ${index+2} 行必须是 Markdown 表格分隔行`);
   header={count:row.length,status:lower.indexOf('status'),topic:lower.indexOf('topic'),category:lower.indexOf('category')};saw=true;index++;continue;
  }
  if(!row.length){header=null;continue}
  if(row.length!==header.count)throw fail(`第 ${index+1} 行列数不一致；文字中的 | 请写成 \\|`);
  const status=row[header.status].toUpperCase(),topic=row[header.topic],category=row[header.category];
  if(!['TODO','已生成'].includes(status))throw fail(`第 ${index+1} 行状态应为 TODO 或 已生成`);
  if(!topic||!category)throw fail(`第 ${index+1} 行主题和分类不能为空`);
  items.push({status,topic,category,line:index+1});
 }
 if(!saw)throw fail('需要包含 Status、Topic、Category 三列的 Markdown 表格');
 return items;
}
function readTopics(file){
 const bytes=fs.readFileSync(file);let text;
 try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{throw fail('配置文件需要使用 UTF-8 编码')}
 let items=[],error='';try{items=parseTopics(text)}catch(e){error=e.message}
 return {path:file,text,revision:hash(bytes),items,next:items.find(x=>x.status==='TODO')||null,error};
}
function saveTopics(file,{text,revision},backupRoot){
 parseTopics(text);
 if(typeof revision!=='string')throw fail('缺少配置版本，请重新读取配置',409);
 const lock=file+'.shiguang.lock';let fd;
 try{fd=fs.openSync(lock,'wx')}catch(e){if(e.code==='EEXIST')throw fail('配置正在被其他任务使用，请稍后重试',409);throw e}
 let tmp;
 try{
  const before=fs.readFileSync(file);
  if(hash(before)!==revision)throw fail('配置已在其他窗口或编辑器中修改。请保留草稿，重新读取后再保存。',409);
  const after=Buffer.from(text,'utf8');if(before.equals(after))return {...readTopics(file),backupPath:null};
  fs.mkdirSync(backupRoot,{recursive:true});
  const backupPath=path.join(backupRoot,`${Date.now()}-${crypto.randomUUID()}.md`);fs.writeFileSync(backupPath,before,{flag:'wx'});
  tmp=file+'.'+crypto.randomUUID()+'.tmp';const out=fs.openSync(tmp,'wx');try{fs.writeFileSync(out,after);fs.fsyncSync(out)}finally{fs.closeSync(out)}
  if(hash(fs.readFileSync(file))!==revision)throw fail('保存期间配置发生变化，请重新读取',409);
  fs.renameSync(tmp,file);tmp=null;
  return {...readTopics(file),backupPath};
 }finally{if(tmp&&fs.existsSync(tmp))fs.unlinkSync(tmp);fs.closeSync(fd);fs.unlinkSync(lock)}
}
module.exports={parseTopics,readTopics,saveTopics};
