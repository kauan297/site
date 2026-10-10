"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { encrypt, decrypt, exportSnapshot, restoreSnapshot } = require("../scripts/license-backup.cjs");
const secret = "original-session-secret-preserved-across-migration";
const key = crypto.randomBytes(32).toString("hex");
const orders = ["paid", "revoked"].map((state, i) => ({
  order_id: `test-order-${i}`, order_ref: `ref-${i}`, product_id: "test-product",
  email_digest: crypto.createHmac("sha256", secret).update(`email:buyer${i}@example.com`).digest("hex"),
  state, device_digest: i === 0 ? "a".repeat(64) : null, expires_at: null,
  updated_at: "2026-10-10T12:00:00.000Z"
}));

// Transações simuladas para verificar atomicidade e recusa de sobrescrita.
function database(initial = [], failInsert = false) {
  let rows = structuredClone(initial), before;
  const calls = [];
  return { calls, get rows() { return rows; }, async query(sql, values) {
    calls.push(sql);
    if (sql.startsWith("BEGIN")) before = structuredClone(rows);
    else if (sql === "ROLLBACK") rows = before;
    else if (sql.startsWith("SELECT count")) return { rows: [{ total: rows.length }] };
    else if (sql.startsWith("SELECT order_id")) return { rows: structuredClone(rows) };
    else if (sql.startsWith("INSERT")) {
      if (failInsert) throw new Error("test failure");
      const columns = ["order_id", "order_ref", "product_id", "email_digest", "state", "device_digest", "expires_at", "updated_at"];
      rows.push(Object.fromEntries(columns.map((c, i) => [c, values[i]])));
    }
    return { rows: [] };
  }};
}

(async () => {
  const source = database(orders);
  const snapshot = await exportSnapshot(source, secret);
  assert.match(source.calls[0], /REPEATABLE READ READ ONLY/);
  const ciphertext = encrypt(snapshot, key);
  assert.ok(!ciphertext.includes(secret) && !ciphertext.includes(orders[0].order_id));
  assert.notEqual(ciphertext, encrypt(snapshot, key), "nonce novo a cada backup");
  const recovered = decrypt(ciphertext, key);
  assert.deepEqual(recovered.orders, orders);
  assert.equal(recovered.session_secret, secret);
  assert.throws(() => decrypt(ciphertext, crypto.randomBytes(32).toString("hex")));
  const tampered = JSON.parse(ciphertext);
  const bytes = Buffer.from(tampered.data, "base64"); bytes[0] ^= 1;
  tampered.data = bytes.toString("base64");
  assert.throws(() => decrypt(JSON.stringify(tampered), key));
  assert.throws(() => encrypt({ ...snapshot, orders: [...orders, orders[0]] }, key));
  const target = database();
  assert.equal(await restoreSnapshot(target, recovered, secret), 2);
  assert.deepEqual(target.rows, orders, "preservar licença permanente, reembolso e aparelho");
  const occupied = database(orders);
  await assert.rejects(restoreSnapshot(occupied, recovered, secret), /vazio/);
  assert.deepEqual(occupied.rows, orders);
  assert.ok(occupied.calls.includes("ROLLBACK"));
  const wrongSecret = database();
  await assert.rejects(restoreSnapshot(wrongSecret, recovered, "wrong"), /SESSION_SECRET/);
  assert.equal(wrongSecret.calls.length, 0);
  const failing = database([], true);
  await assert.rejects(restoreSnapshot(failing, recovered, secret));
  assert.deepEqual(failing.rows, []);
  console.log("PASS: backup autenticado, recuperação, segredo preservado e restauração sem sobrescrita (banco simulado).");
})().catch(error => { console.error(error); process.exitCode = 1; });
