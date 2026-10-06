module.exports = function createTikTokDirect({ publishRoblox, topicForSession, validNick }) {
  const active = new Map();
  let connectorModulePromise = null;

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
      data?.userId ||
      data?.uniqueId ||
      ""
    );
  }

  function getGiftName(data) {
    return (
      data?.giftDetails?.giftName ||
      data?.extendedGiftInfo?.name ||
      data?.giftName ||
      data?.gift?.name ||
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

  async function getConnectorModule() {
    if (!connectorModulePromise) {
      connectorModulePromise = import("tiktok-live-connector");
    }
    return connectorModulePromise;
  }

  async function stop(sid) {
    const state = active.get(sid);
    if (!state) return { ok: true, status: "stopped" };

    state.desired = false;
    active.delete(sid);
    try {
      await state.connection.disconnect();
    } catch {}

    return { ok: true, status: "stopped" };
  }

  async function start(session, username, gifts) {
    const sid = session.sid;
    await stop(sid);

    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await getConnectorModule();
    const giftMap = buildGiftMap(gifts);
    const viewerMap = new Map();

    const connection = new TikTokLiveConnection(normalizeUsername(username), {
      processInitialData: false,
      enableExtendedGiftInfo: true,
      fetchRoomInfoOnConnect: false,
      webClientOptions: {
        timeout: { request: 12000 }
      },
      wsClientOptions: {
        handshakeTimeout: 12000
      }
    });

    const state = {
      desired: true,
      connection,
      username: normalizeUsername(username),
      status: "connecting",
      roomId: "",
      lastError: "",
      viewerMap,
      giftMap,
      startedAt: Date.now()
    };
    active.set(sid, state);

    connection.on(WebcastEvent.CHAT, async (data) => {
      if (!state.desired) return;

      let nick = String(data?.comment || "").trim().replace(/^@/, "");
      if (!validNick(nick)) return;

      const key = viewerKey(data);
      if (key) viewerMap.set(key, nick);

      try {
        await publishRoblox(topicForSession(sid), { type: "chat", nick });
      } catch (error) {
        console.error("[TIKTOK CHAT->ROBLOX]", error?.status || "internal");
      }
    });

    connection.on(WebcastEvent.GIFT, async (data) => {
      if (!state.desired) return;

      const giftType = Number(data?.giftDetails?.giftType ?? data?.giftType ?? 0);
      if (giftType === 1 && !data?.repeatEnd) return;

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
    });

    connection.on(ControlEvent.CONNECTED, () => {
      state.status = "connected";
      state.roomId = String(connection.roomId || "");
      state.lastError = "";
    });

    connection.on(ControlEvent.DISCONNECTED, () => {
      if (state.desired) state.status = "disconnected";
    });

    connection.on(ControlEvent.ERROR, (error) => {
      state.lastError = String(error?.message || "Erro de conexão").slice(0, 300);
      if (state.status !== "connected") state.status = "error";
    });

    try {
      const info = await connection.connect();
      state.status = "connected";
      state.roomId = String(info?.roomId || connection.roomId || "");
      state.lastError = "";
      return {
        ok: true,
        status: state.status,
        username: state.username,
        room_id: state.roomId
      };
    } catch (error) {
      state.status = "error";
      state.lastError = String(error?.message || "Falha ao conectar à LIVE").slice(0, 300);
      state.desired = false;
      active.delete(sid);
      try { await connection.disconnect(); } catch {}

      const out = new Error("Não foi possível localizar/conectar à LIVE do TikTok. Confirme que a LIVE está pública, já começou e que o @ está correto.");
      out.causeText = state.lastError;
      throw out;
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
