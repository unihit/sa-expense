const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const JSZip=require('../dist/vendor/jszip.min.js');
const source=fs.readFileSync('dist/app.js','utf8');
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
// Standards-compatible DOM adapters for the same production XML functions used in a browser.
const fixture=new DOMParser().parseFromString('<r/>','text/xml');
for(const list of [fixture.childNodes,fixture.getElementsByTagNameNS('*','*')])Object.getPrototypeOf(list)[Symbol.iterator]=Array.prototype[Symbol.iterator];
const proto=Object.getPrototypeOf(fixture.documentElement);
Object.defineProperty(proto,'children',{get(){return Array.from(this.childNodes).filter(n=>n.nodeType===1);}});
proto.replaceChildren=function(){while(this.firstChild)this.removeChild(this.firstChild);};
proto.append=function(...nodes){nodes.forEach(n=>this.appendChild(n));};
class Parser{
 parseFromString(xml,type){const doc=new DOMParser().parseFromString(xml,type);doc.querySelector=selector=>doc.getElementsByTagName(selector)[0]||null;return doc;}
}
const ctx=vm.createContext({NS,DOMParser:Parser,XMLSerializer,JSZip,Blob,Date,templateBytes:fs.readFileSync('dist/template.xlsx'),settings:{name:'테스트',title:'선임'}});
vm.runInContext(source.slice(source.indexOf('function xmlParse('),source.indexOf('\nlet templateBytes'))+'\n'+source.slice(source.indexOf('async function createExcel('),source.indexOf('\nasync function downloadExcel(')),ctx);
const item=(i,day='2026-10-20')=>({day,purpose:'AWS 세미나 참석',origin:'자택',destination:'AWS 코리아',method:i===0?'택시':'지하철',amount:i===0?18700:1650});
async function exported(records){const blob=await ctx.createExcel(records,0);const bytes=Buffer.from(await blob.arrayBuffer());if(process.env.SA_EXCEL_FIXTURE_DIR){fs.mkdirSync(process.env.SA_EXCEL_FIXTURE_DIR,{recursive:true});fs.writeFileSync(require('node:path').join(process.env.SA_EXCEL_FIXTURE_DIR,`rows-${records.length}.xlsx`),bytes);}const zip=await JSZip.loadAsync(bytes);const parser=new Parser();return {bytes,zip,sheet:parser.parseFromString(await zip.file('xl/worksheets/sheet1.xml').async('string'),'application/xml'),workbook:parser.parseFromString(await zip.file('xl/workbook.xml').async('string'),'application/xml')};}
const getCell=(s,ref)=>Array.from(s.getElementsByTagNameNS(NS,'c')).find(c=>c.getAttribute('r')===ref);
const getRow=(s,r)=>Array.from(s.getElementsByTagNameNS(NS,'row')).find(c=>c.getAttribute('r')===String(r));
const value=(s,ref)=>getCell(s,ref)?.getElementsByTagNameNS(NS,'v')[0]?.textContent;
test('2건 출력: 입력 2행과 합계만 표시하고 빈 요일은 토요일이 아님',async()=>{
 const {sheet,workbook,zip}=await exported([item(0,'2026-10-15'),item(1)]);
 assert.equal(zip.file('xl/calcChain.xml'),null);assert.ok(!(await zip.file('xl/_rels/workbook.xml.rels').async('string')).includes('/calcChain'));
 assert.notEqual(getRow(sheet,14).getAttribute('hidden'),'1');assert.notEqual(getRow(sheet,15).getAttribute('hidden'),'1');
 for(let r=16;r<=49;r++)assert.equal(getRow(sheet,r).getAttribute('hidden'),'1',`빈 행 ${r}`);
 assert.notEqual(getRow(sheet,50).getAttribute('hidden'),'1');
 assert.equal(getCell(sheet,'D16').getAttribute('t'),'str');assert.equal(value(sheet,'D16'),'');
 assert.equal(value(sheet,'D14'),'목');assert.equal(value(sheet,'D15'),'화');
 assert.equal(value(sheet,'G50'),'20350');assert.equal(value(sheet,'F8'),'20350');
 assert.equal(getCell(sheet,'G50').getElementsByTagNameNS(NS,'f')[0].textContent,'SUM(G14:G15)');
 assert.equal(Array.from(workbook.getElementsByTagNameNS(NS,'definedName')).find(n=>n.getAttribute('localSheetId')==='0').textContent,"'개인경비-양식'!$A$4:$G$50");
 assert.equal(getRow(sheet,55).getAttribute('hidden'),'1');
});
test('36건 출력: 36번째 행 추가, 합계 이동, 요약표·인쇄범위 갱신',async()=>{
 const {sheet,workbook}=await exported(Array.from({length:36},(_,i)=>item(i)));
 assert.equal(value(sheet,'B49'),'36');assert.equal(getRow(sheet,49).getAttribute('hidden'),'');
 assert.equal(getRow(sheet,50).getAttribute('hidden'),'1');
 assert.equal(value(sheet,'G51'),String(18700+35*1650));
 assert.equal(getCell(sheet,'D8').getElementsByTagNameNS(NS,'f')[0].textContent,'G51');
 assert.equal(getCell(sheet,'G51').getElementsByTagNameNS(NS,'f')[0].textContent,'SUM(G14:G49)');
 assert.equal(Array.from(workbook.getElementsByTagNameNS(NS,'definedName')).find(n=>n.getAttribute('localSheetId')==='0').textContent,"'개인경비-양식'!$A$4:$G$51");
 const refs=Array.from(sheet.getElementsByTagNameNS(NS,'c')).map(c=>c.getAttribute('r'));assert.equal(new Set(refs).size,refs.length);
});
test('35건 뒤 1건으로 다시 출력해도 빈 행과 날짜가 남지 않음',async()=>{
 await exported(Array.from({length:35},(_,i)=>item(i)));
 const {sheet}=await exported([item(1)]);
 assert.equal(getRow(sheet,15).getAttribute('hidden'),'1');assert.equal(getCell(sheet,'C15').textContent,'');
 assert.equal(value(sheet,'D15'),'');assert.equal(value(sheet,'G50'),'1650');
});
test('모든 시트의 공유 문자열 참조 제거 및 패키지 관계·정의 정합성',async()=>{
 const {zip,sheet}=await exported([item(0,'2026-10-15'),item(1)]);
 assert.equal(zip.file('xl/sharedStrings.xml'),null);
 assert.equal(zip.file('xl/calcChain.xml'),null);
 const rels=await zip.file('xl/_rels/workbook.xml.rels').async('string');
 const types=await zip.file('[Content_Types].xml').async('string');
 assert.ok(!rels.includes('/sharedStrings'));assert.ok(!rels.includes('/calcChain'));
 assert.ok(!types.includes('/xl/sharedStrings.xml'));assert.ok(!types.includes('/xl/calcChain.xml'));
 for(const path of Object.keys(zip.files).filter(p=>/^xl\/worksheets\/sheet\d+\.xml$/.test(p))){
  const doc=new Parser().parseFromString(await zip.file(path).async('string'),'text/xml');
  assert.ok(Array.from(doc.getElementsByTagNameNS(NS,'c')).every(c=>c.getAttribute('t')!=='s'));
 }
 assert.equal(getCell(sheet,'B13').textContent,'NO.');
 assert.equal(getCell(sheet,'E14').textContent,'AWS 세미나 참석\n(자택 > AWS 코리아)');
});
