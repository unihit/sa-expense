const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8');
function fixture(images={}){
 const pages=[];const ctx=vm.createContext({imageElement:async key=>images[key],document:{createElement(){const page={width:0,height:0,images:[],labels:[]};pages.push(page);return {width:0,height:0,getContext(){return {fillRect(){},fillText(text){page.labels.push(text);},drawImage(...args){page.images.push(args);}};},toBlob(done){page.width=this.width;page.height=this.height;done(page);}};}},Promise});
 vm.runInContext(source.slice(source.indexOf('function canvasBlob('),source.indexOf('\nasync function downloadJpeg(')),ctx);
 return {ctx,pages};
}
test('taxi receipts keep a common width regardless of input resolution',()=>{
 const {ctx}=fixture();const small=ctx.jpegReceiptLayout('택시',320,640),large=ctx.jpegReceiptLayout('택시',1280,2560);
 assert.equal(small[0].w,640);assert.equal(large[0].w,640);assert.equal(small[0].h,large[0].h);
});
test('bus and subway share a width and preserve their aspect ratio',()=>{
 const {ctx}=fixture();const bus=ctx.jpegReceiptLayout('버스',370,555)[0],rail=ctx.jpegReceiptLayout('지하철',1480,2220)[0];
 assert.equal(bus.w,740);assert.equal(rail.w,740);assert.equal(bus.h,1110);assert.equal(rail.h,1110);
});
test('very long receipts continue at the same width without losing any image area',()=>{
 const {ctx}=fixture();const parts=ctx.jpegReceiptLayout('택시',320,7000);
 assert.equal(parts.length,4);assert.ok(parts.every(p=>p.w===640&&p.h<=4600));
 assert.equal(parts.reduce((sum,p)=>sum+p.sourceH,0),7000);
 for(let i=1;i<parts.length;i++)assert.equal(parts[i].sourceY,parts[i-1].sourceY+parts[i-1].sourceH);
});
test('JPEG rendering preserves expense numbering, dates and missing-proof entries',async()=>{
 const {ctx,pages}=fixture({small:{naturalWidth:320,naturalHeight:640},large:{naturalWidth:1280,naturalHeight:2560},rail:{naturalWidth:370,naturalHeight:555}});
 const list=[{method:'택시',image:'small'},{method:'택시',image:'large'},{method:'지하철',image:'rail'},{method:'버스',image:''}].map(x=>({...x,day:'2026-02-12'}));
 await ctx.jpegPages(list);assert.equal(pages.length,1);const page=pages[0];
 assert.deepEqual(page.images.map(args=>args[7]),[640,640,740]);
 assert.deepEqual(page.labels.slice(0,4),['1. 2월 12일','2. 2월 12일','3. 2월 12일','4. 2월 12일']);
 assert.ok(page.labels.includes('증빙 없음 · 별도 확인'));assert.equal(page.width,2420);assert.ok(page.height<=6000);
});
test('continued receipts stay within page limits and retain their original number',async()=>{
 const {ctx,pages}=fixture({long:{naturalWidth:320,naturalHeight:10000}});
 await ctx.jpegPages([{method:'택시',image:'long',day:'2026-02-12'}]);
 assert.equal(pages.length,2);assert.ok(pages.every(p=>p.height<=6000));
 const labels=pages.flatMap(p=>p.labels);assert.equal(labels.length,5);assert.ok(labels.every(x=>x.startsWith('1. 2월 12일')));
 assert.ok(labels[4].endsWith('5/5'));
});
