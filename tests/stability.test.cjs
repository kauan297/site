"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const html = fs.readFileSync("public/index.html", "utf8");
const js = fs.readFileSync("public/app.js", "utf8");
for (const id of ["recoveryCard", "resumeStageBtn", "copyStageBtn", "stStage", "stageNotice"]) {
  assert.match(html, new RegExp('id="' + id + '"'), "Falta o componente " + id);
}

function createHarness({ mobile = false, expMs = 2 * 60 * 60 * 1000 } = {}) {
  const store = new Map([["palcolive_credential_v1", "v1.test"]]);
  const elements = new Map();
  const urls = [];
  const fetchCalls = [];
  const copied = [];
  function element(id) {
    if (!elements.has(id)) {
      const handlers = new Map();
      const el = {
        id, value: "", textContent: "", className: "", disabled: false,
        handlers, classList: { toggle() {}, add() {}, remove() {} },
        addEventListener(name, fn) { handlers.set(name, fn); },
        querySelector() { return { textContent: "" }; },
        insertBefore() {}, add() {}, close() {}, showModal() {}
      };
      elements.set(id, el);
    }
    return elements.get(id);
  }
  const location = { href: "https://example.com/app/" };
  const sessionData = () => ({
    ok: true, room_id: "room_test_123", place_id: "76605256587436",
    session_token: "signed_test_token",
    expires_at: new Date(Date.now() + expMs).toISOString()
  });
  const fetchMock = async (url) => {
    fetchCalls.push(String(url));
    let data;
    if (url === "/api/config") data = { tiktokReady: true, kiwifyAutomaticReady: false };
    else if (url === "/api/login-device") data = sessionData();
    else if (url === "/api/tiktok/status") data = { ok: true, connected: true, status: "connected" };
    else data = { ok: true };
    return { ok: true, status: 200, async json() { return data; } };
  };
  const context = {
    Uint8Array, Date, Map, Set, Option: class { constructor(name, value) { this.name=name; this.value=value; } },
    window: { location, matchMedia: () => ({ matches: mobile }), addEventListener() {}, prompt() {} },
    document: { getElementById: element, hidden: false, addEventListener() {} },
    navigator: {
      userAgent: mobile ? "Android" : "Desktop",
      onLine: true, clipboard: { writeText: async (url) => { copied.push(url); } }
    },
    localStorage: {
      getItem(key) { return store.get(key) ?? null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); }
    },
    crypto: webcrypto,
    fetch: fetchMock,
    setInterval() { return 1; },
    clearInterval() {},
    confirm() { return true; },
    console: { log() {}, error() {} },
  };
  vm.runInNewContext(js, context, { filename: "app.js", timeout: 3000 });
  return { element, location, store, copied, fetchCalls };
}
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0));
}
async function checkStageRecovery(mobile) {
  const h = createHarness({mobile});
  await settle();
  const open = h.element("openRobloxBtn").handlers.get("click");
  const reopen = h.element("resumeStageBtn").handlers.get("click");
  const copy = h.element("copyStageBtn").handlers.get("click");
  assert.equal(typeof open, "function");
  assert.equal(typeof reopen, "function");
  assert.equal(typeof copy, "function");
  await open();
  await settle();
  assert.match(h.location.href, /placeId=76605256587436/);
  assert.match(h.location.href, /launchData=room_test_123/);
  const first = h.location.href;
  await reopen();
  await settle();
  assert.equal(h.location.href, first, "Recuperação não deve trocar a sala");
  await copy();
  await settle();
  assert.equal(h.copied.at(-1), first, "Link copiado deve apontar à mesma sala");
  assert.ok(Number(h.store.get("palcolive_stage_opened_at_v1")) > 0);
}
async function checkSessionRenewal() {
  const h = createHarness({ expMs: 60000 });
  await settle();
  const before = h.fetchCalls.filter(x => x === "/api/login-device").length;
  h.element("resumeStageBtn").handlers.get("click")();
  await settle();
  const after = h.fetchCalls.filter(x => x === "/api/login-device").length;
  assert.ok(after > before, "Sessão próxima do vencimento deve ser renovada");
  assert.match(h.location.href, /launchData=room_test_123/);
}
(async () => {
  await checkStageRecovery(false);
  await checkStageRecovery(true);
  await checkSessionRenewal();
  console.log("Testes do PalcoLive passaram (PC, mobile, sala e renovação).");
})().catch(e => {console.error(e);process.exitCode=1;});
