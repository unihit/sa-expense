// A one-way copy of IndexedDB. Folder contents never become application state.
export function createFolderBackup({readSetting,writeSetting,getSnapshot,getRevision,makeSubmission,onStatus,
 supported=typeof globalThis.showDirectoryPicker==='function',
 pickDirectory=options=>globalThis.showDirectoryPicker(options),
 sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),debounceMs=1500}){
 let handle=null,lastSyncedAt=0,lastSyncedRevision=null,dirty=false,permission='prompt';
 let error='',writing=false,retrying=false,timer=null,tail=Promise.resolve(),syncInFlight=null,pendingSubmission=null;
 const emit=()=>onStatus?.({supported,connected:!!handle,folderName:handle?.name||'',permission,
  pending:dirty,writing,retrying,error,submissionPending:!!pendingSubmission,pendingMonth:pendingSubmission?.month||null,lastSyncedAt});
 const enqueue=task=>{const result=tail.then(task);tail=result.catch(()=>{});return result;};
 const cancelTimer=()=>{clearTimeout(timer);timer=null;};
 const record=()=>({id:'folderBackup',handle,lastSyncedAt,lastSyncedRevision,pendingMonth:pendingSubmission?.month||null});
 const permissionError=()=>Object.assign(new Error('폴더 쓰기 권한이 필요합니다.'),{name:'NotAllowedError'});
 async function writeFile(folder,name,blob){
  const file=await folder.getFileHandle(name,{create:true});
  const stream=await file.createWritable();
  try{await stream.write(blob);await stream.close();}
  catch(e){await stream.abort().catch(()=>{});throw e;}
 }
 async function withRetries(task){
  for(let attempt=0;;attempt++){
   try{
    permission=await handle.queryPermission({mode:'readwrite'});
    if(permission!=='granted')throw permissionError();
    return await task();
   }catch(e){
    if(['NotAllowedError','SecurityError','AbortError'].includes(e.name)||attempt===3)throw e;
    retrying=true;emit();await sleep([1000,2000,4000][attempt]);
   }
  }
 }
 async function syncTask(){
  if(!handle)return false;
  writing=true;retrying=false;error='';emit();
  try{
   // Capture the data and its revision together, after the local commit completes.
   const snapshot=await getSnapshot();
   await withRetries(async()=>{
    const working=await handle.getDirectoryHandle('working',{create:true});
    await writeFile(working,'data.json',new Blob([JSON.stringify(snapshot.data)],{type:'application/json'}));
   });
   const nextAt=Date.now();
   await writeSetting({...record(),lastSyncedAt:nextAt,lastSyncedRevision:snapshot.revision});
   lastSyncedAt=nextAt;lastSyncedRevision=snapshot.revision;
   dirty=(await getRevision())!==snapshot.revision;
   if(dirty&&!timer)schedule();
   return true;
  }catch(e){dirty=true;error=e.name==='NotAllowedError'?'permission':'write';return false;}
  finally{writing=false;retrying=false;emit();}
 }
 function sync(){
  if(syncInFlight)return syncInFlight;
  syncInFlight=enqueue(syncTask).finally(()=>{syncInFlight=null;});
  return syncInFlight;
 }
 function schedule(){
  cancelTimer();if(!supported||!handle)return;
  timer=setTimeout(()=>{timer=null;void sync();},debounceMs);
 }
 function changed(){dirty=true;emit();schedule();}
 async function authorize(){
  if(!supported||!handle)return false;
  try{
   permission=await handle.queryPermission({mode:'readwrite'});
   // Only called by a connect/retry/export button, never by a timer or startup.
   if(permission!=='granted')permission=await handle.requestPermission({mode:'readwrite'});
   if(permission!=='granted'){error='permission';emit();return false;}
   error='';emit();return true;
  }catch{permission='prompt';error='permission';emit();return false;}
 }
 async function initialize(){
  if(!supported){emit();return;}
  try{
   const saved=await readSetting();
   if(saved?.handle?.kind==='directory'){
    handle=saved.handle;lastSyncedAt=Number(saved.lastSyncedAt)||0;lastSyncedRevision=saved.lastSyncedRevision||null;
    if(/^\d{4}-(?:0[1-9]|1[0-2])$/.test(saved.pendingMonth||''))pendingSubmission={month:saved.pendingMonth,files:null};
    dirty=(await getRevision())!==lastSyncedRevision;
    permission=await handle.queryPermission({mode:'readwrite'});
    if(permission==='granted'&&dirty)schedule();
   }
  }catch{error='permission';}
  emit();
 }
 async function connect(){
  if(!supported)return false;
  // Invoke the picker before awaiting any IndexedDB or file-generation work.
  let selected;
  try{selected=await pickDirectory({mode:'readwrite',id:'sa-expense-backup'});}
  catch(e){if(e.name!=='AbortError'){error='permission';emit();}return false;}
  cancelTimer();
  await enqueue(async()=>{
   await writeSetting({id:'folderBackup',handle:selected,lastSyncedAt:0,lastSyncedRevision:null,pendingMonth:null});
   handle=selected;permission='granted';dirty=true;lastSyncedAt=0;lastSyncedRevision=null;error='';pendingSubmission=null;emit();
  });
  return sync();
 }
 async function saveSubmission(month,files){
  if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||files.some(f=>!['개인경비.xlsx','영수증.zip','data.json'].includes(f.name)))throw new Error('Invalid submission files');
  return enqueue(async()=>{
   if(!handle)throw permissionError();
   if(pendingSubmission&&pendingSubmission.month!==month)throw new Error('미완료된 '+pendingSubmission.month+' 제출 파일을 먼저 재시도해 주세요.');
   writing=true;retrying=false;pendingSubmission={month,files};error='';emit();
   try{
    await writeSetting(record());
    await withRetries(async()=>{
     const folder=await handle.getDirectoryHandle(month,{create:true});
     // The snapshot is written last. Success requires all three streams to close.
     for(const file of files)await writeFile(folder,file.name,file.blob);
    });
    await writeSetting({...record(),pendingMonth:null});pendingSubmission=null;return true;
   }catch(e){error=e.name==='NotAllowedError'?'permission':'write';throw e;}
   finally{writing=false;retrying=false;emit();}
  });
 }
 async function retry(){
  cancelTimer();
  if(!await authorize())return false;
  if(pendingSubmission){const {month,files}=pendingSubmission;try{await saveSubmission(month,files||await makeSubmission(month));}catch{error='write';emit();return false;}}
  return sync();
 }
 async function disconnect(){
  cancelTimer();
  return enqueue(async()=>{
   await writeSetting({id:'folderBackup',handle:null,lastSyncedAt:0,lastSyncedRevision:null,pendingMonth:null});
   handle=null;lastSyncedAt=0;lastSyncedRevision=null;dirty=false;pendingSubmission=null;error='';permission='prompt';emit();
  });
 }
 return {initialize,connect,changed,retry,authorize,saveSubmission,disconnect,
  get connected(){return !!handle;},get supported(){return supported;}};
}
