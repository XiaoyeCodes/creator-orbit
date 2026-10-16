// The full Markdown stays editable; it is never silently rebuilt from a table.
window.openAtlasQueue=async function({api,onSaved}){
 const d=document.createElement('dialog');d.className='atlas-config';
 d.innerHTML=`<div class="dialog-header"><div><div class="eyebrow">TOPIC CONFIGURATION</div><h2>编辑选题配置</h2></div><button type="button" aria-label="关闭配置">×</button></div><div class="atlas-config-loading">正在读取本机配置…</div>`;
 document.body.append(d);d.showModal();
 let config,initial='',lineEnding='\n',saving=false,dirty=false;
 function close(){if(saving)return;if(dirty){d.querySelector('[data-q-discard]').hidden=false;message('还有未保存的修改。可以继续编辑，或点击“放弃修改并关闭”。');return}d.close()}
 d.querySelector('[aria-label="关闭配置"]').onclick=close;
 d.addEventListener('cancel',e=>{e.preventDefault();close()});d.addEventListener('close',()=>d.remove());
 const message=(text,error=false)=>{const el=d.querySelector('[data-q-message]');if(el){el.textContent=text;el.classList.toggle('is-error',error)}};
 function busy(value){saving=value;d.querySelectorAll('button').forEach(b=>b.disabled=value);const area=d.querySelector('textarea');if(area)area.readOnly=value;const save=d.querySelector('[data-q-save]');if(save)save.disabled=value||config.locked}
 function apply(value){config=value;lineEnding=value.text.includes('\r\n')?'\r\n':value.text.includes('\r')?'\r':'\n';dirty=false;d.querySelector('#atlas-config-text').value=value.text;initial=d.querySelector('#atlas-config-text').value;d.querySelector('[data-q-path]').textContent=value.path;d.querySelector('[data-q-next]').textContent=value.next?.topic||'暂无待生成内容';d.querySelector('[data-q-count]').textContent=`${value.items.length} 个选题 · ${value.items.filter(x=>x.status==='TODO').length} 个待办`;d.querySelector('[data-q-save]').disabled=value.locked;message(value.error||value.lockReason||'修改顺序即可调整生成顺序；只有 TODO 会进入生成队列。',!!value.error)}
 try{
  config=await api('/api/queue');if(!d.isConnected)return;
  d.querySelector('.atlas-config-loading').outerHTML=`<div class="atlas-config-body"><div class="atlas-config-source"><span>当前文件</span><code data-q-path></code><button class="btn" data-q-open>用记事本打开</button></div><div class="atlas-config-summary"><div><span>当前文件的下一篇</span><strong data-q-next></strong></div><small data-q-count></small></div><p class="atlas-config-help">每行一个选题：<code>|TODO|主题标题|分类|</code>。可新增、删除、移动整行；将 <code>TODO</code> 改为 <code>已生成</code> 即可跳过该选题。<br>保留 <code>Status / Topic / Category</code> 表头和下一行分隔线。文本中的竖线写成 <code>\\|</code>。</p><label for="atlas-config-text">配置文件原文 · Markdown</label><textarea id="atlas-config-text" aria-label="选题配置原文" spellcheck="false"></textarea><div data-q-message role="status"></div><div class="atlas-config-footer"><span>保存前自动备份原文件</span><div><button class="btn" data-q-discard hidden>放弃修改并关闭</button><button class="btn" data-q-reload>重新读取文件</button><button class="btn btn-primary" data-q-save>保存并更新下一篇</button></div></div></div>`;
  apply(config);
  d.querySelector('textarea').addEventListener('input',e=>{dirty=e.target.value!==initial;message(dirty?'有未保存的修改，保存后下一篇才会更新。':'内容未修改。')});
  d.querySelector('[data-q-discard]').onclick=()=>{dirty=false;d.close()};
  d.querySelector('[data-q-open]').onclick=async()=>{try{await api('/api/queue/open',{});message('已打开记事本。外部保存后点击“重新读取文件”。')}catch(e){message(e.message,true)}};
  d.querySelector('[data-q-reload]').onclick=async()=>{
   busy(true);try{const fresh=await api('/api/queue');if(dirty){
    // Retain the draft visibly instead of overwriting it when a conflict occurs.
    let details=d.querySelector('[data-q-draft]');if(!details){details=document.createElement('details');details.dataset.qDraft='';details.innerHTML='<summary>保存前的未提交草稿（可展开复制）</summary><textarea readonly aria-label="保留的配置草稿"></textarea>';d.querySelector('.atlas-config-footer').before(details)}details.querySelector('textarea').value=d.querySelector('#atlas-config-text').value;
   }apply(fresh);await onSaved(fresh);message('已读取最新配置。未提交草稿如有修改，会保留在下方供复制。')}catch(e){message(e.message,true)}finally{busy(false)}
  };
  d.querySelector('[data-q-save]').onclick=async()=>{
   busy(true);try{const draft=d.querySelector('#atlas-config-text').value;const text=draft===initial?config.text:draft.replace(/\n/g,lineEnding);const saved=await api('/api/queue',{text,revision:config.revision});apply(saved);await onSaved(saved);message(saved.backupPath?'已保存并更新下一篇。原配置备份：'+saved.backupPath:'内容未变化，下一篇已刷新。');d.querySelector('[data-q-discard]').hidden=true}catch(e){message(e.message,true)}finally{busy(false)}
  };
 }catch(e){d.querySelector('.atlas-config-loading').textContent='无法读取配置：'+e.message}
};
