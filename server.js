const express = require("express");
const helmet = require("helmet");
const crypto = require("crypto");
const path = require("path");
const createTikTokDirect = require("./tiktok-direct");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);
app.use(express.json({ limit: "12kb", strict: true }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-PalcoLive-Version", "13");
  next();
});

const PORT = Number(process.env.PORT || 10000);
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY || "";
const ROBLOX_UNIVERSE_ID = process.env.ROBLOX_UNIVERSE_ID || "10769353715";
const ROBLOX_PLACE_ID = process.env.ROBLOX_PLACE_ID || "76605256587436";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const LICENSE_MODE = (process.env.LICENSE_MODE || "test").toLowerCase();
const TEST_LICENSE_KEY = String(process.env.TEST_LICENSE_KEY || "").trim();
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || "").trim();
const LEMON_PRODUCT_ID = String(process.env.LEMON_PRODUCT_ID || "").trim();
const SESSION_HOURS = Math.max(1, Math.min(6, Number(process.env.SESSION_HOURS || 6)));
const EULER_API_KEY = String(process.env.EULER_API_KEY || "").trim();

const buckets = new Map();

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 128);
}

function limited(key, max, windowMs) {
  const now = Date.now();
  const item = buckets.get(key);
  if (!item || now - item.startedAt >= windowMs) {
    buckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  item.count += 1;
  return item.count > max;
}

setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, value] of buckets) {
    if (value.startedAt < cutoff) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

app.use((req, res, next) => {
  if (limited("global:" + clientIp(req), 180, 60_000)) {
    return res.status(429).json({ ok: false, error: "Muitas solicitações. Aguarde um pouco." });
  }
  next();
});

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function secureEqualText(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function validMachineCode(value) {
  return typeof value === "string" && /^[A-F0-9]{20}$/.test(value);
}

function hashDevice(machineCode) {
  return crypto.createHash("sha256").update("palcolive-device:" + machineCode).digest("hex");
}

function credentialKey() {
  return crypto.createHash("sha256").update("palcolive-credential:" + SESSION_SECRET).digest();
}

function encryptDeviceCredential(data, machineCode) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", credentialKey(), iv);
  cipher.setAAD(Buffer.from("device:" + machineCode, "utf8"));
  const plain = Buffer.from(JSON.stringify(data), "utf8");
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    tag.toString("base64url")
  ].join(".");
}

