"use strict";

// Backup privado: nunca disponibilizar por HTTP, commitar ou registrar segredos.
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const COLUMNS = ["order_id", "order_ref", "product_id", "email_digest", "state",
  "device_digest", "expires_at", "updated_at"];
const TABLE = "palcolive_kiwify_orders";
const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  order_id TEXT PRIMARY KEY, order_ref TEXT NOT NULL DEFAULT '', product_id TEXT NOT NULL,
  email_digest TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('paid','revoked')),
  device_digest TEXT DEFAULT NULL, expires_at TIMESTAMPTZ DEFAULT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW())`;

function backupKey(value) {
  if (!/^[a-fA-F0-9]{64}$/.test(value || "")) throw new Error("Chave de backup inválida.");
  return Buffer.from(value, "hex");
}

function validateSnapshot(snapshot) {
  if (snapshot?.format !== "palcolive-licenses-v1" ||
      typeof snapshot.session_secret !== "string" || snapshot.session_secret.length < 32 ||
      !Array.isArray(snapshot.orders)) throw new Error("Backup inválido.");
  const ids = new Set();
  for (const row of snapshot.orders) {
    if (!row || COLUMNS.some(c => !Object.hasOwn(row, c)) ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(row.order_id) || ids.has(row.order_id) ||
        typeof row.order_ref !== "string" || row.order_ref.length > 128 ||
        typeof row.product_id !== "string" || row.product_id.length < 8 ||
        !/^(?:[a-f0-9]{64}|removed-by-kiwify)$/.test(row.email_digest) ||
        !["paid", "revoked"].includes(row.state) ||
        !(row.device_digest === null || /^[a-f0-9]{64}$/.test(row.device_digest)) ||
        !(row.expires_at === null || Number.isFinite(Date.parse(row.expires_at))) ||
        !(row.updated_at === null || Number.isFinite(Date.parse(row.updated_at)))) {
      throw new Error("Registro de licença inválido.");
    }
    ids.add(row.order_id);
  }
  return snapshot;
}

function encrypt(snapshot, key) {
  validateSnapshot(snapshot);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", backupKey(key), iv);
  cipher.setAAD(Buffer.from("palcolive-backup-v1"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot), "utf8"), cipher.final()]);
  return JSON.stringify({ format: "palcolive-backup-v1", iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") });
}

function decrypt(serialized, key) {
  try {
    const envelope = JSON.parse(serialized);
    if (envelope.format !== "palcolive-backup-v1") throw new Error();
    const iv = Buffer.from(envelope.iv, "base64"), tag = Buffer.from(envelope.tag, "base64");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = crypto.createDecipheriv("aes-256-gcm", backupKey(key), iv);
    decipher.setAAD(Buffer.from("palcolive-backup-v1"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
    return validateSnapshot(JSON.parse(plaintext.toString("utf8")));
  } catch {
    throw new Error("Backup inválido, alterado ou chave incorreta.");
  }
}

async function exportSnapshot(client, sessionSecret) {
  if (typeof sessionSecret !== "string" || sessionSecret.length < 32) throw new Error("SESSION_SECRET inválido.");
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const result = await client.query(`SELECT ${COLUMNS.join(", ")} FROM ${TABLE} ORDER BY order_id`);
    const snapshot = validateSnapshot({ format: "palcolive-licenses-v1",
      created_at: new Date().toISOString(), session_secret: sessionSecret, orders: result.rows });
    await client.query("COMMIT");
    return snapshot;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function restoreSnapshot(client, snapshot, sessionSecret) {
  validateSnapshot(snapshot);
  if (sessionSecret !== snapshot.session_secret) throw new Error("Preserve o SESSION_SECRET original antes de restaurar.");
  await client.query("BEGIN");
  try {
    await client.query(DDL);
    await client.query(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE`);
    const existing = await client.query(`SELECT count(*)::int AS total FROM ${TABLE}`);
    if (existing.rows[0].total !== 0) throw new Error("O banco de destino precisa estar vazio; nenhuma licença foi substituída.");
    for (const row of snapshot.orders) {
      await client.query(`INSERT INTO ${TABLE} (${COLUMNS.join(", ")}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        COLUMNS.map(c => row[c]));
    }
    await client.query("COMMIT");
    return snapshot.orders.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  const [operation, filename] = process.argv.slice(2);
  if (!["export", "verify", "restore"].includes(operation) || !filename) {
    throw new Error("Uso: node scripts/license-backup.cjs export|verify|restore arquivo.palcolive.enc");
  }
  const key = process.env.PALCOLIVE_BACKUP_KEY;
  backupKey(key);
  let snapshot;
  if (operation !== "export") snapshot = decrypt(await fs.readFile(filename, "utf8"), key);
  if (operation === "verify") {
    console.log(`Backup autenticado: ${snapshot.orders.length} licenças. Restauração no banco ainda não executada.`);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ausente.");
  if (operation === "restore" && (process.env.PUBLIC_SALES_ENABLED !== "0" || process.env.KIWIFY_AUTO_ENABLED !== "0")) {
    throw new Error("Desative vendas e webhooks durante a restauração.");
  }
  const { Client } = require("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined });
  try {
    await client.connect();
    if (operation === "export") {
      snapshot = await exportSnapshot(client, process.env.SESSION_SECRET);
      await fs.writeFile(filename, encrypt(snapshot, key), { flag: "wx", mode: 0o600 });
      console.log(`Backup criptografado criado: ${snapshot.orders.length} licenças.`);
    } else {
      const total = await restoreSnapshot(client, snapshot, process.env.SESSION_SECRET);
      console.log(`Restauração concluída: ${total} licenças. Valide a ativação antes de reabrir vendas.`);
    }
  } finally { await client.end().catch(() => {}); }
}

module.exports = { encrypt, decrypt, exportSnapshot, restoreSnapshot };
if (require.main === module) main().catch(() => {
  // Erros de conexão podem conter hosts, URLs e credenciais: não imprimi-los.
  console.error("Operação não concluída. Confira configuração, chave, arquivo e banco vazio. Segredos não foram exibidos.");
  process.exitCode = 1;
});
