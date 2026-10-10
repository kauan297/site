-- Schema existente de licenças Kiwify, sem apagar ou substituir pedidos.
CREATE TABLE IF NOT EXISTS palcolive_kiwify_orders (
  order_id TEXT PRIMARY KEY,
  order_ref TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL,
  email_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('paid', 'revoked')),
  device_digest TEXT DEFAULT NULL,
  expires_at TIMESTAMPTZ DEFAULT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE palcolive_kiwify_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;
