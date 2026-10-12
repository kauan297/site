"use strict";

// Auditoria administrativa opcional, somente leitura, sem imprimir dados de clientes.
module.exports = async function auditLegacyDatabase({ env = process.env, logger = console, ClientClass } = {}) {
  if (env.PALCOLIVE_LEGACY_AUDIT !== "1") return;
  if (!ClientClass) ClientClass = require("pg").Client;
  const connectionString = env.DATABASE_URL;
  if (!connectionString) { logger.log("[LEGACY DATABASE AUDIT] no connection configured"); return; }
  const client = new ClientClass({ connectionString, connectionTimeoutMillis: 5000,
    ssl: env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined });
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
    logger.log("[LEGACY DATABASE AUDIT] " + JSON.stringify({ tables: tables.rows.length, rows,
      empty: rows === 0, migrationRequired: rows !== 0 }));
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("[LEGACY DATABASE AUDIT] unavailable; original database preserved");
  } finally { await client.end().catch(() => {}); }
};
