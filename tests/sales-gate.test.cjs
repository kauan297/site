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
