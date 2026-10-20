const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../dist/folder-backup.mjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually(check){for(let i=0;i<100;i++){if(check())return;await wait(5);}assert.fail('Timed out waiting for backup');}
function filesystem(){
 const state={files:new Map(),attempts:0,active:0,maxActive:0,failures:0,permission:'granted',requests:0,failPath:'',beforeWrite:null};
 function directory(prefix=''){
  return {kind:'directory',name:prefix||'Test backup',
   async queryPermission(options){assert.equal(options.mode,'readwrite');return state.permission;},
   async requestPermission(options){assert.equal(options.mode,'readwrite');state.requests++;return state.permission=state.requestResult||'granted';},
   async getDirectoryHandle(name,options){assert.equal(options.create,true);return directory(prefix+'/'+name);},
   async getFileHandle(name,options){assert.equal(options.create,true);const file=prefix+'/'+name;return {async createWritable(){
    state.active++;state.maxActive=Math.max(state.maxActive,state.active);let bytes;
    return {async write(blob){state.attempts++;if(state.beforeWrite)await state.beforeWrite(file);
     if(state.failures-->0||state.failPath===file)throw Object.assign(new Error('Offline'),{name:'NotFoundError'});bytes=await blob.text();},
     async close(){state.files.set(file,bytes);state.active--;},async abort(){state.active--;}};
   }};}
  };
 }
 return {root:directory(),state};
}
async function fixture(options={}){
 const {createFolderBackup}=await modulePromise,{root,state}=options.fs||filesystem();
 const revisions={current:'r0',expenses:[{id:'one',amount:1000}],profile:{name:'테스트',title:'',isTeamLead:false}};
 let saved=options.saved===undefined?{id:'folderBackup',handle:root,lastSyncedRevision:'r0',lastSyncedAt:1}:options.saved;
 const sleeps=[],states=[];let pickerCalls=0,generated=0;
 const makeFiles=()=>['개인경비.xlsx','영수증.zip','data.json'].map(name=>({name,blob:new Blob([name])}));
 const controller=createFolderBackup({supported:options.supported!==false,debounceMs:10,
  readSetting:async()=>saved,writeSetting:async value=>{saved={...value};},
  getRevision:async()=>revisions.current,
  getSnapshot:async()=>({revision:revisions.current,data:{format:'sa-expense-web',version:1,exportedAt:new Date().toISOString(),settings:{...revisions.profile},expenses:revisions.expenses.map(x=>({...x}))}}),
  makeSubmission:async()=>{generated++;return makeFiles();},
  sleep:async ms=>{sleeps.push(ms);},onStatus:s=>states.push(s),
  pickDirectory:async args=>{pickerCalls++;assert.equal(args.mode,'readwrite');if(options.cancelPicker)throw Object.assign(new Error(),{name:'AbortError'});return root;}});
 await controller.initialize();
 return {controller,root,state,revisions,sleeps,states,makeFiles,get saved(){return saved;},get pickerCalls(){return pickerCalls;},get generated(){return generated;},get status(){return states.at(-1);}};
}
test('connecting writes an all-month v1 snapshot, with profile data and no folder handle',async()=>{
 const f=await fixture({saved:null});assert.equal(f.controller.connected,false);
 assert.equal(await f.controller.connect(),true);assert.equal(f.pickerCalls,1);
 const data=JSON.parse(f.state.files.get('/working/data.json'));
 assert.equal(data.format,'sa-expense-web');assert.equal(data.version,1);assert.equal(data.expenses.length,1);
 assert.deepEqual(Object.keys(data).sort(),['expenses','exportedAt','format','settings','version']);
 assert.deepEqual(data.settings,f.revisions.profile);assert.equal(f.saved.handle,f.root);
 assert.equal(f.status.pending,false);assert.ok(f.status.lastSyncedAt>1);await f.controller.disconnect();
});
test('rapid changes debounce into one write of the latest local snapshot',async()=>{
 const f=await fixture();for(let i=1;i<=3;i++){f.revisions.current='r'+i;f.revisions.expenses[0].amount=i;f.controller.changed();}
 await eventually(()=>f.saved.lastSyncedRevision==='r3'&&!f.status.writing);
 assert.equal(f.state.attempts,1);assert.equal(JSON.parse(f.state.files.get('/working/data.json')).expenses[0].amount,3);
 await f.controller.disconnect();
});
test('changes committed during a slow write get a second, current snapshot',async()=>{
 const f=await fixture();let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 f.state.beforeWrite=async()=>{f.state.beforeWrite=null;entered();await gate;};
 f.revisions.current='r1';const first=f.controller.retry();await started;
 f.revisions.current='r2';f.revisions.expenses.push({id:'two'});f.controller.changed();await wait(20);release();await first;
 await eventually(()=>f.saved.lastSyncedRevision==='r2'&&!f.status.writing);
 assert.equal(JSON.parse(f.state.files.get('/working/data.json')).expenses.length,2);assert.equal(f.state.maxActive,1);await f.controller.disconnect();
});
test('temporary failures retry at 1, 2, 4 seconds and only closed writes become successful',async()=>{
 const f=await fixture();f.state.failures=3;assert.equal(await f.controller.retry(),true);
 assert.deepEqual(f.sleeps,[1000,2000,4000]);assert.equal(f.state.attempts,4);assert.equal(f.state.active,0);assert.equal(f.status.error,'');await f.controller.disconnect();
});
test('exhausted writes remain pending without mutating local expenses and can be retried',async()=>{
 const f=await fixture();f.revisions.current='r1';f.state.failures=10;
 assert.equal(await f.controller.retry(),false);assert.equal(f.state.attempts,4);assert.equal(f.saved.lastSyncedAt,1);
 assert.equal(f.status.pending,true);assert.equal(f.status.error,'write');assert.equal(f.revisions.expenses.length,1);
 await wait(25);assert.equal(f.state.attempts,4);
 f.state.failures=0;assert.equal(await f.controller.retry(),true);assert.equal(f.saved.lastSyncedRevision,'r1');await f.controller.disconnect();
});
test('startup checks permission without prompting, manual retry requests permission once',async()=>{
 const fs=filesystem();fs.state.permission='prompt';const f=await fixture({fs});
 assert.equal(f.state.requests,0);assert.equal(f.state.attempts,0);
 assert.equal(await f.controller.retry(),true);assert.equal(f.state.requests,1);await f.controller.disconnect();
});
test('denied permission neither writes nor repeatedly prompts',async()=>{
 const fs=filesystem();fs.state.permission='prompt';fs.state.requestResult='denied';const f=await fixture({fs});
 assert.equal(await f.controller.retry(),false);assert.equal(f.state.requests,1);assert.equal(f.state.attempts,0);assert.deepEqual(f.sleeps,[]);await f.controller.disconnect();
});
test('a saved dirty revision resumes automatically without prompting after restart',async()=>{
 const f=await fixture({saved:{id:'folderBackup',handle:null}});await f.controller.disconnect();
 const next=await fixture({fs:{root:f.root,state:f.state},saved:{id:'folderBackup',handle:f.root,lastSyncedRevision:'old'}});
 await eventually(()=>next.saved.lastSyncedRevision==='r0'&&!next.status.writing);assert.equal(next.state.requests,0);await next.controller.disconnect();
});
test('working and monthly files share one writer and monthly files retain their exact names',async()=>{
 const f=await fixture();await Promise.all([f.controller.retry(),f.controller.saveSubmission('2026-10',f.makeFiles())]);
 assert.equal(f.state.maxActive,1);for(const name of ['개인경비.xlsx','영수증.zip','data.json'])assert.equal(f.state.files.get('/2026-10/'+name),name);
 assert.equal(f.status.submissionPending,false);assert.equal(f.saved.pendingMonth,null);await f.controller.disconnect();
});
test('partial submission failure is pending, survives restart and is regenerated on manual retry',async()=>{
 const f=await fixture();f.state.failPath='/2026-10/영수증.zip';
 await assert.rejects(f.controller.saveSubmission('2026-10',f.makeFiles()));
 assert.equal(f.status.submissionPending,true);assert.equal(f.saved.pendingMonth,'2026-10');assert.equal(f.state.files.has('/2026-10/data.json'),false);
 f.state.failPath='';const restored=await fixture({fs:{root:f.root,state:f.state},saved:f.saved});
 assert.equal(restored.status.submissionPending,true);assert.equal(await restored.controller.retry(),true);
 assert.equal(restored.generated,1);assert.equal(restored.saved.pendingMonth,null);assert.equal(restored.status.submissionPending,false);await restored.controller.disconnect();
});
test('unsupported browsers and picker cancellation preserve the download-only flow',async()=>{
 const f=await fixture({supported:false});assert.equal(f.controller.connected,false);assert.equal(await f.controller.connect(),false);assert.equal(f.pickerCalls,0);assert.equal(f.state.attempts,0);
 const cancel=await fixture({cancelPicker:true});assert.equal(await cancel.controller.connect(),false);assert.equal(cancel.saved.handle,cancel.root);assert.equal(cancel.state.attempts,0);await cancel.controller.disconnect();
});
test('a different month cannot silently replace an unfinished submission',async()=>{
 const f=await fixture();f.state.failPath='/2026-10/영수증.zip';
 await assert.rejects(f.controller.saveSubmission('2026-10',f.makeFiles()));
 await assert.rejects(f.controller.saveSubmission('2026-11',f.makeFiles()),/2026-10/);
 assert.equal(f.saved.pendingMonth,'2026-10');assert.equal(f.status.pendingMonth,'2026-10');await f.controller.disconnect();
});
test('disconnecting retains backup files and stops later automatic writes',async()=>{
 const f=await fixture();await f.controller.retry();await f.controller.disconnect();const attempts=f.state.attempts;
 f.revisions.current='r2';f.controller.changed();await wait(25);assert.equal(f.state.attempts,attempts);assert.equal(f.saved.handle,null);assert.ok(f.state.files.has('/working/data.json'));
});