function decryptDeviceCredential(value, machineCode) {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;

  try {
    const iv = Buffer.from(parts[1], "base64url");
    const encrypted = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", credentialKey(), iv);
    decipher.setAAD(Buffer.from("device:" + machineCode, "utf8"));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

function sidForLicense(licenseKey) {
  return stableRoomId("license:" + String(licenseKey || "").trim());
}

function roomIdForClient(licenseKey, auth, machineCode) {
  const mode = String(auth?.mode || "").toLowerCase();

  // No modo de teste/desenvolvimento, cada aparelho recebe uma sala própria.
  // Assim várias pessoas podem usar a mesma chave de teste sem misturar eventos.
  if (mode === "test" || mode === "off") {
    return stableRoomId("device:" + hashDevice(machineCode));
  }

  // No modo comercial, uma licença = uma sala isolada do cliente.
  return sidForLicense(licenseKey);
}

function signPayload(payload) {
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET não configurado");
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}

function createManualLicense(machineCode, days, label) {
  if (!validMachineCode(machineCode)) throw new Error("Código do aparelho inválido.");
  const created = nowSeconds();
  const safeDays = Math.max(0, Math.min(3650, Number(days || 0)));
  const exp = safeDays > 0 ? created + Math.floor(safeDays * 86400) : 0;
  const licenseId = crypto.randomBytes(8).toString("hex");
  const payload = {
    v: 1,
    aud: "palcolive-license",
    lic: licenseId,
    dev: hashDevice(machineCode),
    iat: created,
    exp,
    label: String(label || "").slice(0, 80)
  };
  return "PL1." + signPayload(payload);
}

function verifyManualLicense(licenseKey, machineCode) {
  if (typeof licenseKey !== "string" || !licenseKey.startsWith("PL1.")) return null;
  if (!validMachineCode(machineCode)) return null;
  const token = licenseKey.slice(4);
  if (!token.includes(".")) return null;

  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest();
  let received;
  try {
    received = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (payload.v !== 1 || payload.aud !== "palcolive-license") return null;
  if (!payload.lic || typeof payload.lic !== "string") return null;
  if (!payload.dev || !secureEqualText(payload.dev, hashDevice(machineCode))) return null;
  if (payload.exp && Number(payload.exp) > 0 && Number(payload.exp) < nowSeconds()) return null;
  return payload;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest();
  let received;
  try {
    received = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload.exp || payload.exp < nowSeconds()) return null;
  if (!payload.sid || typeof payload.sid !== "string") return null;
  if (payload.aud !== "palcolive-client" || payload.v !== 6) return null;
  return payload;
}

function getBearer(req) {
  const h = String(req.headers.authorization || "");
  if (!h.startsWith("Bearer ")) return "";
  return h.slice(7).trim();
}

function getSession(req) {
  const session = verifyToken(getBearer(req));
  if (!session) return null;

  if (session.dev) {
    const machine = String(req.headers["x-palcolive-device"] || "").trim().toUpperCase();
    if (!validMachineCode(machine)) return null;
    if (!secureEqualText(session.dev, hashDevice(machine))) return null;
  }

  return session;
}

function validNick(nick) {
  return typeof nick === "string" && /^[A-Za-z0-9_]{3,20}$/.test(nick);
}

function topicForSession(sessionId) {
  return "LunaDance_" + sessionId;
}

function stableRoomId(seed) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(String(seed)).digest("hex").slice(0, 32);
}

function createSessionToken(sid, auth, machineCode) {
  const exp = nowSeconds() + SESSION_HOURS * 3600;
  const token = signPayload({
    v: 6,
    aud: "palcolive-client",
    sid,
    dev: hashDevice(machineCode),
    iat: nowSeconds(),
    exp,
    licenseMode: auth.mode,
    licenseInstanceId: auth.instanceId || null
  });
  return { token, exp, expiresAt: new Date(exp * 1000).toISOString() };
}

async function lemonRequest(path, fields) {
  const body = new URLSearchParams(fields);
  const response = await fetch("https://api.lemonsqueezy.com" + path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Falha na validação da licença.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function productMatches(meta) {
  if (!LEMON_PRODUCT_ID) return false;
  return String(meta && meta.product_id) === LEMON_PRODUCT_ID;
}

function commercialModeEnabled() {
  return ["manual", "lemonsqueezy", "hybrid"].includes(LICENSE_MODE);
}

async function authorizeLemonLicense({ licenseKey, instanceId, deviceName }) {
  if (!LEMON_PRODUCT_ID) {
    return { ok: false, error: "Licenciamento comercial ainda não configurado." };
  }

  if (!licenseKey || typeof licenseKey !== "string" || licenseKey.length > 256) {
    return { ok: false, error: "Licença obrigatória." };
  }

  if (instanceId) {
    const result = await lemonRequest("/v1/licenses/validate", {
      license_key: licenseKey.trim(),
      instance_id: String(instanceId).slice(0, 128)
    });

    if (!result.valid || !productMatches(result.meta)) {
      return { ok: false, error: "Licença inválida para este produto." };
    }

    return {
      ok: true,
      mode: "lemonsqueezy",
      instanceId: result.instance?.id || String(instanceId)
    };
  }

  const activation = await lemonRequest("/v1/licenses/activate", {
    license_key: licenseKey.trim(),
    instance_name: String(deviceName || "PalcoLive").slice(0, 100)
  });

  if (!activation.activated || !productMatches(activation.meta)) {
    return { ok: false, error: "Não foi possível ativar esta licença neste aparelho." };
  }

  return {
    ok: true,
    mode: "lemonsqueezy",
    instanceId: activation.instance?.id || null
  };
}

async function deactivateLemonLicense({ licenseKey, instanceId }) {
  if (!licenseKey || !instanceId) return { ok: true, deactivated: false };

  const result = await lemonRequest("/v1/licenses/deactivate", {
    license_key: String(licenseKey).trim(),
    instance_id: String(instanceId).slice(0, 128)
  });

  return {
    ok: Boolean(result.deactivated),
    deactivated: Boolean(result.deactivated)
  };
}

async function authorizeLicense({ licenseKey, instanceId, deviceName, machineCode }) {
  if (!validMachineCode(machineCode)) {
    return { ok: false, error: "Dispositivo inválido." };
  }

  if (LICENSE_MODE === "off") {
    return {
      ok: true,
      mode: "off",
      instanceId: "development-" + hashDevice(machineCode).slice(0, 16)
    };
  }

  // Chave do dono para testes internos.
  if (["test", "manual", "hybrid"].includes(LICENSE_MODE) && TEST_LICENSE_KEY && secureEqualText(licenseKey, TEST_LICENSE_KEY)) {
    return {
      ok: true,
      mode: "test",
      instanceId: "test-" + hashDevice(machineCode).slice(0, 16)
    };
  }

  // Licença comercial manual, gerada pelo painel do vendedor e presa ao aparelho.
  if (LICENSE_MODE === "manual" || LICENSE_MODE === "hybrid") {
    const manual = verifyManualLicense(licenseKey, machineCode);
    if (manual) {
      return {
        ok: true,
        mode: "manual",
        instanceId: "manual-" + manual.lic
      };
    }
    if (LICENSE_MODE === "manual") {
      return { ok: false, error: "Licença inválida, expirada ou emitida para outro aparelho." };
    }
  }

  if (LICENSE_MODE === "lemonsqueezy" || LICENSE_MODE === "hybrid") {
    return authorizeLemonLicense({ licenseKey, instanceId, deviceName });
  }

  if (LICENSE_MODE === "test") {
    return { ok: false, error: "Licença de teste inválida." };
  }

  return { ok: false, error: "Sistema de licença indisponível." };
}

async function publishRoblox(topic, message) {
  if (!ROBLOX_API_KEY) throw new Error("ROBLOX_API_KEY não configurada");

  const payloadMessage = typeof message === "string" ? message : JSON.stringify(message);

  const response = await fetch(
    "https://apis.roblox.com/cloud/v2/universes/" +
      encodeURIComponent(ROBLOX_UNIVERSE_ID) +
      ":publishMessage",
    {
      method: "POST",
      headers: {
        "x-api-key": ROBLOX_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ topic, message: payloadMessage }),
      signal: AbortSignal.timeout(10_000)
    }
  );

  if (!response.ok) {
    const error = new Error("Roblox HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
}

async function publishRobloxSession(topic, message) {
  // Sempre publica somente na sala exclusiva da sessão.
  // Não existe mais tópico global compartilhado entre clientes.
  await publishRoblox(topic, message);
}

app.get("/admin", (req, res) => res.redirect(302, "/app/admin.html"));

app.post("/api/admin/license", (req, res) => {
  if (limited("admin:" + clientIp(req), 20, 5 * 60_000)) {
    return res.status(429).json({ ok: false, error: "Muitas tentativas." });
  }

  const supplied = String(req.headers["x-palcolive-admin"] || "");
  if (!ADMIN_SECRET || !secureEqualText(supplied, ADMIN_SECRET)) {
    return res.status(403).json({ ok: false, error: "Senha do vendedor inválida." });
  }

  const machineCode = String(req.body?.machine_code || "").trim().toUpperCase();
  const days = Number(req.body?.days || 0);
  const label = String(req.body?.label || "").trim();

  if (!validMachineCode(machineCode)) {
    return res.status(400).json({ ok: false, error: "Código do aparelho inválido." });
  }
  if (!Number.isFinite(days) || days < 0 || days > 3650) {
    return res.status(400).json({ ok: false, error: "Duração inválida." });
  }

  try {
    const licenseKey = createManualLicense(machineCode, days, label);
    return res.json({
      ok: true,
      license_key: licenseKey,
      machine_code: machineCode,
      days,
      lifetime: days === 0
    });
  } catch {
    return res.status(500).json({ ok: false, error: "Não foi possível gerar a licença." });
  }
});

app.get("/app", (req, res) => res.redirect(302, "/app/"));
app.get("/termos", (req, res) => res.redirect(302, "/app/termos.html"));
app.get("/privacidade", (req, res) => res.redirect(302, "/app/privacidade.html"));
app.use("/app", express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  etag: true,
  maxAge: "10m"
}));

app.get("/", (req, res) => {
  res.json({ name: "PalcoLive Server", ok: true, version: 13, app: "/app/" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, version: 13 });
});

app.get("/api/config", (req, res) => {
  res.json({ placeId: ROBLOX_PLACE_ID, version: 13, mobileApp: "/app/", tiktokReady: Boolean(EULER_API_KEY), isolatedRooms: true, commercialReady: commercialModeEnabled() });
});

app.post("/api/activate", async (req, res) => {
  if (limited("auth:" + clientIp(req), 12, 5 * 60_000)) {
    return res.status(429).json({ ok: false, error: "Muitas tentativas de ativação." });
  }

  try {
    const body = req.body || {};
    const licenseKey = String(body.license_key || body.licenseKey || "").trim();
    const machineCode = String(body.machine_code || body.machineCode || "").trim().toUpperCase();

    if (licenseKey.length < 1 || licenseKey.length > 256 || !validMachineCode(machineCode)) {
      return res.status(400).json({ ok: false, error: "Dados de ativação inválidos." });
    }

    const auth = await authorizeLicense({
      licenseKey,
      instanceId: null,
      deviceName: "PalcoLive " + machineCode.slice(0, 8),
      machineCode
    });

    if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });

    const sid = roomIdForClient(licenseKey, auth, machineCode);
    const session = createSessionToken(sid, auth, machineCode);
    const deviceCredential = encryptDeviceCredential({
      licenseKey,
      instanceId: auth.instanceId || null
    }, machineCode);

    return res.json({
      ok: true,
      instance_id: auth.instanceId,
      room_id: sid,
      place_id: ROBLOX_PLACE_ID,
      session_token: session.token,
      device_credential: deviceCredential,
      expires_at: session.expiresAt
    });
  } catch (error) {
    console.error("[ACTIVATE]", error.status || "internal");
    return res.status(error.status || 500).json({ ok: false, error: "Falha ao ativar." });
  }
});

app.post("/api/login", async (req, res) => {
  if (limited("auth:" + clientIp(req), 30, 5 * 60_000)) {
    return res.status(429).json({ ok: false, error: "Muitas tentativas. Aguarde um pouco." });
  }

  try {
    const body = req.body || {};
    const licenseKey = String(body.license_key || body.licenseKey || "").trim();
    const instanceId = body.instance_id || body.instanceId || null;
    const machineCode = String(body.machine_code || body.machineCode || "").trim().toUpperCase();

    if (licenseKey.length < 1 || licenseKey.length > 256 || !validMachineCode(machineCode)) {
      return res.status(400).json({ ok: false, error: "Dados de login inválidos." });
    }

    const auth = await authorizeLicense({
      licenseKey,
      instanceId,
      deviceName: "PalcoLive " + machineCode.slice(0, 8),
      machineCode
    });

    if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });

    const sid = roomIdForClient(licenseKey, auth, machineCode);
    const session = createSessionToken(sid, auth, machineCode);

    return res.json({
      ok: true,
      instance_id: auth.instanceId || instanceId,
      room_id: sid,
      place_id: ROBLOX_PLACE_ID,
      session_token: session.token,
      expires_at: session.expiresAt
    });
  } catch (error) {
    console.error("[LOGIN]", error.status || "internal");
    return res.status(error.status || 500).json({ ok: false, error: "Falha ao validar a licença." });
  }
});

