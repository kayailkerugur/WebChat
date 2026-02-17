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

alter table messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references users(id) on delete set null,
  add column if not exists deleted_for_all boolean not null default false;

create index if not exists idx_messages_deleted_for_all
  on messages (conversation_id, deleted_for_all);

create table if not exists message_deletions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists idx_msg_del_user_conv
  on message_deletions (user_id, message_id);

-- E2EE public keys table
create table if not exists e2ee_public_keys (
  user_id uuid not null references users(id) on delete cascade,
  device_id text not null,
  sign_pub_jwk jsonb not null,
  dh_pub_jwk jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create index if not exists idx_e2ee_keys_user on e2ee_public_keys(user_id);