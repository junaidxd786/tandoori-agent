create extension if not exists pgcrypto;

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  address text not null default 'Please update this branch address',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into branches (slug, name, address)
values ('default-branch', 'Default Branch', 'Please update this branch address')
on conflict (slug) do nothing;

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  active_branch_id uuid references branches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into contacts (phone, name)
select distinct c.phone, c.name
from conversations c
on conflict (phone) do update set name = excluded.name;

alter table conversations add column if not exists contact_id uuid references contacts(id) on delete cascade;
alter table conversations add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table conversations add column if not exists has_unread boolean not null default false;
alter table conversations add column if not exists staff_notes text;

update conversations set contact_id = contacts.id
from contacts
where conversations.contact_id is null and conversations.phone = contacts.phone;

update conversations set branch_id = branches.id
from branches
where conversations.branch_id is null and branches.slug = 'default-branch';

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'conversations' and constraint_name = 'conversations_phone_key'
  ) then
    alter table conversations drop constraint conversations_phone_key;
  end if;
exception when undefined_object then null;
end $$;

create unique index if not exists idx_conversations_contact_branch_unique on conversations(contact_id, branch_id);

alter table restaurant_settings drop constraint if exists restaurant_settings_id_check;
alter table restaurant_settings drop constraint if exists ensure_single_row;
do $$ begin
  if not exists (select 1 from pg_class where relname = 'restaurant_settings_id_seq') then
    create sequence restaurant_settings_id_seq;
  end if;
end $$;
alter table restaurant_settings alter column id set default nextval('restaurant_settings_id_seq');
select setval('restaurant_settings_id_seq', greatest((select coalesce(max(id), 0) from restaurant_settings), 1), true);

alter table restaurant_settings add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table restaurant_settings add column if not exists min_delivery_amount numeric not null default 0;
alter table restaurant_settings add column if not exists delivery_enabled boolean not null default false;
alter table restaurant_settings add column if not exists delivery_fee numeric not null default 0;
alter table restaurant_settings add column if not exists city text not null default 'Wah Cantt';
alter table restaurant_settings add column if not exists phone_delivery text not null default '0341-1007722';
alter table restaurant_settings add column if not exists phone_dine_in text not null default '051-4904211';
alter table restaurant_settings add column if not exists ai_personality text not null default 'Warm & Professional';

update restaurant_settings set branch_id = branches.id
from branches
where restaurant_settings.branch_id is null and branches.slug = 'default-branch';

create unique index if not exists idx_restaurant_settings_branch_id on restaurant_settings(branch_id);
insert into restaurant_settings (branch_id)
select id from branches where slug = 'default-branch'
on conflict (branch_id) do nothing;

alter table menu_items add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table menu_items add column if not exists sort_order integer not null default 0;
alter table menu_items add column if not exists description text;
update menu_items set branch_id = branches.id
from branches
where menu_items.branch_id is null and branches.slug = 'default-branch';

alter table menu_uploads add column if not exists branch_id uuid references branches(id) on delete cascade;
update menu_uploads set branch_id = branches.id
from branches
where menu_uploads.branch_id is null and branches.slug = 'default-branch';

create sequence if not exists messages_ingest_seq_seq;
alter table messages add column if not exists ingest_seq bigint;
alter table messages alter column ingest_seq set default nextval('messages_ingest_seq_seq');
update messages set ingest_seq = nextval('messages_ingest_seq_seq') where ingest_seq is null;
alter table messages alter column ingest_seq set not null;
alter table messages add column if not exists sender_kind text not null default 'user';
alter table messages add column if not exists delivery_status text;
alter table messages add column if not exists delivery_error text;
update messages
set sender_kind = case when role = 'user' then 'user' else 'ai' end
where sender_kind is null or sender_kind not in ('user', 'ai', 'human', 'system');
alter table messages drop constraint if exists messages_sender_kind_check;
alter table messages add constraint messages_sender_kind_check check (sender_kind in ('user', 'ai', 'human', 'system')) not valid;
alter table messages drop constraint if exists messages_delivery_status_check;
alter table messages add constraint messages_delivery_status_check check (delivery_status is null or delivery_status in ('pending', 'sent', 'failed')) not valid;

