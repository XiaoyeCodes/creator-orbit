const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
function cleanEnv() {
  const env = {...process.env, PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8'};
  for (const key of ['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL','OPENAI_ORG_ID','OPENAI_PROJECT_ID','CODEX_ACCESS_TOKEN']) delete env[key];
  return env;
}
function pythonBinary() {
  if(process.env.ORBIT_PYTHON_PATH)return process.env.ORBIT_PYTHON_PATH;
  const p=spawnSync(process.platform==='win32'?'where.exe':'which',['python'],{encoding:'utf8',windowsHide:true,timeout:5000});
  return p.status===0?p.stdout.trim().split(/\r?\n/)[0]:'python';
}
function findCodex() {
  if (process.env.ORBIT_CODEX_PATH && fs.existsSync(process.env.ORBIT_CODEX_PATH)) return process.env.ORBIT_CODEX_PATH;
  const root = path.join(process.env.LOCALAPPDATA || '', 'OpenAI','Codex','bin');
  if (fs.existsSync(root)) {
    const candidates = fs.readdirSync(root).map(x=>path.join(root,x,'codex.exe')).filter(x=>fs.existsSync(x));
    candidates.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
    if(candidates.length) return candidates[0];
  }
  const found=spawnSync(process.platform==='win32'?'where.exe':'which',['codex'],{encoding:'utf8',windowsHide:true,timeout:5000});
  return found.status===0 ? found.stdout.trim().split(/\r?\n/).find(x=>!x.endsWith('.cmd')&&!x.endsWith('.ps1')) || null : null;
}
function run(command,args,{cwd,input,timeout=30000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env:cleanEnv(),windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('操作超时，请检查本机环境后重试'));},timeout);
    child.stdout.on('data',x=>{if(stdout.length<4000000)stdout+=x.toString()});child.stderr.on('data',x=>{if(stderr.length<1000000)stderr+=x.toString()});
    child.on('error',e=>{clearTimeout(timer);reject(e)});
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolve({stdout,stderr});else reject(new Error((stderr||stdout||`进程退出 (${code})`).slice(-7000)))});
    child.stdin.on('error',()=>{});child.stdin.end(input||'');
  });
}
async function detect() {
  const codex=findCodex();let loggedIn=false,version='',reason='未找到 Codex，请安装或设置 ORBIT_CODEX_PATH';let python=false;
  if(codex)try{const [v,a]=await Promise.all([run(codex,['--version']),run(codex,['login','status'])]);version=v.stdout.trim();loggedIn=/ChatGPT/i.test(a.stdout+a.stderr);reason=loggedIn?'':'需要使用 ChatGPT 账号登录 Codex，API Key 登录不支持此工作流';}catch(e){reason=e.message}
  try{await run(process.env.ORBIT_PYTHON_PATH||'python',['-c','import PIL; print(PIL.__version__)']);python=true}catch{reason+=(reason?'；':'')+'需要 Python 3.10+ 与 Pillow'}
  return {available:!!codex&&loggedIn&&python,codex:!!codex,loggedIn,python,version,reason,provider:'Codex · ChatGPT 登录 · 内置生图'};
}
async function desktop(root,payload) {
  if(process.platform!=='win32')throw new Error('桌面发布助手目前支持 Windows');
  const r=await run('powershell.exe',['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','desktop.ps1')],{cwd:root,input:JSON.stringify(payload),timeout:30000});
  return JSON.parse(r.stdout.replace(/^\uFEFF/,''));
}
async function exportAccess(root,project) {
  if(process.platform!=='win32')return;
  const sid=(await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'])).stdout.trim();
  if(!/^S-1-5-21-[0-9-]+$/.test(sid))throw new Error('无法确认本机素材接收用户');
  return run(findCodex(),['-c','windows.sandbox="elevated"','sandbox','-P',':workspace','-C',project,'--','powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','export-access.ps1'),'-Project',project,'-OwnerSid',sid],{cwd:project,timeout:120000});
}
module.exports={run,detect,findCodex,pythonBinary,cleanEnv,desktop,exportAccess};
