create extension if not exists "uuid-ossp";

create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  username text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default uuid_generate_v4(),
  type text not null check (type in ('DM')),
  created_at timestamptz not null default now()
);

create table if not exists conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table conversations
  add column if not exists dm_key text unique;

create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  body text not null,
  sent_at timestamptz not null default now()
);

create index if not exists idx_messages_conv_sentat on messages (conversation_id, sent_at desc);

alter table conversation_members
add column if not exists last_read_at timestamptz;

create index if not exists idx_cm_conv_user on conversation_members(conversation_id, user_id);
create index if not exists idx_msg_conv_sent on messages(conversation_id, sent_at desc);

alter table users
add column if not exists last_seen timestamptz,
add column if not exists is_online boolean default false;