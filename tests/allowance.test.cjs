const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8'),ctx=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function allowanceStatus('),source.indexOf('\nfunction renderAllowance(')),ctx);
test('ordinary employees have a 200000 limit, with exact boundary and uncapped excess',()=>{
 for(const [total,remaining,excess,percent] of [[0,200000,0,0],[181200,18800,0,90.60000000000001],[200000,0,0,100],[200001,0,1,100],[235000,0,35000,100]]){
  const s=ctx.allowanceStatus(total,false);assert.equal(s.limit,200000);assert.equal(s.remaining,remaining);assert.equal(s.excess,excess);assert.ok(Math.abs(s.percent-percent)<0.00001);
 }
});
test('team lead allowance uses 300000 without changing the expense total',()=>{
 const s=ctx.allowanceStatus(235000,true);assert.equal(s.limit,300000);assert.equal(s.remaining,65000);assert.equal(s.excess,0);
 assert.equal(ctx.allowanceStatus(300000,true).excess,0);assert.equal(ctx.allowanceStatus(300001,true).excess,1);
});
test('legacy or malformed role settings default to the ordinary allowance',()=>{
 for(const value of [undefined,null,'true','false',1,0])assert.equal(ctx.allowanceStatus(235000,value).limit,200000);
});
