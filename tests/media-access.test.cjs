const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createAccessSync,unreadableFiles}=require('../lib/media-access.cjs');

test('readable files do not trigger an ACL export',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-access-'));
 try{fs.writeFileSync(path.join(dir,'caption.md'),'中文文案');let calls=0;
  assert.deepEqual(unreadableFiles(dir),[]);
  await createAccessSync(async()=>calls++)(dir);assert.equal(calls,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('concurrent readers share a repair and later images get a new repair',async()=>{
 let blocked=true,calls=0,release;
 const gate=new Promise(resolve=>release=resolve);
 const sync=createAccessSync(async()=>{calls++;await gate;blocked=false},{inspect:()=>blocked?[{file:'new.png'}]:[]});
 const first=sync('project'),second=sync('project');assert.equal(first,second);
 release();await Promise.all([first,second]);assert.equal(calls,1);
 blocked=true;await sync('project');assert.equal(calls,2);
});
test('partial ACL export is a visible failure; recovery is checked as the host',async()=>{
 let blocked=true,calls=0;
 const sync=createAccessSync(async()=>{calls++;return {stdout:'{"changed":1,"failed":[{}]}'}},{inspect:()=>blocked?[{file:'locked.png'}]:[],retryDelay:0});
 await assert.rejects(sync('project'),/读取权限尚未恢复.*locked.png/);assert.equal(calls,1);
 blocked=false;await sync('project');assert.equal(calls,1);
});
test('failed sandbox repair is throttled across poll and image requests',async()=>{
 let calls=0;const sync=createAccessSync(async()=>{calls++;throw new Error('sandbox unavailable')},{inspect:()=>[{file:'locked.png'}]});
 await assert.rejects(sync('project'),/sandbox unavailable/);
 await assert.rejects(sync('project'),/sandbox unavailable/);assert.equal(calls,1);
});
