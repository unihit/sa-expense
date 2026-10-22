const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8');
test('submission bundles use the selected year and month for the Excel file in both folder and ZIP paths',async()=>{
 for(const month of ['2026-10','2027-01']){
  const archives=[],downloads=[];
  class Zip {constructor(){this.files=[];archives.push(this);}file(name,blob){this.files.push({name,blob});}async generateAsync(){return new Blob([JSON.stringify(this.files.map(x=>x.name))]);}}
  const data={expenses:[{id:'old',day:'2025-01-01',amount:100},{id:'current',day:month+'-02',amount:1000}],settings:{name:'예시'}};
  const context=vm.createContext({Blob,JSON,JSZip:Zip,readBackupSnapshot:async()=>({data}),async createExcel(rows){assert.equal(rows.length,1);assert.equal(rows[0].id,'current');return new Blob(['excel']);},jpegPages:async()=>[new Blob(['receipt'])],download(blob,name){downloads.push({blob,name});}});
  vm.runInContext(source.slice(source.indexOf('async function createSubmissionFiles('),source.indexOf('async function saveSubmission(')),context);
  const files=await context.createSubmissionFiles(month);
  assert.deepEqual(Array.from(files,x=>x.name),[month+'_개인경비.xlsx','영수증.zip','data.json']);
  assert.equal(JSON.parse(await files[2].blob.text()).expenses.length,2);
  await context.downloadSubmissionFiles(month,files);
  const paths=JSON.parse(await downloads[0].blob.text());
  assert.ok(paths.includes(month+'/'+month+'_개인경비.xlsx'));
  assert.equal(downloads[0].name,month+'_제출묶음.zip');
 }
});
