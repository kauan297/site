"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const js=fs.readFileSync("public/vendas.js","utf8");
const html=fs.readFileSync("public/vendas.html","utf8");
for(const name of ["salesCheckoutButton","salesCheckoutPending","salesCheckoutHeading","salesCheckoutDescription","salesCheckoutFootnote","salesNoticeText"]){
  assert.match(html,new RegExp('id="'+name+'"'));
}
async function test(config){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{id,style:{display:id==="salesCheckoutButton"?"none":""},textContent:"",href:"#"});
    return elements.get(id);
  };
  let calls=0;
  vm.runInNewContext(js,{
    document:{getElementById:element,querySelectorAll:()=>[]},
    fetch:async (url,options)=>{
      calls++;assert.equal(url,"/api/config");assert.equal(options.cache,"no-store");
      return {ok:true,json:async()=>config};
    },
    URL,console
  },{filename:"public/vendas.js",timeout:2000});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls,1);
  return {element};
}
(async()=>{
  const off=await test({salesReady:false,checkoutUrl:""});
  assert.equal(off.element("salesCheckoutButton").style.display,"none");
  assert.equal(off.element("salesCheckoutPending").style.display,"");
  const invalid=await test({salesReady:true,checkoutUrl:"https://pay.kiwify.com.br/zNBj6FP?hideCard=true&hidePix=true"});
  assert.equal(invalid.element("salesCheckoutButton").style.display,"none");
  const active=await test({salesReady:true,checkoutUrl:"https://pay.kiwify.com.br/zNBj6FP?hideCard=true"});
  assert.equal(active.element("salesCheckoutButton").style.display,"flex");
  assert.equal(active.element("salesCheckoutPending").style.display,"none");
  assert.equal(active.element("salesCheckoutButton").href,"https://pay.kiwify.com.br/zNBj6FP?hideCard=true");
  const cakto=await test({paymentProvider:"cakto",salesReady:true,checkoutUrl:"https://pay.cakto.com.br/abc1234"});
  assert.equal(cakto.element("salesCheckoutButton").style.display,"flex");
  assert.match(cakto.element("salesCheckoutDescription").textContent,/Cakto/);
  const originalUrl="https://pay.cakto.com.br/qmv857o_1198545";
  const original=await test({paymentProvider:"cakto",salesReady:true,checkoutUrl:originalUrl});
  assert.equal(original.element("salesCheckoutButton").style.display,"flex");
  assert.equal(original.element("salesCheckoutButton").href,originalUrl);
  for(const checkoutUrl of [originalUrl+"?coupon=private",originalUrl+"#x","https://pay.cakto.com.br.evil.com/qmv857o_1198545","https://user:pass@pay.cakto.com.br/qmv857o_1198545","https://pay.cakto.com.br/qmv857o_offer","https://pay.kiwify.com.br/qmv857o_1198545?hideCard=true"]){
    const invalidOriginal=await test({paymentProvider:checkoutUrl.includes("kiwify")?"kiwify":"cakto",salesReady:true,checkoutUrl});
    assert.equal(invalidOriginal.element("salesCheckoutButton").style.display,"none",checkoutUrl);
  }
  const privateCoupon=await test({paymentProvider:"cakto",salesReady:true,checkoutUrl:"https://pay.cakto.com.br/abc1234?coupon=private"});
  assert.equal(privateCoupon.element("salesCheckoutButton").style.display,"none");
  console.log("PASS: o checkout só aparece com resposta segura do servidor e Pix/boleto.");
})().catch(err=>{console.error(err);process.exitCode=1;});
