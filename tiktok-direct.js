const WebSocket = require("ws");

module.exports = function createTikTokDirect({ publishRoblox, topicForSession, validNick, apiKey }) {
  const active = new Map();

  function normalizeUsername(value) {
    return String(value || "").trim().replace(/^@/, "");
  }

  function normalizeGiftName(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim()
      .toLowerCase();
  }

  function viewerKey(data) {
    return String(
      data?.user?.userId ||
      data?.user?.uniqueId ||
      data?.senderUserId ||
      data?.userId ||
      data?.uniqueId ||
      ""
    );
  }

  function buildGiftMap(gifts) {
    const map = new Map();
    for (const [action, giftName] of Object.entries(gifts || {})) {
      const normalized = normalizeGiftName(giftName);
      if (normalized) map.set(normalized, action);
    }
    return map;
  }

  function safeJson(raw) {
    try {
      return JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
    } catch {
      return null;
    }
  }

  async function stop(sid) {
    const state = active.get(sid);
    if (!state) return { ok: true, status: "stopped" };

    state.desired = false;
    active.delete(sid);

    try {
      state.ws.removeAllListeners();
      state.ws.close(1000, "PalcoLive stop");
    } catch {}

    return { ok: true, status: "stopped" };
  }

  async function start(session, username, gifts) {
    const sid = session.sid;
    await stop(sid);

    if (!apiKey) {
      const error = new Error("Falta ativar a conexão TikTok no servidor. Configure a chave do provedor TikTok.");
      error.code = "TIKTOK_PROVIDER_NOT_CONFIGURED";
      throw error;
    }

    const cleanUsername = normalizeUsername(username);
    const giftMap = buildGiftMap(gifts);
    const viewerMap = new Map();

    const url = new URL("wss://api.tik.tools");
    url.searchParams.set("uniqueId", cleanUsername);
    url.searchParams.set("apiKey", apiKey);

    const ws = new WebSocket(url.toString(), {
      handshakeTimeout: 15000
    });

    const state = {
      desired: true,
      ws,
      username: cleanUsername,
      status: "connecting",
      roomId: "",
      lastError: "",
      viewerMap,
      giftMap,
      startedAt: Date.now()
    };
    active.set(sid, state);

    let settled = false;
    let resolveStart;
    let rejectStart;

    const started = new Promise((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      state.status = "error";
      state.lastError = "Tempo esgotado ao conectar à LIVE.";
      active.delete(sid);
      try { ws.terminate(); } catch {}
      rejectStart(new Error("A LIVE não respondeu a tempo. Confira se ela está pública e já iniciada."));
    }, 18000);

    function failStart(message) {
      state.status = "error";
      state.lastError = String(message || "Falha ao conectar à LIVE").slice(0, 300);
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        active.delete(sid);
        rejectStart(new Error(state.lastError));
      }
    }

    ws.on("open", () => {
      state.status = "connecting";
    });

    ws.on("message", async (raw) => {
      const packet = safeJson(raw);
      if (!packet) return;

      const event = String(packet.event || packet.type || "").toLowerCase();
      const data = packet.data || packet.payload || packet;

      if (event === "connected" || event === "connect") {
        state.status = "connected";
        state.roomId = String(data?.roomId || data?.room_id || packet?.roomId || "");
        state.lastError = "";

        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolveStart({
            ok: true,
            status: "connected",
            username: state.username,
            room_id: state.roomId || null
          });
        }
        return;
      }

      if (event === "error") {
        const message = String(data?.message || packet?.message || "O provedor TikTok recusou a conexão.");
        failStart(message);
        return;
      }

      if (event === "chat" || event === "comment") {
        let nick = String(data?.comment || data?.text || "").trim().replace(/^@/, "");
        if (!validNick(nick)) return;

        const key = viewerKey(data);
        if (key) viewerMap.set(key, nick);

        try {
          await publishRoblox(topicForSession(sid), { type: "chat", nick });
        } catch (error) {
          console.error("[TIKTOK CHAT->ROBLOX]", error?.status || "internal");
        }
        return;
      }

      if (event === "gift") {
        const repeatEnd = data?.repeatEnd ?? data?.repeat_end;
        const giftType = Number(data?.giftType ?? data?.gift_type ?? 0);
        if (giftType === 1 && repeatEnd === false) return;

        const giftName = String(
          data?.giftName ||
          data?.gift_name ||
          data?.gift?.name ||
          data?.giftDetails?.giftName ||
          ""
        ).trim();

        const action = giftMap.get(normalizeGiftName(giftName));
        if (!action) return;

        let nick = "";
        if (action !== "reset") {
          const key = viewerKey(data);
          nick = key ? viewerMap.get(key) || "" : "";
          if (!validNick(nick)) return;
        }

        try {
          await publishRoblox(topicForSession(sid), {
            type: "gift_action",
            nick: action === "reset" ? "" : nick,
            action,
            duration: 0
          });
        } catch (error) {
          console.error("[TIKTOK GIFT->ROBLOX]", error?.status || "internal");
        }
      }
    });

    ws.on("close", (code, reason) => {
      clearTimeout(timeout);
      const message = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason || "");
      if (state.desired) {
        state.status = "disconnected";
        state.lastError = message || ("Conexão encerrada (" + code + ").");
      }

      if (!settled) {
        failStart(state.lastError || "A conexão com a LIVE foi encerrada antes de iniciar.");
      }
    });

    ws.on("error", (error) => {
      failStart(error?.message || "Falha de rede ao conectar à LIVE.");
    });

    try {
      return await started;
    } catch (error) {
      state.desired = false;
      active.delete(sid);
      try { ws.terminate(); } catch {}
      throw error;
    }
  }

  function status(sid) {
    const state = active.get(sid);
    if (!state) {
      return { ok: true, status: "stopped", connected: false };
    }

    return {
      ok: true,
      status: state.status,
      connected: state.status === "connected",
      username: state.username,
      room_id: state.roomId || null,
      last_error: state.lastError || null
    };
  }

  return { start, stop, status };
};
