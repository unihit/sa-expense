const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8');
const code=source.slice(source.indexOf('function validDate('),source.indexOf('\nfunction esc('))+'\n'+source.slice(source.indexOf('function receiptAmounts('),source.indexOf('\nfunction applyOCR('))+'\n'+source.slice(source.indexOf('function excelDay('),source.indexOf('\nlet templateBytes'));
const ctx=vm.createContext({$:()=>({value:'2026-10'}),Date,Set,won:n=>Number(n).toLocaleString('ko-KR')});
vm.runInContext(code,ctx);

test('공통 교통 헤더보다 역명으로 지하철 분류',()=>{
 for(const text of ['버스-지하철\n승차 서울역\n하차 강남역','버스/지하철\n신도림\n홍대입구','승차 가역\n하차 나역','승차 강남역(2호선)'])assert.equal(ctx.parseOCR(text).method,'지하철',text);
});
test('정류장과 버스 노선은 역명이 포함되어도 버스 분류',()=>{
 for(const text of ['버스-지하철\n승차 정류장: 한빛아파트','버스/지하철\n서울역버스환승센터','승차 강남역 정류소\n하차 푸른초등학교','승차 한빛아파트\n하차 푸른초등학교','간선 143\n승차 서울역'])assert.equal(ctx.parseOCR(text).method,'버스',text);
});
test('이용내역·지역은 역명으로 오인하지 않고 통합 헤더만 있으면 수동 확인',()=>{
 for(const text of ['이용내역\n최근\n청구','이용 지역 서울\n결제금액 1650원','버스-지하철\n결제금액 1650원','버스/지하철'])assert.equal(ctx.parseOCR(text).method,'',text);
 assert.equal(ctx.parseOCR('택시 영수증\n도착 강남역').method,'택시');
});
test('보조 OCR에서 찾은 역명·정류장으로 이용수단 보완',()=>{
 assert.equal(ctx.combineOCR('버스-지하철','승차 신도림\n하차 홍대입구').method,'지하철');
 assert.equal(ctx.parseOCR('버스-지하철\n[보조 인식]\n정류장 한빛아파트').method,'버스');
});
test('기존 통합 이용수단은 내용에 따라 분류하고 불명확하면 기타로 표시',()=>{
 assert.equal(ctx.normalizeTransitMethod({method:'버스/지하철',rawText:'승차 가역\n하차 나역'}).method,'지하철');
 assert.equal(ctx.normalizeTransitMethod({method:'버스/지하철',rawText:'정류장 한빛아파트'}).method,'버스');
 assert.equal(ctx.normalizeTransitMethod({method:'버스/지하철',rawText:''}).method,'기타');
 const record={method:'택시',amount:8000};assert.equal(ctx.normalizeTransitMethod(record),record);
});
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

test('교통카드 화면의 100원 → 100% OCR 오인식은 제한적으로 보정',()=>{
 const raw='이용내역\n버스·지하철\n월상세\n02/12 11:40\n가역\n100%\n02/12 11:15\n나역\n1,550원';
 const result=ctx.parseOCR(raw);
 assert.equal(result.amount,1650);
 assert.deepEqual(Array.from(result.fares),[1550,100]);
 assert.match(result.notes.join(' '),/%로 읽힌/);
 assert.equal(ctx.parseOCR('100%\n1,550원').amount,1550);
 assert.equal(ctx.parseOCR('버스·지하철\n02/12 11:40\n가역\n100%\n02/12 11:15\n나역\n200%').amount,'');
});

test('첫 인식의 금액 단위 오류는 깨진 보조 원문 때문에 사라지지 않음',()=>{
 const first='이용내역\n최근\n버스-지하철\n월상세\n청구\n02/12 11:40\n100%\n가역\n02/12 11:15\n나역\n1,550원';
 const auxiliary="청구\n이용내역 |\nGD 100%\n지하철\n11:40 ;\n12\n02/\n|하철 가역\nx4 나역\n지하철 시";
 const result=ctx.parseOCR(first+'\n[보조 인식]\n'+auxiliary);
 assert.equal(result.amount,1650);assert.equal(result.method,'지하철');
 assert.match(result.notes.join(' '),/%로 읽힌/);
});
test('실제 백분율·서로 다른 날·여러 이동은 원으로 변환하지 않음',()=>{
 const base='이용내역\n버스-지하철\n02/12 11:40\n100%\n가역\n02/12 11:15\n나역\n1,550원';
 for(const text of [base.replace('100%','할인 100%'),base.replace('100%','할인율\n100%'),base.replace('1,550원','1550'),base.replace('02/12 11:15','02/11 11:15'),base+'\n02/12 12:00\n다역\n1500원'])assert.equal(ctx.parseOCR(text).amount,'',text);
 assert.equal(ctx.parseOCR('결제금액 18,700원\n할인율 100%').amount,18700);
 assert.deepEqual(Array.from(ctx.receiptAmounts('100%',true)),[]);
});

test('교통 내역의 물음표 단위와 깨진 보조 인식을 제한적으로 보정',()=>{
 const first='이용내역\n최근\n버스ㆍ지하철\n월상세\n청구\n02/12 15:40\n100?\n가역\n02/12 15:15\n나역\n1,550원';
 const second='= 이용내역\n최근 버스지하철 월상세 청구\nalee 15:40 1002!\n0212 15:15 1,5502!';
 for(const input of [first,first+'\n[보조 인식]\n'+second,first.replace('100?','１００？')]){
  const result=ctx.parseOCR(input);assert.equal(result.amount,1650);assert.equal(result.method,'지하철');
  assert.deepEqual(Array.from(result.fares),[1550,100]);assert.match(result.notes.join(' '),/\?로 읽힌/);
 }
});
test('물음표만 있거나 숫자까지 손상되면 금액을 추정하지 않음',()=>{
 const base='버스ㆍ지하철\n02/12 15:40\n가역\n100?\n02/12 15:15\n나역\n1,550원';
 for(const text of [base.replace('1,550원','1550'),base.replace('1,550원','1550?'),base.replace('100?','1002!'),base.replace('02/12 15:15','02/11 15:15'),base.replace('가역','')])assert.equal(ctx.parseOCR(text).amount,'',text);
 for(const text of ['100?','1002!','1,5502!'])assert.deepEqual(Array.from(ctx.receiptAmounts(text,true)),[]);
 assert.equal(ctx.parseOCR('결제금액 100?').amount,'');
});
