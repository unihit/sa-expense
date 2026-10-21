const test=require('node:test'),assert=require('node:assert/strict');
const view=import('../dist/folder-backup-view.mjs');
const state={supported:true,connected:true,folderName:'경비 백업',permission:'granted',pending:false,writing:false,error:'',lastSyncedAt:1800000000000};
test('unconnected and unsupported states do not show a failure banner',async()=>{
 const {folderBackupView}=await view;
 assert.equal(folderBackupView({...state,connected:false}).notice,false);
 assert.equal(folderBackupView({...state,supported:false,error:'write'}).notice,false);
});
test('a dirty revision cannot display a completed backup',async()=>{
 const {folderBackupView}=await view,result=folderBackupView({...state,pending:true});
 assert.equal(result.label,'폴더 저장 대기 중');assert.equal(result.tone,'pending');assert.equal(result.notice,false);
});
test('permission UI offers one clear gesture and does not imply a lost local record',async()=>{
 const {folderBackupView}=await view,result=folderBackupView({...state,permission:'prompt'});
 assert.equal(result.retryLabel,'권한 다시 허용');assert.equal(result.label,'폴더 권한 필요');assert.equal(result.notice,true);assert.match(result.noticeText,/브라우저에 보관/);
});
test('failure kinds have concrete recovery instructions and preserve the last-success timestamp',async()=>{
 const {folderBackupView}=await view;
 for(const [error,word] of [['missing','드라이브'],['storage','저장 공간'],['locked','프로그램'],['conflict','다른 전용 폴더'],['write','쓰기 권한']]){
  const result=folderBackupView({...state,error,lastFailure:{attempts:3}});
  assert.equal(result.label,'마지막 저장 실패(재시도)');assert.match(result.noticeText,new RegExp(word));assert.match(result.noticeText,/3회/);assert.match(result.lastSuccess,/마지막 백업 성공/);
 }
});
test('active permission, preparation and retry operations disable recovery buttons',async()=>{
 const {folderBackupView}=await view;
 for(const change of [{authorizing:true},{preparing:true},{writing:true,retrying:true,retryAttempt:2}]){
  const result=folderBackupView({...state,error:'missing',...change});assert.equal(result.busy,true);assert.equal(result.notice,false);assert.equal(result.tone,'pending');
 }
 assert.match(folderBackupView({...state,writing:true,retrying:true,retryAttempt:2}).label,/2\/3/);
});
test('unfinished monthly files stay visibly incomplete even when working backup succeeded',async()=>{
 const {folderBackupView}=await view,result=folderBackupView({...state,submissionPending:true,pendingMonth:'2026-10'});
 assert.equal(result.notice,true);assert.match(result.noticeText,/2026-10/);assert.equal(result.label,'마지막 저장 실패(재시도)');
});
