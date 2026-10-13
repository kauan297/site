"use strict";
const assert=require("node:assert/strict");
const {validateCheckoutUrl,publicSalesState}=require("../sales-gate");
const url="https://pay.kiwify.com.br/zNBj6FP?hideCard=true";
const params={checkoutUrl:url,checkoutCode:"zNBj6FP"};
assert.equal(validateCheckoutUrl(url,"zNBj6FP"),url);
for(const bad of [
"https://pay.kiwify.com.br/zNBj6FP",
"https://pay.kiwify.com.br/zNBj6FP?hidePix=true",
"https://pay.kiwify.com.br/zNBj6FP?hideCard=false",
"https://pay.kiwify.com.br/zNBj6FP?hideCard=true&hideBoleto=true",
"https://pay.kiwify.com.br/zNBj6FP?hideCard=true#abc",
"https://pay.kiwify.com.br/OUTRA1?hideCard=true",
"https://pay.kiwify.com.br.evil.com/zNBj6FP?hideCard=true",
"http://pay.kiwify.com.br/zNBj6FP?hideCard=true",
"https://usuario:senha@pay.kiwify.com.br/zNBj6FP?hideCard=true"
])assert.equal(validateCheckoutUrl(bad,"zNBj6FP"),"",bad);
const off=publicSalesState({...params,enabled:false,automaticReady:true});
assert.equal(off.salesReady,false);
assert.equal(off.checkoutUrl,"");
const noDb=publicSalesState({...params,enabled:true,automaticReady:false});
assert.equal(noDb.salesReady,false);
assert.equal(noDb.checkoutUrl,"");
const published=publicSalesState({...params,enabled:true,automaticReady:true});
assert.equal(published.salesReady,true);
assert.equal(published.checkoutUrl,url);
console.log("PASS: vendas bloqueadas por padrão, checkout apenas Kiwify Pix/boleto e link validado.");

const caktoUrl="https://pay.cakto.com.br/abc1234";
assert.equal(validateCheckoutUrl(caktoUrl,"abc1234","cakto"),caktoUrl);
const originalCaktoCode="qmv857o_1198545";
const originalCaktoUrl="https://pay.cakto.com.br/"+originalCaktoCode;
assert.equal(validateCheckoutUrl(originalCaktoUrl,originalCaktoCode,"cakto"),originalCaktoUrl);
assert.equal(publicSalesState({provider:"cakto",checkoutUrl:originalCaktoUrl,checkoutCode:originalCaktoCode,enabled:true,automaticReady:true}).checkoutUrl,originalCaktoUrl);
for(const code of ["qmv857o_offer","qmv857o_","qmv857o_1198545_extra","qmv857o/1198545","qmv857o_1234567890123"]){
  assert.equal(validateCheckoutUrl("https://pay.cakto.com.br/"+code,code,"cakto"),"");
}
for(const bad of [originalCaktoUrl+"?coupon=private",originalCaktoUrl+"#x","https://pay.cakto.com.br.evil.com/"+originalCaktoCode,"https://user:pass@pay.cakto.com.br/"+originalCaktoCode,"https://pay.cakto.com.br:444/"+originalCaktoCode]){
  assert.equal(validateCheckoutUrl(bad,originalCaktoCode,"cakto"),"");
}
assert.equal(validateCheckoutUrl("https://pay.kiwify.com.br/"+originalCaktoCode+"?hideCard=true",originalCaktoCode,"kiwify"),"");
for(const bad of [caktoUrl+"?coupon=private",caktoUrl+"#x","https://pay.cakto.com.br.evil.com/abc1234","https://user:pass@pay.cakto.com.br/abc1234","https://pay.cakto.com.br:444/abc1234"]){assert.equal(validateCheckoutUrl(bad,"abc1234","cakto"),"");}
assert.equal(publicSalesState({provider:"cakto",checkoutUrl:caktoUrl,checkoutCode:"abc1234",enabled:true,automaticReady:false}).salesReady,false);
assert.equal(publicSalesState({provider:"cakto",checkoutUrl:caktoUrl,checkoutCode:"abc1234",enabled:true,automaticReady:true}).checkoutUrl,caktoUrl);
