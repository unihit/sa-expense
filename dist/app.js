const $ = id => document.getElementById(id);
const icons = {
 grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
 upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
 download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 wallet:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8V5l13-2v2m5 6h-6v5h6"/>',
 list:'<path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01"/>',
 check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
 edit:'<path d="m16 3 5 5-12 12-6 1 1-6L16 3Z"/><path d="m14 5 5 5"/>',
 search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
 archive:'<path d="M4 8h16v13H4zM3 3h18v5H3zm6 9h6"/>',
 settings:'<path d="M12.00 3.80 L14.01 1.90 L15.94 2.48 L16.56 5.18 L17.80 6.20 L20.56 6.28 L21.52 8.06 L20.04 10.40 L20.20 12.00 L22.10 14.01 L21.52 15.94 L18.82 16.56 L17.80 17.80 L17.72 20.56 L15.94 21.52 L13.60 20.04 L12.00 20.20 L9.99 22.10 L8.06 21.52 L7.44 18.82 L6.20 17.80 L3.44 17.72 L2.48 15.94 L3.96 13.60 L3.80 12.00 L1.90 9.99 L2.48 8.06 L5.18 7.44 L6.20 6.20 L6.28 3.44 L8.06 2.48 L10.40 3.96 Z"/><circle cx="12" cy="12" r="3.1"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
 chevronLeft:'<path d="m15 5-7 7 7 7"/>',
 chevronRight:'<path d="m9 5 7 7-7 7"/>',
 chevronDown:'<path d="m6 9 6 6 6-6"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 scan:'<path d="M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5M7 8h10M7 12h10M7 16h6"/>',
 sheet:'<path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h8M12 12v7"/>'
};
function hydrateIcons(root=document) { root.querySelectorAll('[data-icon]').forEach(el => {el.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[el.dataset.icon]||icons.list}</svg>`;}); }
hydrateIcons();
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
let db, all=[], settings={name:'',title:''}, view='ledger', filter='all', queue=[], editing=null, pendingImage='', pendingDigest='', worker=null, ocrBusy=false;
let backupReminder={id:'backupReminder',revision:'initial',startedAt:Date.now(),lastBackupAt:0,lastBackupBytes:null,backupRevision:null,snoozedUntil:0},backupBytes=0;
let toastTimer,monthPickerYear=new Date().getFullYear();
function toast(message) { $('toast').textContent=message; $('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),6000); }
function showError(error) {console.error(error);toast(error.message||String(error));}
function busy(show,label='처리하고 있습니다') {$('busyLabel').textContent=label;$('busyOverlay').hidden=!show;}
const won=n=>Number(n).toLocaleString('ko-KR');
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===value;}
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function rows(){return all.filter(x=>x.day.slice(0,7)===$('monthInput').value).sort((a,b)=>a.day.localeCompare(b.day)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));}
function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function openDB(){db=await new Promise((resolve,reject)=>{const req=indexedDB.open('sa-expense-web',1);req.onupgradeneeded=()=>{req.result.createObjectStore('expenses',{keyPath:'id'});req.result.createObjectStore('settings',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function readStore(name){return request(db.transaction(name).objectStore(name).getAll());}
async function writeStore(name,items,removeId=null){
 const changed=name==='expenses'||(name==='settings'&&items.some(x=>x.id==='profile'));
 const next=changed?{...backupReminder,revision:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}:null;
 return new Promise((resolve,reject)=>{const tx=db.transaction(changed?['expenses','settings']:name,'readwrite');const store=tx.objectStore(name);if(removeId)store.delete(removeId);for(const item of items)store.put(item);if(next)tx.objectStore('settings').put(next);tx.oncomplete=()=>{if(next)backupReminder=next;resolve();};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('저장 공간이 부족하거나 저장을 완료하지 못했습니다. 백업 후 확인해 주세요.'));});
}
async function reload(){all=(await readStore('expenses')).map(normalizeTransitMethod);backupBytes=new Blob([JSON.stringify({settings,expenses:all})]).size;render();}
function backupReminderStatus(count,bytes,state,now=Date.now()){
 if(!count||state.backupRevision===state.revision||now<state.snoozedUntil)return null;
 const baseline=state.lastBackupAt||state.startedAt;
 const days=Math.max(0,Math.floor((now-baseline)/86400000));
 const baseBytes=state.lastBackupAt?(Number.isFinite(state.lastBackupBytes)&&state.lastBackupBytes>=0?state.lastBackupBytes:bytes):0;
 const addedBytes=Math.max(0,bytes-baseBytes);
 const overdue=days>=30,large=addedBytes>=100*1024*1024;
 return overdue||large?{days,overdue,large,megabytes:Math.ceil(addedBytes/1024/1024)}:null;
}
function renderBackupReminder(){
 const host=$('backupReminder');if(!host)return;
 const status=backupReminderStatus(all.length,backupBytes,backupReminder);host.hidden=!status;if(!status)return;
 const reasons=[];
 if(status.overdue)reasons.push(backupReminder.lastBackupAt?'마지막 백업 후 '+status.days+'일이 지났습니다.':'백업 없이 자료를 보관한 지 '+status.days+'일이 지났습니다.');
 if(status.large)reasons.push(backupReminder.lastBackupAt?'마지막 백업 이후 저장 데이터가 약 '+status.megabytes+'MB 늘었습니다.':'백업하지 않은 저장 데이터가 약 '+status.megabytes+'MB입니다.');
 $('backupReminderText').textContent=reasons.join(' ')+' 아직 백업하지 않은 변경 내용이 있습니다. 모든 월의 내역과 영수증을 파일로 보관해 주세요.';
}
async function snoozeBackupReminder(){
 const next={...backupReminder,snoozedUntil:Date.now()+86400000};
 try{await writeStore('settings',[next]);backupReminder=next;renderBackupReminder();}catch(e){showError(e);}
}

async function migrateBackupSize(){
 if(backupReminder.lastBackupAt&&!Number.isFinite(backupReminder.lastBackupBytes)){
  const next={...backupReminder,lastBackupBytes:backupBytes};
  await writeStore('settings',[next]);backupReminder=next;renderBackupReminder();
 }
}

function render(){
 renderBackupReminder();
 const list=rows(), total=list.reduce((s,x)=>s+x.amount,0),missing=list.filter(x=>!x.image).length;
 $('totalAmount').textContent=won(total);$('totalCount').textContent=list.length;$('missingCount').textContent=missing;$('listCount').textContent=list.length;$('navCount').textContent=list.length;
 const [year,month]=$('monthInput').value.split('-');$('monthLabel').textContent=`${year}년 ${Number(month)}월`;$('pageTitle').textContent=`${Number(month)}월 개인경비`;$('periodCaption').textContent=`${year}.${month}.01 — ${year}.${month}.${new Date(Number(year),Number(month),0).getDate()}`;
 $('missingFoot').textContent=list.length?(missing?'영수증을 연결해 정산을 준비하세요':'모든 내역에 영수증이 있습니다'):'등록된 경비가 없습니다';
 $('profileName').textContent=settings.name||'나의 경비 공간';
 $('listTitle').firstChild.textContent=view==='receipts'?'영수증 모아보기 ':'경비 내역 ';
 $('listSubtitle').textContent=view==='receipts'?'번호와 날짜별로 연결된 증빙을 확인하세요.':'저장한 내역과 영수증을 한눈에 확인하세요.';
 $('dropZone').classList.toggle('compact-drop',list.length>0);
 const query=$('searchInput').value.trim().toLowerCase();
 const shown=list.map((r,i)=>({...r,no:i+1})).filter(r=>(filter==='all'||(filter==='대중교통'?/버스|지하철/.test(r.method):filter==='기타'?!/택시|버스|지하철/.test(r.method):r.method===filter))&&`${r.purpose} ${r.origin} ${r.destination}`.toLowerCase().includes(query));
 $('tableArea').hidden=!list.length||view!=='ledger';$('receiptGrid').hidden=!list.length||view!=='receipts';
 $('expenseRows').innerHTML=shown.length?shown.map(r=>`<tr><td>${String(r.no).padStart(2,'0')}</td><td>${esc(r.day.slice(5).replace('-','.'))}</td><td class="purpose-cell"><strong>${esc(r.purpose)}</strong><small>${esc(r.origin||'')}${r.origin||r.destination?' → ':''}${esc(r.destination||'')}</small></td><td><span class="method-pill">${esc(r.method)}</span></td><td class="money right">${won(r.amount)}<small> 원</small></td><td class="center"><span class="proof-dot ${r.image?'':'missing'}">${r.image?'● 있음':'○ 없음'}</span></td><td><button class="edit-row" data-edit="${esc(r.id)}" aria-label="${r.no}번 내역 수정"><i data-icon="edit"></i><span>수정</span></button></td></tr>`).join(''):'<tr><td colspan="7" class="empty-message">조건에 맞는 내역이 없습니다.</td></tr>';
 $('receiptGrid').innerHTML=shown.length?shown.map(r=>`<article class="receipt-card" tabindex="0" role="button" aria-label="${r.no}번 영수증 수정" data-edit="${esc(r.id)}"><div class="receipt-thumb">${r.image?`<img src="${esc(r.image)}" alt="${r.no}번 ${esc(r.day)} 영수증">`:'<span>증빙 없음</span>'}</div><div class="receipt-info"><strong>${r.no}. ${esc(r.day)} · ${won(r.amount)}원</strong><div class="receipt-info-footer"><span class="receipt-purpose">${esc(r.purpose)}</span><span class="receipt-edit"><i data-icon="edit"></i>수정</span></div></div></article>`).join(''):'<p class="empty-message">조건에 맞는 영수증이 없습니다.</p>';
 hydrateIcons($('expenseRows'));hydrateIcons($('receiptGrid'));
 $('resultCaption').textContent=list.length?`${shown.length}건 표시 · ${list.length}건 전체 합계 ${won(total)}원`:'영수증을 추가하거나 직접 입력해 시작하세요.';
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
}
function renderMonthPicker(){
 const [selectedYear,selectedMonth]=$('monthInput').value.split('-').map(Number);
 $('monthYear').textContent=monthPickerYear+'년';
 $('prevYear').disabled=monthPickerYear<=1900;$('nextYear').disabled=monthPickerYear>=2100;
 $('monthGrid').innerHTML=Array.from({length:12},(_,i)=>{const month=i+1,selected=monthPickerYear===selectedYear&&month===selectedMonth;return `<button type="button" data-month="${month}" aria-pressed="${selected}" class="month-option${selected?' selected':''}">${month}월</button>`;}).join('');
}
function showMonthPicker(){monthPickerYear=Number($('monthInput').value.slice(0,4));renderMonthPicker();$('monthDialog').showModal();}
function shiftPickerYear(delta){monthPickerYear=Math.max(1900,Math.min(2100,monthPickerYear+delta));renderMonthPicker();}
function chooseMonth(month){
 if(!Number.isInteger(month)||month<1||month>12)return;
 $('monthInput').value=monthPickerYear+'-'+String(month).padStart(2,'0');
 render();$('monthDialog').close();
}
function setMonth(delta){const [y,m]=$('monthInput').value.split('-').map(Number);const d=new Date(y,m-1+delta,1);$('monthInput').value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;render();}
function selectedImage(){if(pendingImage){$('proofPreview').innerHTML=`<img src="${pendingImage}" alt="등록할 영수증">`;$('ocrBtn').disabled=false;}else{$('proofPreview').innerHTML='<i data-icon="image"></i><p>영수증 없이도 입력할 수 있어요.</p>';hydrateIcons($('proofPreview'));$('ocrBtn').disabled=true;}}
function openEditor(row=null,image='',digest='',autoRead=false){
 editing=row;pendingImage=image||row?.image||'';pendingDigest=digest||row?.digest||'';
 $('expenseForm').reset();$('editorTitle').textContent=row?'경비 내역 수정':'경비 등록';$('expenseDate').value=row?.day||(image?'':today());$('expenseAmount').value=row?.amount?won(row.amount):'';
 for(const [field,key] of [['expenseMethod','method'],['expensePurpose','purpose'],['expenseOrigin','origin'],['expenseDestination','destination'],['ocrText','rawText']])$(field).value=row?.[key]||'';
 $('deleteExpense').hidden=!row;$('ocrState').textContent='영수증을 추가하면 자동으로 글자를 읽습니다. 이미지는 이 브라우저에서 처리합니다.';$('queueStatus').textContent=queue.length?`대기 중인 영수증 ${queue.length}개`:'';
 selectedImage();if(!$('editor').open)$('editor').showModal();
 if(autoRead&&pendingImage)void recognize();
}
function closeEditor(){if(ocrBusy){toast('글자 읽기가 끝난 뒤 닫아 주세요.');return;}if(queue.length&&!confirm(`남은 영수증 ${queue.length}개의 등록을 취소할까요?`))return;queue=[];$('editor').close();editing=null;}
async function digest(data){if(globalThis.crypto?.subtle){const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');}let hash=2166136261;for(const byte of new Uint8Array(data)){hash^=byte;hash=Math.imul(hash,16777619);}return 'local-fnv-'+(hash>>>0).toString(16)+'-'+data.byteLength;}
function readDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
async function filesToQueue(files,replace=false){
 if(!files.length)return;
 busy(true,'영수증을 준비하고 있습니다');
 try{
  const prepared=[];
  for(const file of files){
   if(file.size>20*1024*1024)throw new Error(`${file.name}: 파일당 20MB 이하로 추가해 주세요.`);
   if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){
    const pdfjs=await import('./vendor/pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',location.href).href;
    const pdf=await pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;
    if(pdf.numPages>40){await pdf.destroy();throw new Error('PDF는 한 번에 40페이지 이하로 추가해 주세요.');}
    for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),v=page.getViewport({scale:1.7}),c=document.createElement('canvas');c.width=Math.ceil(v.width);c.height=Math.ceil(v.height);await page.render({canvasContext:c.getContext('2d'),viewport:v}).promise;const data=c.toDataURL('image/png');prepared.push({image:data,digest:await digest(new TextEncoder().encode(data))});}
    await pdf.destroy();
   }else{
    const data=await readDataURL(file);await imageElement(data);prepared.push({image:data,digest:await digest(await file.arrayBuffer())});
   }
  }
  if(replace){if(prepared.length!==1)throw new Error('증빙 교체는 이미지 한 장만 선택하세요.');pendingImage=prepared[0].image;pendingDigest=prepared[0].digest;for(const id of ['expenseDate','expenseAmount','expenseMethod','ocrText'])$(id).value='';selectedImage();void recognize();return;}
  queue.push(...prepared);nextQueued();
 }catch(e){showError(e);}finally{busy(false);$('fileInput').value='';}
}
function nextQueued(){const next=queue.shift();if(next)openEditor(null,next.image,next.digest,true);}
function imageElement(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('이미지를 열 수 없습니다. PNG 또는 JPG로 다시 저장해 주세요.'));im.src=src;});}
function validateRecord(r){
 if(!validDate(r.day))throw new Error('실제 사용일을 올바르게 입력해 주세요.');
 if(!Number.isSafeInteger(r.amount)||r.amount<=0||r.amount>1e9)throw new Error('금액은 1원 이상 정수로 입력해 주세요.');
 if(!r.purpose.trim())throw new Error('업무 목적을 입력해 주세요.');if(!r.method.trim())throw new Error('이용수단을 선택해 주세요.');
 if(r.image&&!/^data:image\/(png|jpeg|webp|bmp);base64,/.test(r.image))throw new Error('지원하지 않는 영수증 이미지입니다.');
}
async function saveExpense(e){
 e.preventDefault();if(ocrBusy)return;
 try{
  const amount=$('expenseAmount').value.replaceAll(',','').trim();if(!/^\d+$/.test(amount))throw new Error('금액은 숫자로 입력해 주세요.');
  const record={id:editing?.id||(globalThis.crypto?.randomUUID?.()||'expense-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),day:$('expenseDate').value,amount:Number(amount),purpose:$('expensePurpose').value.trim(),origin:$('expenseOrigin').value.trim(),destination:$('expenseDestination').value.trim(),method:$('expenseMethod').value,rawText:$('ocrText').value,image:pendingImage,digest:pendingDigest,createdAt:editing?.createdAt||new Date().toISOString()};
  validateRecord(record);
  if(record.digest&&all.some(x=>x.id!==record.id&&x.digest===record.digest)&&!confirm('같은 영수증 파일이 이미 저장되어 있습니다. 별도 거래를 같은 증빙으로 등록하는 경우에만 저장하세요. 계속할까요?'))return;
  await writeStore('expenses',[record]);$('monthInput').value=record.day.slice(0,7);await reload();$('editor').close();toast('경비 내역을 저장했습니다.');editing=null;if(queue.length)nextQueued();
 }catch(e){showError(e);}
}
function receiptAmounts(line,plain=false,zero=false){
 // Normalize full-width digits and separators; correct O/I only inside a labelled numeric token.
 line=line.normalize('NFKC').replace(/[，]/g,',').replace(/[₩￦]/g,'₩');
 const values=[];
 const re=/(?<![\dA-Za-z])(?:₩\s*)?([\dOIol](?:[\dOIol, ]*[\dOIol])?)\s*(원|KRW)?(?![\dA-Za-z])/gi;
 for(const m of line.matchAll(re)){
  const token=m[1].trim(),before=line.slice(0,m.index),after=line.slice(m.index+m[0].length);
  if(/[-/:.]\s*$/.test(before)||/^\s*[-/:.%?!]/.test(after)||/\d\s*$/.test(before))continue;
  const currency=!!m[2]||m[0].includes('₩');
  if(!currency&&!plain)continue;
  if(!/\d/.test(token)||(!plain&&/[OIol]/i.test(token)))continue;
  if(/\s/.test(token)&&!/^\d{1,3}(?:\s*,\s*[\dOIol]{3})+$/i.test(token))continue;
  const fixed=token.replace(/[Oo]/g,'0').replace(/[Il]/g,'1').replaceAll(' ','');
  if(fixed.includes(',')&&!/^\d{1,3}(,\d{3})+$/.test(fixed))continue;
  const value=Number(fixed.replaceAll(',',''));if(Number.isSafeInteger(value)&&(zero?value>=0:value>0)&&value<=1e9)values.push(value);
 }
 return [...new Set(values)];
}
function timedTransitAmount(lines){
 if(!/버스\s*[-·]?\s*지하[철절설]|교통\s*거래|지하철/.test(lines.join('\n'))||/취소|환불/.test(lines.join('\n')))return null;
 const records=[];for(let i=0;i<lines.length;i++){
  const m=lines[i].match(/^(\d{1,2})[/.](\d{1,2})\s+(\d{1,2}):(\d{2})\s*$/);
  if(m&&+m[1]>=1&&+m[1]<=12&&+m[2]>=1&&+m[2]<=31&&+m[3]<24&&+m[4]<60)records.push({index:i,date:`${+m[1]}/${+m[2]}`,minutes:+m[3]*60+(+m[4])});
 }
 if(records.length!==2||records[0].date!==records[1].date)return null;
 const gap=Math.abs(records[0].minutes-records[1].minutes);if(gap===0||gap>180)return null;
 for(let i=0;i<records.length;i++){
  const block=lines.slice(records[i].index+1,records[i+1]?.index??lines.length);
  // Missing 승차/하차 and 원 are tolerated only when a standalone amount and a station-like text remain in each timed record.
  if(!block.some(line=>/[가-힣]{2}/.test(line)))return null;
  const amounts=block.filter(line=>/^(?:₩\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)\s*(?:원|KRW)?$/i.test(line)).flatMap(line=>receiptAmounts(line,true,true));
  // A damaged 원 glyph may become % or ?. Do not guess extra digits such as 1002!.
  // Recover only in two dated transit records with a confirmed currency in the other record.
  const uncertain=block.filter(line=>/^\d{1,5}\s*[%?]$/.test(line));
  if(uncertain.length&&block.some(line=>/할인|적립|포인트|비율|퍼센트|수익률|증감률/.test(line)))return null;
  records[i].currencyConfirmed=block.some(line=>/^(?:₩\s*\d[\d,]*|\d[\d,]*\s*(?:원|KRW))$/i.test(line));
  if(amounts.length===1&&uncertain.length===0){records[i].amount=amounts[0];records[i].uncertain=false;}
  else if(amounts.length===0&&uncertain.length===1){
   records[i].amount=Number(uncertain[0].replace(/\D/g,''));records[i].uncertain=true;records[i].misreadUnit=uncertain[0].at(-1);
  }else return null;
  if(records[i].amount>100000)return null;
 }
 records.sort((a,b)=>a.minutes-b.minutes);const fares=records.map(r=>r.amount),amount=fares[0]+fares[1];
 if(!amount||records.every(r=>r.uncertain))return null;
 if(records.some(r=>r.uncertain)&&!records.some(r=>!r.uncertain&&r.currencyConfirmed))return null;
 const warning=records.some(r=>r.uncertain)?` OCR에서 ${records.find(r=>r.uncertain).misreadUnit}로 읽힌 금액을 원으로 추정했습니다. 반드시 원본을 확인하세요.`:'';
 return {amount,fares,note:`교통 이용내역 두 건 ${won(fares[0])}원 + ${won(fares[1])}원 = ${won(amount)}원을 합산했습니다. 같은 이동의 승차·하차인지 확인하세요.`+warning};
}
function extractReceiptAmount(text){
 const lines=text.normalize('NFKC').split(/\r?\n/).map(x=>x.trim()).filter(Boolean),candidates=[];
 const excluded=/부가\s*세|과세|면세|공급\s*가|잔액|잔여|누적|포인트|적립|할인|거스름|받은\s*돈|승인\s*번호|카드\s*번호|사업자|전화|취소|환불/;
 const score=line=>{const k=line.replace(/\s/g,'');return /승인금액|결제금액|총결제|실결제|최종결제|지불금액|청구금액/.test(k)?100:/합계금액|총금액|총액|합계|총합계|TOTAL|AMOUNT/i.test(k)?85:/이용금액|거래금액|운임|요금|카드결제/.test(k)?75:0;};
 for(let i=0;i<lines.length;i++){
  let line=lines[i];const rank=score(line);if(!rank)continue;const stop=line.search(excluded);if(stop>=0){if(score(line.slice(0,stop))!==rank)continue;line=line.slice(0,stop);}
  const labelEnd=line.search(/[:：]/),suffix=labelEnd>=0?line.slice(labelEnd+1):line;
  let found=receiptAmounts(suffix,true);
  // A label and its value may be separated by a line break or a currency-only line.
  if(!found.length){for(let j=i+1;j<=Math.min(i+2,lines.length-1);j++){
   if(excluded.test(lines[j])||score(lines[j]))break;
   const valueLine=lines[j].replace(/^(?:KRW|₩)\s*/i,'');
   if(/^[\dOIol,\s]+(?:원|KRW)?$/i.test(valueLine))found=receiptAmounts(lines[j],true);
   else if(!/^(?:원|KRW|₩)$/i.test(lines[j]))break;
   if(found.length)break;
  }}
  for(const value of found)candidates.push({value,rank});
 }
 if(candidates.length){const best=Math.max(...candidates.map(x=>x.rank)),values=[...new Set(candidates.filter(x=>x.rank===best).map(x=>x.value))];return values.length===1?{amount:values[0],note:'결제·합계 항목에서 금액을 찾았습니다. 원본과 확인하세요.'}:{amount:'',note:`결제금액 후보가 여러 개입니다 (${values.map(won).join(' / ')}원). 원본을 확인해 입력하세요.`};}
 const boarding=lines.map((x,i)=>/승\s*차/.test(x)?i:-1).filter(i=>i>=0),alighting=lines.map((x,i)=>/하\s*차/.test(x)?i:-1).filter(i=>i>=0);
 if(boarding.length===1&&alighting.length===1&&new Set(text.match(/\d{1,2}\/\d{1,2}/g)||[]).size<=1){
  const parts=[boarding[0],alighting[0]].map(index=>{
   const next=[...boarding,...alighting].filter(i=>i>index).sort((a,b)=>a-b)[0]??lines.length;
   const values=[];for(let j=index;j<Math.min(next,index+6);j++){
    if(excluded.test(lines[j]))continue;
    const numericLine=/^(?:₩\s*)?[\dOIol,\s]+(?:원|KRW)?$/i.test(lines[j]);
    // Accept a bare amount only on its label line or on a numeric-only line within that record.
    values.push(...receiptAmounts(lines[j],j===index||numericLine,true));
   }
   const distinct=[...new Set(values)];return distinct.length===1?distinct[0]:null;
  });
  if(parts.every(x=>x!==null))return {amount:parts[0]+parts[1],fares:parts,note:`승차 ${won(parts[0])}원 + 하차 ${won(parts[1])}원 = ${won(parts[0]+parts[1])}원. 한 번의 이동인지 확인하세요.`};
 }
 const timed=timedTransitAmount(lines);if(timed)return timed;
 if(/승차|하차|교통거래|버스.?지하[철절설]|취소|환불/.test(text))return {amount:'',note:'이동·취소 내역을 확인해 금액을 직접 입력하세요.'};
 const values=[...new Set(lines.filter(x=>!excluded.test(x)).flatMap(x=>receiptAmounts(x)))];
 return values.length===1?{amount:values[0],note:'원화 금액을 찾았습니다. 실제 결제금액인지 확인하세요.'}:{amount:'',note:values.length?'금액이 여러 개여서 결제금액을 확정하지 못했습니다. 직접 입력하세요.':'확실한 금액을 찾지 못했습니다. 직접 입력해 주세요.'};
}
function inferTransport(text){
 text=String(text||'').normalize('NFKC');
 // A taxi receipt may mention a station as its destination.
 if(/택시|taxi/i.test(text))return '택시';
 // Card history screens use this as a category heading, not an individual mode.
 const details=text.replace(/버스\s*[-/·]?\s*지하[철절설]/g,'');
 const busStop=/정류\s*[장소]|버스\s*환승\s*센터|버스\s*터미널|공영\s*차고지|중앙\s*차로/.test(details);
 const busRoute=/(?:간선|지선|광역|마을|공항)\s*(?:버스\s*)?[가-힣]*\d{1,4}|(?:버스\s*(?:번호|노선)|노선\s*번호)\s*[:：]?\s*[가-힣]*\d{1,4}/.test(details);
 if(busStop||busRoute)return '버스';
 const stationTokens=details.match(/[가-힣A-Za-z0-9·.]+역(?=$|[\s()[\]{}>,:：·/])/g)||[];
 if(stationTokens.some(name=>!/(?:내역|지역|영역|권역|구역|용역|면역)$/.test(name)))return '지하철';
 // Common station names also appear without the 역 suffix in transit histories.
 const stationNames='신도림|구로디지털단지|가산디지털단지|홍대입구|고속터미널|서울대입구|동대문역사문화공원|디지털미디어시티|사당|교대|역삼|선릉|합정|잠실|강남|신림|신촌|당산|왕십리|청량리|충무로|충정로|을지로입구|종로3가|종로5가|여의도|영등포구청|금천구청|신대방|대림|온수|오류동|개봉|독산|신길';
 if(new RegExp('(?:^|[\\s()[\\]{}>,:：·/])(?:'+stationNames+')(?:$|[\\s()[\\]{}>,:：·/])','m').test(details))return '지하철';
 if(/승\s*차|하\s*차|교통|이용내역/.test(text)&&/[가-힣0-9.·]+(?:아파트|초등학교|중학교|고등학교|주민센터|사거리|삼거리|주유소|고개)(?=$|[\s()[\]{}>,:：·/])/.test(details))return '버스';
 if(/지하[철절설]|도시철도|전철|[1-9]\s*호선|수인분당선|경의중앙선|신분당선|공항철도/.test(details))return '지하철';
 if(/버스/.test(details))return '버스';
 return '';
}
function normalizeTransitMethod(row){
 if(row.method!=='버스/지하철')return row;
 const method=inferTransport([row.rawText,row.origin,row.destination].filter(Boolean).join('\n'))||'기타';
 return {...row,method};
}
function parseOCR(text){
 if(text.includes('[보조 인식]')){
  const [first,...tail]=text.split('[보조 인식]'),rest=tail.join('[보조 인식]'),second=rest.split(/\[금액 칸/)[0];
  const result=combineOCR(first,second),verified=rest.split('[금액 칸 보조 인식]')[1];
  if(verified&&result.amount===''){const fare=parseOCR(verified);if(fare.amount!=='')return {...result,amount:fare.amount,fares:fare.fares,notes:fare.notes};}
  return result;
 }
 text=text.normalize('NFKC');const notes=[];let day='',method='';const full=text.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/),short=text.match(/(?<!\d)(\d{1,2})[\/월](\d{1,2})(?!\d)/);
 if(full)day=`${full[1]}-${full[2].padStart(2,'0')}-${full[3].padStart(2,'0')}`;else if(short){day=`${$('monthInput').value.slice(0,4)}-${short[1].padStart(2,'0')}-${short[2].padStart(2,'0')}`;notes.push('연도는 선택한 월을 기준으로 입력했습니다.');}if(!validDate(day))day='';
 const result=extractReceiptAmount(text);
 method=inferTransport(text);
 if(!method)notes.push('이용수단을 확인해 선택해 주세요.');
 if(!day)notes.push('사용일을 직접 입력해 주세요.');notes.push(result.note);return {day,amount:result.amount,fares:result.fares,method,notes};
}
function combineOCR(first,second){
 const a=parseOCR(first),b=parseOCR(second);let result={...a,notes:[...a.notes]};
 if(!result.day)result.day=b.day;result.method=inferTransport(first+'\n'+second)||result.method||b.method;
 if(a.amount===''&&b.amount!==''){result.amount=b.amount;result.fares=b.fares;result.notes=b.notes.concat('보조 인식에서 금액을 찾았습니다. 원본을 확인하세요.');}
 else if(a.amount!==''&&b.amount!==''&&a.amount!==b.amount){result.amount='';result.notes=[`두 번의 인식 금액이 다릅니다 (${won(a.amount)} / ${won(b.amount)}원). 원본을 확인해 직접 입력하세요.`];}
 return result;
}
function applyOCR(text,result=parseOCR(text)){
$('expenseDate').value=result.day;$('expenseAmount').value=result.amount===''?'':won(result.amount);$('expenseMethod').value=result.method;$('ocrState').textContent=result.notes.join(' ')||'인식 결과를 원본과 확인한 뒤 저장해 주세요.';}
async function recognize(){
 if(!pendingImage||ocrBusy)return;ocrBusy=true;$('ocrBtn').disabled=true;$('saveExpense').disabled=true;$('replaceReceipt').disabled=true;
 try{
  $('ocrState').textContent='글자 읽기를 준비합니다. 첫 실행은 언어 자료를 받아 시간이 걸릴 수 있어요.';
  if(!worker)worker=await Tesseract.createWorker('kor+eng',1,{cacheMethod:'none',workerPath:new URL('./vendor/worker.min.js',location.href).href,corePath:new URL('./vendor/core/',location.href).href,langPath:new URL('./vendor/lang/',location.href).href,logger:m=>{const label=m.status==='recognizing text'?'영수증의 글자를 읽고 있습니다':'읽기 도구를 준비하고 있습니다';$('ocrState').textContent=`${label} · ${Math.round((m.progress||0)*100)}%`;}});
  await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1',tessedit_char_whitelist:''});
  const source=await imageElement(pendingImage),canvas=document.createElement('canvas');
  const scale=Math.min(3,3200/source.naturalWidth,6000/source.naturalHeight);canvas.width=Math.max(1,Math.round(source.naturalWidth*scale));canvas.height=Math.max(1,Math.round(source.naturalHeight*scale));const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(source,0,0,canvas.width,canvas.height);
  // Preserve thin/light digits in the first pass rather than erasing them with a hard threshold.
  const pixels=context.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<pixels.data.length;i+=4){const v=Math.round(pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114);pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;}context.putImageData(pixels,0,0);
  const first=await worker.recognize(canvas,{}, {text:true,blocks:true});let text=first.data.text,result=parseOCR(text);
  if(result.amount===''||first.data.confidence<70){
   $('ocrState').textContent='금액을 다시 확인하고 있습니다 · 보조 인식';
   for(let i=0;i<pixels.data.length;i+=4){const v=pixels.data[i]<185?0:255;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;}context.putImageData(pixels,0,0);
   await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
   const second=await worker.recognize(canvas,{}, {text:true,blocks:true});result=combineOCR(text,second.data.text);text+='\n\n[보조 인식]\n'+second.data.text;
   // For a single transit pair, isolate the right-hand fare cells so 원 glyphs and timestamps do not become digits.
   const transitData=[second.data,first.data].find(data=>(data.text.match(/승차/g)||[]).length===1&&(data.text.match(/하차/g)||[]).length===1);
   if(result.amount===''&&transitData&&new Set(first.data.text.match(/\d{1,2}\/\d{1,2}/g)||[]).size<=1){
    const lines=(transitData.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));
    const fareLines=lines.map(l=>({...l,text:l.text||(l.words||[]).map(w=>w.text).join(' ')})).filter(l=>/승차|하차/.test(l.text));const fares=[];
    await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789,'});
    for(const line of fareLines.slice(0,2)){
     const box=line.bbox,last=(line.words||[]).filter(w=>/\d/.test(w.text)).at(-1),edge=last?.bbox||box,x=Math.floor(canvas.width*.68),right=Math.min(canvas.width,Math.round(edge.x1-(edge.y1-edge.y0)*.9)),y=Math.max(0,box.y0-5),height=Math.min(canvas.height-y,box.y1-box.y0+10);if(right<=x)continue;
     const crop=document.createElement('canvas');crop.width=right-x;crop.height=height;crop.getContext('2d').drawImage(canvas,x,y,crop.width,height,0,0,crop.width,height);
     const digits=(await worker.recognize(crop)).data.text.trim();crop.width=crop.height=1;text+='\n[금액 칸 읽기] '+digits;
     const number=Number(digits.replaceAll(',','')),forms=[String(number),won(number)].join('|'),corroborated=new RegExp('(?<![0-9/.:,])(?:'+forms+')(?![0-9/.:,])').test(first.data.text);
     if(corroborated&&/^(?:\d{1,3}(?:,\d{3})+|\d{1,6})$/.test(digits))fares.push(`${/승차/.test(line.text)?'승차':'하차'} ${digits}원`);
    }
    if(fares.length===2){const extra=fares.join('\n');const fareResult=parseOCR(extra);if(fareResult.amount!==''){result={...result,amount:fareResult.amount,fares:fareResult.fares,notes:result.notes.filter(n=>!n.includes('금액')).concat('승차·하차 금액 칸을 따로 읽어 합산했습니다. 원본과 확인하세요.')};text+='\n\n[금액 칸 보조 인식]\n'+extra;}}
    await worker.setParameters({tessedit_char_whitelist:''});
   }
  }
  $('ocrText').value=text;applyOCR(text,result);canvas.width=canvas.height=1;
 }catch(e){if(worker){await worker.terminate().catch(()=>{});worker=null;}$('ocrState').textContent='글자를 읽지 못했습니다. 직접 입력으로 계속할 수 있습니다.';showError(e);}finally{ocrBusy=false;$('ocrBtn').disabled=!pendingImage;$('saveExpense').disabled=false;$('replaceReceipt').disabled=false;}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.textContent=name+' · 다시 다운로드';a.className='download-ready';const host=$('downloadArea');host.closest('.context-column').classList.add('has-download');const old=host.querySelector('.download-ready');if(old){URL.revokeObjectURL(old.href);old.remove();}host.append(a);a.click();}

async function backup(){try{
 const revision=backupReminder.revision;
 const data={format:'sa-expense-web',version:1,exportedAt:new Date().toISOString(),settings,expenses:all};
 download(new Blob([JSON.stringify(data)],{type:'application/json'}),'SA_경비백업_'+today()+'.json');
 const snapshotBytes=new Blob([JSON.stringify({settings:data.settings,expenses:data.expenses})]).size;
 const next={...backupReminder,lastBackupAt:Date.now(),lastBackupBytes:snapshotBytes,backupRevision:revision,snoozedUntil:0};
 await writeStore('settings',[next]);backupReminder=next;renderBackupReminder();
 toast('전체 내역과 영수증 백업 다운로드를 요청했습니다. 파일이 저장되었는지 확인해 주세요.');
}catch(e){showError(e);}}

async function restore(file){
 if(!file)return;busy(true,'백업을 확인하고 있습니다');
 try{
  if(file.size>150*1024*1024)throw new Error('백업 파일은 150MB 이하로 불러와 주세요.');const data=JSON.parse(await file.text());
  if(data.format!=='sa-expense-web'||data.version!==1||!Array.isArray(data.expenses))throw new Error('SA 웹앱 백업 JSON을 선택해 주세요. PC 프로그램의 ZIP은 웹앱 이전용 JSON으로 변환해야 합니다.');
  const ids=new Set(all.map(x=>x.id)),incoming=[];
  for(const raw of data.expenses){const r={id:String(raw.id||''),day:String(raw.day||''),amount:Number(raw.amount),purpose:String(raw.purpose||''),origin:String(raw.origin||''),destination:String(raw.destination||''),method:String(raw.method||''),image:String(raw.image||''),digest:String(raw.digest||''),rawText:String(raw.rawText||''),createdAt:String(raw.createdAt||new Date().toISOString())};if(!r.id||r.id.length>200)throw new Error('백업 내역 ID가 올바르지 않습니다.');validateRecord(r);if(!ids.has(r.id)){incoming.push(r);ids.add(r.id);}}
  if(!confirm(`${incoming.length}건을 기존 내역에 추가합니다. 같은 ID는 건너뜁니다. 계속할까요?`))return;
  await writeStore('expenses',incoming);
  if(data.settings){settings={name:String(data.settings.name||'').slice(0,40),title:String(data.settings.title||'').slice(0,40)};await writeStore('settings',[{id:'profile',...settings}]);}
  if(incoming.length)$('monthInput').value=incoming.at(-1).day.slice(0,7);await reload();$('backupDialog').close();toast(`${incoming.length}건을 불러왔습니다. 기존 내역은 보존했습니다.`);
 }catch(e){showError(e);}finally{busy(false);$('restoreInput').value='';}
}
function xmlParse(s){const doc=new DOMParser().parseFromString(s,'application/xml');if(doc.querySelector('parsererror'))throw new Error('엑셀 양식을 읽지 못했습니다.');return doc;}
function cell(sheet,ref){let c=[...sheet.getElementsByTagNameNS(NS,'c')].find(x=>x.getAttribute('r')===ref);if(c)return c;const rowNo=Number(ref.match(/\d+/)[0]);let row=[...sheet.getElementsByTagNameNS(NS,'row')].find(x=>Number(x.getAttribute('r'))===rowNo);if(!row){row=sheet.createElementNS(NS,'row');row.setAttribute('r',rowNo);const data=sheet.getElementsByTagNameNS(NS,'sheetData')[0];const next=[...data.children].find(x=>Number(x.getAttribute('r'))>rowNo);data.insertBefore(row,next||null);}c=sheet.createElementNS(NS,'c');c.setAttribute('r',ref);const ordinal=r=>[...r.match(/^[A-Z]+/)[0]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);const next=[...row.children].find(x=>ordinal(x.getAttribute('r'))>ordinal(ref));row.insertBefore(c,next||null);return c;}
function setCell(sheet,ref,value,type='text',formula=''){const c=cell(sheet,ref);c.replaceChildren();c.removeAttribute('t');if(formula){const f=sheet.createElementNS(NS,'f');f.textContent=formula;c.append(f);if(type==='text')c.setAttribute('t','str');}if(value===null)return;if(type==='text'&&!formula){c.setAttribute('t','inlineStr');const is=sheet.createElementNS(NS,'is'),t=sheet.createElementNS(NS,'t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=String(value);is.append(t);c.append(is);}else{const v=sheet.createElementNS(NS,'v');v.textContent=String(value);c.append(v);}}
function excelDay(day){return Math.round((Date.parse(day+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000);}
function weekdayFormula(row){return `IF(C${row}="","",CHOOSE(WEEKDAY(C${row}),"일","월","화","수","목","금","토"))`;}
function excelLayout(count){const extra=Math.max(0,count-35);return {extra,capacity:35+extra,lastDataRow:13+count,totalRow:50+extra,lastTemplateRow:90+extra};}
function shiftExcelReferences(value,extra){return value.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g,(whole,col,row)=>Number(row)>=49?col+(Number(row)+extra):whole);}
function prepareExcelRows(sheet,count){
 const layout=excelLayout(count),data=sheet.getElementsByTagNameNS(NS,'sheetData')[0],originalRows=[...data.children],prototype=originalRows.find(r=>r.getAttribute('r')==='14').cloneNode(true);
 if(layout.extra){
  for(const row of originalRows){if(Number(row.getAttribute('r'))>=49){row.setAttribute('r',Number(row.getAttribute('r'))+layout.extra);for(const c of row.children)c.setAttribute('r',shiftExcelReferences(c.getAttribute('r'),layout.extra));}}
  for(const f of [...sheet.getElementsByTagNameNS(NS,'f')]){f.textContent=shiftExcelReferences(f.textContent,layout.extra);if(f.hasAttribute('ref'))f.setAttribute('ref',shiftExcelReferences(f.getAttribute('ref'),layout.extra));}
  for(const element of [...sheet.getElementsByTagNameNS(NS,'mergeCell'),...sheet.getElementsByTagNameNS(NS,'dimension'),...sheet.getElementsByTagNameNS(NS,'autoFilter')])if(element.hasAttribute('ref'))element.setAttribute('ref',shiftExcelReferences(element.getAttribute('ref'),layout.extra));
  for(const element of [...sheet.getElementsByTagNameNS(NS,'dataValidation'),...sheet.getElementsByTagNameNS(NS,'conditionalFormatting')])if(element.hasAttribute('sqref'))element.setAttribute('sqref',shiftExcelReferences(element.getAttribute('sqref'),layout.extra).replace(/([A-Z]+)48\b/g,'$1'+layout.lastDataRow));
  const next=[...data.children].find(r=>Number(r.getAttribute('r'))>=49+layout.extra);
  for(let r=49;r<=layout.lastDataRow;r++){const row=prototype.cloneNode(true);row.setAttribute('r',r);for(const c of row.children){c.setAttribute('r',c.getAttribute('r').replace(/\d+$/,r));c.replaceChildren();c.removeAttribute('t');}data.insertBefore(row,next||null);}
 }
 for(const row of data.children){const r=Number(row.getAttribute('r'));if((r>=14&&r<layout.totalRow)||(r>layout.totalRow&&r<=layout.lastTemplateRow)){const hide=r>layout.lastDataRow;hide?row.setAttribute('hidden','1'):row.removeAttribute('hidden');}if(r===layout.totalRow)row.removeAttribute('hidden');}
 return layout;
}
async function finalizeExcelPackage(zip){
 // Use self-contained inline strings rather than retaining the template's shared-string indices/counts.
 if(zip.file('xl/sharedStrings.xml')){
  const strings=xmlParse(await zip.file('xl/sharedStrings.xml').async('string'));
  const entries=[...strings.getElementsByTagNameNS(NS,'si')];
  for(const path of Object.keys(zip.files).filter(path=>/^xl\/worksheets\/sheet\d+\.xml$/.test(path))){
   const sheet=xmlParse(await zip.file(path).async('string'));
   for(const c of [...sheet.getElementsByTagNameNS(NS,'c')]){
    if(c.getAttribute('t')!=='s')continue;
    const value=c.getElementsByTagNameNS(NS,'v')[0],index=Number(value?.textContent);
    if(!value||!Number.isInteger(index)||!entries[index])throw new Error('엑셀 양식의 문자열 참조가 올바르지 않습니다. 파일을 만들지 않았습니다.');
    const inline=sheet.createElementNS(NS,'is');
    for(const node of [...entries[index].childNodes])inline.appendChild(sheet.importNode(node,true));
    c.replaceChild(inline,value);c.setAttribute('t','inlineStr');
   }
   zip.file(path,new XMLSerializer().serializeToString(sheet));
  }
  zip.remove('xl/sharedStrings.xml');
 }
 // Drop parts plus their package relationships together; no dangling references in the ZIP.
 zip.remove('xl/calcChain.xml');
 const relPath='xl/_rels/workbook.xml.rels',rels=xmlParse(await zip.file(relPath).async('string'));
 for(const rel of [...rels.documentElement.children])if(/\/(sharedStrings|calcChain)$/.test(rel.getAttribute('Type')||''))rels.documentElement.removeChild(rel);
 zip.file(relPath,new XMLSerializer().serializeToString(rels));
 const types=xmlParse(await zip.file('[Content_Types].xml').async('string'));
 for(const type of [...types.documentElement.children])if(['/xl/sharedStrings.xml','/xl/calcChain.xml'].includes(type.getAttribute('PartName')))types.documentElement.removeChild(type);
 zip.file('[Content_Types].xml',new XMLSerializer().serializeToString(types));
}
let templateBytes=null;
async function createExcel(list,offset){
 if(!templateBytes){const response=await fetch('./template.xlsx');if(!response.ok)throw new Error('회사 양식을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');templateBytes=await response.arrayBuffer();}
 const zip=await JSZip.loadAsync(templateBytes),sheet=xmlParse(await zip.file('xl/worksheets/sheet1.xml').async('string')),layout=prepareExcelRows(sheet,list.length);
 const month=Number(list[0].day.slice(5,7));setCell(sheet,'A4',`■ ( ${month} ) 월 개인경비 신청내역`);setCell(sheet,'B8',settings.title);setCell(sheet,'C8',settings.name);
 for(let r=14;r<=13+layout.capacity;r++){for(const col of ['B','C','E','F','G'])setCell(sheet,col+r,null);setCell(sheet,'D'+r,'','text',weekdayFormula(r));}
 for(let r=55+layout.extra;r<=86+layout.extra;r++){if(r===60+layout.extra)continue;for(const col of ['B','C','E','F','G','H'])setCell(sheet,col+r,null);setCell(sheet,'D'+r,'','text',weekdayFormula(r));if(r<60+layout.extra){setCell(sheet,'F'+r,'주유비');setCell(sheet,'H'+r,0,'number',`G${r}*200`);}}
 const styles=xmlParse(await zip.file('xl/styles.xml').async('string'));let formats=styles.getElementsByTagNameNS(NS,'numFmts')[0];if(!formats){formats=styles.createElementNS(NS,'numFmts');styles.documentElement.insertBefore(formats,styles.documentElement.firstChild);}const formatId=Math.max(163,...[...formats.children].map(n=>Number(n.getAttribute('numFmtId'))))+1;const format=styles.createElementNS(NS,'numFmt');format.setAttribute('numFmtId',formatId);format.setAttribute('formatCode','yyyy-mm-dd');formats.append(format);formats.setAttribute('count',formats.children.length);const xfs=styles.getElementsByTagNameNS(NS,'cellXfs')[0],dateStyle=xfs.children[Number(cell(sheet,'C14').getAttribute('s')||0)].cloneNode(true),dateStyleId=xfs.children.length;dateStyle.setAttribute('numFmtId',formatId);dateStyle.setAttribute('applyNumberFormat','1');xfs.append(dateStyle);xfs.setAttribute('count',xfs.children.length);zip.file('xl/styles.xml',new XMLSerializer().serializeToString(styles));
 list.forEach((item,i)=>{const r=14+i;setCell(sheet,'B'+r,offset+i+1,'number');setCell(sheet,'C'+r,excelDay(item.day),'number');cell(sheet,'C'+r).setAttribute('s',dateStyleId);setCell(sheet,'D'+r,['일','월','화','수','목','금','토'][new Date(item.day+'T00:00:00Z').getUTCDay()],'text',weekdayFormula(r));const purpose=item.purpose+((item.origin||item.destination)?`\n(${item.origin} > ${item.destination})`:'');setCell(sheet,'E'+r,purpose);setCell(sheet,'F'+r,item.method);setCell(sheet,'G'+r,item.amount,'number');});
 const sum=list.reduce((s,r)=>s+r.amount,0),fuel=60+layout.extra,carTotal=87+layout.extra;for(const [ref,formula,value] of [['G'+layout.totalRow,`SUM(G14:G${layout.lastDataRow})`,sum],['D8','G'+layout.totalRow,sum],['E8','H'+carTotal,0],['F8','D8+E8',sum],['H'+fuel,`SUM(H${55+layout.extra}:H${59+layout.extra})`,0],['H'+carTotal,`SUM(H${fuel}:H${86+layout.extra})`,0]])setCell(sheet,ref,value,'number',formula);
 zip.file('xl/worksheets/sheet1.xml',new XMLSerializer().serializeToString(sheet));
 const wb=xmlParse(await zip.file('xl/workbook.xml').async('string'));const calc=wb.getElementsByTagNameNS(NS,'calcPr')[0];if(calc)calc.setAttribute('fullCalcOnLoad','1');for(const name of wb.getElementsByTagNameNS(NS,'definedName'))if(name.getAttribute('name')==='_xlnm.Print_Area'&&name.getAttribute('localSheetId')==='0')name.textContent=`'개인경비-양식'!$A$4:$G$${layout.totalRow}`;zip.file('xl/workbook.xml',new XMLSerializer().serializeToString(wb));
 await finalizeExcelPackage(zip);
 return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',compression:'DEFLATE'});
}
async function downloadExcel(){
 const list=rows();if(!list.length)return;if(!settings.name&&!confirm('기본 정보의 성명이 비어 있습니다. 빈 상태로 출력할까요?'))return;busy(true,'회사 양식에 경비를 작성하고 있습니다');
 try{const month=$('monthInput').value;download(await createExcel(list,0),`${month}_개인경비.xlsx`);toast('입력한 내역과 합계만 보이도록 엑셀을 만들었습니다.');}catch(e){showError(e);}finally{busy(false);}
}
function canvasBlob(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('이미지 파일을 만들지 못했습니다.')),'image/jpeg',.95));}
function jpegReceiptLayout(method,naturalWidth,naturalHeight){
 const width=method==='택시'?640:/버스|지하철/.test(method)?740:700;
 const height=Math.max(1,Math.round(naturalHeight*width/naturalWidth)),parts=[];
 // Keep the same width even for very long receipts; continue them without shrinking the text.
 for(let top=0;top<height;top+=4600)parts.push({w:width,h:Math.min(4600,height-top),sourceY:top*naturalHeight/height,sourceH:Math.min(4600,height-top)*naturalHeight/height});
 return parts;
}
async function jpegPages(list){
 const items=[];
 for(let i=0;i<list.length;i++){
  const row=list[i];
  if(!row.image){items.push({row,no:i+1,im:null,w:740,h:180,part:1,partCount:1});continue;}
  const im=await imageElement(row.image),parts=jpegReceiptLayout(row.method,im.naturalWidth,im.naturalHeight);
  parts.forEach((part,index)=>items.push({row,no:i+1,im,...part,part:index+1,partCount:parts.length}));
 }
 const groups=[];for(let i=0;i<items.length;i+=3){const group=items.slice(i,i+3);groups.push({items:group,height:Math.max(...group.map(x=>x.h))+90});}
 const pages=[];let current=[],height=100;for(const group of groups){const gap=current.length?50:0;if(current.length&&height+gap+group.height>6000){pages.push(current);current=[];height=100;}if(current.length)height+=50;current.push(group);height+=group.height;}if(current.length)pages.push(current);
 const output=[];
 for(const page of pages){
  const c=document.createElement('canvas');c.width=2420;c.height=100+page.reduce((s,g)=>s+g.height,0)+(page.length-1)*50;
  const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';let y=50;
  for(const group of page){
   group.items.forEach((item,col)=>{
    const x=50+col*790,month=Number(item.row.day.slice(5,7)),day=Number(item.row.day.slice(8));
    ctx.fillStyle='#111';ctx.font=`${item.partCount>1?36:44}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
    const continuation=item.partCount>1?` · ${item.part}/${item.partCount}`:'';
    ctx.fillText(`${item.no}. ${month}월 ${day}일${continuation}`,x,y+45);
    if(item.im)ctx.drawImage(item.im,0,item.sourceY,item.im.naturalWidth,item.sourceH,x+(740-item.w)/2,y+90,item.w,item.h);
    else{ctx.fillStyle='#999';ctx.font='32px sans-serif';ctx.fillText('증빙 없음 · 별도 확인',x,y+145);}
   });
   y+=group.height+50;
  }
  output.push(await canvasBlob(c));c.width=1;c.height=1;
 }
 return output;
}
async function downloadJpeg(){const list=rows();if(!list.length)return;busy(true,'영수증 목록을 이미지로 만들고 있습니다');try{const month=$('monthInput').value,pages=await jpegPages(list);if(pages.length===1)download(pages[0],`${month}_영수증.jpeg`);else{const zip=new JSZip();pages.forEach((blob,i)=>zip.file(`${month}_영수증_${String(i+1).padStart(2,'0')}.jpeg`,blob));download(await zip.generateAsync({type:'blob',compression:'STORE'}),`${month}_영수증.zip`);}toast('영수증 목록을 다운로드했습니다.');}catch(e){showError(e);}finally{busy(false);}}

