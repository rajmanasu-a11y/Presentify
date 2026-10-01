-- =============================================================================
-- Presentify 0001 — foundation
--   packages, organisations, organisation settings, staff profiles, permissions,
--   audit log, login lockout, system settings, branding storage, and the
--   helper functions used by every Row-Level Security policy.
--
-- Isolation model
--   * Every organisation-owned row carries organisation_id.
--   * RLS policies compare it with app.current_org_id(), which is looked up
--     from the signed-in user's *active* profile on every statement — never
--     taken from anything the browser can change.
--   * Profiles, users and limits are changed only through SECURITY DEFINER
--     functions or the manage-users Edge Function (service role); the browser
--     has no direct write access to them.
-- =============================================================================

create extension if not exists citext with schema extensions;

-- Private schema: helpers and hooks. Not exposed through the REST API.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role, supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('SUPER_ADMIN', 'ORG_ADMIN', 'ORGANISER', 'PRESENTER');
create type public.org_status as enum ('ACTIVE', 'INACTIVE');

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Client IP and browser as forwarded by the gateway (nginx sets X-Real-IP).
create function app.request_ip() returns inet
language plpgsql stable as $$
declare
  h json := nullif(current_setting('request.headers', true), '')::json;
  v text;
begin
  v := coalesce(h ->> 'x-real-ip', split_part(h ->> 'x-forwarded-for', ',', 1));
  return nullif(trim(v), '')::inet;
exception when others then
  return null;
end $$;

