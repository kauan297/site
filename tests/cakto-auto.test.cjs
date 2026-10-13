"use strict";
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const secret='fixture-webhook-secret-32-characters-only',product='42011b46-5012-47a2-b2b1-599590c5a6da';
const rows=new Map(),routes=new Map(),middleware=[],logs=[],stopped=[];
const machineA='A1B2C3D4E5F60718293A',machineB='00112233445566778899';
class Pool{
 async query(sql,p=[]){
  if(/^(CREATE TABLE|ALTER TABLE)/.test(sql)||sql==='SELECT 1')return {rowCount:1,rows:[]};
  if(sql.startsWith('INSERT INTO')){const [id,ref,product,email,state,expires]=p;let r=rows.get(id);if(r){r.state=r.state==='revoked'?'revoked':state;}else{r={order_id:id,order_ref:ref,product_id:product,email_digest:email,state,expires_at:expires,device_digest:null};rows.set(id,r);}return {rowCount:1,rows:[r]};}
  if(sql.startsWith('SELECT 1 FROM')){const r=rows.get(p[0]),ok=r?.state==='paid'&&r.device_digest===p[1];return {rowCount:ok?1:0,rows:[]};}
  if(sql.startsWith('UPDATE')&&sql.includes('device_digest=NULL')){const r=rows.get(p[0]),ok=r?.device_digest===p[1]&&r.state==='paid';if(ok)r.device_digest=null;return{rowCount:ok?1:0,rows:[]};}
  throw Error('SQL unknown');
 }
 async connect(){return{release(){},query:async(sql,p=[])=>{
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rowCount:0,rows:[]};
  if(sql.startsWith('SELECT order_id')){assert.ok(sql.includes("left(order_id,6)='CAKTO_'"));const matches=[...rows.values()].filter(r=>r.order_id.startsWith('CAKTO_')&&r.email_digest===p[0]&&(r.order_id===p[1]||r.order_ref===p[1]));return{rowCount:matches.length,rows:matches};}
  if(sql.startsWith('UPDATE')&&sql.includes('device_digest=$2')){rows.get(p[0]).device_digest=p[1];return{rowCount:1,rows:[]};}
  return this.query(sql,p);
 }};}
}
const context={module:{exports:{}},Buffer,Date,console:{log:(...x)=>logs.push(x.join(' ')),error:(...x)=>logs.push(x.join(' '))},process:{env:{CAKTO_AUTO_ENABLED:'1',CAKTO_PRODUCT_ID:product,CAKTO_WEBHOOK_SECRET:secret,CAKTO_LICENSE_DAYS:'0',KIWIFY_DATABASE_URL:'postgres://fixture',LICENSE_MODE:'manual',CAKTO_DIAGNOSTICS:'1'}},require:n=>n==='pg'?{Pool}:crypto};
vm.runInNewContext(fs.readFileSync('cakto-auto.js','utf8'),context);
const auto=context.module.exports({app:{post:(p,f)=>routes.set(p,f),use:(p,f)=>middleware.push(f)},sessionSecret:'fixture-session-secret-not-real-12345',hashDevice:s=>crypto.createHash('sha256').update(s).digest('hex'),validMachineCode:s=>/^[A-F0-9]{20}$/.test(s),sidForLicense:s=>s,createSessionToken:()=>({token:'fixture-token',expiresAt:'fixture'}),encryptDeviceCredential:()=> 'fixture-encrypted',getSession:r=>r.session,limited:()=>false,stopLive:async id=>stopped.push(id)});
const response=()=>({code:200,status(n){this.code=n;return this;},json(b){this.body=b;return this;}});
const order='b3df956e-1998-4322-b091-ac0c54f7b4ba';
const data={id:order,refId:'Ab12Cd3',status:'paid',product:{id:product},customer:{email:'buyer@example.invalid',docNumber:'PRIVATE_DOC_SENTINEL',name:'PRIVATE_NAME_SENTINEL'}};
const payload={secret,event:'purchase_approved',data};
async function webhook(body,options={}){const raw=options.raw||JSON.stringify(body),timestamp=String(options.timestamp||Math.floor(Date.now()/1000));const signature='v1='+crypto.createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');const r=response();await routes.get('/api/cakto/webhook')({body,rawBody:raw,headers:options.missing?{}:{'x-cakto-timestamp':timestamp,'x-cakto-signature':options.bad?'v1='+'0'.repeat(64):signature}},r);return r;}
async function claim(email,ref,machine){const r=response();await routes.get('/api/cakto/claim')({body:{email,order:ref,machine_code:machine},ip:'fixture'},r);return r;}
(async()=>{
 assert.equal(auto.configured,true);assert.equal(await auto.readyForClaims(),true);
 assert.equal((await webhook(payload,{bad:true})).code,401);
 assert.equal((await webhook(payload,{missing:true})).code,401,'secret alone cannot replace a signature');
 assert.equal((await webhook(payload,{timestamp:Math.floor(Date.now()/1000)-301})).code,401,'reject replay');
 const raw=JSON.stringify(payload,null,2);assert.equal((await webhook(payload,{raw})).code,200,'sign exact raw bytes');
 const id='CAKTO_'+order;assert.equal(rows.size,1);assert.equal(rows.get(id).expires_at,null);
 assert.equal((await webhook(payload)).code,200);assert.equal(rows.size,1);
 assert.equal((await webhook({...payload,event:'pix_gerado'})).body.ignored,'evento');
 assert.equal((await webhook({...payload,data:{...data,product:{id:'wrong-product'}}})).body.processed,0);
 assert.equal((await webhook({...payload,data:[{...data,product:{id:'other'}},data]})).body.processed,1,'V2 batches');
 assert.equal((await webhook({...payload,data:{...data,id:'short'}})).code,422);
 assert.equal((await claim('wrong@example.invalid',data.refId,machineA)).code,403);
 const activation=await claim(data.customer.email,'Ab12Cd3',machineA);assert.equal(activation.code,200);assert.match(activation.body.license_key,/^CKT1\./);
 assert.equal((await claim(data.customer.email,data.refId,machineB)).code,403);
 assert.equal((await auto.authorizeLicense(activation.body.license_key,machineA)).ok,true);
 assert.equal((await auto.releaseDevice(activation.body.license_key,machineA)).ok,true);
 assert.equal((await auto.authorizeLicense(activation.body.license_key,machineA)).ok,false);
 const next=await claim(data.customer.email,data.refId,machineB);assert.equal(next.code,200);
 assert.equal((await webhook({...payload,event:'refund',data:{...data,status:'refunded'}})).code,200);
 assert.equal((await auto.authorizeLicense(next.body.license_key,machineB)).ok,false);
 await webhook(payload);assert.equal(rows.get(id).state,'revoked');
 const denied=response();await middleware[0]({session:{licenseMode:'cakto',licenseInstanceId:id},headers:{'x-palcolive-device':machineB}},denied,()=>{throw Error('revoked passed');});assert.equal(denied.code,401);
 for(const value of [secret,data.customer.email,data.customer.docNumber,data.customer.name,order,next.body.license_key])assert.equal(logs.join('\n').includes(value),false);
 assert.ok(stopped.length>=2);
 console.log('PASS: Cakto signed raw body, replay rejection, V2 batch, approved order, lifetime, device transfer, refund, no private logs.');
})().catch(e=>{console.error(e);process.exitCode=1;});
