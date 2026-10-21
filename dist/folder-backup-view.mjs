export function folderBackupView(state){
 const busy=!!(state.writing||state.authorizing||state.preparing);
 const needsPermission=state.connected&&(state.permission!=='granted'||state.error==='permission');
 let label='백업 폴더 연결 필요',tone='idle',detail='자동 백업할 전용 폴더를 선택해 주세요.';
 let reason={permission:'폴더 쓰기를 허용해야 백업을 이어갈 수 있습니다. 권한 다시 허용을 눌러 주세요.',
  missing:'폴더나 드라이브에 접근하지 못했습니다. 연결 상태를 확인하거나 폴더를 다시 선택해 주세요.',
  storage:'저장 공간이 부족합니다. 연결 폴더가 있는 드라이브와 브라우저의 저장 공간을 확인해 주세요.',
  locked:'파일이 사용 중이거나 쓰기가 제한돼 있습니다. 파일을 사용 중인 프로그램을 닫고 폴더 권한을 확인해 주세요.',
  conflict:'백업 경로에 같은 이름의 파일·폴더가 있어 저장할 수 없습니다. 다른 전용 폴더를 선택해 주세요.',
  write:'폴더에 쓰지 못했습니다. 폴더의 연결 상태·쓰기 권한을 확인한 뒤 재시도해 주세요.'}[needsPermission?'permission':state.error]||'';
 if(state.connected){
  if(state.authorizing){label='폴더 권한 확인 중';tone='pending';}
  else if(state.preparing){label='제출 파일 다시 만드는 중';tone='pending';}
  else if(state.writing){label=state.retrying?'폴더 저장 재시도 중 · '+state.retryAttempt+'/3':'폴더 저장 중';tone='pending';}
  else if(needsPermission){label='폴더 권한 필요';tone='error';}
  else if(state.error||state.submissionPending){label='마지막 저장 실패(재시도)';tone='error';}
  else if(state.pending){label='폴더 저장 대기 중';tone='pending';}
  else if(state.lastSyncedAt){label='폴더 백업 완료 · '+new Date(state.lastSyncedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});tone='ready';}
  detail=state.folderName+' · '+(reason||'내역은 브라우저에 먼저 저장하고 이 폴더로 자동 백업합니다.');
 }else if(state.error){label='폴더 연결 실패';tone='error';detail=reason;}
 const pendingMonth=state.submissionPending?state.pendingMonth+' 제출 파일 저장이 남아 있습니다. ':'';
 const exhausted=state.lastFailure?.attempts===3?'자동 재시도 3회를 마쳤습니다. ':'';
 const notice=!!state.supported&&!!state.connected&&!busy&&!!(needsPermission||state.error||state.submissionPending);
 const noticeText='저장한 내역은 이 브라우저에 보관돼 있습니다. '+pendingMonth+exhausted+(reason||'재시도하면 미완료된 파일을 다시 저장합니다.');
 const lastSuccess=state.lastSyncedAt?'마지막 백업 성공: '+new Date(state.lastSyncedAt).toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'아직 이 폴더에 백업을 완료하지 못했습니다.';
 return {label,tone,detail,busy,notice,noticeText,lastSuccess,
  noticeTitle:needsPermission?'백업 폴더 권한을 허용해 주세요':'폴더 백업을 완료하지 못했습니다',
  retryLabel:needsPermission?'권한 다시 허용':'지금 재시도'};
}
