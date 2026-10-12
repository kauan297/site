"use strict";
const assert = require("node:assert/strict");
const audit = require("../legacy-db-audit");
async function test(count, fail = false) {
  const queries = [], logs = [];
  let ended = false;
  class Client {
    async connect() { if (fail) throw new Error("postgres://PRIVATE-CREDENTIAL"); }
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith("SELECT schemaname")) return { rows: [{ schemaname: "public", tablename: 'private"table' }] };
      if (sql.startsWith("SELECT COUNT")) return { rows: [{ total: String(count) }] };
      return { rows: [] };
    }
    async end() { ended = true; }
  }
  await audit({ env: { PALCOLIVE_LEGACY_AUDIT: "1", DATABASE_URL: "postgres://PRIVATE-CREDENTIAL" }, ClientClass: Client,
    logger: { log: message => logs.push(message), error: message => logs.push(message) } });
  assert.ok(ended);
  assert.ok(!logs.join().includes("PRIVATE-CREDENTIAL"));
  assert.ok(!logs.join().includes("private"));
  if (fail) assert.match(logs.join(), /unavailable/);
  else {
    assert.equal(queries[0], "BEGIN READ ONLY");
    assert.ok(queries.includes('SELECT COUNT(*)::text AS total FROM "public"."private""table"'));
    assert.match(logs.join(), new RegExp('"rows":' + count));
    assert.match(logs.join(), new RegExp('"migrationRequired":' + (count !== 0)));
    assert.equal(queries.at(-1), "ROLLBACK");
  }
  assert.ok(!queries.some(sql => /^(DELETE|INSERT|UPDATE|CREATE|ALTER|DROP)/.test(sql)));
}
(async () => { await test(0); await test(2); await test(0, true); console.log("PASS: auditoria somente leitura, contagens exatas e sem dados privados nos logs."); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
