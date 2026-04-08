create extension if not exists pgcrypto;

alter table conversations add column if not exists has_unread boolean not null default false;
alter table conversations add column if not exists staff_notes text;

alter table restaurant_settings add column if not exists min_delivery_amount numeric not null default 0;
alter table restaurant_settings add column if not exists delivery_enabled boolean not null default false;
alter table restaurant_settings add column if not exists delivery_fee numeric not null default 0;

alter table menu_items add column if not exists sort_order integer not null default 0;

create sequence if not exists messages_ingest_seq_seq;
alter table messages add column if not exists ingest_seq bigint;
alter table messages alter column ingest_seq set default nextval('messages_ingest_seq_seq');
update messages set ingest_seq = nextval('messages_ingest_seq_seq') where ingest_seq is null;
alter table messages alter column ingest_seq set not null;
alter table messages add column if not exists sender_kind text not null default 'user';
alter table messages add column if not exists delivery_status text;
alter table messages add column if not exists delivery_error text;

update messages
set sender_kind = case
  when role = 'user' then 'user'
  else 'ai'
end
where sender_kind is null
   or sender_kind not in ('user', 'ai', 'human', 'system');

alter table messages
  drop constraint if exists messages_sender_kind_check;

alter table messages
  add constraint messages_sender_kind_check
  check (sender_kind in ('user', 'ai', 'human', 'system')) not valid;

alter table messages
  drop constraint if exists messages_delivery_status_check;

alter table messages
  add constraint messages_delivery_status_check
  check (delivery_status is null or delivery_status in ('pending', 'sent', 'failed')) not valid;

alter table order_items add column if not exists created_at timestamptz not null default now();

alter table orders add column if not exists source_user_message_id text;
alter table orders add column if not exists assigned_to text;
alter table orders add column if not exists status_notified_at timestamptz;
alter table orders add column if not exists status_notification_status text;
alter table orders add column if not exists status_notification_error text;
create unique index if not exists idx_orders_source_user_message_id on orders(source_user_message_id) where source_user_message_id is not null;

alter table orders
  drop constraint if exists orders_status_notification_status_check;

alter table orders
  add constraint orders_status_notification_status_check
  check (status_notification_status is null or status_notification_status in ('sent', 'failed', 'skipped')) not valid;

