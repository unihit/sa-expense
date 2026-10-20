const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8');
function fixture(optimize=async(f,data)=>data){
 const fields=new Map(),runs=[],errors=[];
 const $=id=>{if(!fields.has(id))fields.set(id,{value:'',open:false,reset(){},showModal(){this.open=true;}});return fields.get(id);};
 const ctx=vm.createContext({$,runs,errors,TextEncoder,today:()=> '2026-02-12',won:String,selectedImage(){},busy(){},showError:e=>errors.push(e.message),readDataURL:async f=>'data:image/png;base64,'+f.name,imageElement:async()=>({}),digest:async()=> 'digest',recognize:async()=>runs.push({image:ctx.currentImage(),date:$('expenseDate').value,amount:$('expenseAmount').value})});
 ctx.optimizeReceiptImage=optimize;
 vm.runInContext("let editing=null,pendingImage='',pendingOCRImage='',pendingDigest='',queue=[];function currentImage(){return pendingImage;}function ocrImage(){return pendingOCRImage||pendingImage;}function waiting(){return queue.length;}"+source.slice(source.indexOf('function openEditor('),source.indexOf('\nfunction closeEditor('))+'\n'+source.slice(source.indexOf('async function filesToQueue('),source.indexOf('\nfunction imageElement(')),ctx);
 return {ctx,$,runs,errors};
}
const file=name=>({name,type:'image/png',size:10,arrayBuffer:async()=>new ArrayBuffer(1)});
test('upload starts OCR without a separate click',async()=>{
 const {ctx,runs,$}=fixture();await ctx.filesToQueue([file('first.png')]);
 assert.equal(runs.length,1);assert.equal(runs[0].image,'data:image/png;base64,first.png');assert.equal($('editor').open,true);
});
test('each queued receipt starts OCR when its editor opens',async()=>{
 const {ctx,runs}=fixture();await ctx.filesToQueue([file('first.png'),file('second.png')]);
 assert.equal(runs.length,1);assert.equal(ctx.waiting(),1);ctx.nextQueued();
 assert.equal(runs.length,2);assert.equal(runs[1].image,'data:image/png;base64,second.png');
});
test('opening saved records and manual entry does not overwrite fields with OCR',()=>{
 const {ctx,runs,$}=fixture();ctx.openEditor({day:'2026-02-12',amount:1650,method:'지하철',image:'saved-image',rawText:'saved text'});
 assert.equal(runs.length,0);assert.equal($('expenseAmount').value,'1650');assert.equal($('ocrText').value,'saved text');
 ctx.openEditor();assert.equal(runs.length,0);
});
test('replacing a receipt automatically reads it without retaining the old amount',async()=>{
 const {ctx,runs,$}=fixture();ctx.openEditor({day:'2026-02-12',amount:1650,method:'지하철',purpose:'방문',image:'old-image'});
 await ctx.filesToQueue([file('new.png')],true);
 assert.equal(runs.length,1);assert.equal(runs[0].image,'data:image/png;base64,new.png');
 assert.equal(runs[0].amount,'');assert.equal(runs[0].date,'');assert.equal($('expensePurpose').value,'방문');
});
test('rejected oversized uploads do not start OCR',async()=>{
 const {ctx,runs,errors}=fixture();await ctx.filesToQueue([{...file('large.png'),size:21*1024*1024}]);
 assert.equal(runs.length,0);assert.equal(errors.length,1);
});
test('optimized uploads and replacements retain only a transient original for OCR',async()=>{
 const {ctx}=fixture(async()=> 'data:image/jpeg;base64,optimized');
 await ctx.filesToQueue([file('original.png')]);
 assert.equal(ctx.currentImage(),'data:image/jpeg;base64,optimized');
 assert.equal(ctx.ocrImage(),'data:image/png;base64,original.png');
 await ctx.filesToQueue([file('replacement.png')],true);
 assert.equal(ctx.ocrImage(),'data:image/png;base64,replacement.png');
 ctx.openEditor({image:'saved-image'});
 assert.equal(ctx.ocrImage(),'saved-image');
});
