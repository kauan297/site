const express = require("express");
const helmet = require("helmet");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "16kb" }));

const PORT = Number(process.env.PORT || 10000);
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY || "";
const ROBLOX_UNIVERSE_ID = process.env.ROBLOX_UNIVERSE_ID || "10769353715";
const ROBLOX_PLACE_ID = process.env.ROBLOX_PLACE_ID || "76605256587436";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const LICENSE_MODE = (process.env.LICENSE_MODE || "off").toLowerCase();
const LEMON_PRODUCT_ID = String(process.env.LEMON_PRODUCT_ID || "").trim();

const SESSION_HOURS = Math.max(1, Number(process.env.SESSION_HOURS || 12));
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 30;
const rateBuckets = new Map();

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload) {
  if (!SESSION_SECRET) {
    throw new Error("SESSION_SECRET não configurado");
  }
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest();
  let received;
  try {
    received = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload.exp || payload.exp < nowSeconds()) return null;
  if (!payload.sid || typeof payload.sid !== "string") return null;

  return payload;
}

function getBearer(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return "";
  return h.slice(7).trim();
}

function validNick(nick) {
  return typeof nick === "string" && /^[A-Za-z0-9_]{3,20}$/.test(nick);
}

function topicForSession(sessionId) {
  return `LunaDance_${sessionId}`;
}

function stableRoomId(seed) {
  if (!SESSION_SECRET) {
    throw new Error("SESSION_SECRET não configurado");
  }
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(String(seed || "lunadance"))
    .digest("hex")
    .slice(0, 32);
}

