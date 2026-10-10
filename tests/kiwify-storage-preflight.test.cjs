"use strict";
const assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs"), crypto = require("node:crypto");
async function check(fail) {
  const queries = [], logs = [], routes = new Map();
  let selected;
  class Pool {
    constructor(options) { selected = options; }
    async query(sql) { queries.push(sql); if (fail) throw Object.assign(new Error("private-url-not-for-logs"), { code: "ECONNREFUSED" }); return { rows: [], rowCount: 0 }; }
  }
  const context = { module: { exports: {} }, Buffer, Date, process: { env: {
    KIWIFY_AUTO_ENABLED: "0", LICENSE_MODE: "test", KIWIFY_STORAGE_PREFLIGHT: "1",
    KIWIFY_DATABASE_URL: "postgres://new-database", DATABASE_URL: "postgres://old-database", PGSSLMODE: "require"
  } }, require: name => name === "pg" ? { Pool } : crypto,
  console: { log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) } };
  vm.runInNewContext(fs.readFileSync("kiwify-auto.js", "utf8"), context);
  const auto = context.module.exports({ app: { post: (path, fn) => routes.set(path, fn), use() {} },
    sessionSecret: "test-session-secret-for-private-preflight-1234", getSession: () => null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(selected.connectionString, "postgres://new-database", "usar novo banco preservando variável antiga");
  assert.equal(selected.ssl.rejectUnauthorized, true, "validar certificado TLS");
  assert.equal(auto.configured, false);
  assert.equal(await auto.readyForClaims(), false);
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await routes.get("/api/kiwify/webhook")({}, response);
  assert.equal(response.code, 503, "preflight não libera processamento de venda");
  await routes.get("/api/kiwify/claim")({}, response);
  assert.equal(response.code, 503, "preflight não libera ativação");
  assert.ok(logs.some(s => s.includes(fail ? "failed ECONNREFUSED" : "ready; sales flags unchanged")));
  assert.ok(!logs.some(s => s.includes("postgres://") || s.includes("private-url")));
  if (!fail) assert.ok(queries.includes("SELECT 1"));
}
(async () => { await check(false); await check(true); console.log("PASS: conexão Neon/TLS e diagnóstico sem habilitar vendas ou expor segredos."); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
