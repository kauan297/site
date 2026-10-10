"use strict";
// Local route/SQL tests with PostgreSQL compiled to WASM (PGlite).
// Synthetic signatures/payloads: these do NOT validate Kiwify's real delivery,
// network pooling, concurrent row locks, or TikTok/Roblox live isolation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');

const product = 'fixture-product-palcolive';
const secret = 'local-test-only-webhook-secret-12345';
const source = path.resolve(__dirname, '../kiwify-auto.js');
const machineA = 'TESTDEVICEAAAA';
const machineB = 'TESTDEVICEBBBB';

test('PalcoLive licensing: local PostgreSQL lifecycle', async t => {
  const db = new PGlite();
  const stopped = [];
  let storageFailure = false;
  class Pool {
    async query(sql, params) {
      if (storageFailure) throw Object.assign(new Error('test outage'), {code:'TEST_OUTAGE'});
      const result = await db.query(sql, params);
      return { rows: result.rows, rowCount: /^\s*SELECT\b/i.test(sql) ? result.rows.length : result.affectedRows };
    }
    async connect() { return { query: this.query.bind(this), release() {} }; }
  }
  const compiled = new Module(source, module);
  compiled.filename = source;
  compiled.paths = Module._nodeModulePaths(path.dirname(source));
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = name => name === 'pg' ? { Pool } : originalRequire(name);
  compiled._compile(fs.readFileSync(source, 'utf8'), source);
  const hash = x => crypto.createHash('sha256').update(x).digest('hex');
  const env = { KIWIFY_AUTO_ENABLED:'1', KIWIFY_PRODUCT_ID:product,
    KIWIFY_WEBHOOK_TOKEN:secret, DATABASE_URL:'local-pglite',
    KIWIFY_LICENSE_DAYS:'0', LICENSE_MODE:'manual' };
  const priorEnv = Object.fromEntries(Object.keys(env).map(k => [k,process.env[k]]));
  Object.assign(process.env, env);
  const app = express();
  app.use(express.json({verify(req,res,buffer) {req.rawBody = buffer.toString('utf8');}}));
  const deps = {app, sessionSecret:'local-test-only-session-secret-12345',
    hashDevice: hash, validMachineCode:x => /^TESTDEVICE[A-Z]{4}$/.test(x),
    sidForLicense:hash, createSessionToken:(sid, auth, machine) => ({token:JSON.stringify({sid,licenseMode:auth.mode,licenseInstanceId:auth.instanceId}),expiresAt:9999999999}),
    encryptDeviceCredential:() => 'synthetic-device-credential',
    getSession:req => {try {return JSON.parse(req.headers['x-test-session']);} catch {return null;}},
    limited:() => false, stopLive:async sid => stopped.push(sid)};
  const integration = compiled.exports(deps);
  app.get('/api/protected', (req,res) => res.json({ok:true}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {await new Promise(resolve=>server.close(resolve)); await db.close();
    for (const [k,v] of Object.entries(priorEnv)) {if(v===undefined) delete process.env[k]; else process.env[k]=v;}});
  async function post(route, data, query='') {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    const r = await fetch(root+route+query, {method:'POST',headers:{'Content-Type':'application/json'},body});
    return {status:r.status, data:await r.json()};
  }
  const event = (id, extras={}) => ({order_id:id,order_ref:id+'REF',Product:{product_id:product},
    Customer:{email:'buyer@example.com'},webhook_event_type:'order_approved',order_status:'paid',...extras});
  async function webhook(data, pretty=false) {
    const body=JSON.stringify(data,null,pretty?2:undefined);
    const signature=crypto.createHmac('sha1',secret).update(body).digest('hex');
    return post('/api/kiwify/webhook',body,'?signature='+signature);
  }
  const claim=(order,machine=machineA,email='buyer@example.com')=>post('/api/kiwify/claim',{order,machine_code:machine,email});
  let first;
  await t.test('missing, empty or invalid duration fails closed', () => {
    for(const value of [undefined,'',' ','-1','1.5','3651','abc']) {
      if(value===undefined) delete process.env.KIWIFY_LICENSE_DAYS; else process.env.KIWIFY_LICENSE_DAYS=value;
      const isolated = {...deps, app:express()};
      assert.equal(compiled.exports(isolated).configured,false);
    }
    process.env.KIWIFY_LICENSE_DAYS='0';
    assert.equal(integration.configured,true);
  });
  await t.test('forged payment rejected before storage', async () => {
    assert.equal((await post('/api/kiwify/webhook',event('order-0001'),'?signature='+'0'.repeat(40))).status,401);
  });
  await t.test('other product and unpaid event do not issue a license', async () => {
    assert.equal((await webhook(event('order-0001',{Product:{product_id:'another-product'}}))).data.ignored,'produto');
    assert.equal((await webhook(event('order-0001',{order_status:'waiting_payment'}))).data.ignored,'evento');
    assert.equal((await claim('order-0001')).status,403);
  });
  await t.test('approved purchase stores NULL expiration and hashes email', async () => {
    assert.equal((await webhook(event('order-0001'),true)).status,200);
    const {rows} = await db.query('SELECT * FROM palcolive_kiwify_orders WHERE order_id=$1',['order-0001']);
    assert.equal(rows[0].expires_at,null);
    assert.match(rows[0].email_digest,/^[a-f0-9]{64}$/);
    assert.notEqual(rows[0].email_digest,'buyer@example.com');
  });
  await t.test('wrong email denied; order reference and normalized email activate', async () => {
    assert.equal((await claim('order-0001',machineA,'other@example.com')).status,403);
    first=await claim('order-0001REF',machineA,' BUYER@EXAMPLE.COM ');
    assert.equal(first.status,200);
    assert.equal((await integration.authorizeLicense(first.data.license_key,machineA)).ok,true);
  });
  await t.test('duplicate payment preserves device and single permanent order', async () => {
    await webhook(event('order-0001'));
    const {rows}=await db.query('SELECT * FROM palcolive_kiwify_orders');
    assert.equal(rows.length,1); assert.equal(rows[0].expires_at,null);
    assert.equal(rows[0].device_digest,hash(machineA));
  });
  await t.test('second device blocked until first is released', async () => {
    assert.equal((await claim('order-0001',machineB)).status,403);
    assert.equal((await integration.authorizeLicense(first.data.license_key,machineB)).ok,false);
    assert.equal((await integration.releaseDevice(first.data.license_key,machineA)).ok,true);
    assert.equal((await integration.authorizeLicense(first.data.license_key,machineA)).ok,false);
    assert.equal((await claim('order-0001',machineB)).status,200);
  });
  await t.test('two purchases receive different room IDs', async () => {
    await webhook(event('order-0002'));
    const other=await claim('order-0002');
    assert.equal(other.status,200);
    assert.notEqual(other.data.room_id,first.data.room_id);
  });
  await t.test('refund revokes license, active session and stops live', async () => {
    const active=await claim('order-0001',machineB);
    await webhook(event('order-0001',{webhook_event_type:'order_refunded',order_status:'refunded'}));
    assert.equal((await integration.authorizeLicense(active.data.license_key,machineB)).ok,false);
    const r=await fetch(root+'/api/protected',{headers:{'x-test-session':active.data.session_token,'x-palcolive-device':machineB}});
    assert.equal(r.status,401);
    assert.ok(stopped.includes(active.data.room_id));
  });
  await t.test('late approval cannot undo refund; refund-before-approval also stays revoked', async () => {
    await webhook(event('order-0001'));
    assert.equal((await claim('order-0001',machineB)).status,403);
    await webhook(event('order-0003',{webhook_event_type:'order_refunded',order_status:'refunded',Customer:{}}));
    await webhook(event('order-0003'));
    assert.equal((await claim('order-0003')).status,403);
  });
  await t.test('chargeback revokes access', async () => {
    await webhook(event('order-0002',{webhook_event_type:'chargeback',order_status:'chargedback'}));
    assert.equal((await claim('order-0002')).status,403);
  });
  await t.test('storage outage returns retriable failure without granting access', async () => {
    storageFailure=true;
    assert.equal((await webhook(event('order-0004'))).status,503);
    assert.equal((await claim('order-0004')).status,503);
    storageFailure=false;
  });
});
