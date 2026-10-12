"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const createAuto = require("../kiwify-auto");
const createDelivery = require("../kiwify-delivery");
const url = process.env.TEST_DATABASE_URL || "";
const parsed = new URL(url);
if (process.env.PALCOLIVE_DISPOSABLE_DATABASE !== "1" || parsed.hostname !== "localhost" || parsed.pathname !== "/palcolive_disposable_test") {
  throw new Error("Este teste exige o PostgreSQL descartável local do CI.");
}
const pool = new Pool({ connectionString: url });
const secret = "fixture-session-secret-only-for-isolated-tests";
const webhookSecret = "fixture-webhook-secret";
const product = "40cf8850-c44b-11f1-8fdf-3f2670dd515f";
const email = "buyer-fixture@example.invalid";
const a = "A1B2C3D4E5F60718293A", b = "00112233445566778899";
Object.assign(process.env, { KIWIFY_AUTO_ENABLED: "1", KIWIFY_DATABASE_URL: url, KIWIFY_WEBHOOK_TOKEN: webhookSecret,
  KIWIFY_PRODUCT_ID: product, KIWIFY_LICENSE_DAYS: "0", LICENSE_MODE: "manual", PGSSLMODE: "disable" });
const deliveryEnv = { KIWIFY_DELIVERY_ENABLED: "1", KIWIFY_PRODUCT_ID: product, BREVO_API_KEY: "fixture-api-key-never-real-12345", PALCOLIVE_EMAIL_FROM: "sender@example.invalid" };
const logs = [], messages = [], stopped = [], routes = new Map(), middleware = [];
let failSending = false, holdSend, sendStarted;
const fetchMock = async (path, options) => {
  if (path.endsWith("/senders")) return { ok: true, json: async () => ({ senders: [{ email: deliveryEnv.PALCOLIVE_EMAIL_FROM, active: true }] }) };
  assert.equal(path, "https://api.brevo.com/v3/smtp/email");
  assert.equal(options.redirect, "error");
  const message = JSON.parse(options.body);
  assert.equal(message.to.length, 1);
  assert.equal(message.to[0].email, email);
  assert.equal(message.sender.name, "PalcoLive");
  assert.ok(message.textContent.includes("https://lunadance-server.onrender.com/app/#pedido="));
  messages.push(message);
  if (sendStarted) sendStarted();
  if (holdSend) await holdSend;
  return { ok: !failSending, status: failSending ? 503 : 201, json: async () => failSending ? {} : ({ messageId: "fixture-message" }) };
};
const logger = { log: message => logs.push(message), error: message => logs.push(message) };
const delivery = createDelivery({ sessionSecret: secret, pool, env: deliveryEnv, fetchImpl: fetchMock, logger });
const auto = createAuto({
  app: { post: (path, fn) => routes.set(path, fn), use: (path, fn) => middleware.push(fn) }, sessionSecret: secret,
  hashDevice: value => crypto.createHash("sha256").update(value).digest("hex"), validMachineCode: value => /^[A-F0-9]{20}$/.test(value),
  sidForLicense: value => crypto.createHash("sha256").update(value).digest("hex"),
  createSessionToken: () => ({ token: "fixture-token", expiresAt: new Date(Date.now() + 3600000).toISOString() }),
  encryptDeviceCredential: () => "fixture-credential", getSession: req => req.session, limited: () => false,
  stopLive: async value => stopped.push(value),
  // O teste controla a fila para observar concorrência e reinício deterministicamente.
  delivery: { enabled: true, queue: delivery.queue, cancel: delivery.cancel, drain: async () => false }
});
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
async function post(path, body, signed = false) {
  const res = response();
  const signature = signed ? crypto.createHmac("sha1", webhookSecret).update(JSON.stringify(body)).digest("hex") : "";
  await routes.get(path)({ body, rawBody: JSON.stringify(body), query: { signature }, headers: {}, ip: "fixture" }, res);
  return res;
}
const sale = (id, ref) => ({ order_id: id, order_ref: ref, Product: { product_id: product }, Customer: { email }, order_status: "paid", webhook_event_type: "order_approved" });
const claim = (ref, machine) => post("/api/kiwify/claim", { order: ref, email, machine_code: machine });
const ids = [crypto.randomUUID(), crypto.randomUUID()];
(async () => {
  assert.ok(await auto.readyForClaims());
  assert.ok(await delivery.readyForDelivery());
  const first = sale(ids[0], "fixtureRefA");
  assert.equal((await post("/api/kiwify/webhook", first, true)).code, 200);
  const stored = (await pool.query("SELECT email_ciphertext FROM palcolive_kiwify_delivery WHERE order_id=$1", [ids[0]])).rows[0];
  assert.ok(stored.email_ciphertext && !stored.email_ciphertext.includes(email));
  assert.equal(await delivery.queue(ids[0], "attacker@example.invalid"), false);
  const [one, two] = await Promise.all([claim(first.order_ref, a), claim(first.order_ref, b)]);
  assert.deepEqual([one.code, two.code].sort(), [200, 403], "Só um aparelho vence a ativação concorrente real");
  const winner = one.code === 200 ? one : two;
  const machine = one.code === 200 ? a : b, nextMachine = machine === a ? b : a;
  assert.ok((await auto.authorizeLicense(winner.body.license_key, machine)).ok);
  assert.ok((await auto.releaseDevice(winner.body.license_key, machine)).ok);
  assert.equal((await auto.authorizeLicense(winner.body.license_key, machine)).ok, false);
  const transferred = await claim(first.order_ref, nextMachine);
  assert.equal(transferred.code, 200);
  let releaseSend;
  holdSend = new Promise(resolve => { releaseSend = resolve; });
  const started = new Promise(resolve => { sendStarted = resolve; });
  const drainFirst = delivery.drain();
  await started;
  const secondWorker = createDelivery({ sessionSecret: secret, pool, env: deliveryEnv, fetchImpl: fetchMock, logger });
  assert.equal(await secondWorker.drain(), false, "Dois workers não enviam o mesmo pedido concorrente");
  releaseSend();
  assert.equal(await drainFirst, true);
  holdSend = null; sendStarted = null;
  assert.equal(messages.length, 1);
  const sent = (await pool.query("SELECT state,email_ciphertext FROM palcolive_kiwify_delivery WHERE order_id=$1", [ids[0]])).rows[0];
  assert.equal(sent.state, "sent"); assert.equal(sent.email_ciphertext, null);
  await post("/api/kiwify/webhook", first, true);
  assert.equal(await delivery.drain(), false, "Webhook duplicado não reenvia email");
  await delivery.requestLink("unknown@example.invalid");
  assert.equal(messages.length, 1);
  await delivery.requestLink(email);
  assert.equal(await delivery.drain(), false, "Reenvio imediato é limitado");
  const refund = { ...first, order_status: "refunded", webhook_event_type: "order_refunded" };
  assert.equal((await post("/api/kiwify/webhook", refund, true)).code, 200);
  assert.equal((await auto.authorizeLicense(transferred.body.license_key, nextMachine)).ok, false);
  assert.equal((await claim(first.order_ref, nextMachine)).code, 403);
  assert.ok(stopped.length >= 2);
  const denied = response();
  await middleware[0]({ session: { licenseMode: "kiwify", licenseInstanceId: ids[0] }, headers: { "x-palcolive-device": nextMachine } }, denied, () => { throw new Error("Revoked session passed"); });
  assert.equal(denied.code, 401);
  await post("/api/kiwify/webhook", first, true);
  assert.equal((await claim(first.order_ref, nextMachine)).code, 403, "Repetição não reativa reembolso");
  const second = sale(ids[1], "fixtureRefB");
  await post("/api/kiwify/webhook", second, true);
  failSending = true;
  assert.equal(await delivery.drain(), false);
  const failedKey = messages.at(-1).headers.idempotencyKey;
  assert.equal((await pool.query("SELECT attempts FROM palcolive_kiwify_delivery WHERE order_id=$1", [ids[1]])).rows[0].attempts, 1);
  await pool.query("UPDATE palcolive_kiwify_delivery SET next_attempt_at=NOW() - INTERVAL '1 minute' WHERE order_id=$1", [ids[1]]);
  failSending = false;
  const restarted = createDelivery({ sessionSecret: secret, pool, env: deliveryEnv, fetchImpl: fetchMock, logger });
  assert.equal(await restarted.drain(), true, "Reinício recupera envio pendente persistido");
  assert.equal(messages.at(-1).headers.idempotencyKey, failedKey);
  for (const value of [email, secret, deliveryEnv.BREVO_API_KEY, ...ids]) assert.ok(!logs.join().includes(value));
  console.log("PASS: PostgreSQL real; ativação concorrente, troca, reembolso, sessões revogadas, fila criptografada, idempotência e recuperação após reinício.");
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await auto.close(); await pool.end(); });
