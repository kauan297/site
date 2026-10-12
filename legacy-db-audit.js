"use strict";

// Auditoria administrativa opcional, somente leitura, sem imprimir dados de clientes.
module.exports = async function auditLegacyDatabase({ env = process.env, logger = console, ClientClass } = {}) {
  if (env.PALCOLIVE_LEGACY_AUDIT !== "1") return;
  if (!ClientClass) ClientClass = require("pg").Client;
  const connectionString = env.DATABASE_URL;
  if (!connectionString) { logger.log("[LEGACY DATABASE AUDIT] no connection configured"); return; }
  const expected = String(env.PALCOLIVE_LEGACY_DATABASE_ID || "dpg-db5337navr4c73f9l3mg-a").toLowerCase();
  let privateInternal = false;
  try {
    const parsed = new URL(connectionString);
    const hostname = parsed.hostname.toLowerCase();
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("unsupported connection");
    if (hostname !== expected && !hostname.startsWith(expected + ".")) {
      logger.error("[LEGACY DATABASE AUDIT] connection does not match preserved database"); return;
    }
    privateInternal = hostname === expected && /^dpg-[a-z0-9]+-a$/.test(hostname)
      && env.RENDER === "true" && env.RENDER_SERVICE_ID === "srv-db1qjg9srm7s73csh1f0";
  } catch { logger.error("[LEGACY DATABASE AUDIT] invalid connection; original database preserved"); return; }
  // O endpoint interno Render usa certificado autoassinado e não suporta verify-ca/full.
  // TLS continua obrigatório. Esta exceção só vale para o host curto conhecido,
  // dentro do serviço Render conhecido; URLs externas mantêm validação do certificado.
  const client = new ClientClass({ connectionString, connectionTimeoutMillis: 5000,
    ssl: { rejectUnauthorized: !privateInternal, minVersion: "TLSv1.2" } });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const tables = await client.query(`SELECT schemaname,tablename FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_%'
      ORDER BY schemaname,tablename LIMIT 51`);
    if (tables.rows.length > 50) throw new Error("legacy table limit");
    let rows = 0;
    const quote = value => '"' + value.replace(/"/g, '""') + '"';
    for (const table of tables.rows) {
      const count = await client.query("SELECT COUNT(*)::text AS total FROM " + quote(table.schemaname) + "." + quote(table.tablename));
      rows += Number(count.rows[0].total);
    }
    await client.query("ROLLBACK");
    logger.log("[LEGACY DATABASE AUDIT] " + JSON.stringify({ verifiedLegacyHost: true, tables: tables.rows.length, rows,
      empty: rows === 0, migrationRequired: rows !== 0 }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const code = /^[A-Z0-9_]{1,40}$/.test(error?.code || "") ? error.code : "connection";
    logger.error("[LEGACY DATABASE AUDIT] unavailable " + code + "; original database preserved");
  } finally { await client.end().catch(() => {}); }
};
