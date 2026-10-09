"use strict";
const $=id=>document.getElementById(id);
$("form").addEventListener("submit",async e=>{
  e.preventDefault();
  $("error").textContent="";
  $("result").hidden=true;
  $("status").textContent="Gerando licença...";
  const machine=$("machine").value.trim().toUpperCase();
  if(!/^[A-F0-9]{20}$/.test(machine)){ $("error").textContent="Código do aparelho inválido."; $("status").textContent=""; return; }
  $("emit").disabled=true;
  try{
    const response=await fetch("/api/admin/license",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-PalcoLive-Admin":$("admin").value},
      body:JSON.stringify({machine_code:machine,days:Number($("days").value),label:$("label").value.trim()})
    });
    const data=await response.json().catch(()=>({ok:false,error:"Resposta inválida do servidor."}));
    if(!response.ok||!data.ok) throw Error(data.error||"Não foi possível gerar a licença.");
    $("licenseOut").textContent=data.license_key;
    $("result").hidden=false;
    $("status").textContent="Licença gerada. Guarde o registro do pagamento e da data de vencimento.";
  }catch(err){
    $("status").textContent="";
    $("error").textContent=err.message||"Erro inesperado.";
  }finally{$("emit").disabled=false;}
});
$("copy").addEventListener("click",async()=>{
 const key=$("licenseOut").textContent;
 try{await navigator.clipboard.writeText(key);$("status").textContent="Licença copiada."}
 catch{$("status").textContent="Selecione a licença exibida e copie manualmente.";}
});
