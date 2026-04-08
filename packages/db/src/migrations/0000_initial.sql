create table if not exists users (
  id uuid primary key,
  tenant_id varchar(128) not null,
  email varchar(320),
  display_name varchar(255),
  subject varchar(255) not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists users_tenant_subject_idx
  on users (tenant_id, subject);

create table if not exists user_identities (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  provider varchar(64) not null,
  subject varchar(255) not null,
  tenant_id varchar(128) not null,
  created_at timestamptz not null
);

create unique index if not exists user_identities_provider_subject_tenant_idx
  on user_identities (provider, subject, tenant_id);

create table if not exists tenants (
  id varchar(128) primary key,
  name varchar(255),
  is_allowed boolean not null default true,
  created_at timestamptz not null
);

create table if not exists trusted_devices (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  label varchar(120) not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null
);

create table if not exists refresh_tokens (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by_token_id uuid,
  created_at timestamptz not null
);

create table if not exists environments (
  id uuid primary key,
  owner_user_id uuid not null references users(id) on delete cascade,
  kind varchar(32) not null,
  machine_name varchar(255) not null,
  directory text not null,
  branch varchar(255),
  git_repo_url text,
  max_sessions integer not null default 1,
  metadata jsonb,
  secret_hash text not null,
  archived_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists sessions (
  id uuid primary key,
  owner_user_id uuid not null references users(id) on delete cascade,
  environment_id uuid references environments(id) on delete set null,
  status varchar(32) not null,
  title varchar(255),
  metadata jsonb,
  worker_epoch integer not null default 0,
  last_event_seq integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  archived_at timestamptz
);

create table if not exists session_events (
  id uuid primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  seq integer not null,
  type varchar(128) not null,
  payload jsonb not null,
  created_at timestamptz not null
);

create unique index if not exists session_events_session_seq_idx
  on session_events (session_id, seq);

create table if not exists session_subscribers (
  id uuid primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  created_at timestamptz not null
);

create table if not exists work_items (
  id uuid primary key,
  environment_id uuid not null references environments(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  token text not null,
  token_hash text not null,
  status varchar(32) not null,
  created_at timestamptz not null,
  claimed_at timestamptz,
  heartbeat_at timestamptz
);

create index if not exists work_items_environment_status_idx
  on work_items (environment_id, status, created_at);

create table if not exists worker_leases (
  id uuid primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  worker_epoch integer not null,
  lease_expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists worker_credentials (
  id uuid primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  worker_epoch integer not null,
  token_jti varchar(255) not null,
  expires_at timestamptz not null,
  connected_at timestamptz,
  created_at timestamptz not null
);

create index if not exists worker_credentials_session_created_idx
  on worker_credentials (session_id, created_at desc);

create table if not exists audit_logs (
  id uuid primary key,
  actor_user_id uuid references users(id) on delete set null,
  action varchar(128) not null,
  target_type varchar(64) not null,
  target_id varchar(255) not null,
  metadata jsonb,
  created_at timestamptz not null
);