create table if not exists conversation_states (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references conversations(id) on delete cascade,
  workflow_step text not null default 'idle',
  cart jsonb not null default '[]'::jsonb,
  preferred_language text not null default 'english',
  resume_workflow_step text,
  last_presented_category text,
  last_presented_at timestamptz,
  last_presented_options jsonb,
  last_presented_options_at timestamptz,
  order_type text,
  address text,
  guests integer,
  reservation_time timestamptz,
  upsell_item_name text,
  upsell_item_price numeric,
  upsell_offered boolean not null default false,
  declined_upsells jsonb not null default '[]'::jsonb,
  summary_sent_at timestamptz,
  last_user_whatsapp_msg_id text,
  last_processed_user_message_id text,
  last_processed_message_seq bigint,
  last_processed_user_message_at timestamptz,
  processing_token text,
  processing_started_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into conversation_states (conversation_id)
select id from conversations
on conflict (conversation_id) do nothing;

alter table conversation_states add column if not exists preferred_language text not null default 'english';
alter table conversation_states add column if not exists resume_workflow_step text;
alter table conversation_states add column if not exists last_processed_message_seq bigint;
alter table conversation_states add column if not exists last_presented_category text;
alter table conversation_states add column if not exists last_presented_at timestamptz;
alter table conversation_states add column if not exists last_presented_options jsonb;
alter table conversation_states add column if not exists last_presented_options_at timestamptz;
alter table conversation_states add column if not exists declined_upsells jsonb not null default '[]'::jsonb;
alter table conversation_states drop constraint if exists conversation_states_preferred_language_check;
alter table conversation_states add constraint conversation_states_preferred_language_check check (preferred_language in ('english', 'roman_urdu')) not valid;
alter table conversation_states drop constraint if exists conversation_states_workflow_step_check;
alter table conversation_states add constraint conversation_states_workflow_step_check check (
  workflow_step in ('idle', 'awaiting_branch_selection', 'collecting_items', 'awaiting_upsell_reply', 'awaiting_order_type', 'awaiting_delivery_address', 'awaiting_dine_in_details', 'awaiting_confirmation', 'awaiting_resume_decision')
) not valid;
alter table conversation_states drop constraint if exists conversation_states_resume_workflow_step_check;
alter table conversation_states add constraint conversation_states_resume_workflow_step_check check (
  resume_workflow_step is null or resume_workflow_step in ('idle', 'awaiting_branch_selection', 'collecting_items', 'awaiting_upsell_reply', 'awaiting_order_type', 'awaiting_delivery_address', 'awaiting_dine_in_details', 'awaiting_confirmation')
) not valid;

alter table orders add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table orders add column if not exists source_user_message_id text;
alter table orders add column if not exists assigned_to text;
alter table orders add column if not exists status_notified_at timestamptz;
alter table orders add column if not exists status_notification_status text;
alter table orders add column if not exists status_notification_error text;
alter table order_items add column if not exists created_at timestamptz not null default now();

update orders set branch_id = conversations.branch_id
from conversations
where orders.branch_id is null and orders.conversation_id = conversations.id;
update orders set branch_id = branches.id
from branches
where orders.branch_id is null and branches.slug = 'default-branch';

create unique index if not exists idx_orders_source_user_message_id on orders(source_user_message_id) where source_user_message_id is not null;
alter table orders drop constraint if exists orders_status_notification_status_check;
alter table orders add constraint orders_status_notification_status_check check (status_notification_status is null or status_notification_status in ('sent', 'failed', 'skipped')) not valid;
alter table orders drop constraint if exists orders_require_delivery_fields;
alter table orders add constraint orders_require_delivery_fields check (
  (type = 'delivery' and address is not null and guests is null and reservation_time is null)
  or
  (type = 'dine-in' and address is null and guests is not null and reservation_time is not null)
) not valid;

update contacts set active_branch_id = branches.id
from branches
where contacts.active_branch_id is null and branches.slug = 'default-branch';

create table if not exists staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'branch_staff' check (role in ('admin', 'branch_staff')),
  default_branch_id uuid references branches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staff_branch_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);

create index if not exists idx_contacts_active_branch on contacts(active_branch_id);
create index if not exists idx_conversations_branch_updated on conversations(branch_id, updated_at desc);
create index if not exists idx_messages_conversation_created on messages(conversation_id, created_at desc);
create unique index if not exists idx_messages_ingest_seq on messages(ingest_seq);
create index if not exists idx_messages_conversation_ingest_seq on messages(conversation_id, ingest_seq asc);
create index if not exists idx_messages_whatsapp_msg_id on messages(whatsapp_msg_id) where whatsapp_msg_id is not null;
create index if not exists idx_orders_branch_created on orders(branch_id, created_at desc);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_conversation_states_conversation on conversation_states(conversation_id);
create index if not exists idx_menu_items_branch_name_lookup on menu_items(branch_id, lower(trim(name)));
create index if not exists idx_menu_uploads_branch_created on menu_uploads(branch_id, created_at desc);

create or replace function update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_branches_updated_at on branches;
create trigger update_branches_updated_at before update on branches for each row execute function update_updated_at_column();
drop trigger if exists update_contacts_updated_at on contacts;
create trigger update_contacts_updated_at before update on contacts for each row execute function update_updated_at_column();
drop trigger if exists update_conversations_updated_at on conversations;
create trigger update_conversations_updated_at before update on conversations for each row execute function update_updated_at_column();
drop trigger if exists update_restaurant_settings_updated_at on restaurant_settings;
create trigger update_restaurant_settings_updated_at before update on restaurant_settings for each row execute function update_updated_at_column();
drop trigger if exists update_menu_items_updated_at on menu_items;
create trigger update_menu_items_updated_at before update on menu_items for each row execute function update_updated_at_column();
drop trigger if exists update_conversation_states_updated_at on conversation_states;
create trigger update_conversation_states_updated_at before update on conversation_states for each row execute function update_updated_at_column();
drop trigger if exists update_orders_updated_at on orders;
create trigger update_orders_updated_at before update on orders for each row execute function update_updated_at_column();
drop trigger if exists update_staff_profiles_updated_at on staff_profiles;
create trigger update_staff_profiles_updated_at before update on staff_profiles for each row execute function update_updated_at_column();

