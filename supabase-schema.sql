-- ============================================================
-- Tandoori Restaurant WhatsApp Agent — Supabase Database Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Conversations
create table if not exists conversations (
  id          uuid default gen_random_uuid() primary key,
  phone       text unique not null,
  name        text,
  mode        text not null default 'agent'
                check (mode in ('agent', 'human')),
  updated_at  timestamptz default now(),
  created_at  timestamptz default now()
);

-- 2. Messages
create table if not exists messages (
  id                uuid default gen_random_uuid() primary key,
  conversation_id   uuid references conversations(id) on delete cascade not null,
  role              text not null check (role in ('user', 'assistant')),
  content           text not null,
  whatsapp_msg_id   text unique,
  created_at        timestamptz default now()
);

-- 3. Orders
create table if not exists orders (
  id               uuid default gen_random_uuid() primary key,
  conversation_id  uuid references conversations(id) on delete cascade not null,
  order_number     serial unique not null,
  type             text not null check (type in ('delivery', 'dine-in')),
  status           text not null default 'received'
                     check (status in (
                       'received', 'preparing',
                       'out_for_delivery', 'delivered', 'cancelled'
                     )),
  subtotal         numeric not null,
  delivery_fee     numeric not null default 0,
  total            numeric generated always as (subtotal + delivery_fee) stored,
  address          text,
  guests           integer,
  reservation_time timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- 4. Order Items
create table if not exists order_items (
  id        uuid default gen_random_uuid() primary key,
  order_id  uuid references orders(id) on delete cascade not null,
  name      text not null,
  qty       integer not null,
  price     numeric not null
);

-- 5. Menu Items (extracted from photos)
create table if not exists menu_items (
  id          uuid default gen_random_uuid() primary key,
  name        text not null,
  price       numeric not null,
  category    text,
  description text,
  is_available boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 6. Menu Uploads
create table if not exists menu_uploads (
  id          uuid default gen_random_uuid() primary key,
  image_url   text not null,
  status      text not null default 'pending' 
                check (status in ('pending', 'processing', 'completed', 'error')),
  error_message text,
  created_at  timestamptz default now()
);

-- ─── Indexes ────────────────────────────────────────────────
create index if not exists idx_messages_conversation
  on messages(conversation_id);

create index if not exists idx_conversations_updated
  on conversations(updated_at desc);

create index if not exists idx_orders_conversation
  on orders(conversation_id);

create index if not exists idx_orders_status
  on orders(status);

create index if not exists idx_orders_created
  on orders(created_at desc);

-- ─── Row Level Security (RLS) ────────────────────────────────
-- Enable RLS on all tables
alter table conversations  enable row level security;
alter table messages       enable row level security;
alter table orders         enable row level security;
alter table order_items    enable row level security;

-- Allow service_role to do everything (used by backend API routes)
create policy "Service role full access on conversations"
  on conversations for all using (true);

create policy "Service role full access on messages"
  on messages for all using (true);

create policy "Service role full access on orders"
  on orders for all using (true);

create policy "Service role full access on order_items"
  on order_items for all using (true);

create policy "Service role full access on menu_items"
  on menu_items for all using (true);

create policy "Service role full access on menu_uploads"
  on menu_uploads for all using (true);

-- ─── Realtime ────────────────────────────────────────────────
-- Enable Realtime for the dashboard live updates
-- Run these in Supabase Dashboard → Database → Replication
-- Or use the Supabase UI to add tables to the Realtime publication.
-- (The SQL below may need to be run separately if publication exists)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table orders;
  end if;
end $$;

-- 7. Restaurant Settings
create table if not exists restaurant_settings (
  id integer primary key default 1,     -- enforce a single row
  is_accepting_orders boolean default true not null,
  opening_time text default '10:00 AM' not null,
  closing_time text default '11:00 PM' not null,
  updated_at timestamptz default now()
);

-- Ensure only one row can exist
alter table restaurant_settings add constraint ensure_single_row check (id = 1);

-- Default settings row
insert into restaurant_settings (id, is_accepting_orders, opening_time, closing_time)
values (1, true, '10:00 AM', '11:00 PM')
on conflict (id) do nothing;

alter table restaurant_settings enable row level security;

create policy "Service role full access on restaurant_settings"
  on restaurant_settings for all using (true);

-- ─── Triggers ────────────────────────────────────────────────
-- Auto-update updated_at on conversations and orders

create or replace function update_updated_at_column()
returns trigger as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$ language plpgsql;

create trigger update_conversations_updated_at
  before update on conversations
  for each row execute function update_updated_at_column();

create trigger update_orders_updated_at
  before update on orders
  for each row execute function update_updated_at_column();

