"use strict";

// Integração de vendas Kiwify do PalcoLive.
// Ativa APENAS quando env estiver inteiramente configurado.
// Uma compra aprovada libera a ativação no painel com e-mail + pedido.
// Não armazena CPF ou e-mail em claro: somente HMAC do e-mail.
const crypto = require("crypto");
const { Pool } = require("pg");

module.exports = function createKiwifyAuto({
  app, sessionSecret, hashDevice, validMachineCode, sidForLicense,
  createSessionToken, encryptDeviceCredential, getSession, limited, stopLive
}) {
  const enabled = String(process.env.KIWIFY_AUTO_ENABLED || "") === "1";
  const product = String(process.env.KIWIFY_PRODUCT_ID || "").trim();
  const token = String(process.env.KIWIFY_WEBHOOK_TOKEN || "");
  const databaseUrl = String(process.env.DATABASE_URL || "");
  const configured = enabled && ["manual", "hybrid"].includes(String(process.env.LICENSE_MODE || "test").toLowerCase())
    && product.length >= 8 && token.length >= 24 && !!databaseUrl;
  const pool = configured ? new Pool({
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
    "updated_at TIMESTAMPTZ DEFAULT NOW()",
    ")"
  ].join(" ");

  async function ready() {
    if (!pool) throw new Error("Kiwify não configurada.");
    if (!readyPromise) {
      readyPromise = pool.query(ddl).catch((error) => {
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
      .update("kiwify-license-v1:" + orderId + ":" + deviceDigest)
      .digest("base64url");
    return "KWF1." + encoded + "." + mac;
  }

  function parseLicenseKey(key) {
    if (typeof key !== "string" || key.length > 450 || !key.startsWith("KWF1.")) return null;
    const parts = key.split(".");
    if (parts.length !== 3) return null;
    let orderId = "";
    try {
      orderId = Buffer.from(parts[1], "base64url").toString("utf8");
    } catch { return null; }
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(orderId) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null;
    return { orderId, receivedMac: parts[2] };
  }

  async function orderIsPaid(orderId, deviceDigest) {
    await ready();
    const query = await pool.query(
      "SELECT 1 FROM palcolive_kiwify_orders WHERE order_id = $1 AND state = 'paid' AND device_digest = $2 LIMIT 1",
      [orderId, deviceDigest]
    );
    return query.rowCount === 1;
  }

  async function authorizeLicense(key, machineCode) {
    if (!configured || !validMachineCode(machineCode)) return { ok: false, error: "Licença Kiwify indisponível." };
    const parsed = parseLicenseKey(key);
    if (!parsed) return { ok: false, error: "Licença Kiwify inválida." };
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
      return { ok: true, mode: "kiwify", instanceId: parsed.orderId };
    } catch {
      return { ok: false, error: "Não foi possível confirmar a compra. Tente novamente." };
    }
  }

  function validWebhookSignature(req) {
    // Kiwify (webhooks da plataforma de cursos) usa ?signature= com HMAC-SHA1
    // do JSON enviado e o token secreto configurado no painel da Kiwify.
    const signature = String(req.query?.signature || "").toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(signature) || token.length < 24) return false;
    const body = JSON.stringify(req.body || {});
    const variants = [body];
    if (typeof req.rawBody === "string") variants.push(req.rawBody);
    return variants.some((value) => {
      const expected = crypto.createHmac("sha1", token).update(value).digest("hex");
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    });
  }

  // Recebimento automático das vendas. Sem assinatura válida, não processa.
  app.post("/api/kiwify/webhook", async (req, res) => {
    if (!configured) return res.status(503).json({ ok: false, error: "Integração ainda não configurada." });
    if (!validWebhookSignature(req)) return res.status(401).json({ ok: false, error: "Assinatura de webhook inválida." });

    const data = req.body || {};
    const productId = String(data.Product?.product_id || "").trim();
    if (productId !== product) return res.json({ ok: true, ignored: "produto" });

    const orderId = String(data.order_id || "").trim();
    const orderRef = String(data.order_ref || "").trim();
    const emailDigest = digestEmail(data.Customer?.email);
    const event = String(data.webhook_event_type || "").trim().toLowerCase();
    const status = String(data.order_status || "").trim().toLowerCase();
    const isApproved = (event === "order_approved" || event === "subscription_renewed") && status === "paid";
    const isRevoked = ["order_refunded", "chargeback", "subscription_canceled", "subscription_late"].includes(event)
      || ["refunded", "chargedback"].includes(status);

    if (!isApproved && !isRevoked) return res.json({ ok: true, ignored: "evento" });
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(orderId) || orderRef.length > 128 || (isApproved && !emailDigest)) {
      return res.status(422).json({ ok: false, error: "Pedido incompleto." });
    }

    try {
      await ready();
      const state = isRevoked ? "revoked" : "paid";
      const saved = await pool.query(
        ["INSERT INTO palcolive_kiwify_orders",
         "(order_id, order_ref, product_id, email_digest, state)",
         "VALUES ($1, $2, $3, $4, $5)",
         "ON CONFLICT (order_id) DO UPDATE SET",
         "state = CASE WHEN palcolive_kiwify_orders.state = 'revoked' THEN 'revoked' ELSE EXCLUDED.state END,",
         "updated_at = NOW()",
         "RETURNING order_id, device_digest, state"].join(" "),
        [orderId, orderRef, productId, emailDigest || "removed-by-kiwify", state]
      );

      if (saved.rows[0]?.state === "revoked" && saved.rows[0]?.device_digest) {
        const licenseKey = makeLicenseKey(orderId, saved.rows[0].device_digest);
        await stopLive(sidForLicense(licenseKey)).catch(() => {});
      }
      return res.json({ ok: true });
    } catch (error) {
      console.error("[KIWIFY WEBHOOK]", error?.code || "storage");
      return res.status(503).json({ ok: false, error: "Falha temporária de processamento. Reenvie o webhook." });
    }
  });

  app.post("/api/kiwify/claim", async (req, res) => {
    if (!configured) return res.status(503).json({ ok: false, error: "Ativação Kiwify ainda não configurada." });
    if (limited("kiwify-claim:" + String(req.ip || ""), 10, 15 * 60_000)) {
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
        "SELECT order_id, state, device_digest FROM palcolive_kiwify_orders WHERE email_digest=$1 AND (order_id=$2 OR order_ref=$2) FOR UPDATE",
        [emailDigest, order]
      );
      if (find.rowCount !== 1 || find.rows[0].state !== "paid") {
        await client.query("ROLLBACK");
        return res.status(403).json({ ok: false, error: "Não encontramos uma compra aprovada com esses dados." });
      }
      const sale = find.rows[0];
      if (sale.device_digest && sale.device_digest !== deviceDigest) {
        await client.query("ROLLBACK");
        return res.status(403).json({ ok: false, error: "A licença já está ativada em outro aparelho. Saia do antigo antes de trocar." });
      }
      if (!sale.device_digest) {
        await client.query("UPDATE palcolive_kiwify_orders SET device_digest=$2,updated_at=NOW() WHERE order_id=$1", [sale.order_id, deviceDigest]);
      }
      await client.query("COMMIT");

      const licenseKey = makeLicenseKey(sale.order_id, deviceDigest);
      const auth = { mode: "kiwify", instanceId: sale.order_id };
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
      console.error("[KIWIFY CLAIM]", error?.code || "storage");
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

  // Toda chamada autenticada revalida licenças Kiwify contra o banco.
  // Reembolsos e chargebacks bloqueiam tokens ainda dentro das 6h de validade.
  app.use("/api", async (req, res, next) => {
    const session = getSession(req);
    if (!session || session.licenseMode !== "kiwify") return next();
    try {
      const machine = String(req.headers["x-palcolive-device"] || "").trim().toUpperCase();
      if (!validMachineCode(machine) || !await orderIsPaid(session.licenseInstanceId, hashDevice(machine))) {
        return res.status(401).json({ ok: false, error: "Licença Kiwify revogada ou trocada de aparelho." });
      }
      return next();
    } catch {
      return res.status(503).json({ ok: false, error: "Não foi possível verificar a licença." });
    }
  });

  return { configured, authorizeLicense, releaseDevice };
};
