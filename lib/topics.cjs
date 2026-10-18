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
// Change only the requested row(s); prose, extra columns and line endings survive.
function editTopics(text, action){
 const items=parseTopics(text),eol=text.includes('\r\n')?'\r\n':text.includes('\r')?'\r':'\n',lines=text.split(/\r\n|\n|\r/);
 if(!action||!['add','edit','next','move'].includes(action.type))throw fail('未知选题操作');
 const headers=[];for(let i=0;i<lines.length;i++){const names=cells(lines[i]).map(x=>x.toLowerCase());if(['status','topic','category'].every(k=>names.includes(k)))headers.push({index:i,names})}
 const headerFor=index=>headers.filter(h=>h.index<index).at(-1);
 const encode=value=>{if(typeof value!=='string'||!value.trim()||/[\r\n\0]/.test(value)||value.length>200||value.includes('\\'))throw fail('标题和分类需为 1–200 字的单行文字，不能包含反斜线');return value.trim().replace(/\|/g,'\\|')};
 if(action.type==='add'){
  const h=headers[0],row=h.names.map(k=>k==='status'?'TODO':k==='topic'?encode(action.topic):k==='category'?encode(action.category):'');
  const end=items.filter(item=>headerFor(item.line-1)===h).at(-1)?.line||h.index+2;
  lines.splice(end,0,'|'+row.join('|')+'|');
 }else{
  const item=items.find(x=>x.line===action.line);if(!item)throw fail('选题已变化，请刷新后重试',409);
  const index=item.line-1,h=headerFor(index),parts=cells(lines[index]);
  if(action.type==='edit'){
   parts[h.names.indexOf('topic')]=encode(action.topic);parts[h.names.indexOf('category')]=encode(action.category);
   lines[index]='|'+parts.map((value,i)=>['topic','category'].includes(h.names[i])?value:value.replace(/\|/g,'\\|')).join('|')+'|';
  }else{
   const target=action.type==='next'?items.find(x=>x.status==='TODO'&&x.line!==item.line):items[items.indexOf(item)+(action.direction==='up'?-1:action.direction==='down'?1:0)];
   if(action.type==='move'&&!['up','down'].includes(action.direction))throw fail('无效排序方向');
   if(action.type==='next'&&item.status!=='TODO'){
    if(action.regenerate!==true)throw fail('此选题已有成果，请先查看作品或明确选择再次生成');
    parts[h.names.indexOf('status')]='TODO';lines[index]='|'+parts.map(x=>x.replace(/\|/g,'\\|')).join('|')+'|';
   }
   if(target&&target.line!==item.line&&(action.type==='move'||target.line<item.line)){
    if(JSON.stringify(h.names)!==JSON.stringify(headerFor(target.line-1).names))throw fail('这两组选题的表格列不同，请在高级配置中调整顺序');
    const row=lines.splice(index,1)[0];lines.splice(target.line-1,0,row);
   }
  }
 }
 const result=lines.join(eol);parseTopics(result);return result;
}
// Commit exactly one reserved row into the latest queue, preserving every other
// byte. The stored raw row protects against external edits and duplicate topics.
function completeTopic(text,reservation){
 const items=parseTopics(text),matches=items.filter(x=>x.topic===reservation.topic&&x.category===reservation.category);
 if(matches.length!==1)throw fail('选题同步冲突：原选题已删除、改名或存在重复，请检查配置',409);
 const item=matches[0],lines=text.split(/\r\n|\n|\r/),row=lines[item.line-1];
 const expected=reservation.completedRow;
 if(item.status==='已生成'&&expected&&row===expected)return {text,alreadyCompleted:true};
 if(item.status!=='TODO'||row!==reservation.row)throw fail('选题同步冲突：该行已被修改，保留图文并等待确认',409);
 let header;for(let i=0;i<item.line-1;i++){const names=cells(lines[i]).map(x=>x.toLowerCase());if(['status','topic','category'].every(k=>names.includes(k)))header=names}
 const marks=[];for(let i=0;i<row.length;i++)if(row[i]==='|'){let n=0;for(let j=i-1;j>=0&&row[j]==='\\';j--)n++;if(n%2===0)marks.push(i)}
 const bounds=[-1,...marks,row.length];let spans=bounds.slice(0,-1).map((n,i)=>[n+1,bounds[i+1]]);
 if(!row.slice(0,marks[0]).trim())spans.shift();if(!row.slice(marks.at(-1)+1).trim())spans.pop();
 const [start,end]=spans[header.indexOf('status')],completedRow=row.slice(0,start)+row.slice(start,end).replace(/TODO/i,'已生成')+row.slice(end);
 // Splice by offset so mixed line endings elsewhere also remain byte-for-byte.
 const segments=text.split(/(\r\n|\n|\r)/);segments[(item.line-1)*2]=completedRow;
 return {text:segments.join(''),completedRow,alreadyCompleted:false};
}
module.exports={parseTopics,readTopics,saveTopics,editTopics,completeTopic};