app.post("/api/login-device", async (req, res) => {
  if (limited("auth:" + clientIp(req), 40, 5 * 60_000)) {
    return res.status(429).json({ ok: false, error: "Muitas tentativas. Aguarde um pouco." });
  }

  try {
    const body = req.body || {};
    const machineCode = String(body.machine_code || body.machineCode || "").trim().toUpperCase();
    const credential = String(body.device_credential || body.deviceCredential || "").trim();

    if (!validMachineCode(machineCode) || credential.length < 20 || credential.length > 4096) {
      return res.status(400).json({ ok: false, error: "Credencial do dispositivo inválida." });
    }

    const stored = decryptDeviceCredential(credential, machineCode);
    if (!stored || typeof stored.licenseKey !== "string") {
      return res.status(401).json({ ok: false, error: "Credencial inválida neste dispositivo." });
    }

    const licenseKey = stored.licenseKey.trim();
    const instanceId = stored.instanceId || null;

    const auth = await authorizeLicense({
      licenseKey,
      instanceId,
      deviceName: "PalcoLive Web " + machineCode.slice(0, 8),
      machineCode
    });

    if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });

    const sid = roomIdForClient(licenseKey, auth, machineCode);
    const session = createSessionToken(sid, auth, machineCode);

    return res.json({
      ok: true,
      instance_id: auth.instanceId || instanceId,
      room_id: sid,
      place_id: ROBLOX_PLACE_ID,
      session_token: session.token,
      expires_at: session.expiresAt
    });
  } catch (error) {
    console.error("[LOGIN DEVICE]", error.status || "internal");
    return res.status(error.status || 500).json({ ok: false, error: "Falha ao validar este dispositivo." });
  }
});

