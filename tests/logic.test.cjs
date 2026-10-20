const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8');
const code=source.slice(source.indexOf('function validDate('),source.indexOf('\nfunction esc('))+'\n'+source.slice(source.indexOf('function receiptAmounts('),source.indexOf('\nfunction applyOCR('))+'\n'+source.slice(source.indexOf('function excelDay('),source.indexOf('\nlet templateBytes'));
const ctx=vm.createContext({$:()=>({value:'2026-10'}),Date,Set,won:n=>Number(n).toLocaleString('ko-KR')});
vm.runInContext(code,ctx);
test('날짜 유효성과 Excel 날짜값',()=>{assert.equal(ctx.validDate('2026-02-30'),false);assert.equal(ctx.validDate('2028-02-29'),true);assert.equal(ctx.excelDay('2026-10-20'),46315);});
test('승차 하차 1회만 합산',()=>{const r=ctx.parseOCR('10/20 08:43 하차 가역 100원\n10/20 08:19 승차 나역 1,550원\n지하철');assert.equal(r.amount,1650);assert.equal(r.day,'2026-10-20');assert.equal(r.method,'지하철');assert.equal(ctx.parseOCR('승차 1550원\n하차 100원\n승차 1550원').amount,'');});
test('승인 금액을 세금과 누적액보다 우선',()=>{assert.equal(ctx.parseOCR('2026.10.15\n승인 금액 5,800원\n부가세 527원\n총 금액 174,800원').amount,5800);});
test('확실하지 않은 OCR 금액은 비워둠',()=>{assert.equal(ctx.parseOCR('10/20 08:43\n100%\n10/20 08:19\n1,5507').amount,'');assert.equal(ctx.parseOCR('카드 5181-8523\n부가세 527원').amount,'');});
test('통화 단위 생략, 줄바꿈, 다양한 합계 표기',()=>{
 for(const text of ['승 인 금 액 18,700','결제금액\n₩\n18,700','합계 : 18700','TOTAL 18,700','이용금액 18,700','결제금액 １８，７００원','승인금액 18,7OO'])assert.equal(ctx.parseOCR(text).amount,18700,text);
});
test('날짜 시간 카드번호 세금 잔액을 금액으로 쓰지 않음',()=>{
 for(const text of ['승인금액\n2026-10-20 08:43','카드번호 5181-8523\n잔액 20,000원\n부가세 527원','승인금액\n승인번호 12345678','승인금액 18,700\n할인 3,000원\n잔액 99,000원'])assert.equal(ctx.parseOCR(text).amount,text.startsWith('승인금액 18')?18700:'',text);
});
test('승인금액 우선과 동률 충돌 처리',()=>{
 assert.equal(ctx.parseOCR('합계 20,000\n실결제금액 18,700\n부가세 1700').amount,18700);
 assert.equal(ctx.parseOCR('결제금액 18,700\n승인금액 19,700').amount,'');
 assert.equal(ctx.parseOCR('금액 18,700원\n금액 1,650원').amount,'');
 assert.equal(ctx.parseOCR('18,700원').amount,18700);
});
test('두 차례 OCR 결과가 다르면 확인 요청',()=>{
 assert.equal(ctx.combineOCR('승인금액 18,700','결제금액 19,700').amount,'');
 assert.equal(ctx.combineOCR('읽기 실패','결제금액 18,700').amount,18700);
 assert.equal(ctx.combineOCR('결제금액 18,700','18,700원').amount,18700);
});

test('같은 줄 세금과 환승 추가요금 0원',()=>{
 assert.equal(ctx.parseOCR('결제금액 18,700원 부가세 1,700원').amount,18700);
 assert.equal(ctx.parseOCR('승차 1,550원\n하차 0원').amount,1550);
 assert.equal(ctx.parseOCR('버스지하철\n100원\n1,550').amount,'');
});
test('승하차 라벨·역·금액이 여러 줄로 나뉜 OCR',()=>{
 for(const text of ['하차\n10/20 08:43\n가역\n100원\n승차\n10/20 08:19\n나역\n1,550원','승 차\n10/20 08:19\n나역\n1550\n하 차\n10/20 08:43\n가역\n100'])assert.equal(ctx.parseOCR(text).amount,1650,text);
 assert.equal(ctx.parseOCR('승차\n1,550원\n하차\n0').amount,1550);
 assert.equal(ctx.parseOCR('승차\n10/19 08:19\n1,550원\n하차\n10/20 08:43\n100원').amount,'');
});
test('보조 인식 원문을 재해석해도 중복 때문에 합산이 사라지지 않음',()=>{
 const raw='승차 1,550원\n하차 100원\n[보조 인식]\n승차 1,550원\n하차 100원';
 assert.equal(ctx.parseOCR(raw).amount,1650);
 assert.equal(ctx.parseOCR('인식 실패\n[보조 인식]\n승차 1,5502!\n하차 100원\n[금액 칸 읽기] 1550\n[금액 칸 보조 인식]\n승차 1550원\n하차 100원').amount,1650);
});
test('분할 인식 원문: 승하차·원 누락 및 보조 인식 오류에도 1650원',()=>{
 const text=`이용내역\n최근\n버스-지하절\nBoA\n청구\n10/20 08:43\n100\nO\nL_\n가역\n10/20 08:19\n1,550\n나역\n[보조 인식]\nㅡ 이용내역\n최근 버스지하철 월상세 성구\n10/20 08:43\n버스-지하설 ole 가역 1004\n64 107200019 5508`;
 const result=ctx.parseOCR(text);assert.equal(result.amount,1650);assert.deepEqual(Array.from(result.fares),[1550,100]);assert.equal(result.day,'2026-10-20');
});
test('시각 기준 교통비 합산 제한: 여러 이동·다른 날짜·불명확 금액 제외',()=>{
 const base='버스-지하철\n10/20 08:43\n100\n가역\n10/20 08:19\n1550\n나역';
 assert.equal(ctx.parseOCR(base).amount,1650);
 for(const text of [base.replace('10/20 08:19','10/19 08:19'),base.replace('08:19','01:19'),base+'\n10/20 08:50\n1550\n가역',base.replace('100\n','1004!\n'),base.replace('100\n','100\n200\n'),base.replace('버스-지하철','일반 거래')])assert.equal(ctx.parseOCR(text).amount,'',text);
});
