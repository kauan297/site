"use strict";

// Aggregate page views only: no visitor IDs, cookies, stored IPs or referrers.
function createStore(pool) {
  let readyPromise;
  async function ready() {
    if (!pool) throw new Error("Visit storage unavailable");
    if (!readyPromise) {
      readyPromise = pool.query(`CREATE TABLE IF NOT EXISTS palcolive_sales_visits (
        day DATE PRIMARY KEY,
        views BIGINT NOT NULL CHECK (views > 0),
        first_view_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_view_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`).catch(error => { readyPromise = null; throw error; });
    }
    await readyPromise;
  }
  return {
    async record() {
      await ready();
      await pool.query(`INSERT INTO palcolive_sales_visits (day, views)
        VALUES ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date, 1)
        ON CONFLICT (day) DO UPDATE SET views = palcolive_sales_visits.views + 1,
        last_view_at = NOW()`);
    },
    async summary() {
      await ready();
      const totals = await pool.query(`SELECT COALESCE(SUM(views), 0)::text AS total,
        COALESCE(SUM(views) FILTER (WHERE day = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date), 0)::text AS today,
        MIN(first_view_at) AS started_at FROM palcolive_sales_visits`);
      const daily = await pool.query(`SELECT day::text AS day, views::text AS views
        FROM palcolive_sales_visits
        WHERE day >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 29 ORDER BY day DESC`);
      return { ...totals.rows[0], daily: daily.rows, timezone: "America/Sao_Paulo" };
    }
  };
}

function registerRoutes({ app, store, adminSecret, secureEqualText, limited, clientIp }) {
  app.post("/api/sales/visit", async (req, res) => {
    const origin = req.get("origin");
    if (!origin || origin !== `${req.protocol}://${req.get("host")}`) {
      return res.status(403).json({ ok: false });
    }
    if (req.body?.page !== "/vendas") return res.status(400).json({ ok: false });
    if (/bot|crawler|spider|headless|preview|slurp/i.test(req.get("user-agent") || "") ||
        req.get("dnt") === "1" || req.get("sec-gpc") === "1") return res.sendStatus(204);
    if (limited("sales-visits:" + clientIp(req), 30, 60_000)) return res.sendStatus(429);
    try { await store.record(); return res.sendStatus(204); }
    catch { return res.status(503).json({ ok: false }); }
  });

  app.get("/api/admin/visits", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (limited("sales-visits-admin:" + clientIp(req), 20, 5 * 60_000)) return res.sendStatus(429);
    if (!adminSecret || !secureEqualText(req.get("x-palcolive-admin") || "", adminSecret)) {
      return res.status(403).json({ ok: false, error: "Senha do vendedor inválida." });
    }
    try { return res.json({ ok: true, ...(await store.summary()) }); }
    catch { return res.status(503).json({ ok: false, error: "Contagem indisponível. Tente novamente." }); }
  });
}

module.exports = { createStore, registerRoutes };
