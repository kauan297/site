"use strict";
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Pool}=require('pg'),createAuto=require('../cakto-auto'),backup=require('../scripts/license-backup.cjs');
const url=process.env.TEST_DATABASE_URL||'',parsed=new URL(url);
if(process.env.PALCOLIVE_DISPOSABLE_DATABASE!=='1'||parsed.hostname!=='localhost'||parsed.pathname!=='/palcolive_disposable_test')throw Error('Requires disposable local test PostgreSQL.');
const pool=new Pool({connectionString:url}),secret='fixture-cakto-session-secret-only-12345',webhookSecret='fixture-cakto-webhook-secret-only-12345';
const product='42011b46-5012-47a2-b2b1-599590c5a6da',email='cakto-fixture@example.invalid',a='A1B2C3D4E5F60718293A',b='00112233445566778899';
Object.assign(process.env,{CAKTO_AUTO_ENABLED:'1',CAKTO_PRODUCT_ID:product,CAKTO_WEBHOOK_SECRET:webhookSecret,CAKTO_LICENSE_DAYS:'0',CAKTO_DATABASE_URL:url,LICENSE_MODE:'manual',PGSSLMODE:'disable'});
const routes=new Map(),middleware=[],stopped=[];
const auto=createAuto({app:{post:(p,f)=>routes.set(p,f),use:(p,f)=>middleware.push(f)},sessionSecret:secret,hashDevice:s=>crypto.createHash('sha256').update(s).digest('hex'),validMachineCode:s=>/^[A-F0-9]{20}$/.test(s),sidForLicense:s=>s,createSessionToken:()=>({token:'fixture-token',expiresAt:'fixture'}),encryptDeviceCredential:()=> 'fixture-encrypted',getSession:r=>r.session,limited:()=>false,stopLive:async id=>stopped.push(id)});
const response=()=>({code:200,status(n){this.code=n;return this;},json(b){this.body=b;return this;}});
async function post(path,body){const rawBody=JSON.stringify(body),timestamp=String(Math.floor(Date.now()/1000)),signature='v1='+crypto.createHmac('sha256',webhookSecret).update(timestamp+'.'+rawBody).digest('hex');const r=response();await routes.get(path)({body,rawBody,headers:{'x-cakto-timestamp':timestamp,'x-cakto-signature':signature},ip:'fixture'},r);return r;}
const id=crypto.randomUUID(),storedId='CAKTO_'+id,ref='caktoFixtureRef';
const sale={event:'purchase_approved',secret:webhookSecret,data:{id,refId:ref,status:'paid',customer:{email,docNumber:'private-document-not-stored'},product:{id:product}}};
const claim=machine=>post('/api/cakto/claim',{email,order:ref,machine_code:machine});
(async()=>{
 assert.equal(await auto.readyForClaims(),true);
 await post('/api/cakto/webhook',sale);
 const digest=crypto.createHmac('sha256',secret).update('email:'+email).digest('hex');
 await pool.query("INSERT INTO palcolive_kiwify_orders (order_id,order_ref,product_id,email_digest,state) VALUES ($1,$2,$3,$4,'paid')",[crypto.randomUUID(),ref,product,digest]);
 const results=await Promise.all([claim(a),claim(b)]);assert.deepEqual(results.map(r=>r.code).sort(),[200,403]);
 const win=results[0].code===200?0:1,machine=win===0?a:b,nextMachine=win===0?b:a;
 const key=results[win].body.license_key;
 assert.equal((await auto.authorizeLicense(key,machine)).ok,true);
 assert.equal((await pool.query('SELECT expires_at FROM palcolive_kiwify_orders WHERE order_id=$1',[storedId])).rows[0].expires_at,null);
 const client=await pool.connect();try{const snapshot=await backup.exportSnapshot(client,secret);const encrypted=backup.encrypt(snapshot,'a'.repeat(64));assert.equal(backup.decrypt(encrypted,'a'.repeat(64)).orders.filter(o=>o.order_id===storedId).length,1);}finally{client.release();}
 assert.equal((await auto.releaseDevice(key,machine)).ok,true);
 assert.equal((await auto.authorizeLicense(key,machine)).ok,false);
 const moved=await claim(nextMachine);assert.equal(moved.code,200);
 await post('/api/cakto/webhook',{...sale,event:'refund',data:{...sale.data,status:'refunded'}});
 assert.equal((await auto.authorizeLicense(moved.body.license_key,nextMachine)).ok,false);
 await post('/api/cakto/webhook',sale);assert.equal((await claim(nextMachine)).code,403);
 const denied=response();await middleware[0]({session:{licenseMode:'cakto',licenseInstanceId:storedId},headers:{'x-palcolive-device':nextMachine}},denied,()=>{throw Error('Revoked passed');});assert.equal(denied.code,401);
 assert.ok(stopped.length>=2);
 console.log('PASS: real PostgreSQL Cakto race, legacy-ref isolation, lifetime, encrypted backup, transfer and refund revocation.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await auto.close();await pool.end();});
