"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { registerRoutes } = require("../sales-visits");

(async () => {
  const handlers = {};
  let records = 0, summaries = 0, rateLimited = false;
  registerRoutes({
    app: { post: (path, handler) => { handlers[path] = handler; }, get: (path, handler) => { handlers[path] = handler; } },
    store: { record: async () => { records++; }, summary: async () => { summaries++; return { total: "7", today: "3", daily: [] }; } },
    adminSecret: "test-only-secret", secureEqualText: (a, b) => a === b,
    limited: () => rateLimited, clientIp: () => "test"
  });
  async function request(path, overrides = {}) {
    const headers = { origin: "https://example.test", host: "example.test", "user-agent": "Mozilla/5.0", ...overrides.headers };
    const req = { protocol: "https", body: { page: "/vendas" }, ...overrides, get: name => headers[name.toLowerCase()] };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, sendStatus(code) { this.code = code; return this; }, setHeader() {} };
    await handlers[path](req, res); return res;
  }
  assert.equal((await request("/api/sales/visit")).code, 204);
  assert.equal(records, 1);
  assert.equal((await request("/api/sales/visit", { headers: { origin: "https://evil.test" } })).code, 403);
  assert.equal((await request("/api/sales/visit", { headers: { origin: undefined } })).code, 403);
  assert.equal((await request("/api/sales/visit", { body: { page: "/app" } })).code, 400);
  await request("/api/sales/visit", { headers: { "user-agent": "Googlebot" } });
  await request("/api/sales/visit", { headers: { dnt: "1" } });
  await request("/api/sales/visit", { headers: { "sec-gpc": "1" } });
  assert.equal(records, 1, "Reject cross-site and privacy opt-out writes");
  rateLimited = true;
  assert.equal((await request("/api/sales/visit")).code, 429);
  rateLimited = false;
  assert.equal((await request("/api/admin/visits")).code, 403);
  assert.equal(summaries, 0, "Never read private metrics before authentication");
  const privateResult = await request("/api/admin/visits", { headers: { "x-palcolive-admin": "test-only-secret" } });
  assert.equal(privateResult.body.total, "7");
  assert.equal(summaries, 1);

  const script = fs.readFileSync(require.resolve("../public/visits.js"), "utf8");
  function browser(privacy = {}) {
    let sends = 0;
    const events = {};
    const document = { visibilityState: "hidden", addEventListener: (name, handler) => { events[name] = handler; } };
    vm.runInNewContext(script, { document, navigator: privacy, location: { search: "" }, URLSearchParams,
      fetch: () => { sends++; return Promise.resolve(); } });
    document.visibilityState = "visible";
    events.visibilitychange(); events.visibilitychange();
    return sends;
  }
  assert.equal(browser(), 1, "Count once when a page becomes visible");
  assert.equal(browser({ doNotTrack: "1" }), 0);
  assert.equal(browser({ globalPrivacyControl: true }), 0);
  assert.equal(browser({ webdriver: true }), 0);
  console.log("PASS: private aggregate visits, same-origin checks, opt-outs and one count per document.");
})().catch(error => { console.error(error); process.exitCode = 1; });
