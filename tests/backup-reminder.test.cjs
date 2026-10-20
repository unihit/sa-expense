const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8');
const DAY=86400000, MB=1024*1024, now=1800000000000;
function status(overrides={},count=1,bytes=1){
 const ctx=vm.createContext({Date});
 vm.runInContext(source.slice(source.indexOf('function backupReminderStatus('),source.indexOf('\nfunction renderBackupReminder(')),ctx);
 return ctx.backupReminderStatus(count,bytes,{revision:'new',backupRevision:null,startedAt:now-29*DAY,lastBackupAt:0,snoozedUntil:0,...overrides},now);
}
test('backup age reaches the threshold at 30 days and uses the last full backup',()=>{
 assert.equal(status(),null);
 assert.equal(status({startedAt:now-30*DAY}).overdue,true);
 assert.equal(status({startedAt:now-100*DAY,lastBackupAt:now-2*DAY}),null);
 assert.equal(status({lastBackupAt:now-31*DAY}).days,31);
});
test('100 MB warns even for recent data, with exact size boundary',()=>{
 assert.equal(status({},1,100*MB-1),null);
 const result=status({},1,100*MB);
 assert.equal(result.large,true);assert.equal(result.overdue,false);assert.equal(result.megabytes,100);
});
test('empty or unchanged backed-up data does not repeatedly warn',()=>{
 assert.equal(status({startedAt:now-90*DAY},0,200*MB),null);
 assert.equal(status({backupRevision:'new',lastBackupAt:now-90*DAY},2,200*MB),null);
 assert.ok(status({backupRevision:'old',lastBackupAt:now-90*DAY},2,200*MB));
});
test('snooze suppresses both reasons for one day and expires at its deadline',()=>{
 assert.equal(status({startedAt:now-50*DAY,snoozedUntil:now+1},1,200*MB),null);
 assert.ok(status({startedAt:now-50*DAY,snoozedUntil:now},1,200*MB));
});
test('data writes store a new revision atomically; reminder-only writes preserve it',async()=>{
 const calls=[],pending=[];
 const ctx=vm.createContext({Date,Math,backupReminder:{id:'backupReminder',revision:'original'},db:{transaction(stores){const tx={objectStore(name){return{put(value){calls.push({name,value});},delete(id){calls.push({id});}}}};pending.push({stores,tx});queueMicrotask(()=>tx.oncomplete());return tx;}}});
 vm.runInContext(source.slice(source.indexOf('async function writeStore('),source.indexOf('\nasync function reload(')),ctx);
 await ctx.writeStore('expenses',[{id:'row'}]);
 assert.deepEqual(Array.from(pending[0].stores),['expenses','settings']);
 assert.notEqual(ctx.backupReminder.revision,'original');
 assert.equal(calls.find(x=>x.name==='settings').value.revision,ctx.backupReminder.revision);
 const revision=ctx.backupReminder.revision;
 await ctx.writeStore('settings',[{id:'backupReminder',snoozedUntil:123}]);
 assert.equal(pending[1].stores,'settings');assert.equal(ctx.backupReminder.revision,revision);
 await ctx.writeStore('expenses',[],'row');assert.notEqual(ctx.backupReminder.revision,revision);
 const afterDelete=ctx.backupReminder.revision;
 await ctx.writeStore('settings',[{id:'profile',name:'예시'}]);assert.notEqual(ctx.backupReminder.revision,afterDelete);
});
function backupFixture(fail){
 const writes=[],downloads=[],errors=[];
 const ctx=vm.createContext({Date,Blob,JSON,settings:{name:'예시'},all:[{id:'one'},{id:'two'}],backupReminder:{id:'backupReminder',revision:'current',lastBackupAt:0},today:()=> '2026-10-20',download(blob,name){if(fail==='download')throw Error('download failed');downloads.push({blob,name});},async writeStore(name,items){if(fail==='metadata')throw Error('storage failed');writes.push({name,items});},renderBackupReminder(){},toast(){},showError(e){errors.push(e);}});
 vm.runInContext(source.slice(source.indexOf('async function backup(){'),source.indexOf('\nasync function restore(')),ctx);
 return{ctx,writes,downloads,errors};
}
test('full backup contains all records and records the backed-up revision',async()=>{
 const f=backupFixture();await f.ctx.backup();
 const data=JSON.parse(await f.downloads[0].blob.text());
 assert.equal(data.expenses.length,2);assert.equal(data.format,'sa-expense-web');
 assert.equal(f.ctx.backupReminder.backupRevision,'current');assert.ok(f.ctx.backupReminder.lastBackupAt>0);
 assert.equal(f.writes[0].items[0].snoozedUntil,0);
});
test('a failed download or metadata save does not mark the backup as recorded',async()=>{
 for(const failure of ['download','metadata']){const f=backupFixture(failure);await f.ctx.backup();assert.equal(f.ctx.backupReminder.lastBackupAt,0);assert.equal(f.errors.length,1);assert.equal(f.writes.length,0);}
});