app.post("/api/deactivate-device", async (req, res) => {
  try {
    const machineCode = String(req.body?.machine_code || req.body?.machineCode || "").trim().toUpperCase();
    const credential = String(req.body?.device_credential || req.body?.deviceCredential || "").trim();

    if (!validMachineCode(machineCode) || credential.length < 20 || credential.length > 4096) {
      return res.status(400).json({ ok: false, error: "Credencial do dispositivo inválida." });
    }

    const stored = decryptDeviceCredential(credential, machineCode);
    if (!stored || typeof stored.licenseKey !== "string") {
      return res.status(401).json({ ok: false, error: "Credencial inválida neste dispositivo." });
    }

    const licenseKey = stored.licenseKey.trim();
    const instanceId = stored.instanceId || null;

    if (LICENSE_MODE === "lemonsqueezy" || LICENSE_MODE === "hybrid") {
      try {
        const result = await deactivateLemonLicense({ licenseKey, instanceId });
        return res.json({ ok: true, deactivated: result.deactivated });
      } catch (error) {
        console.error("[DEACTIVATE DEVICE]", error.status || "internal");
        return res.status(error.status || 500).json({ ok: false, error: "Não foi possível liberar esta ativação." });
      }
    }

    return res.json({ ok: true, deactivated: false });
  } catch {
    return res.status(500).json({ ok: false, error: "Não foi possível sair deste aparelho." });
  }
});

