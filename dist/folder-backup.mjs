// A one-way copy of IndexedDB. Folder contents never become application state.
const BACKUP_PATH='expense/backup.json';
export function folderFailureKind(error){
 if(['NotAllowedError','SecurityError'].includes(error?.name))return 'permission';
 if(error?.name==='NotFoundError')return 'missing';
 if(error?.name==='QuotaExceededError')return 'storage';
 if(error?.name==='NoModificationAllowedError')return 'locked';
 if(error?.name==='TypeMismatchError')return 'conflict';
 return 'write';
}
export function createFolderBackup({readSetting,writeSetting,getSnapshot,getRevision,makeSubmission,onStatus,
 supported=typeof globalThis.showDirectoryPicker==='function',
 pickDirectory=options=>globalThis.showDirectoryPicker(options),
 sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),debounceMs=1500}){
 let handle=null,lastSyncedAt=0,lastSyncedRevision=null,lastSyncedPath=null,dirty=false,permission='prompt';
 let error='',writing=false,retrying=false,timer=null,tail=Promise.resolve(),syncInFlight=null,pendingSubmission=null;
 let lastFailure=null,retryAttempt=0,authorizing=false,preparing=false,authorization=null,retryInFlight=null;
 const emit=()=>onStatus?.({supported,connected:!!handle,folderName:handle?.name||'',permission,
  pending:dirty,writing,retrying,error,lastFailure,retryAttempt,authorizing,preparing,
  submissionPending:!!pendingSubmission,pendingMonth:pendingSubmission?.month||null,lastSyncedAt});
 const enqueue=task=>{const result=tail.then(task);tail=result.catch(()=>{});return result;};
 const cancelTimer=()=>{clearTimeout(timer);timer=null;};
 const record=()=>({id:'folderBackup',handle,lastSyncedAt,lastSyncedRevision,backupPath:lastSyncedPath,pendingMonth:pendingSubmission?.month||null,failure:lastFailure});
 async function failed(cause,scope){
  cancelTimer();
  error=folderFailureKind(cause);lastFailure={kind:error,scope,at:Date.now(),attempts:retryAttempt};
  // Failure metadata must never turn a successful local expense commit into a rejection.
  if(handle)try{await writeSetting(record());}catch{}
 }
 const permissionError=()=>Object.assign(new Error('폴더 쓰기 권한이 필요합니다.'),{name:'NotAllowedError'});
 async function writeFile(folder,name,blob){
  const file=await folder.getFileHandle(name,{create:true});
  const stream=await file.createWritable();
  try{await stream.write(blob);await stream.close();}
  catch(e){await stream.abort().catch(()=>{});throw e;}
 }
 async function withRetries(task){
  retryAttempt=0;
  for(let attempt=0;;attempt++){
   try{
    permission=await handle.queryPermission({mode:'readwrite'});
    if(permission!=='granted')throw permissionError();
    return await task();
   }catch(e){
    if(['permission','storage','conflict'].includes(folderFailureKind(e))||e.name==='AbortError'||attempt===3)throw e;
    retryAttempt=attempt+1;retrying=true;emit();await sleep([1000,2000,4000][attempt]);retrying=false;emit();
   }
  }
 }
 async function syncTask(){
  if(!handle)return false;
  writing=true;retrying=false;retryAttempt=0;error='';emit();
  try{
   // Capture the data and its revision together, after the local commit completes.
   const snapshot=await getSnapshot();
   await withRetries(async()=>{
    const expense=await handle.getDirectoryHandle('expense',{create:true});
    await writeFile(expense,'backup.json',new Blob([JSON.stringify(snapshot.data)],{type:'application/json'}));
   });
   const nextAt=Date.now();
   const remainingFailure=lastFailure?.scope==='submission'?lastFailure:null;
   await writeSetting({...record(),lastSyncedAt:nextAt,lastSyncedRevision:snapshot.revision,backupPath:BACKUP_PATH,failure:remainingFailure});
   lastSyncedAt=nextAt;lastSyncedRevision=snapshot.revision;lastSyncedPath=BACKUP_PATH;
   lastFailure=remainingFailure;error=lastFailure?.kind||'';
   dirty=(await getRevision())!==snapshot.revision;
   if(dirty&&!timer&&!lastFailure)schedule();
   return true;
  }catch(e){dirty=true;await failed(e,'backup');return false;}
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
 function changed(){dirty=true;emit();if(!lastFailure)schedule();}
 function authorize(){
  if(authorization)return authorization;
  authorization=authorizeOnce().finally(()=>{authorization=null;authorizing=false;emit();});return authorization;
 }
 async function authorizeOnce(){
  if(!supported||!handle)return false;
  authorizing=true;retryAttempt=0;emit();
  try{
   permission=await handle.queryPermission({mode:'readwrite'});
   // Only called by a connect/retry/export button, never by a timer or startup.
   if(permission!=='granted')permission=await handle.requestPermission({mode:'readwrite'});
   if(permission!=='granted'){await failed(permissionError(),'backup');emit();return false;}
   error='';emit();return true;
  }catch(e){await failed(e,'backup');emit();return false;}
 }
 async function initialize(){
  if(!supported){emit();return;}
  try{
   const saved=await readSetting();
   if(saved?.handle?.kind==='directory'){
    handle=saved.handle;lastSyncedAt=Number(saved.lastSyncedAt)||0;lastSyncedRevision=saved.lastSyncedRevision||null;lastSyncedPath=saved.backupPath||null;
    if(['permission','missing','storage','locked','conflict','write'].includes(saved.failure?.kind)){
     lastFailure={kind:saved.failure.kind,scope:saved.failure.scope==='submission'?'submission':'backup',at:Number(saved.failure.at)||0,attempts:Math.min(3,Math.max(0,Number(saved.failure.attempts)||0))};error=lastFailure.kind;
    }
    if(/^\d{4}-(?:0[1-9]|1[0-2])$/.test(saved.pendingMonth||''))pendingSubmission={month:saved.pendingMonth,files:null};
    dirty=(await getRevision())!==lastSyncedRevision||saved.backupPath!==BACKUP_PATH;
    permission=await handle.queryPermission({mode:'readwrite'});
    if(permission==='granted'&&dirty&&!lastFailure)schedule();
   }
  }catch(e){error=folderFailureKind(e);}
  emit();
 }
 async function connect(){
  if(!supported)return false;
  // Invoke the picker before awaiting any IndexedDB or file-generation work.
  let selected;
  try{selected=await pickDirectory({mode:'readwrite',id:'sa-expense-backup'});}
  catch(e){if(e.name!=='AbortError'){error=folderFailureKind(e);emit();}return false;}
  cancelTimer();
  await enqueue(async()=>{
   await writeSetting({id:'folderBackup',handle:selected,lastSyncedAt:0,lastSyncedRevision:null,pendingMonth:null});
   handle=selected;permission='granted';dirty=true;lastSyncedAt=0;lastSyncedRevision=null;lastSyncedPath=null;error='';lastFailure=null;pendingSubmission=null;emit();
  });
  return sync();
 }
 async function saveSubmission(month,files){
  if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||files.some(f=>![month+'_개인경비.xlsx','영수증.zip','data.json'].includes(f.name)))throw new Error('Invalid submission files');
  return enqueue(async()=>{
   if(!handle)throw permissionError();
   if(pendingSubmission&&pendingSubmission.month!==month)throw new Error('미완료된 '+pendingSubmission.month+' 제출 파일을 먼저 재시도해 주세요.');
   writing=true;retrying=false;retryAttempt=0;pendingSubmission={month,files};error='';emit();
   try{
    await writeSetting(record());
    await withRetries(async()=>{
     const folder=await handle.getDirectoryHandle(month,{create:true});
     // The snapshot is written last. Success requires all three streams to close.
     for(const file of files)await writeFile(folder,file.name,file.blob);
    });
    const remainingFailure=lastFailure?.scope==='backup'?lastFailure:null;
    await writeSetting({...record(),pendingMonth:null,failure:remainingFailure});pendingSubmission=null;lastFailure=remainingFailure;error=lastFailure?.kind||'';return true;
   }catch(e){await failed(e,'submission');throw e;}
   finally{writing=false;retrying=false;emit();}
  });
 }
 function retry(){
  if(retryInFlight)return retryInFlight;
  retryInFlight=retryOnce().finally(()=>{retryInFlight=null;});return retryInFlight;
 }
 async function retryOnce(){
  cancelTimer();
  if(!await authorize())return false;
  if(pendingSubmission){
   const {month,files}=pendingSubmission;
   try{let prepared=files;if(!prepared){preparing=true;emit();try{prepared=await makeSubmission(month);}finally{preparing=false;emit();}}await saveSubmission(month,prepared);}
   catch(e){await failed(e,'submission');emit();return false;}
  }
  return sync();
 }
 async function disconnect(){
  cancelTimer();
  return enqueue(async()=>{
   await writeSetting({id:'folderBackup',handle:null,lastSyncedAt:0,lastSyncedRevision:null,pendingMonth:null});
   handle=null;lastSyncedAt=0;lastSyncedRevision=null;lastSyncedPath=null;dirty=false;pendingSubmission=null;error='';lastFailure=null;permission='prompt';emit();
  });
 }
 async function refreshPermission(){
  if(!supported||!handle||authorizing||writing)return;
  try{permission=await handle.queryPermission({mode:'readwrite'});}catch(e){error=folderFailureKind(e);}
  emit();
 }
 return {initialize,connect,changed,retry,authorize,saveSubmission,disconnect,refreshPermission,
  get connected(){return !!handle;},get supported(){return supported;}};
}
