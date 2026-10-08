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
    if (code === 4555) return "Tempo máximo da conexão atingido.";
    if (code === 4556 || code === 4557) return "O provedor não conseguiu localizar os dados da LIVE.";
    return text || ("Conexão encerrada (" + code + ").");
  }

  function isTerminalClose(code) {
    return code === 1000 || code === 4005 || code === 4401 || code === 4403 || code === 4404;
  }

  function socketUrl(username) {
    const url = new URL("wss://ws.eulerstream.com");
    url.searchParams.set("uniqueId", username);
    url.searchParams.set("apiKey", apiKey);
    return url.toString();
  }

  async function stop(sid) {
    const state = active.get(sid);
    if (!state) return { ok: true, status: "stopped" };

    state.desired = false;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    active.delete(sid);

    try {
      if (state.ws) {
        state.ws.removeAllListeners();
        state.ws.close(1000, "PalcoLive stop");
      }
    } catch {}

    return { ok: true, status: "stopped" };
  }

  async function start(session, username, gifts) {
    const sid = session.sid;
    await stop(sid);

    if (!apiKey) throw new Error("Falta configurar a chave Euler Stream no servidor.");

    const cleanUsername = normalizeUsername(username);
    const state = {
      sid,
      desired: true,
      ws: null,
      username: cleanUsername,
      status: "connecting",
      roomId: "",
      lastError: "",
      viewerMap: new Map(),
      giftMap: buildGiftMap(gifts),
      startedAt: Date.now(),
      lastEventAt: 0,
      reconnectCount: 0,
      reconnectTimer: null,
      heartbeatTimer: null,
      connecting: false
    };
    active.set(sid, state);

    let initialSettled = false;
    let resolveInitial;
    let rejectInitial;

    const initialPromise = new Promise((resolve, reject) => {
      resolveInitial = resolve;
      rejectInitial = reject;
    });

    function settleInitialOk() {
      if (initialSettled) return;
      initialSettled = true;
      resolveInitial({
        ok: true,
        status: "connected",
        username: state.username,
        room_id: state.roomId || null
      });
    }

    function settleInitialError(message) {
      if (initialSettled) return;
      initialSettled = true;
      rejectInitial(new Error(String(message || "Não foi possível conectar à LIVE.")));
    }

    function markConnected(roomId) {
      state.status = "connected";
      state.roomId = String(roomId || state.roomId || "");
      state.lastError = "";
      state.reconnectCount = 0;
      settleInitialOk();
    }

    async function handleEvent(evt) {
      const type = String(evt?.type || evt?.event || "").trim();
      const low = type.toLowerCase();
      const data = evt?.data || evt?.payload || evt;

      if (low === "room.status" || low === "roomstatus") {
        const status = String(data?.state || "").toLowerCase();

        if (status === "connected") {
          markConnected(data?.roomId || data?.room_id);
          return;
        }

        if (status === "reconnecting" || status === "connecting") {
          state.status = status;
          return;
        }

        if (status === "offline" || status === "ended" || status === "error") {
          state.status = status;
          state.lastError = String(
            data?.message ||
            (status === "offline" ? "A conta não está AO VIVO." : "A LIVE não está disponível.")
          ).slice(0, 300);

          if (!initialSettled) settleInitialError(state.lastError);
          return;
        }
      }

      if (low === "tiktok.connect" || low === "connect" || low === "connected") {
        markConnected(data?.roomId || data?.room_id);
        return;
      }

      if (low.includes("chat")) {
        const nick = String(data?.comment || data?.text || "").trim().replace(/^@/, "");
        if (!validNick(nick)) return;

        const key = viewerKey(data);
        if (key) state.viewerMap.set(key, nick);

        try {
          await publishRoblox(topicForSession(sid), { type: "chat", nick });
          console.log("[TIKTOK CHAT] enviado ao Roblox");
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
        const action = state.giftMap.get(normalizeGiftName(giftName));
        if (!action) return;

        let nick = "";
        if (action !== "reset") {
          const key = viewerKey(data);
          nick = key ? state.viewerMap.get(key) || "" : "";
          if (!validNick(nick)) return;
        }

        try {
          await publishRoblox(topicForSession(sid), {
            type: "gift_action",
            nick: action === "reset" ? "" : nick,
            action,
            duration: 0
          });
          console.log("[TIKTOK GIFT] enviado ao Roblox");
        } catch (error) {
          console.error("[TIKTOK GIFT->ROBLOX]", error?.status || "internal");
        }
      }
    }

    function scheduleReconnect(message) {
      if (!state.desired || active.get(sid) !== state || state.reconnectTimer) return;

      state.status = "reconnecting";
      state.lastError = String(message || "Reconectando ao TikTok...").slice(0, 300);
      state.reconnectCount += 1;

      const delay = Math.min(15000, 1200 * Math.pow(1.7, Math.min(state.reconnectCount - 1, 5)));
      console.log("[TIKTOK RECONNECT] tentativa " + state.reconnectCount + " em " + Math.round(delay) + "ms");

      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        connectSocket(false);
      }, delay);
    }

    function connectSocket(initialAttempt) {
      if (!state.desired || active.get(sid) !== state || state.connecting) return;

      state.connecting = true;
      state.status = initialAttempt ? "connecting" : "reconnecting";

      const ws = new WebSocket(socketUrl(state.username), { handshakeTimeout: 15000 });
      state.ws = ws;

      let openGraceTimer = null;
      let initialTimeout = null;
      let gotPong = true;

      function cleanupTimers() {
        if (openGraceTimer) clearTimeout(openGraceTimer);
        if (initialTimeout) clearTimeout(initialTimeout);
        if (state.heartbeatTimer) {
          clearInterval(state.heartbeatTimer);
          state.heartbeatTimer = null;
        }
      }

      if (initialAttempt) {
        initialTimeout = setTimeout(() => {
          if (initialSettled || !state.desired) return;
          state.lastError = "A LIVE não respondeu a tempo. Confira se ela está pública e já iniciada.";
          try { ws.terminate(); } catch {}
          settleInitialError(state.lastError);
        }, 20000);
      }

      ws.on("open", () => {
        state.connecting = false;
        gotPong = true;

        openGraceTimer = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN && state.desired) {
            markConnected(state.roomId);
          }
        }, 1500);

        state.heartbeatTimer = setInterval(() => {
          if (!state.desired || state.ws !== ws) return;
          if (ws.readyState !== WebSocket.OPEN) return;

          if (!gotPong) {
            try { ws.terminate(); } catch {}
            return;
          }

          gotPong = false;
          try { ws.ping(); } catch {}
        }, 20000);
      });

      ws.on("pong", () => {
        gotPong = true;
      });

      ws.on("message", async (raw) => {
        const packet = safeJson(raw);
        if (!packet) return;

        state.lastEventAt = Date.now();
        gotPong = true;

        if (!initialSettled) markConnected(state.roomId);

        for (const evt of unpackPacket(packet)) {
          try {
            await handleEvent(evt);
          } catch (error) {
            console.error("[EULER EVENT]", error?.message || "internal");
          }
        }
      });

      ws.on("close", (code, reason) => {
        cleanupTimers();
        state.connecting = false;

        if (!state.desired || active.get(sid) !== state) return;

        const message = closeMessage(
          code,
          Buffer.isBuffer(reason) ? reason.toString("utf8") : reason
        );

        state.lastError = message;
        state.status = code === 4005 ? "ended" : "disconnected";

        if (!initialSettled && isTerminalClose(code)) {
          active.delete(sid);
          settleInitialError(message);
          return;
        }

        if (isTerminalClose(code)) {
          console.log("[TIKTOK CLOSE] terminal " + code + " - " + message);
          return;
        }

        scheduleReconnect(message);
      });

      ws.on("error", (error) => {
        cleanupTimers();
        state.connecting = false;
        state.lastError = String(error?.message || "Falha de rede ao conectar à LIVE.").slice(0, 300);

        if (!initialSettled && initialAttempt) {
          // close normally follows; leave the final decision to the close handler.
          return;
        }

        scheduleReconnect(state.lastError);
      });
    }

    connectSocket(true);

    try {
      return await initialPromise;
    } catch (error) {
      state.desired = false;
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
      active.delete(sid);
      try { state.ws?.terminate(); } catch {}
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
      last_error: state.lastError || null,
      reconnect_count: state.reconnectCount,
      last_event_at: state.lastEventAt ? new Date(state.lastEventAt).toISOString() : null
    };
  }

  return { start, stop, status };
};