create function app.request_user_agent() returns text
language sql stable as $$
  select left(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', 300)
$$;

-- -----------------------------------------------------------------------------
-- Packages (subscription templates) and organisations
-- -----------------------------------------------------------------------------
create table public.packages (
  id                            uuid primary key default gen_random_uuid(),
  code                          text not null unique check (code ~ '^[A-Z0-9_]{2,30}$'),
  name                          text not null check (length(trim(name)) between 2 and 80),
  description                   text,
  max_admins                    integer not null check (max_admins >= 1),
  max_users                     integer not null check (max_users >= 1),
  max_meetings                  integer not null check (max_meetings >= 0),
  max_presentations             integer not null check (max_presentations >= 0),
  max_participants_per_meeting  integer not null check (max_participants_per_meeting >= 1),
  storage_bytes                 bigint  not null check (storage_bytes >= 0),
  max_file_bytes                bigint  not null check (max_file_bytes > 0),
  -- Longest participant-data retention an organisation may choose; null = indefinite allowed.
  max_retention_days            integer check (max_retention_days > 0),
  features                      jsonb   not null default '{}'::jsonb,
  is_active                     boolean not null default true,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger packages_touch before update on public.packages
  for each row execute function app.touch_updated_at();

create table public.organisations (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (length(trim(name)) between 2 and 150),
  short_name            text check (length(short_name) <= 30),
  tagline               text check (length(tagline) <= 200),
  address               text check (length(address) <= 500),
  contact_name          text check (length(contact_name) <= 120),
  contact_email         extensions.citext check (contact_email is null or contact_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  contact_phone         text check (contact_phone is null or contact_phone ~ '^[0-9+()\- ]{6,20}$'),
  logo_path             text,
  seal_path             text,
  package_id            uuid not null references public.packages(id),
  -- Per-organisation overrides; null means "use the package value".
  max_admins                    integer check (max_admins >= 1),
  max_users                     integer check (max_users >= 1),
  max_meetings                  integer check (max_meetings >= 0),
  max_presentations             integer check (max_presentations >= 0),
  max_participants_per_meeting  integer check (max_participants_per_meeting >= 1),
  storage_bytes                 bigint  check (storage_bytes >= 0),
  max_file_bytes                bigint  check (max_file_bytes > 0),
  status                org_status not null default 'ACTIVE',
  expires_at            timestamptz,
  grace_days            integer not null default 15 check (grace_days between 0 and 365),
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index organisations_name_uq on public.organisations (lower(regexp_replace(trim(name), '\s+', ' ', 'g')));
create index organisations_package_idx on public.organisations (package_id);
create trigger organisations_touch before update on public.organisations
  for each row execute function app.touch_updated_at();

-- Effective limits = organisation override, otherwise package value.
create view public.organisation_limits with (security_invoker = true) as
select o.id as organisation_id,
       coalesce(o.max_admins, p.max_admins)                                     as max_admins,
       coalesce(o.max_users, p.max_users)                                       as max_users,
       coalesce(o.max_meetings, p.max_meetings)                                 as max_meetings,
       coalesce(o.max_presentations, p.max_presentations)                       as max_presentations,
       coalesce(o.max_participants_per_meeting, p.max_participants_per_meeting) as max_participants_per_meeting,
       coalesce(o.storage_bytes, p.storage_bytes)                               as storage_bytes,
       coalesce(o.max_file_bytes, p.max_file_bytes)                             as max_file_bytes,
       p.max_retention_days,
       p.features
from public.organisations o
join public.packages p on p.id = o.package_id;

create table public.organisation_settings (
  organisation_id             uuid primary key references public.organisations(id) on delete cascade,
  allowed_file_types          text[] not null default array['pdf','ppt','pptx','doc','docx','xls','xlsx','jpg','jpeg','png'],
  downloads_default           boolean not null default false,
  -- Participant registration form: which fields are shown and which are required.
  registration_fields         jsonb not null default '[
    {"key":"name","enabled":true,"required":true},
    {"key":"designation","enabled":true,"required":true},
    {"key":"organisation","enabled":true,"required":true},
    {"key":"mobile","enabled":false,"required":false},
    {"key":"email","enabled":false,"required":false},
    {"key":"department","enabled":false,"required":false},
    {"key":"location","enabled":false,"required":false}
  ]'::jsonb,
  consent_text_en             text,
  consent_text_kn             text,
  participant_retention_days  integer default 365 check (participant_retention_days in (30, 90, 180, 365)),
  keep_participant_directory  boolean not null default true,
  require_mfa_for_admins      boolean not null default false,
  default_language            text not null default 'en' check (default_language in ('en', 'kn')),
  brand_color                 text not null default '#0B2E5C' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  updated_at                  timestamptz not null default now(),
  constraint registration_fields_is_array check (jsonb_typeof(registration_fields) = 'array')
);
create trigger organisation_settings_touch before update on public.organisation_settings
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Staff profiles (one per login) and permissions
-- -----------------------------------------------------------------------------
create table public.profiles (
  user_id                     uuid primary key references auth.users(id) on delete cascade,
  organisation_id             uuid references public.organisations(id),
  role                        user_role not null,
  full_name                   text not null check (length(trim(full_name)) between 2 and 120),
  designation                 text check (length(designation) <= 120),
  phone                       text check (phone is null or phone ~ '^[0-9+()\- ]{6,20}$'),
  email                       extensions.citext not null,
  is_active                   boolean not null default true,
  -- Organiser may create meetings; presenter may see the live participant count.
  can_create_meetings         boolean not null default true,
  can_view_participant_count  boolean not null default false,
  must_change_password        boolean not null default true,
  preferred_language          text not null default 'en' check (preferred_language in ('en', 'kn')),
  last_sign_in_at             timestamptz,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint profiles_super_admin_has_no_org check ((role = 'SUPER_ADMIN') = (organisation_id is null))
);
create unique index profiles_email_uq on public.profiles (email);
create index profiles_org_idx on public.profiles (organisation_id, role) where is_active;
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

create table public.permissions (
  code        text primary key,
  description text not null
);
create table public.role_permissions (
  role            user_role not null,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role, permission_code)
);

insert into public.permissions (code, description) values
  ('SYSTEM_MANAGE',      'Manage system settings, packages and global security'),
  ('ORG_MANAGE_ALL',     'Create, edit, activate and deactivate organisations; set limits'),
  ('ORG_PROFILE_EDIT',   'Edit own organisation profile, branding and settings'),
  ('USER_MANAGE',        'Create and manage staff accounts of own organisation'),
  ('PRESENTER_MANAGE',   'Manage the presenter directory'),
  ('MEETING_MANAGE',     'Create and edit meetings, sessions and access settings'),
  ('MEETING_VIEW',       'View meetings of own organisation'),
  ('CONTENT_UPLOAD',     'Upload and replace presentations and supporting material'),
  ('QR_MANAGE',          'Generate, regenerate and revoke QR codes'),
  ('QR_DISPLAY',         'Display QR codes and presenter mode'),
  ('PARTICIPANT_VIEW',   'View participant and attendance records'),
  ('REPORT_VIEW',        'View and export reports'),
  ('AUDIT_VIEW',         'View the audit log');

insert into public.role_permissions (role, permission_code) values
  ('SUPER_ADMIN', 'SYSTEM_MANAGE'), ('SUPER_ADMIN', 'ORG_MANAGE_ALL'), ('SUPER_ADMIN', 'USER_MANAGE'),
  ('SUPER_ADMIN', 'AUDIT_VIEW'),
  ('ORG_ADMIN', 'ORG_PROFILE_EDIT'), ('ORG_ADMIN', 'USER_MANAGE'), ('ORG_ADMIN', 'PRESENTER_MANAGE'),
  ('ORG_ADMIN', 'MEETING_MANAGE'), ('ORG_ADMIN', 'MEETING_VIEW'), ('ORG_ADMIN', 'CONTENT_UPLOAD'),
  ('ORG_ADMIN', 'QR_MANAGE'), ('ORG_ADMIN', 'QR_DISPLAY'), ('ORG_ADMIN', 'PARTICIPANT_VIEW'),
  ('ORG_ADMIN', 'REPORT_VIEW'), ('ORG_ADMIN', 'AUDIT_VIEW'),
  ('ORGANISER', 'PRESENTER_MANAGE'), ('ORGANISER', 'MEETING_MANAGE'), ('ORGANISER', 'MEETING_VIEW'),
  ('ORGANISER', 'CONTENT_UPLOAD'), ('ORGANISER', 'QR_MANAGE'), ('ORGANISER', 'QR_DISPLAY'),
  ('ORGANISER', 'PARTICIPANT_VIEW'), ('ORGANISER', 'REPORT_VIEW'),
  ('PRESENTER', 'MEETING_VIEW'), ('PRESENTER', 'CONTENT_UPLOAD'), ('PRESENTER', 'QR_DISPLAY');

-- -----------------------------------------------------------------------------
-- System settings (global, Super Admin only)
-- -----------------------------------------------------------------------------
create table public.system_settings (
  key         text primary key check (key ~ '^[a-z0-9_.]+$'),
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);
create trigger system_settings_touch before update on public.system_settings
  for each row execute function app.touch_updated_at();

insert into public.system_settings (key, value, description) values
  ('security.lockout_threshold', '5',   'Failed sign-in attempts before an account is locked'),
  ('security.lockout_minutes',   '15',  'Minutes an account stays locked'),
  ('security.ip_retention_days', '90',  'Days IP addresses and browser details are kept in logs'),
  ('app.support_contact',        '""',  'Contact shown to users who need help');

-- -----------------------------------------------------------------------------
-- Current-user helpers used by RLS (SECURITY DEFINER: they read profiles
-- without being subject to its own policies; search_path pinned).
-- -----------------------------------------------------------------------------
create function app.aal() returns text
language sql stable as $$ select coalesce(auth.jwt() ->> 'aal', 'aal1') $$;

-- Super Admin rights require an active Super Admin profile AND an MFA-verified session.
create function app.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.is_active and p.role = 'SUPER_ADMIN'
  ) and app.aal() = 'aal2'
$$;

-- Organisation of the signed-in staff member, or null when the account is
-- inactive, the organisation is deactivated, or the organisation requires MFA
-- for administrators and this session has not completed it.
create function app.current_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.organisation_id
  from public.profiles p
  join public.organisations o on o.id = p.organisation_id
  join public.organisation_settings s on s.organisation_id = o.id
  where p.user_id = auth.uid()
    and p.is_active
    and o.status = 'ACTIVE'
    and not (p.role = 'ORG_ADMIN' and s.require_mfa_for_admins and app.aal() <> 'aal2')
$$;

create function app.has_perm(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role = p.role and rp.permission_code = p_code
    where p.user_id = auth.uid() and p.is_active
      and (p_code <> 'MEETING_MANAGE' or p.role <> 'ORGANISER' or p.can_create_meetings)
  ) and (app.current_org_id() is not null or app.is_super_admin())
$$;

-- ACTIVE | GRACE (expired, still fully usable) | READ_ONLY (grace over) | INACTIVE
create function app.org_access(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when o.status = 'INACTIVE' then 'INACTIVE'
    when o.expires_at is null or now() < o.expires_at then 'ACTIVE'
    when now() < o.expires_at + make_interval(days => o.grace_days) then 'GRACE'
    else 'READ_ONLY'
  end
  from public.organisations o where o.id = p_org
$$;

create function app.org_writable(p_org uuid) returns boolean
language sql stable as $$ select coalesce(app.org_access(p_org) in ('ACTIVE', 'GRACE'), false) $$;

grant execute on all functions in schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id               bigint generated always as identity primary key,
  occurred_at      timestamptz not null default now(),
  organisation_id  uuid references public.organisations(id) on delete set null,
  actor_user_id    uuid,
  actor_role       text,
  actor_name       text,
  action           text not null check (action ~ '^[A-Z_]+$'),
  entity_type      text,
  entity_id        text,
  summary          text,
  details          jsonb,
  ip               inet,
  user_agent       text
);
create index audit_logs_org_time_idx on public.audit_logs (organisation_id, occurred_at desc);
create index audit_logs_time_idx on public.audit_logs (occurred_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id, occurred_at desc);

-- Rows can never be changed or deleted, except that the retention job may blank
-- IP address and browser details after the configured period.
create function app.audit_logs_protect() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and current_setting('app.audit_redaction', true) = 'on'
     and (to_jsonb(new) - 'ip' - 'user_agent') = (to_jsonb(old) - 'ip' - 'user_agent')
     and new.ip is null and new.user_agent is null then
    return new;
  end if;
  raise exception 'Audit records cannot be changed or deleted.' using errcode = 'P0001';
end $$;
create trigger audit_logs_protect before update or delete on public.audit_logs
  for each row execute function app.audit_logs_protect();
-- TRUNCATE would bypass row triggers.
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function app.audit_logs_protect();

-- Writes one audit record for the current user (or the system).
-- Server functions act with the service key on behalf of a signed-in staff
-- member; they name that person in the X-Presentify-Actor header, which is
-- trusted only for service-role requests (the key never reaches a browser).
create function app.actor_id() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is not null then
    return auth.uid();
  end if;
  if auth.role() = 'service_role' then
    return nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-presentify-actor', '')::uuid;
  end if;
  return null;
exception when others then
  return null;
end $$;

create function app.audit(p_action text, p_entity_type text, p_entity_id text, p_summary text,
                          p_details jsonb default null, p_org uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.actor_id();
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where user_id = v_actor;
  insert into public.audit_logs (organisation_id, actor_user_id, actor_role, actor_name, action,
                                 entity_type, entity_id, summary, details, ip, user_agent)
  values (coalesce(p_org, v_profile.organisation_id), v_actor,
          coalesce(v_profile.role::text, nullif(auth.role(), ''), 'SYSTEM'),
          v_profile.full_name, p_action, p_entity_type, p_entity_id, p_summary, p_details,
          app.request_ip(), app.request_user_agent());
end $$;

-- Row-change audit trigger: records what changed (old/new values of changed fields).
create function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_entity text := tg_argv[0];
  v_id text;
  v_org uuid;
begin
  v_id := coalesce(v_new, v_old) ->> coalesce(tg_argv[1], 'id');
  v_org := nullif(coalesce(v_new, v_old) ->> coalesce(tg_argv[2], 'organisation_id'), '')::uuid;
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      continue when v_key in ('updated_at', 'last_sign_in_at');
      if v_new -> v_key is distinct from v_old -> v_key then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  end if;
  perform app.audit(
    upper(v_entity) || '_' || case tg_op when 'INSERT' then 'CREATED' when 'UPDATE' then 'UPDATED' else 'DELETED' end,
    v_entity, v_id, null,
    case tg_op when 'UPDATE' then v_changes when 'INSERT' then v_new else v_old end,
    v_org);
  return coalesce(new, old);
end $$;

create trigger packages_audit after insert or update or delete on public.packages
  for each row execute function app.audit_row_change('package', 'id', 'none');
create trigger organisations_audit after insert or update or delete on public.organisations
  for each row execute function app.audit_row_change('organisation', 'id', 'id');
create trigger organisation_settings_audit after update on public.organisation_settings
  for each row execute function app.audit_row_change('organisation_settings', 'organisation_id', 'organisation_id');
create trigger profiles_audit after insert or update on public.profiles
  for each row execute function app.audit_row_change('user', 'user_id', 'organisation_id');
create trigger system_settings_audit after update on public.system_settings
  for each row execute function app.audit_row_change('system_setting', 'key', 'none');

-- -----------------------------------------------------------------------------
-- Organisation rules (triggers)
-- -----------------------------------------------------------------------------

-- Every organisation gets a settings row.
create function app.organisation_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organisation_settings (organisation_id) values (new.id);
  return new;
end $$;
create trigger organisations_create_settings after insert on public.organisations
  for each row execute function app.organisation_created();

-- Only the Super Admin may change package, limits, status, expiry or grace;
-- organisation admins edit only profile/branding fields, and only while writable.
-- (SECURITY INVOKER on purpose: current_user must be the caller, not the owner.)
create function app.organisations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.role() = 'service_role' or app.is_super_admin() or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  if (new.package_id, new.max_admins, new.max_users, new.max_meetings, new.max_presentations,
      new.max_participants_per_meeting, new.storage_bytes, new.max_file_bytes, new.status,
      new.expires_at, new.grace_days, new.created_by, new.created_at, new.id)
     is distinct from
     (old.package_id, old.max_admins, old.max_users, old.max_meetings, old.max_presentations,
      old.max_participants_per_meeting, old.storage_bytes, old.max_file_bytes, old.status,
      old.expires_at, old.grace_days, old.created_by, old.created_at, old.id) then
    raise exception 'Only the Presentify administrator can change the package, limits, status or expiry.'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger organisations_guard before update on public.organisations
  for each row execute function app.organisations_guard();

-- Retention chosen by an organisation may not exceed its package maximum.
create function app.settings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer;
begin
  select max_retention_days into v_max from public.organisation_limits where organisation_id = new.organisation_id;
  if v_max is not null and (new.participant_retention_days is null or new.participant_retention_days > v_max) then
    raise exception 'Your package allows participant records to be kept for at most % days.', v_max
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger organisation_settings_guard before insert or update on public.organisation_settings
  for each row execute function app.settings_guard();

-- Administrator / user limits, checked inside the same transaction as the change.
create function app.profiles_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limits public.organisation_limits;
  v_admins integer;
  v_users integer;
begin
  if new.organisation_id is null or not new.is_active then
    return new;
  end if;
  -- Serialise concurrent account creation for the same organisation.
  perform 1 from public.organisations where id = new.organisation_id for update;
  select * into v_limits from public.organisation_limits where organisation_id = new.organisation_id;
  select count(*) filter (where role = 'ORG_ADMIN'), count(*)
    into v_admins, v_users
    from public.profiles
   where organisation_id = new.organisation_id and is_active and user_id <> new.user_id;
  if new.role = 'ORG_ADMIN' and v_admins + 1 > v_limits.max_admins then
    raise exception 'This organisation already has the maximum number of administrators (%).', v_limits.max_admins
      using errcode = '23514', hint = 'LIMIT_ADMINS';
  end if;
  if v_users + 1 > v_limits.max_users then
    raise exception 'This organisation already has the maximum number of user accounts (%).', v_limits.max_users
      using errcode = '23514', hint = 'LIMIT_USERS';
  end if;
  return new;
end $$;
create trigger profiles_limits before insert or update of role, is_active, organisation_id on public.profiles
  for each row execute function app.profiles_limits();

-- Keep the profile e-mail in step with the login, and clear the
-- "must change password" flag when the user sets a new password themselves.
create function app.auth_user_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where user_id = new.id;
  end if;
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set must_change_password = false where user_id = new.id;
  end if;
  return new;
end $$;
create trigger presentify_auth_user_changed after update on auth.users
  for each row execute function app.auth_user_changed();

-- -----------------------------------------------------------------------------
-- Sign-in protection: lockout after repeated failures, login events
-- -----------------------------------------------------------------------------
create table public.login_events (
  id               bigint generated always as identity primary key,
  occurred_at      timestamptz not null default now(),
  user_id          uuid,
  organisation_id  uuid references public.organisations(id) on delete set null,
  email            text,
  event            text not null check (event in ('SIGN_IN', 'SIGN_IN_FAILED', 'ACCOUNT_LOCKED', 'MFA_VERIFIED', 'MFA_FAILED', 'BLOCKED_INACTIVE'))
);
create index login_events_org_time_idx on public.login_events (organisation_id, occurred_at desc);
create index login_events_user_time_idx on public.login_events (user_id, occurred_at desc);

create table app.auth_failures (
  user_id          uuid primary key,
  failed_count     integer not null default 0,
  first_failed_at  timestamptz,
  locked_until     timestamptz
);

create function app.setting_int(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::integer from public.system_settings where key = p_key), p_default)
$$;

create function app.record_login_event(p_user uuid, p_event text) returns void
language sql security definer set search_path = '' as $$
  insert into public.login_events (user_id, organisation_id, email, event)
  select p_user, p.organisation_id, p.email, p_event
  from (select 1) x left join public.profiles p on p.user_id = p_user
$$;

-- Shared by the password and MFA hooks. Returns the hook decision.
create function app.verification_attempt(p_user uuid, p_valid boolean, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row app.auth_failures;
  v_threshold integer := app.setting_int('security.lockout_threshold', 5);
  v_minutes integer := app.setting_int('security.lockout_minutes', 15);
  v_window interval := make_interval(mins => v_minutes);
begin
  select * into v_row from app.auth_failures where user_id = p_user for update;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('decision', 'reject', 'should_logout_user', true,
      'message', format('Too many unsuccessful attempts. Please try again after %s minutes.', v_minutes));
  end if;

  if p_valid then
    delete from app.auth_failures where user_id = p_user;
    if p_kind = 'MFA' then
      perform app.record_login_event(p_user, 'MFA_VERIFIED');
    end if;
    return jsonb_build_object('decision', 'continue');
  end if;

  perform app.record_login_event(p_user, case p_kind when 'MFA' then 'MFA_FAILED' else 'SIGN_IN_FAILED' end);
  insert into app.auth_failures as f (user_id, failed_count, first_failed_at)
  values (p_user, 1, now())
  on conflict (user_id) do update
    set failed_count = case when f.first_failed_at < now() - v_window then 1 else f.failed_count + 1 end,
        first_failed_at = case when f.first_failed_at < now() - v_window then now() else f.first_failed_at end,
        locked_until = null
  returning * into v_row;

  if v_row.failed_count >= v_threshold then
    update app.auth_failures set locked_until = now() + v_window, failed_count = 0, first_failed_at = null
     where user_id = p_user;
    perform app.record_login_event(p_user, 'ACCOUNT_LOCKED');
    return jsonb_build_object('decision', 'reject', 'should_logout_user', true,
      'message', format('Too many unsuccessful attempts. Your account is locked for %s minutes.', v_minutes));
  end if;
  return jsonb_build_object('decision', 'continue');
end $$;

-- Supabase Auth hook: called for every password check.
create function app.password_verification_hook(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return app.verification_attempt((event ->> 'user_id')::uuid, (event ->> 'valid')::boolean, 'PASSWORD');
end $$;

-- Supabase Auth hook: called for every authenticator-code check.
create function app.mfa_verification_hook(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return app.verification_attempt((event ->> 'user_id')::uuid, (event ->> 'valid')::boolean, 'MFA');
end $$;

-- Supabase Auth hook: runs whenever a session token is issued or refreshed.
-- Blocks deactivated users and organisations, and adds role/organisation claims
-- (for the screens; the database itself never trusts these claims).
create function app.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_claims jsonb := event -> 'claims';
  v_profile public.profiles;
  v_org_status public.org_status;
begin
  select * into v_profile from public.profiles where user_id = v_user;
  if not found then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403,
      'message', 'Your account is not set up yet. Please contact your administrator.'));
  end if;
  if not v_profile.is_active then
    perform app.record_login_event(v_user, 'BLOCKED_INACTIVE');
    return jsonb_build_object('error', jsonb_build_object('http_code', 403,
      'message', 'Your account has been deactivated. Please contact your administrator.'));
  end if;
  if v_profile.organisation_id is not null then
    select status into v_org_status from public.organisations where id = v_profile.organisation_id;
    if v_org_status = 'INACTIVE' then
      perform app.record_login_event(v_user, 'BLOCKED_INACTIVE');
      return jsonb_build_object('error', jsonb_build_object('http_code', 403,
        'message', 'Access for your organisation is currently disabled. Please contact the Presentify administrator.'));
    end if;
  end if;

  if event ->> 'authentication_method' = 'password' then
    update public.profiles set last_sign_in_at = now() where user_id = v_user;
    perform app.record_login_event(v_user, 'SIGN_IN');
  end if;

  v_claims := jsonb_set(v_claims, '{app_role}', to_jsonb(v_profile.role::text));
  v_claims := jsonb_set(v_claims, '{org_id}', coalesce(to_jsonb(v_profile.organisation_id), 'null'::jsonb));
  return jsonb_build_object('claims', v_claims);
end $$;

revoke execute on function app.custom_access_token_hook(jsonb), app.password_verification_hook(jsonb),
  app.mfa_verification_hook(jsonb), app.verification_attempt(uuid, boolean, text)
  from public, authenticated, anon, service_role;
grant execute on function app.custom_access_token_hook(jsonb), app.password_verification_hook(jsonb),
  app.mfa_verification_hook(jsonb) to supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------
alter table public.packages              enable row level security;
alter table public.organisations         enable row level security;
alter table public.organisation_settings enable row level security;
alter table public.profiles              enable row level security;
alter table public.permissions           enable row level security;
alter table public.role_permissions      enable row level security;
alter table public.system_settings       enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.login_events          enable row level security;

-- Start from no privileges (Supabase grants everything to anon/authenticated by
-- default) and grant only what each role needs. Anonymous visitors get nothing.
revoke all on public.packages, public.organisations, public.organisation_settings, public.profiles,
  public.permissions, public.role_permissions, public.system_settings, public.audit_logs,
  public.login_events, public.organisation_limits from anon, authenticated;

-- packages
create policy packages_select on public.packages for select to authenticated
  using (app.is_super_admin()
         or id = (select o.package_id from public.organisations o where o.id = (select app.current_org_id())));
create policy packages_write on public.packages for all to authenticated
  using (app.is_super_admin()) with check (app.is_super_admin());

-- organisations
create policy organisations_select on public.organisations for select to authenticated
  using (app.is_super_admin() or id = (select app.current_org_id()));
create policy organisations_insert on public.organisations for insert to authenticated
  with check (app.is_super_admin());
create policy organisations_update on public.organisations for update to authenticated
  using (app.is_super_admin()
         or (id = (select app.current_org_id()) and app.has_perm('ORG_PROFILE_EDIT') and app.org_writable(id)))
  with check (app.is_super_admin()
         or (id = (select app.current_org_id()) and app.has_perm('ORG_PROFILE_EDIT') and app.org_writable(id)));
-- Organisations are deactivated, never deleted through the API.

-- organisation settings
create policy settings_select on public.organisation_settings for select to authenticated
  using (app.is_super_admin() or organisation_id = (select app.current_org_id()));
create policy settings_update on public.organisation_settings for update to authenticated
  using (app.is_super_admin()
         or (organisation_id = (select app.current_org_id()) and app.has_perm('ORG_PROFILE_EDIT')
             and app.org_writable(organisation_id)))
  with check (app.is_super_admin()
         or (organisation_id = (select app.current_org_id()) and app.has_perm('ORG_PROFILE_EDIT')
             and app.org_writable(organisation_id)));

-- profiles: everyone sees their own; staff see colleagues; Super Admin sees all.
-- All changes go through functions (update_my_profile, manage-users).
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = auth.uid()
         or app.is_super_admin()
         or organisation_id = (select app.current_org_id()));

-- permissions are reference data
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

-- system settings
create policy system_settings_select on public.system_settings for select to authenticated
  using (app.is_super_admin());
create policy system_settings_update on public.system_settings for update to authenticated
  using (app.is_super_admin()) with check (app.is_super_admin());

-- audit log: Super Admin sees everything; organisation admins see their own organisation.
create policy audit_select on public.audit_logs for select to authenticated
  using (app.is_super_admin()
         or (organisation_id = (select app.current_org_id()) and app.has_perm('AUDIT_VIEW')));

create policy login_events_select on public.login_events for select to authenticated
  using (app.is_super_admin()
         or (organisation_id = (select app.current_org_id()) and app.has_perm('AUDIT_VIEW'))
         or user_id = auth.uid());

-- Table privileges for signed-in users (RLS above decides which rows).
grant select on public.packages, public.organisations, public.organisation_settings, public.profiles,
  public.permissions, public.role_permissions, public.system_settings, public.audit_logs,
  public.login_events, public.organisation_limits to authenticated;
grant insert, update, delete on public.packages to authenticated;
grant insert, update on public.organisations to authenticated;
grant update on public.organisation_settings, public.system_settings to authenticated;

-- -----------------------------------------------------------------------------
-- Functions callable by the screens (exposed as /rest/v1/rpc/...)
-- -----------------------------------------------------------------------------

-- Information the screens need right after sign-in.
create function public.my_context() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile public.profiles;
  v_org public.organisations;
  v_settings public.organisation_settings;
begin
  select * into v_profile from public.profiles where user_id = auth.uid();
  if not found then
    return null;
  end if;
  if v_profile.organisation_id is not null then
    select * into v_org from public.organisations where id = v_profile.organisation_id;
    select * into v_settings from public.organisation_settings where organisation_id = v_profile.organisation_id;
  end if;
  return jsonb_build_object(
    'user_id', v_profile.user_id,
    'full_name', v_profile.full_name,
    'email', v_profile.email,
    'designation', v_profile.designation,
    'phone', v_profile.phone,
    'role', v_profile.role,
    'is_active', v_profile.is_active,
    'must_change_password', v_profile.must_change_password,
    'preferred_language', v_profile.preferred_language,
    'mfa_required', v_profile.role = 'SUPER_ADMIN'
                    or (v_profile.role = 'ORG_ADMIN' and coalesce(v_settings.require_mfa_for_admins, false)),
    'permissions', (select coalesce(jsonb_agg(rp.permission_code order by rp.permission_code), '[]'::jsonb)
                    from public.role_permissions rp
                    where rp.role = v_profile.role
                      and (rp.permission_code <> 'MEETING_MANAGE' or v_profile.role <> 'ORGANISER'
                           or v_profile.can_create_meetings)),
    'organisation', case when v_org.id is null then null else jsonb_build_object(
      'id', v_org.id, 'name', v_org.name, 'short_name', v_org.short_name, 'tagline', v_org.tagline,
      'logo_path', v_org.logo_path, 'brand_color', v_settings.brand_color,
      'access', app.org_access(v_org.id), 'expires_at', v_org.expires_at,
      'grace_days', v_org.grace_days) end
  );
end $$;

-- Staff may update a few details of their own profile.
-- A null argument leaves that detail unchanged; an empty string clears it.
create function public.update_my_profile(p_full_name text default null, p_designation text default null,
                                         p_phone text default null, p_language text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to continue.' using errcode = '42501';
  end if;
  update public.profiles
     set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
         designation = case when p_designation is null then designation else nullif(trim(p_designation), '') end,
         phone = case when p_phone is null then phone else nullif(trim(p_phone), '') end,
         preferred_language = coalesce(p_language, preferred_language)
   where user_id = auth.uid() and is_active;
end $$;

-- Usage figures for one organisation (Super Admin, or staff of that organisation).
-- Meeting, presentation and storage figures are added by later migrations.
create function public.organisation_usage(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not (app.is_super_admin() or p_org = app.current_org_id()) then
    raise exception 'You do not have permission to view this organisation.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'organisation_id', p_org,
    'admins', count(*) filter (where role = 'ORG_ADMIN' and is_active),
    'users', count(*) filter (where is_active),
    'storage_bytes', coalesce((
      select sum((o.metadata ->> 'size')::bigint) from storage.objects o
      where (storage.foldername(o.name))[1] = p_org::text), 0),
    'access', app.org_access(p_org))
    into v_result
    from public.profiles where organisation_id = p_org;
  return v_result || jsonb_build_object('limits', (select to_jsonb(l) - 'organisation_id'
                                                  from public.organisation_limits l where l.organisation_id = p_org));
end $$;

-- Used by server functions (service role only).
create function public.organisation_access(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$ select app.org_access(p_org) $$;
revoke execute on function public.organisation_access(uuid) from public, anon, authenticated;
grant execute on function public.organisation_access(uuid) to service_role;

revoke execute on function public.my_context(), public.update_my_profile(text, text, text, text),
  public.organisation_usage(uuid) from public, anon;
grant execute on function public.my_context(), public.update_my_profile(text, text, text, text),
  public.organisation_usage(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Branding files (organisation logo and seal) — private bucket
-- Path: <organisation_id>/<file name>
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy branding_select on storage.objects for select to authenticated
  using (bucket_id = 'branding'
         and (app.is_super_admin() or (storage.foldername(name))[1] = (select app.current_org_id())::text));

create policy branding_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'branding'
              and (app.is_super_admin()
                   or ((storage.foldername(name))[1] = (select app.current_org_id())::text
                       and app.has_perm('ORG_PROFILE_EDIT')
                       and app.org_writable(app.current_org_id()))));

create policy branding_delete on storage.objects for delete to authenticated
  using (bucket_id = 'branding'
         and (app.is_super_admin()
              or ((storage.foldername(name))[1] = (select app.current_org_id())::text
                  and app.has_perm('ORG_PROFILE_EDIT'))));

-- -----------------------------------------------------------------------------
-- Reference data: packages
-- -----------------------------------------------------------------------------
insert into public.packages (code, name, description, max_admins, max_users, max_meetings, max_presentations,
                             max_participants_per_meeting, storage_bytes, max_file_bytes, max_retention_days) values
  ('BASIC', 'Basic', 'Small departments and training cells', 2, 10, 50, 100, 200,
     5::bigint * 1024 * 1024 * 1024, 50 * 1024 * 1024, 365),
  ('PROFESSIONAL', 'Professional', 'Larger departments with regular meetings', 5, 30, 200, 500, 500,
     20::bigint * 1024 * 1024 * 1024, 100 * 1024 * 1024, 365),
  ('ENTERPRISE', 'Enterprise', 'Organisation-wide use', 10, 100, 1000, 2000, 1000,
     100::bigint * 1024 * 1024 * 1024, 100 * 1024 * 1024, null),
  ('GOVERNMENT', 'Government / Internal', 'Internal government use', 10, 100, 1000, 2000, 1000,
     100::bigint * 1024 * 1024 * 1024, 100 * 1024 * 1024, null);

-- -----------------------------------------------------------------------------
-- Final privileges on helper functions (after all are defined).
-- -----------------------------------------------------------------------------
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.custom_access_token_hook(jsonb), app.password_verification_hook(jsonb),
  app.mfa_verification_hook(jsonb), app.verification_attempt(uuid, boolean, text)
  from public, authenticated, anon, service_role;
