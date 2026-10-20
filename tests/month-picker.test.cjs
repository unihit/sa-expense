const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8');
function fixture(value){
 const fields=new Map(),shown=[];
 const $=id=>{if(!fields.has(id))fields.set(id,{value:'',textContent:'',innerHTML:'',open:false,showModal(){this.open=true;},close(){this.open=false;}});return fields.get(id);};
 $('monthInput').value=value;
 const ctx=vm.createContext({$,Date,render:()=>shown.push($('monthInput').value)});
 vm.runInContext('let monthPickerYear=2026;'+source.slice(source.indexOf('function renderMonthPicker('),source.indexOf('\nfunction selectedImage(')),ctx);
 return {ctx,$,shown};
}
test('choosing a month in a different year updates the filter and closes the picker',()=>{
 const {ctx,$,shown}=fixture('2026-10');ctx.showMonthPicker();ctx.shiftPickerYear(1);ctx.chooseMonth(2);
 assert.equal($('monthInput').value,'2027-02');assert.deepEqual(shown,['2027-02']);assert.equal($('monthDialog').open,false);
});
test('previous and next month controls cross year boundaries correctly',()=>{
 const {ctx,$,shown}=fixture('2026-01');ctx.setMonth(-1);assert.equal($('monthInput').value,'2025-12');
 ctx.setMonth(1);assert.equal($('monthInput').value,'2026-01');assert.equal(shown.length,2);
});
test('year navigation leaves the current filter unchanged until a month is chosen',()=>{
 const {ctx,$,shown}=fixture('2026-10');ctx.showMonthPicker();ctx.shiftPickerYear(-1);
 assert.equal($('monthInput').value,'2026-10');assert.equal(shown.length,0);assert.equal($('monthYear').textContent,'2025년');
 assert.equal(($('monthGrid').innerHTML.match(/data-month=/g)||[]).length,12);
 ctx.chooseMonth(13);assert.equal($('monthInput').value,'2026-10');assert.equal($('monthDialog').open,true);
});
