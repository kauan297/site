"use strict";
// Executar somente no Postgres descartável dos testes, nunca no banco dos clientes.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Client } = require("pg");
const { encrypt, decrypt, exportSnapshot, restoreSnapshot } = require("../scripts/license-backup.cjs");

(async () => {
  if (process.env.PALCOLIVE_DISPOSABLE_DATABASE !== "1" || !process.env.TEST_DATABASE_URL) {
    throw new Error("Este teste exige banco descartável explicitamente configurado.");
  }
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = "backup_test_" + crypto.randomBytes(8).toString("hex");
  const secret = "test-only-original-session-secret-preserve-1234";
  const key = crypto.randomBytes(32).toString("hex");
  const orders = ["paid", "revoked"].map((state, i) => ({
    order_id: `test-order-${i}`, order_ref: `ref-${i}`, product_id: "test-product",
    email_digest: "a".repeat(64), state, device_digest: i === 0 ? "b".repeat(64) : null,
    expires_at: i === 0 ? null : "2026-10-01T00:00:00.000Z", updated_at: "2026-10-10T12:00:00.000Z"
  }));
  const snapshot = { format: "palcolive-licenses-v1", session_secret: secret, orders };
  try {
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    assert.equal(await restoreSnapshot(client, decrypt(encrypt(snapshot, key), key), secret), 2);
    const exported = await exportSnapshot(client, secret);
    assert.deepEqual(JSON.parse(JSON.stringify(exported.orders)), orders);
    await assert.rejects(restoreSnapshot(client, snapshot, secret), /vazio/);
    assert.equal((await client.query("SELECT count(*)::int AS total FROM palcolive_kiwify_orders")).rows[0].total, 2);
    // Verificar rollback real se uma inserção falha depois da primeira licença.
    await client.query("DELETE FROM palcolive_kiwify_orders");
    await client.query("ALTER TABLE palcolive_kiwify_orders ADD CONSTRAINT test_paid_only CHECK (state = 'paid')");
    await assert.rejects(restoreSnapshot(client, snapshot, secret));
    assert.equal((await client.query("SELECT count(*)::int AS total FROM palcolive_kiwify_orders")).rows[0].total, 0);
    console.log("PASS: backup/restauração em PostgreSQL real, preservação de licenças e rollback atômico.");
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end().catch(() => {});
  }
})().catch(() => { console.error("Falha no teste PostgreSQL descartável; detalhes privados omitidos."); process.exitCode = 1; });
