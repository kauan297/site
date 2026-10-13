"use strict";

// Integração Cakto. Reutiliza o banco e backup de licenças existentes.
// Pedidos Cakto usam prefixo CAKTO_; não alteram compras antigas da Kiwify.
// Ativa APENAS quando env estiver inteiramente configurado.
// Uma compra aprovada libera a ativação no painel com e-mail + pedido.
// Não armazena CPF ou e-mail em claro: somente HMAC do e-mail.
const crypto = require("crypto");
const { Pool } = require("pg");

module.exports = function createCaktoAuto({
  app, sessionSecret, hashDevice, validMachineCode, sidForLicense,
  createSessionToken, encryptDeviceCredential, getSession, limited, stopLive
}) {
  const enabled = String(process.env.CAKTO_AUTO_ENABLED || "") === "1";
  const product = String(process.env.CAKTO_PRODUCT_ID || "").trim();
  const token = String(process.env.CAKTO_WEBHOOK_SECRET || "");
  // Segredo privado do webhook; validação da assinatura HMAC-SHA256.
  const webhookTokenValid = token.length >= 24 && token.length <= 512 && token === token.trim();
  // Permite preparar a migração preservando a conexão do banco antigo no Render.
  const databaseUrl = String(process.env.CAKTO_DATABASE_URL || process.env.KIWIFY_DATABASE_URL || process.env.DATABASE_URL || "");
  // Uma compra única libera uma licença por tempo definido; 0 = vitalícia somente
  // se o vendedor configurar isso de propósito. Padrão seguro: 30 dias.
  const configuredDays = Number(process.env.CAKTO_LICENSE_DAYS ?? 30);
  const licenseDays = Number.isInteger(configuredDays) && configuredDays >= 0 && configuredDays <= 3650
    ? configuredDays : NaN;
  const configured = enabled && ["manual", "hybrid"].includes(String(process.env.LICENSE_MODE || "test").toLowerCase())
    && product.length >= 8 && webhookTokenValid && !!databaseUrl
    && Number.isFinite(licenseDays);
  // Diagnóstico temporário: somente mensagens constantes, sem corpo, URL,
  // assinatura, e-mail, pedido, licença ou qualquer segredo nos logs.
  const diagnostics = process.env.CAKTO_DIAGNOSTICS === "1";
  function diagnostic(message) {
    if (diagnostics) console.log("[CAKTO WEBHOOK DIAGNOSTIC] " + message);
  }
  diagnostic(configured ? "configured" : "not configured");
  // Verificação administrativa no deploy sem habilitar compras ou ativações.
  const storagePreflight = process.env.CAKTO_STORAGE_PREFLIGHT === "1" && !!databaseUrl;
  const pool = configured || storagePreflight ? new Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined
  }) : null;

  let readyPromise = null;
  const ddl = [
    "CREATE TABLE IF NOT EXISTS palcolive_kiwify_orders (",
    "order_id TEXT PRIMARY KEY,",
    "order_ref TEXT NOT NULL DEFAULT '',",
    "product_id TEXT NOT NULL,",
    "email_digest TEXT NOT NULL,",
    "state TEXT NOT NULL CHECK (state IN ('paid','revoked')),",
    "device_digest TEXT DEFAULT NULL,",
    "expires_at TIMESTAMPTZ DEFAULT NULL,",
    "updated_at TIMESTAMPTZ DEFAULT NOW()",
    ")"
  ].join(" ");

  async function ready() {
    if (!pool) throw new Error("Cakto não configurada.");
    if (!readyPromise) {
      readyPromise = (async () => {
        await pool.query(ddl);
        await pool.query("ALTER TABLE palcolive_kiwify_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL");
      })().catch((error) => {
        readyPromise = null;
        throw error;
      });
    }
    await readyPromise;
  }

  function digestEmail(email) {
    const cleaned = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleaned) || cleaned.length > 254) return "";
    return crypto.createHmac("sha256", sessionSecret).update("email:" + cleaned).digest("hex");
  }

  function makeLicenseKey(orderId, deviceDigest) {
    const encoded = Buffer.from(orderId, "utf8").toString("base64url");
    const mac = crypto.createHmac("sha256", sessionSecret)
      .update("cakto-license-v1:" + orderId + ":" + deviceDigest)
      .digest("base64url");
    return "CKT1." + encoded + "." + mac;
  }

  function parseLicenseKey(key) {
    if (typeof key !== "string" || key.length > 450 || !key.startsWith("CKT1.")) return null;
    const parts = key.split(".");
    if (parts.length !== 3) return null;
    let orderId = "";
    try {
      orderId = Buffer.from(parts[1], "base64url").toString("utf8");
    } catch { return null; }
    if (!/^CAKTO_[a-zA-Z0-9_-]{8,120}$/.test(orderId) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null;
    return { orderId, receivedMac: parts[2] };
  }

  async function orderIsPaid(orderId, deviceDigest) {
    await ready();
    const query = await pool.query(
      "SELECT 1 FROM palcolive_kiwify_orders WHERE order_id = $1 AND state = 'paid' AND device_digest = $2 AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1",
      [orderId, deviceDigest]
    );
    return query.rowCount === 1;
  }

  async function authorizeLicense(key, machineCode) {
    if (!configured || !validMachineCode(machineCode)) return { ok: false, error: "Licença Cakto indisponível." };
    const parsed = parseLicenseKey(key);
    if (!parsed) return { ok: false, error: "Licença Cakto inválida." };
    const deviceDigest = hashDevice(machineCode);
    const expected = makeLicenseKey(parsed.orderId, deviceDigest).split(".")[2];
    const a = Buffer.from(expected);
    const b = Buffer.from(parsed.receivedMac);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, error: "Esta licença pertence a outro dispositivo." };
    }
    try {
      if (!await orderIsPaid(parsed.orderId, deviceDigest)) {
        return { ok: false, error: "Compra não localizada, cancelada ou pertencente a outro dispositivo." };
      }
      return { ok: true, mode: "cakto", instanceId: parsed.orderId };
    } catch {
      return { ok: false, error: "Não foi possível confirmar a compra. Tente novamente." };
    }
  }

  function validWebhookSignature(req) {
    // Contrato oficial: HMAC-SHA256(timestamp + "." + corpo cru), até 5 minutos.
    const timestamp = String(req.headers?.["x-cakto-timestamp"] || "");
    const signature = String(req.headers?.["x-cakto-signature"] || "");
    if (!webhookTokenValid || !/^\d{10}$/.test(timestamp)
        || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
        || typeof req.rawBody !== "string") return false;
    const received = signature.split(",").map(s => s.trim()).find(s => /^v1=[a-f0-9]{64}$/.test(s));
    if (!received) return false;
    const expected = "v1=" + crypto.createHmac("sha256", token).update(timestamp + "." + req.rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  }

  function validLegacySecret(req) {
    // A Cakto também documenta autenticação pela chave no corpo. Usar apenas
    // quando explicitamente configurado, em HTTPS e sem headers de assinatura.
    // Header presente e inválido nunca pode cair para o método alternativo.
    if (process.env.CAKTO_ALLOW_LEGACY_SECRET !== "1" || req.secure !== true ||
        req.headers?.["x-cakto-signature"] || req.headers?.["x-cakto-timestamp"] ||
        typeof req.body?.secret !== "string" || !webhookTokenValid) return false;
    const received = Buffer.from(req.body.secret);
    const expected = Buffer.from(token);
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  }

  // Recebimento automático das vendas. Sem assinatura válida, não processa.
  async function processOrder(data, res) {
    const productId = String(data.product?.id || "").trim();
    if (productId !== product) {
      diagnostic("ignored product");
      return res.json({ ok: true, ignored: "produto" });
    }

    const orderId = String(data.id ? "CAKTO_" + data.id : "").trim();
    const orderRef = String(data.refId || "").trim();
    const emailDigest = digestEmail(data.customer?.email);
    const event = String(data._event || "").trim().toLowerCase();
    const status = String(data.status || "").trim().toLowerCase();
    const isApproved = event === "purchase_approved" && status === "paid";
    const isRevoked = ["refund", "chargeback"].includes(event)
      || ["refunded", "chargedback"].includes(status);

    if (!isApproved && !isRevoked) {
      diagnostic("ignored event");
      return res.json({ ok: true, ignored: "evento" });
    }
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(String(data.id || "")) || !/^[A-Za-z0-9_-]{8,128}$/.test(orderId) || orderRef.length > 128 || (isApproved && !emailDigest)) {
      diagnostic("rejected incomplete order");
      return res.status(422).json({ ok: false, error: "Pedido incompleto." });
    }

    try {
      await ready();
      const state = isRevoked ? "revoked" : "paid";
      const expiresAt = licenseDays === 0 ? null : new Date(Date.now() + licenseDays * 86400_000);
      const saved = await pool.query(
        ["INSERT INTO palcolive_kiwify_orders",
         "(order_id, order_ref, product_id, email_digest, state, expires_at)",
         "VALUES ($1, $2, $3, $4, $5, $6)",
         "ON CONFLICT (order_id) DO UPDATE SET",
         "state = CASE WHEN palcolive_kiwify_orders.state = 'revoked' THEN 'revoked' ELSE EXCLUDED.state END,",
         "updated_at = NOW()",
         "RETURNING order_id, device_digest, state"].join(" "),
        [orderId, orderRef, productId, emailDigest || "removed-by-kiwify", state, expiresAt]
      );

      if (saved.rows[0]?.state === "revoked" && saved.rows[0]?.device_digest) {
        const licenseKey = makeLicenseKey(orderId, saved.rows[0].device_digest);
        await stopLive(sidForLicense(licenseKey)).catch(() => {});
      }
      diagnostic(saved.rows[0]?.state === "revoked" ? "processed revoked" : "processed paid");
      return res.json({ ok: true });
    } catch (error) {
      console.error("[CAKTO WEBHOOK]", error?.code || "storage");
      return res.status(503).json({ ok: false, error: "Falha temporária de processamento. Reenvie o webhook." });
    }
  }

  app.post("/api/cakto/webhook", async (req, res) => {
    if (!configured) return res.status(503).json({ ok: false, error: "Integração ainda não configurada." });
    if (!validWebhookSignature(req) && !validLegacySecret(req)) {
      diagnostic(req.headers?.["x-cakto-signature"] ? "signature header present" : "signature header missing");
      diagnostic(req.headers?.["x-cakto-timestamp"] ? "timestamp header present" : "timestamp header missing");
      const supplied = typeof req.body?.secret === "string" ? Buffer.from(req.body.secret) : Buffer.alloc(0);
      const expected = Buffer.from(token);
      diagnostic(supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
        ? "body secret matches" : "body secret mismatch");
      return res.status(401).json({ ok: false, error: "Assinatura de webhook inválida." });
    }
    const payload = req.body || {};
    if (!["purchase_approved", "refund", "chargeback"].includes(payload.event)) {
      return res.json({ ok: true, ignored: "evento" });
    }
    const items = Array.isArray(payload.data) ? payload.data : [payload.data];
    if (!items.length || items.length > 20 || items.some(d => !d || typeof d !== "object" || Array.isArray(d))) {
      return res.status(422).json({ ok: false, error: "Pedido incompleto." });
    }
    let processed = 0;
    for (const item of items) {
      const result = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await processOrder({ ...item, _event: payload.event }, result);
      if (result.code !== 200) return res.status(result.code).json(result.body);
      if (!result.body?.ignored) processed++;
    }
    return res.json({ ok: true, processed });
  });

  app.post("/api/cakto/claim", async (req, res) => {
    if (!configured) return res.status(503).json({ ok: false, error: "Ativação Cakto ainda não configurada." });
    if (limited("cakto-claim:" + String(req.ip || ""), 10, 15 * 60_000)) {
      return res.status(429).json({ ok: false, error: "Muitas tentativas. Aguarde alguns minutos." });
    }
    const machine = String(req.body?.machine_code || "").trim().toUpperCase();
    const order = String(req.body?.order || "").trim();
    const emailDigest = digestEmail(req.body?.email);
    if (!validMachineCode(machine) || !emailDigest || !/^[A-Za-z0-9_-]{4,128}$/.test(order)) {
      return res.status(400).json({ ok: false, error: "Confira o pedido, e-mail da compra e dispositivo." });
    }

    const deviceDigest = hashDevice(machine);
    let client;
    try {
      await ready();
      client = await pool.connect();
      await client.query("BEGIN");
      const find = await client.query(
        "SELECT order_id, state, device_digest, expires_at FROM palcolive_kiwify_orders WHERE email_digest=$1 AND (order_id=$2 OR order_ref=$2) AND left(order_id,6)='CAKTO_' FOR UPDATE",
        [emailDigest, order]
      );
      if (find.rowCount !== 1 || find.rows[0].state !== "paid") {
        await client.query("ROLLBACK");
        return res.status(403).json({ ok: false, error: "Não encontramos uma compra aprovada com esses dados." });
      }
      const sale = find.rows[0];
      if (sale.expires_at && Date.parse(sale.expires_at) <= Date.now()) {
        await client.query("ROLLBACK");
        return res.status(403).json({ ok: false, error: "O prazo de acesso desta compra terminou." });
      }
      if (sale.device_digest && sale.device_digest !== deviceDigest) {
        await client.query("ROLLBACK");
        return res.status(403).json({ ok: false, error: "A licença já está ativada em outro aparelho. Saia do antigo antes de trocar." });
      }
      if (!sale.device_digest) {
        await client.query("UPDATE palcolive_kiwify_orders SET device_digest=$2,updated_at=NOW() WHERE order_id=$1", [sale.order_id, deviceDigest]);
      }
      await client.query("COMMIT");

      const licenseKey = makeLicenseKey(sale.order_id, deviceDigest);
      const auth = { mode: "cakto", instanceId: sale.order_id };
      const sid = sidForLicense(licenseKey);
      const session = createSessionToken(sid, auth, machine);
      const deviceCredential = encryptDeviceCredential({ licenseKey, instanceId: sale.order_id }, machine);

      return res.json({
        ok: true, room_id: sid, instance_id: sale.order_id,
        place_id: String(process.env.ROBLOX_PLACE_ID || "76605256587436"),
        session_token: session.token, expires_at: session.expiresAt,
        device_credential: deviceCredential, license_key: licenseKey
      });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      console.error("[CAKTO CLAIM]", error?.code || "storage");
      return res.status(503).json({ ok: false, error: "Sistema temporariamente indisponível. Tente novamente." });
    } finally { client?.release(); }
  });

  async function releaseDevice(key, machine) {
    const parsed = parseLicenseKey(key);
    if (!parsed || !validMachineCode(machine)) return { ok: false };
    const check = await authorizeLicense(key, machine);
    if (!check.ok) return { ok: false };
    await ready();
    const result = await pool.query(
      "UPDATE palcolive_kiwify_orders SET device_digest=NULL,updated_at=NOW() WHERE order_id=$1 AND device_digest=$2 AND state='paid'",
      [parsed.orderId, hashDevice(machine)]
    );
    await stopLive(sidForLicense(key)).catch(() => {});
    return { ok: result.rowCount === 1 };
  }

  // Antes de anunciar a ativação no painel, confirmar que o banco responde.
  // Sem vazar URL, credenciais ou detalhes internos ao comprador.
  async function readyForClaims() {
    if (!configured) return false;
    try {
      await ready();
      await pool.query("SELECT 1");
      return true;
    } catch (error) {
      console.error("[CAKTO READY]", error?.code || "storage");
      return false;
    }
  }

  // Toda chamada autenticada revalida licenças Cakto contra o banco.
  // Reembolsos e chargebacks bloqueiam tokens ainda dentro das 6h de validade.
  app.use("/api", async (req, res, next) => {
    const session = getSession(req);
    if (!session || session.licenseMode !== "cakto") return next();
    try {
      const machine = String(req.headers["x-palcolive-device"] || "").trim().toUpperCase();
      if (!validMachineCode(machine) || !await orderIsPaid(session.licenseInstanceId, hashDevice(machine))) {
        return res.status(401).json({ ok: false, error: "Licença Cakto revogada ou trocada de aparelho." });
      }
      return next();
    } catch {
      return res.status(503).json({ ok: false, error: "Não foi possível verificar a licença." });
    }
  });

  if (storagePreflight) {
    ready().then(() => pool.query("SELECT 1")).then(() => {
      console.log("[CAKTO STORAGE PREFLIGHT] ready; sales flags unchanged");
    }).catch(error => {
      console.error("[CAKTO STORAGE PREFLIGHT] failed", error?.code || "storage");
    });
  }
  return { configured, authorizeLicense, releaseDevice, readyForClaims, close: () => pool?.end() };
};

