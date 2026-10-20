const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8');
function fixture(options={}){
 const calls=[],messages=[],fields={editor:{open:!!options.editor},busyOverlay:{hidden:!options.busy}};
 const ctx=vm.createContext({$:id=>fields[id],ocrBusy:!!options.ocr,toast:m=>messages.push(m),showError:e=>{throw e;},document:{querySelector:()=>options.dialog?{}:null},filesToQueue:async(files,replace)=>{calls.push({files,replace});if(options.wait)await options.wait;}});
 vm.runInContext(source.slice(source.indexOf('let receiptPasteBusy=false;'),source.indexOf('// UI events')),ctx);
 return {ctx,calls,messages};
}
const image={name:'clipboard.png',type:'image/png',size:10};
function paste(files=[image],options={}){
 return {clipboardData:{items:options.noItems?[]:files.map(file=>({kind:'file',type:file.type,getAsFile:()=>file})),files,getData:()=>options.text||''},target:{closest:()=>options.input?{}:null},prevented:false,preventDefault(){this.prevented=true;}};
}
test('clipboard image becomes a new receipt through the upload pipeline',async()=>{
 const {ctx,calls}=fixture(),event=paste();await ctx.handleReceiptPaste(event);
 assert.equal(event.prevented,true);assert.equal(calls.length,1);assert.equal(calls[0].files.length,1);assert.equal(calls[0].files[0],image);assert.equal(calls[0].replace,false);
});
test('clipboard Files fallback works without duplicate items',async()=>{
 const {ctx,calls}=fixture();await ctx.handleReceiptPaste(paste([image],{noItems:true}));assert.equal(calls[0].files.length,1);
});
test('image paste in an editor replaces its receipt',async()=>{
 const {ctx,calls}=fixture({editor:true});await ctx.handleReceiptPaste(paste());assert.equal(calls[0].replace,true);
});
test('text paste and text selections in fields remain native',async()=>{
 const {ctx,calls}=fixture(),text=paste([],{input:true,text:'AWS seminar'}),rich=paste([image],{input:true,text:'copied description'});
 await ctx.handleReceiptPaste(text);await ctx.handleReceiptPaste(rich);assert.equal(text.prevented,false);assert.equal(rich.prevented,false);assert.equal(calls.length,0);
});
test('OCR, another dialog and active upload block image paste',async()=>{
 for(const options of [{ocr:true},{busy:true},{dialog:true}]){const {ctx,calls,messages}=fixture(options);await ctx.handleReceiptPaste(paste());assert.equal(calls.length,0);assert.equal(messages.length,1);}
});
test('unsupported files do not consume paste',async()=>{
 const {ctx,calls}=fixture(),event=paste([{name:'test.pdf',type:'application/pdf'}]);await ctx.handleReceiptPaste(event);assert.equal(event.prevented,false);assert.equal(calls.length,0);
});
test('multiple images queue on the list but cannot replace one receipt',async()=>{
 const {ctx,calls}=fixture();await ctx.handleReceiptPaste(paste([image,{...image,name:'two.png'}]));assert.equal(calls[0].files.length,2);
 const edit=fixture({editor:true});await edit.ctx.handleReceiptPaste(paste([image,{...image,name:'two.png'}]));assert.equal(edit.calls.length,0);
});
test('rapid repeated paste does not open two editors',async()=>{
 let finish;const wait=new Promise(resolve=>{finish=resolve;}),{ctx,calls}=fixture({wait});
 const first=ctx.handleReceiptPaste(paste());await ctx.handleReceiptPaste(paste());assert.equal(calls.length,1);finish();await first;
});
