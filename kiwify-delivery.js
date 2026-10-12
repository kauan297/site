"use strict";

const crypto = require("node:crypto");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const APP_ORIGIN = "https://lunadance-server.onrender.com";
const ENDPOINT = "https://api.brevo.com/v3/smtp/email";

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : "";
}

module.exports = function createKiwifyDelivery({
  sessionSecret, pool, env = process.env, fetchImpl = globalThis.fetch,
  logger = console, clock = () => Date.now()
}) {
  const enabled = env.KIWIFY_DELIVERY_ENABLED === "1";
  const key = String(env.BREVO_API_KEY || "").trim();
  const sender = cleanEmail(env.PALCOLIVE_EMAIL_FROM);
  const product = String(env.KIWIFY_PRODUCT_ID || "").trim();
  const configured = enabled && key.length >= 20 && !!sender && !!pool && product.length >= 8 && sessionSecret.length >= 16;
  const encryptionKey = crypto.createHmac("sha256", sessionSecret).update("palcolive-email-outbox-v1").digest();
  let readyPromise, senderCheck, busy = false;
  let senderCheckedAt = 0;
  let senderValid = false;
  const digestEmail = email => crypto.createHmac("sha256", sessionSecret).update("email:" + email).digest("hex");
  function seal(email, orderId) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    cipher.setAAD(Buffer.from(orderId));
    const value = Buffer.concat([cipher.update(email, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), value].map(part => part.toString("base64url")).join(".");
  }
  function open(value, orderId) {
    const [iv, tag, data] = String(value).split(".").map(part => Buffer.from(part, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, iv);
    decipher.setAAD(Buffer.from(orderId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }
  async function ready() {
    if (!pool) throw new Error("delivery storage unavailable");
    if (!readyPromise) {
      readyPromise = pool.query(`CREATE TABLE IF NOT EXISTS palcolive_kiwify_delivery (
        order_id TEXT PRIMARY KEY,
        email_ciphertext TEXT,
        state TEXT NOT NULL CHECK (state IN ('pending','sent','canceled')),
        generation UUID NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ
      )`).catch(error => { readyPromise = null; throw error; });
    }
    await readyPromise;
  }
  async function readyForDelivery() {
    if (!configured) return false;
    if (clock() - senderCheckedAt < 60_000 && senderCheckedAt) return senderValid;
    if (!senderCheck) {
      senderCheck = (async () => {
        try {
          await ready();
          const response = await fetchImpl("https://api.brevo.com/v3/senders", {
            headers: { "api-key": key, accept: "application/json" },
            signal: AbortSignal.timeout(5000), redirect: "error"
          });
          const data = response.ok ? await response.json() : {};
          senderValid = Array.isArray(data.senders) && data.senders.some(item => cleanEmail(item.email) === sender && item.active === true);
        } catch { senderValid = false; }
        senderCheckedAt = clock();
        return senderValid;
      })().finally(() => { senderCheck = null; });
    }
    return senderCheck;
  }
  async function queue(orderId, value, resend = false) {
    if (!enabled) return false;
    const email = cleanEmail(value);
    if (!email) return false;
    await ready();
    const result = await pool.query(`INSERT INTO palcolive_kiwify_delivery
      (order_id, email_ciphertext, state, generation)
      SELECT order_id, $3, 'pending', $4::uuid FROM palcolive_kiwify_orders
      WHERE order_id=$1 AND email_digest=$2 AND product_id=$6 AND state='paid'
        AND (expires_at IS NULL OR expires_at > NOW())
      ON CONFLICT (order_id) DO UPDATE SET
        email_ciphertext=EXCLUDED.email_ciphertext, state='pending', generation=EXCLUDED.generation,
        attempts=0, next_attempt_at=NOW(), created_at=NOW(), sent_at=NULL
      WHERE $5::boolean AND (
        (palcolive_kiwify_delivery.state='sent' AND palcolive_kiwify_delivery.sent_at < NOW() - INTERVAL '1 hour')
        OR (palcolive_kiwify_delivery.state='pending' AND palcolive_kiwify_delivery.attempts>=8
          AND palcolive_kiwify_delivery.created_at < NOW() - INTERVAL '1 hour')
        OR palcolive_kiwify_delivery.state='canceled')
      RETURNING order_id`, [orderId, digestEmail(email), seal(email, orderId), crypto.randomUUID(), resend, product]);
    return result.rowCount === 1;
  }
  async function cancel(orderId) {
    if (!enabled) return;
    await ready();
    await pool.query("UPDATE palcolive_kiwify_delivery SET state='canceled',email_ciphertext=NULL WHERE order_id=$1", [orderId]);
  }
  async function requestLink(value) {
    if (!configured) return false;
    const email = cleanEmail(value);
    if (!email) return false;
    const result = await pool.query(`SELECT order_id FROM palcolive_kiwify_orders
      WHERE email_digest=$1 AND product_id=$2 AND state='paid' AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY updated_at DESC LIMIT 5`, [digestEmail(email), product]);
    for (const row of result.rows) await queue(row.order_id, email, true);
    return true; // A mesma resposta, com ou sem compra, evita expor compradores.
  }
  async function drain() {
    if (busy || !configured) return false;
    busy = true;
    let client;
    try {
      if (!await readyForDelivery()) return false;
      client = await pool.connect();
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query(`UPDATE palcolive_kiwify_delivery SET state='canceled',email_ciphertext=NULL
        WHERE state='pending' AND created_at < NOW() - INTERVAL '30 days'`);
      const result = await client.query(`SELECT d.order_id,d.email_ciphertext,d.generation,d.attempts,o.order_ref,o.email_digest
        FROM palcolive_kiwify_delivery d JOIN palcolive_kiwify_orders o ON o.order_id=d.order_id
        WHERE d.state='pending' AND d.attempts<8 AND d.next_attempt_at<=NOW()
          AND o.product_id=$1 AND o.state='paid' AND (o.expires_at IS NULL OR o.expires_at > NOW())
        ORDER BY d.created_at FOR UPDATE OF d,o SKIP LOCKED LIMIT 1`, [product]);
      if (!result.rowCount) { await client.query("COMMIT"); return false; }
      const job = result.rows[0];
      const email = cleanEmail(open(job.email_ciphertext, job.order_id));
      if (!email || digestEmail(email) !== job.email_digest) throw new Error("delivery integrity");
      const reference = /^[A-Za-z0-9_-]{4,128}$/.test(job.order_ref) ? job.order_ref : job.order_id;
      const link = APP_ORIGIN + "/app/#pedido=" + encodeURIComponent(reference);
      let sent = false;
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
          headers: { "api-key": key, accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({
            sender: { name: "PalcoLive", email: sender }, to: [{ email }],
            subject: "PalcoLive — seu link de ativação",
            textContent: "Seu pagamento foi aprovado.\n\nAbra seu link de ativação:\n" + link +
              "\n\nSeu pedido: " + reference + "\nInforme o mesmo e-mail usado na compra e toque em ATIVAR MINHA COMPRA AUTOMATICAMENTE.\n" +
              "A licença permite um aparelho ativado por vez. Não compartilhe este link.\n\nGuia: " + APP_ORIGIN + "/app/guia.html\n" +
              "Suporte: use o contato do vendedor informado no e-mail da Kiwify.",
            headers: { idempotencyKey: job.generation }
          })
        });
        const payload = await response.json().catch(() => ({}));
        sent = response.ok && typeof payload.messageId === "string";
        // A repetição da mesma chave significa que o provedor já aceitou o envio.
        if (!sent && response.status === 400 && payload.code === "duplicate_parameter") sent = true;
      } catch { /* Retentativa persistida, sem registrar destinatário ou chave. */ }
      await client.query(`UPDATE palcolive_kiwify_delivery SET
        state=CASE WHEN $2::boolean THEN 'sent' ELSE 'pending' END,
        email_ciphertext=CASE WHEN $2::boolean THEN NULL ELSE email_ciphertext END,
        attempts=attempts+1, sent_at=CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
        next_attempt_at=NOW() + LEAST(3600, 60 * POWER(2, attempts)) * INTERVAL '1 second'
        WHERE order_id=$1`, [job.order_id, sent]);
      await client.query("COMMIT");
      logger.log(sent ? "[KIWIFY DELIVERY] accepted" : "[KIWIFY DELIVERY] retry pending");
      return sent;
    } catch {
      if (client) await client.query("ROLLBACK").catch(() => {});
      logger.error("[KIWIFY DELIVERY] unavailable");
      return false;
    } finally { client?.release(); busy = false; }
  }
  function start() {
    if (!configured) return;
    const timer = setInterval(() => { drain().catch(() => {}); }, 60_000);
    timer.unref();
    drain().catch(() => {});
  }
  return { enabled, configured, ready, readyForDelivery, queue, cancel, requestLink, drain, start };
};
module.exports.cleanEmail = cleanEmail;
