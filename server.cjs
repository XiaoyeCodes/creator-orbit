const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createAtlas,inside}=require('./lib/atlas.cjs');
const {createStudio}=require('./lib/design-studio.cjs');
const publishingLimits=require('./config/publishing-limits.json');
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png'};
function makeServer({atlas=createAtlas(),studio=null,root=path.join(__dirname,'dist')}={}){
 let studioManager=studio;const getStudio=()=>studioManager||(studioManager=createStudio());
 const token=crypto.randomBytes(32).toString('hex');
 const send=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))};
 const server=http.createServer(async(req,res)=>{try{
  if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||''))return send(res,403,{error:'只接受本机访问'});
  if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)return send(res,403,{error:'跨站请求已拒绝，请从本地工作台操作'});
  if(req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'跨站请求已拒绝'});
  const pathname=decodeURIComponent(new URL(req.url,`http://${req.headers.host}`).pathname);
  if(req.method==='GET'&&pathname==='/api/bootstrap'){await atlas.refreshMedia();return send(res,200,{workspaceVersion:2,studioVersion:3,publishingLimits,token,capabilities:await atlas.capability(),queue:atlas.queueItems(),queueConfig:atlas.queueConfig(),jobs:atlas.list()})}
  if(req.method==='GET'&&pathname==='/api/queue')return send(res,200,atlas.queueConfig());
  if(pathname.startsWith('/api/')){
   let body={};if(req.method==='POST'){
    if(req.headers['x-orbit-token']!==token||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(res,403,{error:'操作验证失败，请刷新工作台'});
    let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>(pathname==='/api/queue'?320*1024:pathname.startsWith('/api/studio/')?128*1024:16384))return send(res,413,{error:'请求过大'});chunks.push(chunk)}
    try{body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{return send(res,400,{error:'无效 JSON'})}
   }
   if(pathname.startsWith('/api/studio/')){
    const s=getStudio();
    if(req.method==='GET'&&pathname==='/api/studio/bootstrap')return send(res,200,{...await s.bootstrap(),token});
    if(req.method==='GET'&&pathname==='/api/studio/export')return send(res,200,s.exportCatalog());
    if(req.method==='GET'&&pathname==='/api/studio/jobs'){await s.refreshMedia();return send(res,200,s.list());}
    if(req.method==='POST'&&pathname==='/api/studio/jobs')return send(res,202,await s.create(body));
    const topicMatch=pathname.match(/^\/api\/studio\/topics\/(DS\d{3})$/);
    if(topicMatch&&req.method==='GET')return send(res,200,s.topic(topicMatch[1]));
    if(topicMatch&&req.method==='POST')return send(res,200,s.updateTopic(topicMatch[1],body));
    const jobMatch=pathname.match(/^\/api\/studio\/jobs\/([a-zA-Z0-9-]+)(?:\/(retry|cancel|open-folder|assets)(?:\/([^/]+))?)?$/);
    if(jobMatch){const [,id,action,name]=jobMatch;
     if(req.method==='GET'&&!action)return send(res,200,await s.progress(id));
     if(req.method==='GET'&&action==='assets'){const file=await s.asset(id,name);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await fs.promises.readFile(file));return}
     if(req.method==='POST'){if(action==='retry')return send(res,200,await s.retry(id));if(action==='cancel')return send(res,200,await s.cancel(id));if(action==='open-folder')return send(res,200,await s.openFolder(id));}
    }
    return send(res,404,{error:'设计所接口不存在'});
   }
   if(req.method==='POST'&&pathname==='/api/queue')return send(res,200,atlas.updateQueue(body));
   if(req.method==='POST'&&pathname==='/api/queue/open')return send(res,200,await atlas.openQueue());
   if(req.method==='POST'&&pathname==='/api/jobs')return send(res,202,await atlas.create(body.mode||'production',{testTopic:body.testTopic,visualStyle:body.visualStyle,...(body.topic!==undefined?{topic:body.topic}:{}),...(body.topicCategory!==undefined?{topicCategory:body.topicCategory}:{}),...(body.reviewEnabled!==undefined?{reviewEnabled:body.reviewEnabled}:{}),...(body.queueRevision!==undefined?{queueRevision:body.queueRevision}:{})}));
   const match=pathname.match(/^\/api\/jobs\/([a-zA-Z0-9-]+)(?:\/(sync-queue|park|retry|cancel|publish|review|content-review|publication|copy|open-folder|assets)(?:\/(.+))?)?$/);
   if(!match)return send(res,404,{error:'接口不存在'});const [,id,action,filename]=match;
   if(req.method==='GET'&&!action)return send(res,200,await atlas.progress(id));
   if(req.method==='GET'&&action==='assets'){const file=await atlas.asset(id,filename);const bytes=await fs.promises.readFile(file);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return}
   if(req.method==='POST'){const handlers={'sync-queue':()=>atlas.syncQueue(id),park:()=>atlas.park(id),'content-review':()=>atlas.startContentReview(id),retry:()=>atlas.retry(id),cancel:()=>atlas.cancel(id),publish:()=>atlas.publish(id),review:()=>atlas.review(id),publication:()=>atlas.publication(id,body),copy:()=>atlas.copy(id,body.kind),'open-folder':()=>atlas.openFolder(id)};if(handlers[action])return send(res,200,await handlers[action]())}
   return send(res,405,{error:'不支持此操作'});
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'不支持此方法'});
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!inside(root,file)||!fs.existsSync(file)||!fs.statSync(file).isFile()||!inside(fs.realpathSync(root),fs.realpathSync(file)))return send(res,404,{error:'文件不存在'});
  const bytes=req.method==='HEAD'?null:await fs.promises.readFile(file);res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(bytes);
 }catch(e){send(res,e.status||400,{error:e.message||'操作未完成'})}});
 server.atlas=atlas;Object.defineProperty(server,'studio',{get:()=>studioManager});return server;
}
if(require.main===module){const port=Number(process.env.ORBIT_PORT||4173);const server=makeServer();server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已在使用。请直接打开 http://127.0.0.1:${port}`:e.message);process.exitCode=1});server.listen(port,'127.0.0.1',()=>console.log(`ORBIT 本机工作台：http://127.0.0.1:${port}`));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await Promise.all([server.atlas.close(),server.studio?.close()]);server.close(()=>process.exit(0))})}
module.exports={makeServer};