alter table branches enable row level security;
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table restaurant_settings enable row level security;
alter table menu_items enable row level security;
alter table menu_uploads enable row level security;
alter table conversation_states enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table staff_profiles enable row level security;
alter table staff_branch_access enable row level security;

drop policy if exists "service_branches" on branches;
create policy "service_branches" on branches for all using (true);
drop policy if exists "service_contacts" on contacts;
create policy "service_contacts" on contacts for all using (true);
drop policy if exists "service_conversations" on conversations;
create policy "service_conversations" on conversations for all using (true);
drop policy if exists "service_messages" on messages;
create policy "service_messages" on messages for all using (true);
drop policy if exists "service_settings" on restaurant_settings;
create policy "service_settings" on restaurant_settings for all using (true);
drop policy if exists "service_menu_items" on menu_items;
create policy "service_menu_items" on menu_items for all using (true);
drop policy if exists "service_menu_uploads" on menu_uploads;
create policy "service_menu_uploads" on menu_uploads for all using (true);
drop policy if exists "service_conversation_states" on conversation_states;
create policy "service_conversation_states" on conversation_states for all using (true);
drop policy if exists "service_orders" on orders;
create policy "service_orders" on orders for all using (true);
drop policy if exists "service_order_items" on order_items;
create policy "service_order_items" on order_items for all using (true);
drop policy if exists "service_staff_profiles" on staff_profiles;
create policy "service_staff_profiles" on staff_profiles for all using (true);
drop policy if exists "service_staff_branch_access" on staff_branch_access;
create policy "service_staff_branch_access" on staff_branch_access for all using (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'branches') then
    alter publication supabase_realtime add table branches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversations') then
    alter publication supabase_realtime add table conversations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversation_states') then
    alter publication supabase_realtime add table conversation_states;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orders') then
    alter publication supabase_realtime add table orders;
  end if;
end $$;

create or replace function apply_menu_catalog(branch_uuid uuid, menu_payload jsonb, replace_all boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  duplicate_name text;
begin
  select lower(trim(item.name))
  into duplicate_name
  from jsonb_to_recordset(menu_payload) as item(
    name text,
    price numeric,
    category text,
    description text,
    is_available boolean,
    sort_order integer
  )
  group by lower(trim(item.name))
  having count(*) > 1
  limit 1;

  if duplicate_name is not null then
    raise exception 'Duplicate menu item in payload: %', duplicate_name;
  end if;

  create temp table tmp_menu_payload (
    normalized_name text primary key,
    name text not null,
    price numeric not null,
    category text,
    description text,
    is_available boolean not null,
    sort_order integer not null
  ) on commit drop;

  insert into tmp_menu_payload (normalized_name, name, price, category, description, is_available, sort_order)
  select lower(trim(item.name)), trim(item.name), item.price,
    nullif(regexp_replace(trim(coalesce(item.category, '')), '\s+', ' ', 'g'), ''),
    nullif(trim(item.description), ''), coalesce(item.is_available, true), coalesce(item.sort_order, 0)
  from jsonb_to_recordset(menu_payload) as item(
    name text,
    price numeric,
    category text,
    description text,
    is_available boolean,
    sort_order integer
  )
  where trim(coalesce(item.name, '')) <> '';

  update menu_items as existing
  set name = incoming.name, price = incoming.price, category = incoming.category, description = incoming.description, is_available = incoming.is_available, sort_order = incoming.sort_order
  from tmp_menu_payload as incoming
  where existing.branch_id = branch_uuid and lower(trim(existing.name)) = incoming.normalized_name;

  insert into menu_items (branch_id, name, price, category, description, is_available, sort_order)
  select branch_uuid, incoming.name, incoming.price, incoming.category, incoming.description, incoming.is_available, incoming.sort_order
  from tmp_menu_payload as incoming
  where not exists (
    select 1 from menu_items as existing
    where existing.branch_id = branch_uuid and lower(trim(existing.name)) = incoming.normalized_name
  );

  if replace_all then
    delete from menu_items as existing
    where existing.branch_id = branch_uuid
      and not exists (
        select 1 from tmp_menu_payload as incoming
        where incoming.normalized_name = lower(trim(existing.name))
      );
  end if;

  return jsonb_build_object('branch_id', branch_uuid, 'applied', (select count(*) from tmp_menu_payload), 'replace_all', replace_all);
end;
$$;

create or replace function replace_menu_items(branch_uuid uuid, menu_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform apply_menu_catalog(branch_uuid, menu_payload, true);
end;
$$;