create table if not exists conversation_states (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references conversations(id) on delete cascade,
  workflow_step text not null default 'idle' check (
    workflow_step in (
      'idle',
      'collecting_items',
      'awaiting_upsell_reply',
      'awaiting_order_type',
      'awaiting_delivery_address',
      'awaiting_dine_in_details',
      'awaiting_confirmation',
      'awaiting_resume_decision'
    )
  ),
  cart jsonb not null default '[]'::jsonb,
  preferred_language text not null default 'english' check (preferred_language in ('english', 'roman_urdu')),
  resume_workflow_step text check (
    resume_workflow_step in (
      'idle',
      'collecting_items',
      'awaiting_upsell_reply',
      'awaiting_order_type',
      'awaiting_delivery_address',
      'awaiting_dine_in_details',
      'awaiting_confirmation'
    )
  ),
  last_presented_category text,
  last_presented_at timestamptz,
  order_type text check (order_type in ('delivery', 'dine-in')),
  address text,
  guests integer check (guests is null or guests > 0),
  reservation_time timestamptz,
  upsell_item_name text,
  upsell_item_price numeric,
  upsell_offered boolean not null default false,
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

alter table conversation_states
  add column if not exists preferred_language text not null default 'english';

alter table conversation_states
  add column if not exists resume_workflow_step text;

alter table conversation_states
  add column if not exists last_processed_message_seq bigint;

alter table conversation_states
  add column if not exists last_presented_category text;

alter table conversation_states
  add column if not exists last_presented_at timestamptz;

alter table conversation_states
  drop constraint if exists conversation_states_preferred_language_check;

alter table conversation_states
  add constraint conversation_states_preferred_language_check
  check (preferred_language in ('english', 'roman_urdu')) not valid;

alter table conversation_states
  drop constraint if exists conversation_states_workflow_step_check;

alter table conversation_states
  add constraint conversation_states_workflow_step_check
  check (
    workflow_step in (
      'idle',
      'collecting_items',
      'awaiting_upsell_reply',
      'awaiting_order_type',
      'awaiting_delivery_address',
      'awaiting_dine_in_details',
      'awaiting_confirmation',
      'awaiting_resume_decision'
    )
  ) not valid;

alter table conversation_states
  drop constraint if exists conversation_states_resume_workflow_step_check;

alter table conversation_states
  add constraint conversation_states_resume_workflow_step_check
  check (
    resume_workflow_step is null
    or resume_workflow_step in (
      'idle',
      'collecting_items',
      'awaiting_upsell_reply',
      'awaiting_order_type',
      'awaiting_delivery_address',
      'awaiting_dine_in_details',
      'awaiting_confirmation'
    )
  ) not valid;

insert into conversation_states (conversation_id)
select id from conversations
on conflict (conversation_id) do nothing;

alter table conversation_states enable row level security;
drop policy if exists "service_conversation_states" on conversation_states;
create policy "service_conversation_states" on conversation_states for all using (true);

create index if not exists idx_messages_conversation_created on messages(conversation_id, created_at desc);
create unique index if not exists idx_messages_ingest_seq on messages(ingest_seq);
create index if not exists idx_messages_conversation_ingest_seq on messages(conversation_id, ingest_seq asc);
create index if not exists idx_messages_whatsapp_msg_id on messages(whatsapp_msg_id) where whatsapp_msg_id is not null;
create index if not exists idx_orders_conversation_created on orders(conversation_id, created_at desc);
create index if not exists idx_conversation_states_conversation on conversation_states(conversation_id);
create index if not exists idx_menu_items_name_lookup on menu_items((lower(trim(name))));

create or replace function update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_orders_updated_at on orders;
create trigger update_orders_updated_at
before update on orders
for each row execute function update_updated_at_column();

drop trigger if exists update_conversation_states_updated_at on conversation_states;
create trigger update_conversation_states_updated_at
before update on conversation_states
for each row execute function update_updated_at_column();

alter table orders
  drop constraint if exists orders_require_delivery_fields;

alter table orders
  add constraint orders_require_delivery_fields check (
    (type = 'delivery' and address is not null and guests is null and reservation_time is null)
    or
    (type = 'dine-in' and address is null and guests is not null and reservation_time is not null)
  ) not valid;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'conversation_states'
  ) then
    alter publication supabase_realtime add table conversation_states;
  end if;
end $$;

create or replace function apply_menu_catalog(menu_payload jsonb, replace_all boolean default false)
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
  select
    lower(trim(item.name)),
    trim(item.name),
    item.price,
    nullif(regexp_replace(trim(coalesce(item.category, '')), '\s+', ' ', 'g'), ''),
    nullif(trim(item.description), ''),
    coalesce(item.is_available, true),
    coalesce(item.sort_order, 0)
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
  set
    name = incoming.name,
    price = incoming.price,
    category = incoming.category,
    description = incoming.description,
    is_available = incoming.is_available,
    sort_order = incoming.sort_order
  from tmp_menu_payload as incoming
  where lower(trim(existing.name)) = incoming.normalized_name;

  insert into menu_items (name, price, category, description, is_available, sort_order)
  select
    incoming.name,
    incoming.price,
    incoming.category,
    incoming.description,
    incoming.is_available,
    incoming.sort_order
  from tmp_menu_payload as incoming
  where not exists (
    select 1
    from menu_items as existing
    where lower(trim(existing.name)) = incoming.normalized_name
  );

  if replace_all then
    delete from menu_items as existing
    where not exists (
      select 1
      from tmp_menu_payload as incoming
      where incoming.normalized_name = lower(trim(existing.name))
    );
  end if;

  return jsonb_build_object(
    'applied', (select count(*) from tmp_menu_payload),
    'replace_all', replace_all
  );
end;
$$;

create or replace function replace_menu_items(menu_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform apply_menu_catalog(menu_payload, true);
end;
$$;
