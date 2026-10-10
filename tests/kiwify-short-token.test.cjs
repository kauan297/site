"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("kiwify-auto.js","utf8");
const product = "40cf8850-c44b-11f1-8fdf-3f2670dd515f";

function start(secret) {
  const handlers = new Map();
  const mockPool = class { async query(){return {rowCount:1,rows:[{}]};} };
  const ctx = {
    module: {exports:{}}, Buffer, console, Date,
    process: {env: {
      KIWIFY_AUTO_ENABLED:"1",
      LICENSE_MODE:"manual",
      KIWIFY_PRODUCT_ID:product,
      KIWIFY_WEBHOOK_TOKEN:secret,
      DATABASE_URL:"postgres://mock",
      KIWIFY_LICENSE_DAYS:"0"
    }},
    require: name => name==="crypto" ? crypto : name==="pg" ? {Pool:mockPool} : (()=>{throw Error(name);})()
  };
  vm.runInNewContext(source, ctx, {timeout:2000});
  const auto=ctx.module.exports({
    app: {post:(p,fn)=>handlers.set(p,fn),use:()=>{}},
    sessionSecret:"unit-test-license-key",
    hashDevice:()=>"",
    validMachineCode:()=>true,
    sidForLicense:()=>"",
    createSessionToken:()=>({}),
    encryptDeviceCredential:()=>"",
    getSession:()=>null,
    limited:()=>false,
    stopLive:async()=>{}
  });
  return {auto,handlers};
}
async function webhook(session,body,sig) {
  const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  await session.handlers.get("/api/kiwify/webhook")({
    body,rawBody:JSON.stringify(body),query:{signature:sig},headers:{}
  },res);
  return res;
}
(async()=>{
  for(const short of ["Kiwify8A","KiwifyToken12345"]) {
    const instance=start(short);
    assert.equal(instance.auto.configured,true,"aceitar token Kiwify gerado: "+short.length);
    const body={order_id:"ignored-id",Product:{product_id:"outro-produto"}};
    const signed=crypto.createHmac("sha1",short).update(JSON.stringify(body)).digest("hex");
    assert.equal((await webhook(instance,body,signed)).code,200,"assinatura correta aceita");
    assert.equal((await webhook(instance,body,"0".repeat(40))).code,401,"assinatura falsa recusada");
    assert.equal((await webhook(instance,body,"")).code,401,"sem assinatura recusada");
  }
  for(const invalid of ["","1234567"," token-espaco"," " + "X".repeat(15), "X".repeat(513)]) {
    const instance=start(invalid);
    assert.equal(instance.auto.configured,false,"recusar token vazio, muito curto, espaço ou muito longo");
  }
  console.log("PASS: tokens gerados pela Kiwify de 8-16 caracteres, HMAC e entradas inválidas.");
})().catch(e=>{console.error(e);process.exitCode=1;});
