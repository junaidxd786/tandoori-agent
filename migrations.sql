-- ============================================================
-- Tandoori Agent — Database Migrations
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ─── 1. conversations: add has_unread & staff_notes ────────
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS has_unread BOOLEAN DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS staff_notes TEXT;

-- ─── 2. menu_items: add sort_order ─────────────────────────
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- ─── 3. restaurant_settings: add min_delivery_amount ───────
ALTER TABLE restaurant_settings ADD COLUMN IF NOT EXISTS min_delivery_amount NUMERIC DEFAULT 0;

-- ─── 4. orders: trigger to auto-update updated_at ──────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── 5. messages: index on whatsapp_msg_id (explicit) ──────
-- The UNIQUE constraint already creates one, but this makes it explicit.
CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_msg_id
  ON messages(whatsapp_msg_id)
  WHERE whatsapp_msg_id IS NOT NULL;

-- ─── 6. orders: index on (conversation_id, created_at) ─────
-- Speeds up the "recent order" guard check in the webhook.
CREATE INDEX IF NOT EXISTS idx_orders_conv_created
  ON orders(conversation_id, created_at DESC);

-- ─── Done ───────────────────────────────────────────────────