function createSessionToken(sid, auth) {
  const exp = nowSeconds() + SESSION_HOURS * 3600;
  const token = signPayload({
    sid,
    exp,
    licenseMode: auth && auth.mode ? auth.mode : LICENSE_MODE,
    licenseInstanceId: auth && auth.instanceId ? auth.instanceId : null
  });
  return {
    token,
    exp,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

function rateAllowed(key) {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (!existing || now - existing.startedAt > RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }

  existing.count += 1;
  if (existing.count > RATE_MAX) return false;
  return true;
}

async function lemonRequest(path, fields) {
  const body = new URLSearchParams(fields);
  const response = await fetch(`https://api.lemonsqueezy.com${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Lemon Squeezy HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function productMatches(meta) {
  if (!LEMON_PRODUCT_ID) return true;
  return String(meta && meta.product_id) === LEMON_PRODUCT_ID;
}

async function authorizeLicense({ licenseKey, instanceId, deviceName }) {
  if (LICENSE_MODE === "off") {
    return {
      ok: true,
      mode: "off",
      instanceId: instanceId || "development"
    };
  }

  if (LICENSE_MODE !== "lemonsqueezy") {
    return { ok: false, error: "LICENSE_MODE inválido no servidor." };
  }

  if (!licenseKey || typeof licenseKey !== "string") {
    return { ok: false, error: "Licença obrigatória." };
  }

  if (instanceId) {
    const result = await lemonRequest("/v1/licenses/validate", {
      license_key: licenseKey.trim(),
      instance_id: String(instanceId)
    });

    if (!result.valid) {
      return { ok: false, error: result.error || "Licença inválida." };
    }
    if (!productMatches(result.meta)) {
      return { ok: false, error: "Licença pertence a outro produto." };
    }

    return {
      ok: true,
      mode: "lemonsqueezy",
      instanceId: result.instance && result.instance.id ? result.instance.id : instanceId
    };
  }

  const activation = await lemonRequest("/v1/licenses/activate", {
    license_key: licenseKey.trim(),
    instance_name: String(deviceName || "Luna Dance PC").slice(0, 100)
  });

  if (!activation.activated) {
    return { ok: false, error: activation.error || "Não foi possível ativar a licença." };
  }
  if (!productMatches(activation.meta)) {
    return { ok: false, error: "Licença pertence a outro produto." };
  }

  return {
    ok: true,
    mode: "lemonsqueezy",
    instanceId: activation.instance && activation.instance.id
  };
}

async function publishRoblox(topic, message) {
  if (!ROBLOX_API_KEY) {
    throw new Error("ROBLOX_API_KEY não configurada");
  }

  const response = await fetch(
    `https://apis.roblox.com/cloud/v2/universes/${encodeURIComponent(ROBLOX_UNIVERSE_ID)}:publishMessage`,
    {
      method: "POST",
      headers: {
        "x-api-key": ROBLOX_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ topic, message })
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`Roblox respondeu HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    error.status = response.status;
    throw error;
  }
}

app.get("/", (req, res) => {
  res.json({
    name: "Luna Dance Server",
    ok: true,
    version: 2,
    licenseMode: LICENSE_MODE,
    placeId: ROBLOX_PLACE_ID
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/config", (req, res) => {
  res.json({
    placeId: ROBLOX_PLACE_ID,
    licenseMode: LICENSE_MODE
  });
});

app.post("/api/session/create", async (req, res) => {
  try {
    const { licenseKey, instanceId, deviceName } = req.body || {};
    const auth = await authorizeLicense({ licenseKey, instanceId, deviceName });

    if (!auth.ok) {
      return res.status(403).json({ ok: false, error: auth.error || "Licença recusada." });
    }

    const sid = crypto.randomBytes(24).toString("base64url");
    const session = createSessionToken(sid, auth);

    const webLaunchUrl =
      `https://www.roblox.com/games/start?placeId=${encodeURIComponent(ROBLOX_PLACE_ID)}&launchData=${encodeURIComponent(sid)}`;
    const appLaunchUrl =
      `roblox://placeId=${encodeURIComponent(ROBLOX_PLACE_ID)}&launchData=${encodeURIComponent(sid)}`;

    return res.json({
      ok: true,
      sessionId: sid,
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      licenseInstanceId: auth.instanceId || null,
      launchUrl: webLaunchUrl,
      appLaunchUrl
    });
  } catch (error) {
    console.error("[SESSION]", error.message);
    return res.status(error.status || 500).json({
      ok: false,
      error: error.status ? error.message : "Falha ao criar a sessão."
    });
  }
});

app.post("/api/activate", async (req, res) => {
  try {
    const body = req.body || {};
    const licenseKey = body.license_key || body.licenseKey || "";
    const machineCode = String(body.machine_code || body.machineCode || "pc").slice(0, 128);

    const auth = await authorizeLicense({
      licenseKey,
      instanceId: null,
      deviceName: `Luna Dance ${machineCode.slice(0, 20)}`
    });

    if (!auth.ok) {
      return res.status(403).json({ ok: false, error: auth.error || "Licença recusada." });
    }

    const sid = stableRoomId(`${auth.instanceId || licenseKey || "development"}:${machineCode}`);
    const session = createSessionToken(sid, auth);

    return res.json({
      ok: true,
      instance_id: auth.instanceId || "development",
      room_id: sid,
      place_id: ROBLOX_PLACE_ID,
      session_token: session.token,
      expires_at: session.expiresAt
    });
  } catch (error) {
    console.error("[ACTIVATE]", error.message);
    return res.status(error.status || 500).json({
      ok: false,
      error: error.status ? error.message : "Falha ao ativar."
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const body = req.body || {};
    const licenseKey = body.license_key || body.licenseKey || "";
    const instanceId = body.instance_id || body.instanceId || null;
    const machineCode = String(body.machine_code || body.machineCode || "pc").slice(0, 128);

    const auth = await authorizeLicense({
      licenseKey,
      instanceId,
      deviceName: `Luna Dance ${machineCode.slice(0, 20)}`
    });

    if (!auth.ok) {
      return res.status(403).json({ ok: false, error: auth.error || "Licença recusada." });
    }

    const sid = stableRoomId(`${auth.instanceId || licenseKey || "development"}:${machineCode}`);
    const session = createSessionToken(sid, auth);

    return res.json({
      ok: true,
      instance_id: auth.instanceId || instanceId || "development",
      room_id: sid,
      place_id: ROBLOX_PLACE_ID,
      session_token: session.token,
      expires_at: session.expiresAt
    });
  } catch (error) {
    console.error("[LOGIN]", error.message);
    return res.status(error.status || 500).json({
      ok: false,
      error: error.status ? error.message : "Falha ao validar a licença."
    });
  }
});

async function handleChat(req, res) {
  try {
    const token = getBearer(req);
    const session = verifyToken(token);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Sessão inválida ou expirada." });
    }

    if (!rateAllowed(session.sid)) {
      return res.status(429).json({ ok: false, error: "Muitos comentários em pouco tempo." });
    }

    let nick = req.body && req.body.nick;
    if (typeof nick === "string") nick = nick.trim().replace(/^@/, "");

    if (!validNick(nick)) {
      return res.status(400).json({ ok: false, error: "Nick Roblox inválido." });
    }

    await publishRoblox(topicForSession(session.sid), nick);
    return res.json({ ok: true });
  } catch (error) {
    console.error("[CHAT]", error.message);
    return res.status(error.status || 500).json({
      ok: false,
      error: "Falha ao enviar o nick ao Roblox."
    });
  }
}

app.post("/api/comment", handleChat);
app.post("/api/chat", handleChat);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Rota não encontrada." });
});

if (!SESSION_SECRET) {
  console.error("ERRO: SESSION_SECRET não configurado.");
  process.exit(1);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Luna Dance Server online na porta ${PORT}`);
  console.log(`Universe: ${ROBLOX_UNIVERSE_ID} | Place: ${ROBLOX_PLACE_ID}`);
  console.log(`License mode: ${LICENSE_MODE}`);
});