app.post("/api/deactivate", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "Sessão inválida ou expirada." });

  try {
    const licenseKey = String(req.body?.license_key || req.body?.licenseKey || "").trim();
    const instanceId = String(req.body?.instance_id || req.body?.instanceId || "").trim();

    if (session.licenseMode === "lemonsqueezy") {
      if (!licenseKey || !instanceId || !secureEqualText(session.sid, sidForLicense(licenseKey))) {
        return res.status(403).json({ ok: false, error: "Esta licença não pertence à sessão atual." });
      }

      const result = await deactivateLemonLicense({ licenseKey, instanceId });
      await tiktokDirect.stop(session.sid).catch(() => {});
      return res.json({ ok: true, deactivated: result.deactivated });
    }

    await tiktokDirect.stop(session.sid).catch(() => {});
    return res.json({ ok: true, deactivated: false });
  } catch (error) {
    console.error("[DEACTIVATE]", error.status || "internal");
    return res.status(error.status || 500).json({ ok: false, error: "Não foi possível liberar esta ativação." });
  }
});

async function handleChat(req, res) {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "Sessão inválida ou expirada." });

    if (limited("events:" + session.sid, 40, 10_000)) {
      return res.status(429).json({ ok: false, error: "Muitos eventos em pouco tempo." });
    }

    let nick = req.body && req.body.nick;
    if (typeof nick === "string") nick = nick.trim().replace(/^@/, "");
    if (!validNick(nick)) return res.status(400).json({ ok: false, error: "Nick Roblox inválido." });

    await publishRobloxSession(topicForSession(session.sid), { type: "chat", nick });
    return res.json({ ok: true });
  } catch (error) {
    console.error("[CHAT]", error.status || "internal");
    return res.status(error.status || 500).json({ ok: false, error: "Falha ao enviar ao Roblox." });
  }
}

app.post("/api/comment", handleChat);
app.post("/api/chat", handleChat);

const GIFT_ACTIONS = new Set(["gigante", "gigante_dourado", "reset", "mega_fogo"]);

const tiktokDirect = createTikTokDirect({
  publishRoblox: publishRobloxSession,
  topicForSession,
  validNick,
  apiKey: EULER_API_KEY
});

function validTikTokUsername(value) {
  return typeof value === "string" && /^[A-Za-z0-9._]{2,24}$/.test(value);
}

function readGiftConfig(body) {
  const source = body && body.gifts;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;

  const out = {};
  for (const action of GIFT_ACTIONS) {
    const name = String(source[action] || "").trim();
    if (!name || name.length > 100) return null;
    out[action] = name;
  }
  return out;
}

