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
    const user = data?.user || data?.fromUser || {};
    return String(
      user?.userId ||
      user?.id ||
      user?.uniqueId ||
      user?.displayId ||
      data?.senderUserId ||
      data?.userId ||
      data?.uniqueId ||
      ""
    );
  }

  function getGiftName(data) {
    return String(
      data?.giftName ||
      data?.gift_name ||
      data?.gift?.name ||
      data?.giftDetails?.giftName ||
      data?.giftDetails?.name ||
      data?.extendedGiftInfo?.name ||
      ""
    ).trim();
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
      const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function unpackPacket(packet) {
    if (!packet) return [];
    if (Array.isArray(packet)) return packet.flatMap(unpackPacket);
    if (Array.isArray(packet.messages)) return packet.messages.flatMap(unpackPacket);
    if (Array.isArray(packet.events)) return packet.events.flatMap(unpackPacket);
    return [packet];
  }

  function closeMessage(code, reason) {
    const text = String(reason || "").trim();
    if (code === 4404) return "A conta não está AO VIVO ou a LIVE não foi encontrada.";
    if (code === 4401) return "A chave Euler Stream foi recusada.";
    if (code === 4403) return "A conta Euler Stream não tem permissão para esta conexão.";
    if (code === 4429) return "Limite de conexões simultâneas atingido.";
    if (code === 4005) return "A LIVE terminou.";
    if (code === 4555) return "A conexão atingiu o tempo máximo e precisa reconectar.";
    if (code === 4556 || code === 4557) return "O provedor não conseguiu localizar os dados da LIVE.";
    return text || ("Conexão encerrada (" + code + ").");
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
      throw new Error("Falta configurar a chave Euler Stream no servidor.");
    }

    const cleanUsername = normalizeUsername(username);
    const giftMap = buildGiftMap(gifts);
    const viewerMap = new Map();

    const url = new URL("wss://ws.eulerstream.com");
    url.searchParams.set("uniqueId", cleanUsername);
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("features.bundleEvents", "false");
    url.searchParams.set("features.rawMessages", "false");
    url.searchParams.set("features.schemaVersion", "v2");
    url.searchParams.set("features.normalizeUniqueId", "true");
    url.searchParams.set("features.closeInactiveWebSocketAfter", "0");

    const ws = new WebSocket(url.toString(), { handshakeTimeout: 15000 });

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
    }, 20000);

    function markConnected(roomId) {
      state.status = "connected";
      state.roomId = String(roomId || state.roomId || "");
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
    }

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

    async function handleEvent(evt) {
      const type = String(evt?.type || evt?.event || "").trim();
      const low = type.toLowerCase();
      const data = evt?.data || evt?.payload || evt;

      if (low === "room.status" || low === "roomstatus") {
        const status = String(data?.state || "").toLowerCase();
        if (status === "connected") {
          markConnected(data?.roomId || data?.room_id);
        } else if (status === "error" || status === "offline" || status === "ended") {
          const msg = data?.message || (status === "offline" ? "A conta não está AO VIVO." : "A LIVE não está disponível.");
          failStart(msg);
        }
        return;
      }

      if (low === "tiktok.connect" || low === "connect" || low === "connected") {
        markConnected(data?.roomId || data?.room_id);
        return;
      }

      if (low.includes("chat")) {
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

      if (low.includes("gift")) {
        const giftType = Number(data?.giftType ?? data?.gift_type ?? data?.giftDetails?.giftType ?? 0);
        const repeatEnd = data?.repeatEnd ?? data?.repeat_end;
        if (giftType === 1 && repeatEnd === false) return;

        const giftName = getGiftName(data);
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
    }

    ws.on("open", () => {
      state.status = "connecting";
    });

    ws.on("message", async (raw) => {
      const packet = safeJson(raw);
      if (!packet) return;
      for (const evt of unpackPacket(packet)) {
        try {
          await handleEvent(evt);
        } catch (error) {
          console.error("[EULER EVENT]", error?.message || "internal");
        }
      }
    });

    ws.on("close", (code, reason) => {
      clearTimeout(timeout);
      const message = closeMessage(code, Buffer.isBuffer(reason) ? reason.toString("utf8") : reason);

      if (state.desired) {
        state.status = code === 4005 ? "ended" : "disconnected";
        state.lastError = message;
      }

      if (!settled) failStart(message);
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
    if (!state) return { ok: true, status: "stopped", connected: false };

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
