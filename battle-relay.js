'use strict';
const crypto=require('node:crypto');
const express=require('express');
const WebSocket=require('ws');
const normalize=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f\u200b-\u200d\ufeff]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
function giftFromEvent(event){
 const type=String(event?.type||event?.event||'').toLowerCase();if(!type.includes('gift'))return null;
 const d=event.data||event.payload||event,g=d.giftDetails||d.gift||d.extendedGiftInfo||{};
 const end=d.repeatEnd??d.repeat_end;
 if(Number(d.giftType??d.gift_type??g.giftType)===1&&[false,0,'0','false'].includes(end))return null;
 const name=normalize(d.giftName||d.gift_name||g.giftName||g.name);
 const target=['rose','rosa'].includes(name)?'lula':['white rose','rosa branca'].includes(name)?'bolsonaro':null;if(!target)return null;
 const quantity=Math.trunc(Number(d.repeatCount??d.repeat_count??d.giftCount??1));if(!Number.isFinite(quantity)||quantity<1)return null;
 const u=d.user||d.fromUser||{};
 const viewer={uniqueId:String(u.uniqueId||u.displayId||d.uniqueId||'').slice(0,28),nickname:String(u.nickname||d.nickname||'Visitante').slice(0,28),profilePictureUrl:String(u.profilePictureUrl||d.profilePictureUrl||u.avatarThumb?.urlList?.[0]||u.avatarThumb?.url_list?.[0]||u.avatarMedium?.urlList?.[0]||'').slice(0,2048)};
 const group=d.groupId??d.group_id,common=d.common||{};
 const id=group?`group:${u.id||u.userId||viewer.uniqueId}:${d.giftId||g.id||name}:${group}`:String(common.msgId||common.msg_id||d.msgId||d.eventId||'');
 return {target,quantity:Math.min(1000,quantity),viewer,id};
}
function unpack(packet){if(Array.isArray(packet))return packet.flatMap(unpack);if(Array.isArray(packet?.messages))return packet.messages.flatMap(unpack);if(Array.isArray(packet?.events))return packet.events.flatMap(unpack);return packet?[packet]:[];}
function createBattleRelay({apiKey,accessHash,origin,WebSocketClass=WebSocket}){
 const router=express.Router(),clients=new Set(),seen=new Map(),history=[];
 const epoch=crypto.randomUUID();let seq=0,ws=null,desired=false,retryTimer=null,idleTimer=null,heartbeat=null,confirmTimer=null,retries=0;
 let state={status:'stopped',username:'',message:'TikTok desconectado',received:0,lastGiftAt:null};
 const starts=new Map();
 function snapshot(){return {...state,ready:Boolean(apiKey),epoch,seq};}
 function send(client,data){if(!client.destroyed)client.write('data: '+JSON.stringify(data)+'\n\n');}
 function broadcast(data){for(const client of clients)send(client,data);}
 function status(status,message){state.status=status;state.message=message;broadcast({kind:'status',...snapshot()});}
 function cleanupSocket(){clearInterval(heartbeat);clearTimeout(confirmTimer);heartbeat=null;confirmTimer=null;if(ws){const old=ws;ws=null;old.removeAllListeners();try{old.terminate();}catch{}}}
 function stop(){desired=false;clearTimeout(retryTimer);clearTimeout(idleTimer);retryTimer=null;idleTimer=null;cleanupSocket();status('stopped','TikTok desconectado');}
 function connect(){
  if(!desired)return;cleanupSocket();status(retries?'reconnecting':'connecting',retries?'Reconectando ao TikTok…':'Aguardando confirmação da LIVE…');
  const url=new URL('wss://ws.eulerstream.com');url.searchParams.set('uniqueId',state.username);url.searchParams.set('apiKey',apiKey);url.searchParams.set('features.bundleEvents','true');url.searchParams.set('features.schemaVersion','v2');
  let socket;try{socket=new WebSocketClass(url.toString(),{handshakeTimeout:15000,maxPayload:2*1024*1024});}catch{status('error','Não foi possível abrir a conexão TikTok.');desired=false;return;}ws=socket;
  let alive=true;
  function connected(){if(state.status!=='connected'){clearTimeout(confirmTimer);retries=0;status('connected','LIVE conectada · recebendo presentes');}}
  socket.on('open',()=>{
   if(ws!==socket)return;
   confirmTimer=setTimeout(()=>{if(ws===socket&&state.status!=='connected'){desired=false;cleanupSocket();status('error','A LIVE não confirmou a conexão. Confira se ela já está pública e ao vivo.');}},30000);confirmTimer.unref?.();
   heartbeat=setInterval(()=>{if(ws!==socket)return;if(!alive){socket.terminate();return;}alive=false;try{socket.ping();}catch{}},20000);heartbeat.unref?.();
  });
  socket.on('pong',()=>{alive=true;});
  socket.on('message',raw=>{
   if(ws!==socket)return;alive=true;let packet;try{packet=JSON.parse(String(raw));}catch{return;}
   for(const event of unpack(packet)){
    if(!desired||ws!==socket)break;
    const type=String(event.type||event.event||'').toLowerCase(),d=event.data||event.payload||{};
    if(type==='room.status'||type==='roomstatus'){
     if(d.state==='connected')connected();
     else if(['offline','ended','error'].includes(d.state)){desired=false;cleanupSocket();status(d.state==='error'?'error':'offline',d.state==='error'?'O provedor recusou a conexão.':'A conta não está ao vivo ou a LIVE terminou.');}
     else if(['connecting','reconnecting'].includes(d.state))status(d.state,'Aguardando conexão com a LIVE…');
     continue;
    }
    if(['tiktok.connect','connect','connected'].includes(type)||type.startsWith('webcast'))connected();
    const gift=giftFromEvent(event);if(!gift)continue;connected();
    const now=Date.now();for(const [id,time]of seen)if(now-time>600000)seen.delete(id);
    if(gift.id&&seen.has(gift.id))continue;if(gift.id)seen.set(gift.id,now);while(seen.size>5000)seen.delete(seen.keys().next().value);
    const message={kind:'gift',epoch,seq:++seq,target:gift.target,quantity:gift.quantity,viewer:gift.viewer,at:now};
    history.push(message);while(history.length>300)history.shift();state.received++;state.lastGiftAt=new Date(now).toISOString();broadcast(message);
   }
  });
  socket.on('error',()=>{}); // Never forward error URLs, which contain the upstream API key.
  socket.on('close',code=>{
   if(ws!==socket)return;cleanupSocket();if(!desired)return;
   const terminal={4005:['offline','A LIVE terminou.'],4401:['error','O acesso TikTok do servidor foi recusado.'],4403:['error','O provedor não autorizou esta conexão.'],4404:['offline','Esta conta ainda não está ao vivo.'],4429:['error','Limite de conexões do provedor atingido. Desconecte outra LIVE e tente novamente.']};
   if(terminal[code]){desired=false;status(...terminal[code]);return;}
   retries++;status('reconnecting','A conexão caiu. Reconectando automaticamente…');retryTimer=setTimeout(()=>{retryTimer=null;connect();},Math.min(30000,1500*2**Math.min(retries-1,4)));retryTimer.unref?.();
  });
 }
 router.use((req,res,next)=>{
  const requestOrigin=req.get('Origin');if(requestOrigin&&requestOrigin!==origin)return res.status(403).json({ok:false,error:'Origem não autorizada.'});
  if(requestOrigin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
  res.setHeader('Cache-Control','no-store');if(req.method==='OPTIONS')return res.sendStatus(204);
  const token=String(req.get('Authorization')||'').replace(/^Bearer /,'');const hash=crypto.createHash('sha256').update(token).digest('hex');
  if(!accessHash||!token||hash.length!==accessHash.length||!crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(accessHash)))return res.status(401).json({ok:false,error:'Abra o link de acesso do seu jogo neste navegador.'});
  next();
 });
 router.get('/status',(req,res)=>res.json({ok:true,...snapshot()}));
 router.get('/events',(req,res)=>{
  if(clients.size>=3)return res.status(429).json({ok:false,error:'Já há três telas conectadas. Feche outra aba do jogo.'});
  clearTimeout(idleTimer);idleTimer=null;res.setHeader('Content-Type','text/event-stream');res.setHeader('Connection','keep-alive');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();clients.add(res);
  const after=Number(req.query.after),same=req.query.epoch===epoch;
  if(same&&Number.isSafeInteger(after)&&after>=0){const first=history[0]?.seq||seq+1;if(after<first-1||history.some(event=>event.seq>after&&Date.now()-event.at>=30000))send(res,{kind:'gap',message:'Alguns presentes podem ter sido perdidos durante a queda de conexão.'});for(const event of history)if(event.seq>after&&Date.now()-event.at<30000)send(res,event);}
  send(res,{kind:'hello',...snapshot()});
  const keepalive=setInterval(()=>{if(!res.destroyed)res.write(': keepalive\n\n');},15000);keepalive.unref?.();
  res.on('close',()=>{clearInterval(keepalive);clients.delete(res);if(!clients.size){idleTimer=setTimeout(()=>{if(!clients.size)stop();},90000);idleTimer.unref?.();}});
 });
 router.post('/start',(req,res)=>{
  const username=String(req.body?.username||'').trim().replace(/^@/,'');if(!/^[A-Za-z0-9._]{2,24}$/.test(username))return res.status(400).json({ok:false,error:'Digite apenas o @ da sua conta TikTok.'});
  if(!apiKey)return res.status(503).json({ok:false,error:'O acesso TikTok ainda não está configurado no servidor.'});
  if(!clients.size)return res.status(409).json({ok:false,error:'A tela do jogo precisa estar conectada antes de iniciar.'});
  if(desired&&state.username===username)return res.json({ok:true,...snapshot()});
  const now=Date.now();for(const [key,value]of starts)if(now-value.at>300000)starts.delete(key);const ip=String(req.ip||'unknown'),bucket=starts.get(ip)||{at:now,count:0};bucket.count++;starts.set(ip,bucket);if(bucket.count>5)return res.status(429).json({ok:false,error:'Muitas tentativas. Aguarde cinco minutos antes de reconectar.'});
  stop();seen.clear();history.length=0;state.username=username;state.received=0;state.lastGiftAt=null;desired=true;retries=0;connect();return res.json({ok:true,...snapshot()});
 });
 router.post('/stop',(req,res)=>{stop();res.json({ok:true,...snapshot()});});
 return {router,close(){stop();for(const client of clients)client.end();clients.clear();clearTimeout(idleTimer);}};
}
module.exports={createBattleRelay,giftFromEvent,unpack};