// UI events
$('monthInput').value=today().slice(0,7);$('monthInput').addEventListener('change',()=>{if($('monthInput').value)render();});$('prevMonth').onclick=()=>setMonth(-1);$('nextMonth').onclick=()=>setMonth(1);
$('monthTrigger').onclick=showMonthPicker;$('prevYear').onclick=()=>shiftPickerYear(-1);$('nextYear').onclick=()=>shiftPickerYear(1);$('monthGrid').onclick=e=>{const b=e.target.closest('[data-month]');if(b)chooseMonth(Number(b.dataset.month));};
$('addManual').onclick=()=>{queue=[];openEditor();};$('addReceipt').onclick=()=>{$('fileInput').dataset.replace='';$('fileInput').multiple=true;$('fileInput').accept='image/png,image/jpeg,image/webp,image/bmp,application/pdf';$('fileInput').click();};$('fileInput').onchange=()=>filesToQueue([...$('fileInput').files],$('fileInput').dataset.replace==='yes');
$('replaceReceipt').onclick=()=>{$('fileInput').dataset.replace='yes';$('fileInput').multiple=false;$('fileInput').accept='image/png,image/jpeg,image/webp,image/bmp';$('fileInput').click();};
$('dropZone').onclick=()=> $('addReceipt').click();$('dropZone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('addReceipt').click();}};
for(const evt of ['dragenter','dragover'])$('dropZone').addEventListener(evt,e=>{e.preventDefault();$('dropZone').classList.add('dragover');});for(const evt of ['dragleave','drop'])$('dropZone').addEventListener(evt,e=>{e.preventDefault();$('dropZone').classList.remove('dragover');if(evt==='drop')filesToQueue([...e.dataTransfer.files]);});
$('expenseForm').onsubmit=saveExpense;$('closeEditor').onclick=closeEditor;$('cancelEditor').onclick=closeEditor;$('editor').addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
$('expenseAmount').onblur=()=>{const v=$('expenseAmount').value.replaceAll(',','');if(/^\d+$/.test(v))$('expenseAmount').value=won(v);};
$('deleteExpense').onclick=async()=>{if(!editing||!confirm('이 경비 내역을 삭제할까요?'))return;try{await writeStore('expenses',[],editing.id);$('editor').close();await reload();toast('내역을 삭제했습니다.');}catch(e){showError(e);}};
$('ocrBtn').onclick=recognize;$('parseText').onclick=()=>applyOCR($('ocrText').value);
document.addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)openEditor(all.find(x=>x.id===b.dataset.edit));});document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.receipt-card')){e.preventDefault();e.target.click();}});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render();});document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));render();});$('searchInput').oninput=render;
for(const id of ['navBackup','backupInfo'])$(id).onclick=()=>$('backupDialog').showModal();$('backupQuick').onclick=backup;$('backupReminderNow').onclick=backup;$('backupReminderLater').onclick=snoozeBackupReminder;$('backupAll').onclick=backup;$('restoreBackup').onclick=()=>$('restoreInput').click();$('restoreInput').onchange=()=>restore($('restoreInput').files[0]);
$('navSettings').onclick=()=>{$('settingName').value=settings.name;$('settingTitle').value=settings.title;$('settingsDialog').showModal();};$('settingsForm').onsubmit=async e=>{e.preventDefault();try{settings={name:$('settingName').value.trim(),title:$('settingTitle').value.trim()};await writeStore('settings',[{id:'profile',...settings}]);$('settingsDialog').close();render();toast('기본 정보를 저장했습니다.');}catch(e){showError(e);}};
$('exportBtn').onclick=()=>{const list=rows();if(!list.length){toast('저장된 경비를 먼저 추가해 주세요.');return;}$('exportSummary').textContent=`${$('monthInput').value} · ${list.length}건 · ${won(list.reduce((s,r)=>s+r.amount,0))}원 · 입력한 내역과 합계만 표시합니다.`;$('exportDialog').showModal();};$('downloadExcel').onclick=downloadExcel;$('downloadJpeg').onclick=downloadJpeg;
$('guideBtn').onclick=()=>$('guideDialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('proofPreview').onclick=()=>{if(!pendingImage)return;const w=window.open('','_blank');if(w){const im=w.document.createElement('img');im.src=pendingImage;im.style.maxWidth='100%';w.document.body.append(im);w.document.title='영수증 원본';}};
try{await openDB();const saved=await readStore('settings');const profile=saved.find(x=>x.id==='profile');if(profile)settings={name:profile.name||'',title:profile.title||''};
 const reminder=saved.find(x=>x.id==='backupReminder');if(reminder)backupReminder={...backupReminder,...reminder};
 await reload();await migrateBackupSize();
 if(!reminder){const dates=all.map(x=>Date.parse(x.createdAt)).filter(n=>Number.isFinite(n)&&n>0&&n<=Date.now());if(dates.length)backupReminder.startedAt=dates.reduce((a,b)=>Math.min(a,b),Date.now());await writeStore('settings',[backupReminder]);renderBackupReminder();}}catch(e){toast('브라우저 저장소를 열지 못했습니다. 일반 브라우저 창에서 다시 접속해 주세요.');showError(e);}

setInterval(renderBackupReminder,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderBackupReminder();});
