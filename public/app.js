const $ = (id)=>document.getElementById(id);
const STORAGE = {
  machine:"palcolive_machine_v1",
  credential:"palcolive_credential_v1",
  username:"palcolive_tiktok_username",
  gifts:"palcolive_gifts_v1"
};
let session = null;
let liveConnected = false;
let pollTimer = null;
let mobileMode = localStorage.getItem("palcolive_mobile_mode") || "";
let liveWanted = localStorage.getItem("palcolive_live_wanted") === "1";
let autoRecovering = false;

function machineCode(){
  let v=localStorage.getItem(STORAGE.machine);
  if(v && /^[A-F0-9]{20}$/.test(v)) return v;
  const a=new Uint8Array(10); crypto.getRandomValues(a);
  v=[...a].map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
  localStorage.setItem(STORAGE.machine,v); return v;
}
function gifts(){
  try{return JSON.parse(localStorage.getItem(STORAGE.gifts))||defaultGifts()}catch{return defaultGifts()}
}
function defaultGifts(){return {gigante:"Rose",gigante_dourado:"Finger Heart",mega_fogo:"Rosa",reset:"Galaxy"}}
function username(){return (localStorage.getItem(STORAGE.username)||"").trim().replace(/^@/,"")}
function msg(text,kind="info"){
  $("message").textContent=text;
  $("messageTitle").textContent=kind==="ok"?"TUDO CERTO":kind==="error"?"ERRO":kind==="warn"?"ATENÇÃO":"INFORMAÇÃO";
  $("messageTitle").className=kind==="ok"?"ok":kind==="error"?"bad":kind==="warn"?"warn":"";
}
function setStatus(id,text,kind=""){
  const el=$(id);el.textContent=text;el.className=kind;
}
function isMobile(){
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia("(max-width: 680px)").matches;
}
function applyMobileFlow(mode){
  mobileMode=mode||"";
  if(mobileMode) localStorage.setItem("palcolive_mobile_mode",mobileMode);
  if(!isMobile()) return;

  $("flowTitle").textContent = mobileMode==="two" ? "Mobile com 2 celulares" : "Mobile com 1 celular";
  $("flowHint").textContent = mobileMode==="two"
    ? "Celular A transmite o Roblox. Neste celular, configure e conecte a LIVE."
    : "Primeiro inicie a LIVE no TikTok com jogo/tela. Depois volte aqui: configure, conecte a LIVE e abra o Roblox.";

  const parent=$("mainCard");
  const setup=$("setupBtn"), live=$("liveBtn"), roblox=$("openRobloxBtn");

  if(mobileMode==="two"){
    setup.querySelector("span").textContent="1";
    live.querySelector("span").textContent="2";
    roblox.querySelector("span").textContent="3";
    setup.querySelector("b").textContent="CONFIGURAÇÃO INICIAL";
    live.querySelector("small").textContent="deixe comentários e presentes conectados";
    roblox.querySelector("small").textContent="use no celular que vai transmitir o jogo";
  }else{
    setup.querySelector("span").textContent="1";
    live.querySelector("span").textContent="2";
    roblox.querySelector("span").textContent="3";
    live.querySelector("small").textContent="conecte antes de sair deste painel";
    roblox.querySelector("small").textContent="abre o Roblox depois da LIVE conectada";
  }
  parent.insertBefore(setup,parent.querySelector(".split"));
  parent.insertBefore(live,parent.querySelector(".split"));
  parent.insertBefore(roblox,parent.querySelector(".split"));
}
async function api(path,body={},token=""){
  const headers={"Content-Type":"application/json","X-PalcoLive-Device":machineCode()};
  if(token) headers.Authorization="Bearer "+token;
  const r=await fetch(path,{method:"POST",headers,body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({ok:false,error:"Resposta inválida do servidor."}));
  if(!r.ok && !data.error) data.error="HTTP "+r.status;
  return data;
}
async function config(){
  try{
    const r=await fetch("/api/config",{cache:"no-store"}); const d=await r.json();
    setStatus("stServer","online","ok");
    if(!d.tiktokReady) msg("Servidor online. Falta apenas configurar a chave do provedor TikTok no Render.","warn");
    return d;
  }catch{setStatus("stServer","offline","bad");return null}
}
async function login(){
  const credential=localStorage.getItem(STORAGE.credential);
  if(!credential) return null;
  const d=await api("/api/login-device",{device_credential:credential,machine_code:machineCode()});
  if(d.ok){session=d;setStatus("stLicense","ativa","ok");return d}
  localStorage.removeItem(STORAGE.credential); session=null; return null;
}
async function ensureSession(){
  if(session?.session_token) return session;
  return await login();
}
function applyMainState(active){
  $("activationCard").classList.toggle("hidden",active);
  $("mainCard").classList.toggle("hidden",!active);
  if(active) setStatus("stLicense","ativa","ok"); else setStatus("stLicense","pendente","warn");
  const u=username();
  setStatus("stTikTok",u?"@"+u:"configurar",u?"":"warn");
}
$("activateBtn").addEventListener("click",async()=>{
  const key=$("licenseInput").value.trim();
  if(!key){msg("Digite a licença.","warn");return}
  $("activateBtn").disabled=true;$("activateBtn").textContent="ATIVANDO...";
  msg("Ativando neste aparelho...");
  try{
    const d=await api("/api/activate",{license_key:key,machine_code:machineCode()});
    if(!d.ok) throw new Error(d.error||"Falha na ativação.");
    if(!d.device_credential) throw new Error("Servidor não retornou a credencial segura.");
    localStorage.setItem(STORAGE.credential,d.device_credential);
    session=d;$("licenseInput").value="";
    applyMainState(true);msg("Ativado. Faça a configuração inicial.","ok");
  }catch(e){msg(e.message,"error")}
  finally{$("activateBtn").disabled=false;$("activateBtn").textContent="ATIVAR"}
});
$("setupBtn").addEventListener("click",()=>{
  const g=gifts();
  $("tiktokUser").value=username();
  $("giftGrande").value=g.gigante;
  $("giftDourado").value=g.gigante_dourado;
  $("giftFogo").value=g.mega_fogo;
  $("giftReset").value=g.reset;
  $("setupDialog").showModal();
});
$("setupForm").addEventListener("submit",(e)=>{
  e.preventDefault();
  const u=$("tiktokUser").value.trim().replace(/^@/,"");
  if(!/^[A-Za-z0-9._]{2,24}$/.test(u)){msg("Digite um @ do TikTok válido.","warn");return}
  const g={
    gigante:$("giftGrande").value.trim(),
    gigante_dourado:$("giftDourado").value.trim(),
    mega_fogo:$("giftFogo").value.trim(),
    reset:$("giftReset").value.trim()
  };
  if(Object.values(g).some(v=>!v)){msg("Escolha os 4 presentes.","warn");return}
  if(new Set(Object.values(g).map(v=>v.toLowerCase())).size<4){msg("Use um presente diferente para cada efeito.","warn");return}
  localStorage.setItem(STORAGE.username,u);
  localStorage.setItem(STORAGE.gifts,JSON.stringify(g));
  $("setupDialog").close();
  setStatus("stTikTok","@"+u,"");
  msg("Configuração salva. Agora abra o palco Roblox.","ok");
});
$("onePhoneBtn").addEventListener("click",()=>{
  applyMobileFlow("one");
  msg("Modo 1 celular selecionado. Inicie a LIVE no TikTok com transmissão de jogo/tela; depois volte aqui, conecte a LIVE e abra o Roblox.","ok");
});
$("twoPhoneBtn").addEventListener("click",()=>{
  applyMobileFlow("two");
  msg("Modo 2 celulares selecionado. Deixe este celular como painel e use o outro para Roblox + transmissão.","ok");
});
$("openRobloxBtn").addEventListener("click",async()=>{
  const s=await ensureSession(); if(!s){applyMainState(false);msg("Ative novamente neste aparelho.","warn");return}
  const place=s.place_id, room=s.room_id;
  if(!place||!room){msg("Servidor não retornou o palco.","error");return}
  if(isMobile() && mobileMode!=="two" && !liveConnected){
    const go=confirm("No modo 1 celular, o ideal é CONECTAR A LIVE antes de abrir o Roblox.\n\nQuer abrir o Roblox mesmo assim?");
    if(!go) return;
  }
  msg("Abrindo o Roblox. No celular, aceite abrir o app Roblox.");
  window.location.href="https://www.roblox.com/games/start?placeId="+encodeURIComponent(place)+"&launchData="+encodeURIComponent(room);
});
async function updateLiveStatus(){
  const s=await ensureSession(); if(!s)return;
  const d=await api("/api/tiktok/status",{},s.session_token);
  liveConnected=!!d.connected;

  if(liveConnected){
    setStatus("stLive","ativa","ok");
    $("liveBtnText").textContent="DESCONECTAR LIVE";
    setStatus("stTikTok","conectado","ok");
    return;
  }

  const status=String(d.status||"stopped");
  setStatus("stLive",status==="reconnecting"?"reconectando":"parada",status==="reconnecting"?"warn":"");
  $("liveBtnText").textContent=status==="reconnecting"?"RECONECTANDO...":"CONECTAR LIVE";

  if(liveWanted && status==="stopped" && !autoRecovering && username()){
    autoRecovering=true;
    try{
      const r=await api("/api/tiktok/start",{username:username(),gifts:gifts()},s.session_token);
      if(r.ok){
        liveConnected=true;
        setStatus("stLive","ativa","ok");
        setStatus("stTikTok","conectado","ok");
        $("liveBtnText").textContent="DESCONECTAR LIVE";
        msg("LIVE reconectada automaticamente.","ok");
      }
    }finally{autoRecovering=false}
  }
}
$("liveBtn").addEventListener("click",async()=>{
  const s=await ensureSession(); if(!s){applyMainState(false);msg("Ative novamente.","warn");return}
  if(liveConnected){
    const d=await api("/api/tiktok/stop",{},s.session_token);
    liveWanted=false;localStorage.removeItem("palcolive_live_wanted");
    liveConnected=false;setStatus("stLive","parada","");$("liveBtnText").textContent="CONECTAR LIVE";
    setStatus("stTikTok",username()?"@"+username():"configurar","");
    msg(d.ok?"Live desconectada.":(d.error||"Falha ao desconectar."),d.ok?"ok":"error"); return;
  }
  const u=username(); if(!u){$("setupBtn").click();msg("Configure o @ do TikTok primeiro.","warn");return}
  $("liveBtn").disabled=true;$("liveBtnText").textContent="CONECTANDO...";
  msg("Conectando à LIVE. Ela precisa já estar pública e ao vivo.");
  const d=await api("/api/tiktok/start",{username:u,gifts:gifts()},s.session_token);
  $("liveBtn").disabled=false;
  if(!d.ok){$("liveBtnText").textContent="CONECTAR LIVE";msg(d.error||"Não foi possível conectar.","error");return}
  liveWanted=true;localStorage.setItem("palcolive_live_wanted","1");
  liveConnected=true;setStatus("stLive","ativa","ok");setStatus("stTikTok","conectado","ok");
  $("liveBtnText").textContent="DESCONECTAR LIVE";
  msg("LIVE conectada. Agora um viewer pode comentar o nick Roblox.","ok");
});
$("testBtn").addEventListener("click",async()=>{
  const s=await ensureSession(); if(!s){applyMainState(false);return}
  const d=await api("/api/comment",{nick:"Knzz0102"},s.session_token);
  msg(d.ok?"Teste enviado. Procure o avatar Knzz0102 no palco.":(d.error||"Falha no teste."),d.ok?"ok":"error");
});
$("forgetBtn").addEventListener("click",()=>{
  if(!confirm("Sair do PalcoLive neste aparelho?"))return;
  localStorage.removeItem(STORAGE.credential);session=null;liveConnected=false;applyMainState(false);msg("Este aparelho saiu do PalcoLive.");
});
async function boot(){
  await config();
  const ok=await login();
  applyMainState(!!ok);
  if(isMobile()){
    applyMobileFlow(mobileMode || "one");
    $("mobileCard").classList.remove("hidden");
  }
  if(ok){
    msg(isMobile()
      ? "Pronto. No celular, inicie a LIVE com jogo/tela, conecte aqui e depois abra o Roblox."
      : "Pronto. Abra o palco e conecte sua LIVE.","ok");
    await updateLiveStatus()
  }
  pollTimer=setInterval(()=>{if(session)updateLiveStatus().catch(()=>{})},5000);
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
boot();
