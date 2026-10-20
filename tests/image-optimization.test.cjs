const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8');
const code=source.slice(source.indexOf('async function optimizeReceiptImage('),source.indexOf('\nasync function filesToQueue('));
function fixture({width=4000,height=2000,alpha=255,fail='',type='image/jpeg',size=1000000}={}){
 const calls=[],image={width,height,close(){calls.push('close');}};
 const canvas={width:0,height:0,getContext(){return {drawImage(){},fillRect(){calls.push('white');},getImageData(){return {data:[0,0,0,alpha]};}};},toBlob(done,mime,quality){calls.push({width:this.width,height:this.height,mime,quality});done(fail==='encode'?null:{type:'image/jpeg'});}};
 const ctx=vm.createContext({createImageBitmap:async(file,options)=>{assert.equal(options.imageOrientation,'from-image');if(fail==='decode')throw Error();return image;},imageElement:async()=>{if(fail==='decode')throw Error();return image;},document:{createElement:()=>canvas},readDataURL:async()=>{if(fail==='read')throw Error();return 'optimized';}});
 vm.runInContext(code,ctx);return {run:()=>ctx.optimizeReceiptImage({type,size},'original'),calls,canvas};
}
test('large images preserve aspect ratio with a 1600px long edge and quality .8',async()=>{
 for(const [width,height,w,h] of [[4000,2000,1600,800],[2000,4000,800,1600]]){
  const f=fixture({width,height});assert.equal(await f.run(),'optimized');
  assert.deepEqual(f.calls.find(x=>typeof x==='object'),{width:w,height:h,mime:'image/jpeg',quality:.8});
  assert.ok(f.calls.includes('white'));assert.ok(f.calls.includes('close'));assert.equal(f.canvas.width,1);
 }
});
test('small opaque JPEG and PNG retain original bytes',async()=>{
 for(const type of ['image/jpeg','image/png']){const f=fixture({width:400,height:200,size:10000,type});assert.equal(await f.run(),'original');assert.ok(!f.calls.some(x=>typeof x==='object'));}
});
test('small transparent PNG is flattened and encoded without upscaling',async()=>{
 const f=fixture({width:400,height:200,size:10000,type:'image/png',alpha:0});assert.equal(await f.run(),'optimized');
 assert.ok(f.calls.includes('white'));assert.equal(f.calls.find(x=>typeof x==='object').width,400);
});
test('small dimensions with a large file still get recompressed',async()=>{
 const f=fixture({width:800,height:600,size:2000000});assert.equal(await f.run(),'optimized');assert.equal(f.calls.find(x=>typeof x==='object').width,800);
});
test('decode, encoding and data URL failures preserve the original',async()=>{
 for(const fail of ['decode','encode','read']){const f=fixture({fail});assert.equal(await f.run(),'original');if(fail!=='decode')assert.ok(f.calls.includes('close'));}
});