app.post("/api/gift", async (req, res) => {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "Sessão inválida ou expirada." });

    if (limited("events:" + session.sid, 40, 10_000)) {
      return res.status(429).json({ ok: false, error: "Muitos eventos em pouco tempo." });
    }

    let nick = req.body && req.body.nick;
    let action = req.body && req.body.action;

    if (typeof nick === "string") nick = nick.trim().replace(/^@/, "");
    if (typeof action === "string") action = action.trim().toLowerCase();

    if (!GIFT_ACTIONS.has(action)) {
      return res.status(400).json({ ok: false, error: "Ação inválida." });
    }

    if (action !== "reset" && !validNick(nick)) {
      return res.status(400).json({ ok: false, error: "Nick Roblox inválido." });
    }

    await publishRobloxSession(topicForSession(session.sid), {
      type: "gift_action",
      nick: action === "reset" ? "" : nick,
      action,
      duration: 0
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("[GIFT]", error.status || "internal");
    return res.status(error.status || 500).json({ ok: false, error: "Falha ao enviar presente ao Roblox." });
  }
});

app.post("/api/tiktok/start", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "Sessão inválida ou expirada." });

  if (limited("tiktok-start:" + session.sid, 8, 5 * 60_000)) {
    return res.status(429).json({ ok: false, error: "Muitas tentativas de conexão. Aguarde um pouco." });
  }

  try {
    let username = String(req.body?.username || "").trim().replace(/^@/, "");
    const gifts = readGiftConfig(req.body);

    if (!EULER_API_KEY) {
      return res.json({
        ok: false,
        error: "Conexão TikTok ainda não ativada no servidor. Falta configurar a chave Euler Stream."
      });
    }

    if (!validTikTokUsername(username)) {
      return res.status(400).json({ ok: false, error: "Usuário do TikTok inválido." });
    }
    if (!gifts) {
      return res.status(400).json({ ok: false, error: "Configure os 4 presentes antes de iniciar." });
    }

    const result = await tiktokDirect.start(session, username, gifts);
    return res.json(result);
  } catch (error) {
    console.error("[TIKTOK START]", String(error?.causeText || error?.message || "internal").slice(0, 300));
    return res.json({
      ok: false,
      error: error?.message || "Não foi possível conectar à LIVE do TikTok."
    });
  }
});

app.post("/api/tiktok/stop", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "Sessão inválida ou expirada." });

  try {
    return res.json(await tiktokDirect.stop(session.sid));
  } catch {
    return res.status(500).json({ ok: false, error: "Não foi possível encerrar a conexão." });
  }
});

app.post("/api/tiktok/status", (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "Sessão inválida ou expirada." });
  return res.json(tiktokDirect.status(session.sid));
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Rota não encontrada." });
});

app.use((err, req, res, next) => {
  if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)) {
    return res.status(400).json({ ok: false, error: "JSON inválido." });
  }
  console.error("[HTTP]", "internal");
  return res.status(500).json({ ok: false, error: "Erro interno." });
});

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error("ERRO: SESSION_SECRET ausente ou fraco.");
  process.exit(1);
}
if (!ROBLOX_API_KEY) {
  console.error("ERRO: ROBLOX_API_KEY não configurada.");
  process.exit(1);
}
if (["test", "manual", "hybrid"].includes(LICENSE_MODE) && !TEST_LICENSE_KEY) {
  console.error("ERRO: TEST_LICENSE_KEY não configurada.");
  process.exit(1);
}
if ((LICENSE_MODE === "lemonsqueezy" || LICENSE_MODE === "hybrid") && !LEMON_PRODUCT_ID) {
  console.error("ERRO: LEMON_PRODUCT_ID obrigatório no modo LemonSqueezy/híbrido.");
  process.exit(1);
}
if ((LICENSE_MODE === "manual" || LICENSE_MODE === "hybrid") && ADMIN_SECRET.length < 16) {
  console.error("ERRO: ADMIN_SECRET ausente ou fraco.");
  process.exit(1);
}
if (!["test", "manual", "hybrid", "lemonsqueezy", "off"].includes(LICENSE_MODE)) {
  console.error("ERRO: LICENSE_MODE inválido.");
  process.exit(1);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log("PalcoLive Server v13 online na porta " + PORT);
  console.log("Universe: " + ROBLOX_UNIVERSE_ID + " | Place: " + ROBLOX_PLACE_ID);
  console.log("License mode: " + LICENSE_MODE);
  console.log("TikTok provider: " + (EULER_API_KEY ? "Euler Cloud WebSocket configured" : "Euler key missing"));
});
