"use strict";
const assert=require("node:assert/strict"),crypto=require("node:crypto"),vm=require("node:vm"),fs=require("node:fs");
const PRODUCT="40cf8850-c44b-11f1-8fdf-3f2670dd515f",SECRET="development-test-only-webhook-secret-123456";
const A="A1B2C3D4E5F60718293A",B="00112233445566778899";
const rows=new Map(),handlers=new Map(),middleware=[],stopped=[];
class Pool{
  async query(sql,p=[]){
    if(/^(CREATE TABLE|ALTER TABLE)/.test(sql))return{rowCount:0,rows:[]};
    if(sql.startsWith("INSERT INTO palcolive_kiwify_orders")){
      let [id,ref,product,email,state,expiration]=p,old=rows.get(id);
      if(old){old.state=old.state==="revoked"?"revoked":state;}
      else {old={order_id:id,order_ref:ref,product_id:product,email_digest:email,state,expires_at:expiration,device_digest:null};rows.set(id,old);}
      return{rowCount:1,rows:[{order_id:id,device_digest:old.device_digest,state:old.state}]};
    }
    if(sql.startsWith("SELECT 1 FROM palcolive_kiwify_orders")){
      const row=rows.get(p[0]),ok=row?.state==="paid"&&row.device_digest===p[1]&&(!row.expires_at||new Date(row.expires_at)>new Date());
      return{rowCount:ok?1:0,rows:ok?[{}]:[]};
    }
    if(sql.startsWith("UPDATE palcolive_kiwify_orders SET device_digest=NULL")){
      const row=rows.get(p[0]),ok=row&&row.device_digest===p[1]&&row.state==="paid";
      if(ok)row.device_digest=null;
      return{rowCount:ok?1:0,rows:[]};
    }
    throw Error("SQL desconhecido: "+sql.slice(0,130));
  }
  async connect(){
    return {release(){},query:async(sql,p=[])=>{
      if(["BEGIN","COMMIT","ROLLBACK"].includes(sql))return{rowCount:0,rows:[]};
      if(sql.startsWith("SELECT order_id, state, device_digest, expires_at")){
        const row=[...rows.values()].find(v=>v.email_digest===p[0]&&(v.order_id===p[1]||v.order_ref===p[1]));
        return{rowCount:row?1:0,rows:row?[{...row}]:[]};
      }
      if(sql.startsWith("UPDATE palcolive_kiwify_orders SET device_digest=$2")){
        const row=rows.get(p[0]);if(!row)throw Error("pedido ausente");row.device_digest=p[1];return{rowCount:1,rows:[]};
      }
      return this.query(sql,p);
    }};
  }
}
const ctx={module:{exports:{}},Buffer,Date,console,process:{env:{
KIWIFY_AUTO_ENABLED:"1",KIWIFY_PRODUCT_ID:PRODUCT,KIWIFY_WEBHOOK_TOKEN:SECRET,DATABASE_URL:"postgres://mock",KIWIFY_LICENSE_DAYS:"0",LICENSE_MODE:"manual",ROBLOX_PLACE_ID:"76605256587436"
}},require:n=>n==="pg"?{Pool}:n==="crypto"?crypto:(()=>{throw Error(n)})()};
vm.runInNewContext(fs.readFileSync("kiwify-auto.js","utf8"),ctx,{filename:"kiwify-auto.js",timeout:2000});
const auto=ctx.module.exports({
  app:{post(p,fn){handlers.set(p,fn);},use(p,fn){middleware.push(fn);}},
  sessionSecret:"this-is-a-test-secret-of-sufficient-length-1234",
  hashDevice:s=>crypto.createHash("sha256").update("palcolive-device:"+s).digest("hex"),
  validMachineCode:s=>/^[A-F0-9]{20}$/.test(s),
  sidForLicense:s=>crypto.createHash("sha256").update(s).digest("hex").slice(0,32),
  createSessionToken:()=>({token:"test-token",expiresAt:new Date(Date.now()+3600000).toISOString()}),
  encryptDeviceCredential:()=>"encrypted-test-credential",
  getSession:r=>r.session||null,
  limited:()=>false,stopLive:async sid=>{stopped.push(sid);}
});
assert.equal(auto.configured,true);
const res=()=>({code:200,status(n){this.code=n;return this;},json(d){this.body=d;return this;}});
async function post(path,body,signature=""){
  const r=res();
  await handlers.get(path)({body,rawBody:JSON.stringify(body),query:{signature},ip:"127.0.0.1",headers:{}},r);
  return r;
}
const sig=o=>crypto.createHmac("sha1",SECRET).update(JSON.stringify(o)).digest("hex");
const orderId="da292c35-c6fc-44e7-ad19-ff7865bc2d89";
const data={order_id:orderId,order_ref:"Quzqwus",order_status:"paid",webhook_event_type:"order_approved",Product:{product_id:PRODUCT},Customer:{email:"comprador@example.com"}};
const webhook=(body,signature=sig(body))=>post("/api/kiwify/webhook",body,signature);
const claim=(email,order,machine)=>post("/api/kiwify/claim",{email,order,machine_code:machine});
(async()=>{
  assert.equal((await webhook(data,"wrong")).code,401,"recusar assinatura falsa");
  assert.equal((await claim("comprador@example.com","Quzqwus",A)).code,403,"recusar pedido inexistente");
  const other={...data,Product:{product_id:"00000000-0000-0000-0000-000000000000"}};
  assert.equal((await webhook(other)).body.ignored,"produto","outro produto ignorado");
  assert.equal((await webhook(data)).code,200);
  assert.equal(rows.get(orderId).state,"paid");
  assert.equal(rows.get(orderId).expires_at,null,"sem prazo de expiração");
  assert.equal((await claim("outra@example.com","Quzqwus",A)).code,403,"e-mail incorreto");
  const activated=await claim("comprador@example.com","Quzqwus",A);
  assert.equal(activated.code,200);
  assert.equal(activated.body.place_id,"76605256587436");
  assert.match(activated.body.license_key,/^KWF1\./);
  assert.equal((await claim("comprador@example.com","Quzqwus",B)).code,403,"uma licença por dispositivo");
  assert.equal((await auto.authorizeLicense(activated.body.license_key,A)).ok,true);
  assert.equal((await auto.authorizeLicense(activated.body.license_key,B)).ok,false);
  const refund={...data,webhook_event_type:"order_refunded",order_status:"refunded"};
  assert.equal((await webhook(refund)).code,200,"aceitar reembolso assinado");
  assert.equal(rows.get(orderId).state,"revoked");
  assert.equal(stopped.length,1,"parar LIVE revogada");
  assert.equal((await auto.authorizeLicense(activated.body.license_key,A)).ok,false);
  assert.equal((await claim("comprador@example.com",orderId,A)).code,403);
  assert.equal((await webhook(data)).code,200,"aceitar webhook repetido");
  assert.equal(rows.get(orderId).state,"revoked","não reativar após reembolso");
  const result=res();
  await middleware[0]({session:{licenseMode:"kiwify",licenseInstanceId:orderId},headers:{"x-palcolive-device":A}},result,()=>{throw Error("token revogado passou")});
  assert.equal(result.code,401,"token já emitido precisa ser bloqueado");
  console.log("PASS: webhook assinado, produto, compra, email, dispositivo, licença sem prazo, reembolso e bloqueio.");
})().catch(e=>{console.error(e);process.exitCode=1;});
