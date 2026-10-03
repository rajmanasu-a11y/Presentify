-- =============================================================================
-- Presentify 0003 — QR codes, access settings, participants and attendance.
--
-- Participants never sign in and never reach the database directly. Their
-- requests go to the "public" server function, which calls the public_*
-- functions below with the service role. Those functions check the QR token,
-- the meeting's availability window, the passcode and the participant limit,
-- and decide what may be viewed or downloaded. Tokens given to browsers (QR,
-- access, remember-me) are random; only their SHA-256 is stored, except the QR
-- token, which must be shown again on screen.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- 144-bit random token, URL-safe (24 characters).
create function app.new_token() returns text
language sql volatile as $$
  select translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
$$;

create function app.token_hash(p_token text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- -----------------------------------------------------------------------------
-- Access settings on meetings
-- -----------------------------------------------------------------------------
alter table public.meetings
  add column registration_mode   text not null default 'REQUIRED' check (registration_mode in ('REQUIRED', 'OPTIONAL', 'NONE')),
  add column availability_mode   text not null default 'MEETING'  check (availability_mode in ('MEETING', 'CUSTOM', 'ALWAYS')),
  add column open_before_minutes integer not null default 30 check (open_before_minutes between 0 and 1440),
  -- Days the link keeps working after the meeting ends; null = until the meeting is archived.
  add column access_after_days   integer default 7 check (access_after_days between 0 and 365),
  add column custom_from         timestamptz,
  add column custom_until        timestamptz,
  add column has_passcode        boolean not null default false,
  add constraint meetings_custom_window check (custom_until is null or custom_from is null or custom_until > custom_from);

grant update (registration_mode, availability_mode, open_before_minutes, access_after_days, custom_from, custom_until)
  on public.meetings to authenticated;

-- Passcodes live apart from the meeting row so that no staff screen can read even the hash.
create table app.meeting_secrets (
  meeting_id     uuid primary key references public.meetings(id) on delete cascade,
  passcode_hash  text not null
);

alter table public.organisation_settings
  add column viewer_watermark boolean not null default true;

-- -----------------------------------------------------------------------------
-- QR codes
-- -----------------------------------------------------------------------------
create table public.qr_codes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  meeting_id       uuid not null,
  token            text not null unique default app.new_token(),
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  expires_at       timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  revoked_by       uuid references auth.users(id) on delete set null,
  revoked_at       timestamptz,
  foreign key (organisation_id, meeting_id) references public.meetings (organisation_id, id) on delete cascade
);
create unique index qr_codes_one_active on public.qr_codes (meeting_id) where status = 'ACTIVE';

-- Publishing a meeting gives it a QR code if it has none.
create function app.meetings_ensure_qr() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'PUBLISHED' and not exists (select 1 from public.qr_codes where meeting_id = new.id and status = 'ACTIVE') then
    insert into public.qr_codes (organisation_id, meeting_id, created_by) values (new.organisation_id, new.id, app.actor_id());
    perform app.audit('QR_GENERATED', 'meeting', new.id::text, 'QR code created when the meeting was published', null, new.organisation_id);
  end if;
  return new;
end $$;
create trigger meetings_ensure_qr after insert or update of status on public.meetings
  for each row execute function app.meetings_ensure_qr();

-- Meetings published before this upgrade get their QR code now.
insert into public.qr_codes (organisation_id, meeting_id)
select organisation_id, id from public.meetings where status = 'PUBLISHED';

-- -----------------------------------------------------------------------------
-- Participants, attendance and access events
-- -----------------------------------------------------------------------------
create table public.participants (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations(id),
  full_name          text,
  designation        text,
  organisation_name  text,
  mobile             text,
  email              text,
  department         text,
  location           text,
  mobile_norm        text,
  email_norm         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  anonymised_at      timestamptz,
  unique (organisation_id, id)
);
create unique index participants_mobile_uq on public.participants (organisation_id, mobile_norm) where mobile_norm is not null;
create unique index participants_email_uq on public.participants (organisation_id, email_norm) where email_norm is not null;
create trigger participants_touch before update on public.participants
  for each row execute function app.touch_updated_at();

create table public.attendance (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  meeting_id       uuid not null,
  participant_id   uuid,
  anonymous        boolean not null default false,
  details          jsonb not null default '{}'::jsonb,   -- what the participant entered for this meeting
  consent_at       timestamptz,
  registered_at    timestamptz not null default now(),
  first_access_at  timestamptz,
  last_access_at   timestamptz,
  ip               inet,
  user_agent       text,
  anonymised_at    timestamptz,           -- personal details removed by the retention job
  foreign key (organisation_id, meeting_id) references public.meetings (organisation_id, id) on delete cascade,
  foreign key (organisation_id, participant_id) references public.participants (organisation_id, id),
  constraint attendance_identity check (anonymous = (participant_id is null))
);
create unique index attendance_participant_uq on public.attendance (meeting_id, participant_id) where participant_id is not null;
create index attendance_meeting_idx on public.attendance (meeting_id, registered_at);

create table app.attendance_tokens (
  token_hash     text primary key,
  attendance_id  uuid not null references public.attendance(id) on delete cascade,
  created_at     timestamptz not null default now()
);
create index attendance_tokens_attendance_idx on app.attendance_tokens (attendance_id);

-- "Remember me on this device" (same organisation only, 90 days).
create table app.participant_devices (
  token_hash       text primary key,
  organisation_id  uuid not null references public.organisations(id) on delete cascade,
  participant_id   uuid not null references public.participants(id) on delete cascade,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null
);

create table public.access_events (
  id               bigint generated always as identity primary key,
  organisation_id  uuid not null,
  meeting_id       uuid not null,
  attendance_id    uuid references public.attendance(id) on delete set null,
  session_id       uuid,
  presentation_id  uuid,
  attachment_id    uuid,
  file_id          uuid,
  action           text not null check (action in ('OPEN_MEETING', 'VIEW', 'DOWNLOAD')),
  occurred_at      timestamptz not null default now(),
  ip               inet,
  user_agent       text,
  foreign key (organisation_id, meeting_id) references public.meetings (organisation_id, id) on delete cascade
);
create index access_events_meeting_idx on public.access_events (meeting_id, occurred_at);
create index access_events_attendance_idx on public.access_events (attendance_id);

-- -----------------------------------------------------------------------------
-- Public (participant) logic — service role only
-- -----------------------------------------------------------------------------

-- Resolves a QR token to its meeting and works out whether it is open now.
create function app.resolve_qr(p_token text)
returns table (meeting_id uuid, organisation_id uuid, state text, opens_at timestamptz, closes_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_m public.meetings;
  v_access text;
  v_opens timestamptz;
  v_closes timestamptz;
begin
  select m.* into v_m
    from public.qr_codes q join public.meetings m on m.id = q.meeting_id
   where q.token = p_token and q.status = 'ACTIVE' and (q.expires_at is null or q.expires_at > now());
  if v_m.id is null or v_m.status = 'DRAFT' then
    return query select null::uuid, null::uuid, 'INVALID'::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  v_access := app.org_access(v_m.organisation_id);
  if v_access = 'INACTIVE' then
    return query select null::uuid, null::uuid, 'INVALID'::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  if v_m.availability_mode = 'MEETING' then
    v_opens := v_m.starts_at - make_interval(mins => v_m.open_before_minutes);
    v_closes := case when v_m.access_after_days is null then null else v_m.ends_at + make_interval(days => v_m.access_after_days) end;
  elsif v_m.availability_mode = 'CUSTOM' then
    v_opens := v_m.custom_from;
    v_closes := v_m.custom_until;
  end if;
  return query select v_m.id, v_m.organisation_id,
    case
      when v_access = 'READ_ONLY' then 'UNAVAILABLE'
      when v_m.status = 'ARCHIVED' then 'ENDED'
      when v_opens is not null and now() < v_opens then 'NOT_YET'
      when v_closes is not null and now() > v_closes then 'ENDED'
      else 'OPEN'
    end, v_opens, v_closes;
end $$;

create function app.attendance_for(p_meeting uuid, p_access text) returns public.attendance
language sql stable security definer set search_path = '' as $$
  select a.* from app.attendance_tokens t join public.attendance a on a.id = t.attendance_id
   where t.token_hash = app.token_hash(p_access) and a.meeting_id = p_meeting
$$;

-- What the landing page needs: branding, meeting, sessions, registration form.
create function public.public_meeting_info(p_token text, p_device text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_m public.meetings;
  v_o public.organisations;
  v_s public.organisation_settings;
  v_remembered jsonb;
begin
  select * into r from app.resolve_qr(p_token);
  if r.state = 'INVALID' then
    return jsonb_build_object('state', 'INVALID');
  end if;
  select * into v_m from public.meetings where id = r.meeting_id;
  select * into v_o from public.organisations where id = r.organisation_id;
  select * into v_s from public.organisation_settings where organisation_id = r.organisation_id;
  if p_device is not null and v_s.keep_participant_directory then
    select jsonb_build_object('full_name', p.full_name, 'designation', p.designation, 'organisation', p.organisation_name,
                              'mobile', p.mobile, 'email', p.email, 'department', p.department, 'location', p.location)
      into v_remembered
      from app.participant_devices d join public.participants p on p.id = d.participant_id
     where d.token_hash = app.token_hash(p_device) and d.organisation_id = r.organisation_id
       and d.expires_at > now() and p.anonymised_at is null;
  end if;
  return jsonb_build_object(
    'state', r.state, 'opens_at', r.opens_at, 'closes_at', r.closes_at,
    'organisation', jsonb_build_object('name', v_o.name, 'short_name', v_o.short_name, 'tagline', v_o.tagline,
                                       'logo_path', v_o.logo_path, 'brand_color', v_s.brand_color,
                                       'default_language', v_s.default_language),
    'meeting', jsonb_build_object('title', v_m.title, 'reference_no', v_m.reference_no, 'starts_at', v_m.starts_at,
                                  'ends_at', v_m.ends_at, 'venue', v_m.venue, 'chairperson', v_m.chairperson),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                                                             'presenter', pr.full_name, 'designation', pr.designation)
                                          order by s.starts_at, s.sort_order)
                          from public.meeting_sessions s left join public.presenters pr on pr.id = s.presenter_id
                          where s.meeting_id = v_m.id), '[]'::jsonb),
    'registration', jsonb_build_object(
      'mode', v_m.registration_mode,
      'fields', (select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(v_s.registration_fields) f
                 where (f ->> 'enabled')::boolean),
      'consent_en', v_s.consent_text_en, 'consent_kn', v_s.consent_text_kn,
      'retention_days', v_s.participant_retention_days,
      'passcode_required', v_m.has_passcode,
      'remember_allowed', v_s.keep_participant_directory),
    'remembered', v_remembered);
end $$;

create function app.clean(p jsonb, p_key text, p_max integer default 150) returns text
language sql immutable as $$
  select nullif(left(trim(regexp_replace(coalesce(p ->> p_key, ''), '[[:cntrl:]]', ' ', 'g')), p_max), '')
$$;

-- Registration (or anonymous entry). Returns an access token for this meeting.
create function public.public_register(p_token text, p_fields jsonb, p_consent boolean, p_passcode text,
                                       p_remember boolean, p_anonymous boolean, p_ip inet, p_user_agent text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_m public.meetings;
  v_s public.organisation_settings;
  v_limit integer;
  v_count integer;
  v_anonymous boolean;
  v_field jsonb;
  v_values jsonb := '{}'::jsonb;
  v_mobile_norm text;
  v_email_norm text;
  v_participant uuid;
  v_attendance uuid;
  v_access text := app.new_token() || app.new_token();
  v_device text;
begin
  select * into r from app.resolve_qr(p_token);
  if r.state <> 'OPEN' then
    raise exception 'This meeting is not open.' using errcode = '22023', hint = coalesce(r.state, 'INVALID');
  end if;
  select * into v_m from public.meetings where id = r.meeting_id for update;  -- serialises the participant limit
  select * into v_s from public.organisation_settings where organisation_id = r.organisation_id;

  if v_m.has_passcode and not exists (
      select 1 from app.meeting_secrets
       where meeting_id = v_m.id and passcode_hash = extensions.crypt(coalesce(p_passcode, ''), passcode_hash)) then
    raise exception 'The meeting passcode is not correct.' using errcode = '22023', hint = 'PASSCODE';
  end if;

  v_anonymous := v_m.registration_mode = 'NONE' or (v_m.registration_mode = 'OPTIONAL' and coalesce(p_anonymous, false));

  select max_participants_per_meeting into v_limit from public.organisation_limits where organisation_id = r.organisation_id;
  select count(*) into v_count from public.attendance where meeting_id = v_m.id;

  if v_anonymous then
    if v_count + 1 > v_limit then
      raise exception 'This meeting has reached its participant limit.' using errcode = '23514', hint = 'LIMIT_PARTICIPANTS';
    end if;
    insert into public.attendance (organisation_id, meeting_id, anonymous, first_access_at, last_access_at, ip, user_agent)
    values (r.organisation_id, v_m.id, true, now(), now(), p_ip, left(p_user_agent, 300))
    returning id into v_attendance;
  else
    -- Validate the configured form.
    for v_field in select * from jsonb_array_elements(v_s.registration_fields) loop
      continue when not (v_field ->> 'enabled')::boolean;
      if (v_field ->> 'required')::boolean and app.clean(p_fields, v_field ->> 'key') is null then
        raise exception 'Please fill in: %', v_field ->> 'key' using errcode = '22023', hint = 'FIELD_REQUIRED:' || (v_field ->> 'key');
      end if;
      v_values := v_values || jsonb_strip_nulls(jsonb_build_object(v_field ->> 'key', app.clean(p_fields, v_field ->> 'key')));
    end loop;
    if v_values ->> 'name' is null then
      raise exception 'Please fill in: name' using errcode = '22023', hint = 'FIELD_REQUIRED:name';
    end if;
    if v_values ? 'mobile' then
      v_mobile_norm := right(regexp_replace(v_values ->> 'mobile', '\D', '', 'g'), 10);
      if length(v_mobile_norm) < 10 then
        raise exception 'Please enter a valid mobile number.' using errcode = '22023', hint = 'FIELD_INVALID:mobile';
      end if;
    end if;
    if v_values ? 'email' then
      if (v_values ->> 'email') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
        raise exception 'Please enter a valid e-mail address.' using errcode = '22023', hint = 'FIELD_INVALID:email';
      end if;
      v_email_norm := lower(v_values ->> 'email');
    end if;
    if not coalesce(p_consent, false) then
      raise exception 'Please agree to the privacy notice.' using errcode = '22023', hint = 'CONSENT';
    end if;

    -- Find the person: organisation directory (mobile/e-mail), else same details in this meeting.
    if v_s.keep_participant_directory and (v_mobile_norm is not null or v_email_norm is not null) then
      select id into v_participant from public.participants
       where organisation_id = r.organisation_id and anonymised_at is null
         and ((v_mobile_norm is not null and mobile_norm = v_mobile_norm) or (v_email_norm is not null and email_norm = v_email_norm))
       order by (mobile_norm = v_mobile_norm) desc nulls last limit 1;
    end if;
    if v_participant is null then
      select a.participant_id into v_participant from public.attendance a join public.participants p on p.id = a.participant_id
       where a.meeting_id = v_m.id
         and lower(coalesce(p.full_name, '')) = lower(v_values ->> 'name')
         and lower(coalesce(p.designation, '')) = lower(coalesce(v_values ->> 'designation', ''))
         and lower(coalesce(p.organisation_name, '')) = lower(coalesce(v_values ->> 'organisation', ''))
         -- (mobile_norm/email_norm are kept only with the directory, so compare the entered values)
         and right(regexp_replace(coalesce(p.mobile, ''), '\D', '', 'g'), 10) = coalesce(v_mobile_norm, '')
         and lower(coalesce(p.email, '')) = coalesce(v_email_norm, '')
       limit 1;
    end if;

    if v_participant is null then
      insert into public.participants (organisation_id, full_name, designation, organisation_name, mobile, email, department,
                                       location, mobile_norm, email_norm)
      values (r.organisation_id, v_values ->> 'name', v_values ->> 'designation', v_values ->> 'organisation', v_values ->> 'mobile',
              v_values ->> 'email', v_values ->> 'department', v_values ->> 'location',
              case when v_s.keep_participant_directory then v_mobile_norm end,
              case when v_s.keep_participant_directory then v_email_norm end)
      returning id into v_participant;
    else
      update public.participants
         set full_name = v_values ->> 'name',
             designation = coalesce(v_values ->> 'designation', designation),
             organisation_name = coalesce(v_values ->> 'organisation', organisation_name),
             mobile = coalesce(v_values ->> 'mobile', mobile), email = coalesce(v_values ->> 'email', email),
             department = coalesce(v_values ->> 'department', department), location = coalesce(v_values ->> 'location', location)
       where id = v_participant;
    end if;

    select id into v_attendance from public.attendance where meeting_id = v_m.id and participant_id = v_participant;
    if v_attendance is null then
      if v_count + 1 > v_limit then
        raise exception 'This meeting has reached its participant limit.' using errcode = '23514', hint = 'LIMIT_PARTICIPANTS';
      end if;
      insert into public.attendance (organisation_id, meeting_id, participant_id, details, consent_at, first_access_at,
                                     last_access_at, ip, user_agent)
      values (r.organisation_id, v_m.id, v_participant, v_values, now(), now(), now(), p_ip, left(p_user_agent, 300))
      returning id into v_attendance;
      perform app.audit('PARTICIPANT_REGISTERED', 'attendance', v_attendance::text, v_m.reference_no, null, r.organisation_id);
    else
      update public.attendance set details = v_values, consent_at = now(), last_access_at = now() where id = v_attendance;
    end if;

    if coalesce(p_remember, false) and v_s.keep_participant_directory then
      v_device := app.new_token() || app.new_token();
      insert into app.participant_devices (token_hash, organisation_id, participant_id, expires_at)
      values (app.token_hash(v_device), r.organisation_id, v_participant, now() + interval '90 days');
    end if;
  end if;

  insert into app.attendance_tokens (token_hash, attendance_id) values (app.token_hash(v_access), v_attendance);
  return jsonb_build_object('access_token', v_access, 'device_token', v_device);
end $$;

-- Meeting material the participant may see, with view/download rights.
create function public.public_meeting_content(p_token text, p_access text, p_ip inet, p_user_agent text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_m public.meetings;
  v_s public.organisation_settings;
  v_a public.attendance;
begin
  select * into r from app.resolve_qr(p_token);
  if r.state <> 'OPEN' then
    return jsonb_build_object('state', r.state, 'opens_at', r.opens_at);
  end if;
  v_a := app.attendance_for(r.meeting_id, p_access);
  if v_a.id is null then
    return jsonb_build_object('state', 'REGISTER');
  end if;
  select * into v_m from public.meetings where id = r.meeting_id;
  select * into v_s from public.organisation_settings where organisation_id = r.organisation_id;

  update public.attendance set last_access_at = now(), first_access_at = coalesce(first_access_at, now()) where id = v_a.id;
  -- One "opened the meeting page" event per participant every 10 minutes is enough.
  if not exists (select 1 from public.access_events where attendance_id = v_a.id and action = 'OPEN_MEETING'
                 and occurred_at > now() - interval '10 minutes') then
    insert into public.access_events (organisation_id, meeting_id, attendance_id, action, ip, user_agent)
    values (r.organisation_id, v_m.id, v_a.id, 'OPEN_MEETING', p_ip, left(p_user_agent, 300));
  end if;

  return jsonb_build_object(
    'state', 'OPEN',
    'participant', v_a.details ->> 'name',
    'watermark', v_s.viewer_watermark,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'presenter', pr.full_name, 'designation', pr.designation,
        'released', v_m.session_release = 'ALL' or now() >= s.starts_at,
        'items', case when v_m.session_release = 'ALL' or now() >= s.starts_at then coalesce((
          select jsonb_agg(item order by item ->> 'kind' desc, (item ->> 'sort')::int, item ->> 'title') from (
            select jsonb_build_object(
                     'kind', 'presentation', 'id', p.id, 'title', p.title, 'sort', p.sort_order,
                     'file_name', fo.original_name, 'extension', fo.extension, 'size', fo.size_bytes,
                     'view', case when fv.id is not null then 'pdf'
                                  when fo.extension in ('jpg', 'jpeg', 'png') then 'image'
                                  when fo.extension = 'mp4' then 'video' end,
                     'download', coalesce(p.downloads_allowed, v_m.downloads_allowed)) as item
              from public.presentations p
              join public.presentation_versions v on v.id = p.current_version_id
              join public.stored_files fo on fo.id = v.original_file_id and fo.status = 'READY'
              left join public.stored_files fv on fv.id = v.view_pdf_file_id and fv.status = 'READY'
             where p.session_id = s.id and p.deleted_at is null and p.is_visible
            union all
            select jsonb_build_object(
                     'kind', 'attachment', 'id', at.id, 'title', at.title, 'sort', at.sort_order,
                     'file_name', fo.original_name, 'extension', fo.extension, 'size', fo.size_bytes,
                     'view', case when fv.id is not null then 'pdf'
                                  when fo.extension in ('jpg', 'jpeg', 'png') then 'image'
                                  when fo.extension = 'mp4' then 'video' end,
                     'download', coalesce(at.downloads_allowed, v_m.downloads_allowed))
              from public.attachments at
              join public.stored_files fo on fo.id = at.file_id and fo.status = 'READY'
              left join public.stored_files fv on fv.id = at.view_pdf_file_id and fv.status = 'READY'
             where at.session_id = s.id and at.deleted_at is null) x), '[]'::jsonb) else '[]'::jsonb end)
        order by s.starts_at, s.sort_order)
      from public.meeting_sessions s left join public.presenters pr on pr.id = s.presenter_id
      where s.meeting_id = v_m.id), '[]'::jsonb));
end $$;

-- Authorises viewing or downloading one item; returns the storage path to sign.
create function public.public_file_access(p_token text, p_access text, p_kind text, p_id uuid, p_mode text,
                                          p_ip inet, p_user_agent text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_m public.meetings;
  v_a public.attendance;
  v_session_id uuid;
  v_session_start timestamptz;
  v_original_id uuid;
  v_view_id uuid;
  v_allowed boolean;
  v_original public.stored_files;
  v_view public.stored_files;
  v_file public.stored_files;
  v_presentation uuid;
  v_attachment uuid;
begin
  select * into r from app.resolve_qr(p_token);
  if r.state <> 'OPEN' then
    raise exception 'This meeting is not open.' using errcode = '22023', hint = coalesce(r.state, 'INVALID');
  end if;
  v_a := app.attendance_for(r.meeting_id, p_access);
  if v_a.id is null then
    raise exception 'Please register first.' using errcode = '42501', hint = 'REGISTER';
  end if;
  select * into v_m from public.meetings where id = r.meeting_id;

  if p_kind = 'presentation' then
    select s.id, s.starts_at, coalesce(p.downloads_allowed, v_m.downloads_allowed), v.original_file_id, v.view_pdf_file_id, p.id
      into v_session_id, v_session_start, v_allowed, v_original_id, v_view_id, v_presentation
      from public.presentations p
      join public.meeting_sessions s on s.id = p.session_id
      join public.presentation_versions v on v.id = p.current_version_id
     where p.id = p_id and s.meeting_id = v_m.id and p.deleted_at is null and p.is_visible;
  elsif p_kind = 'attachment' then
    select s.id, s.starts_at, coalesce(at.downloads_allowed, v_m.downloads_allowed), at.file_id, at.view_pdf_file_id, at.id
      into v_session_id, v_session_start, v_allowed, v_original_id, v_view_id, v_attachment
      from public.attachments at
      join public.meeting_sessions s on s.id = at.session_id
     where at.id = p_id and s.meeting_id = v_m.id and at.deleted_at is null;
  end if;
  select * into v_original from public.stored_files where id = v_original_id and status = 'READY';
  select * into v_view from public.stored_files where id = v_view_id and status = 'READY';
  if v_session_id is null or v_original.id is null
     or not (v_m.session_release = 'ALL' or now() >= v_session_start) then
    raise exception 'This item is not available.' using errcode = '42501', hint = 'NOT_AVAILABLE';
  end if;

  if p_mode = 'download' then
    if not v_allowed then
      raise exception 'Downloading is not allowed for this item.' using errcode = '42501', hint = 'DOWNLOAD_NOT_ALLOWED';
    end if;
    v_file := v_original;
  elsif p_mode = 'view' then
    if v_view.id is not null then v_file := v_view;
    elsif v_original.extension in ('pdf', 'jpg', 'jpeg', 'png', 'mp4') then v_file := v_original;
    else
      raise exception 'Preview is not available for this file.' using errcode = '42501', hint = 'NOT_VIEWABLE';
    end if;
  else
    raise exception 'Unknown request.' using errcode = '22023';
  end if;

  insert into public.access_events (organisation_id, meeting_id, attendance_id, session_id, presentation_id, attachment_id,
                                    file_id, action, ip, user_agent)
  values (r.organisation_id, v_m.id, v_a.id, v_session_id, v_presentation, v_attachment, v_file.id,
          case when p_mode = 'download' then 'DOWNLOAD' else 'VIEW' end, p_ip, left(p_user_agent, 300));
  update public.attendance set last_access_at = now() where id = v_a.id;

  return jsonb_build_object('object_path', v_file.object_path, 'file_name', v_file.original_name,
                            'extension', v_file.extension,
                            'kind', case when v_file.extension = 'pdf' then 'pdf'
                                         when v_file.extension in ('jpg', 'jpeg', 'png') then 'image'
                                         when v_file.extension = 'mp4' then 'video' else 'file' end);
end $$;

revoke execute on function public.public_meeting_info(text, text),
  public.public_register(text, jsonb, boolean, text, boolean, boolean, inet, text),
  public.public_meeting_content(text, text, inet, text),
  public.public_file_access(text, text, text, uuid, text, inet, text) from public, anon, authenticated;
grant execute on function public.public_meeting_info(text, text),
  public.public_register(text, jsonb, boolean, text, boolean, boolean, inet, text),
  public.public_meeting_content(text, text, inet, text),
  public.public_file_access(text, text, text, uuid, text, inet, text) to service_role;

-- -----------------------------------------------------------------------------
-- Staff functions: QR codes and passcode
-- -----------------------------------------------------------------------------

-- Replaces the meeting's QR code (the old one stops working at once).
create function public.regenerate_qr(p_meeting uuid, p_expires_at timestamptz default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.meetings;
  v_token text;
begin
  select * into v_m from public.meetings where id = p_meeting;
  if not app.can_manage_meeting(p_meeting) then
    raise exception 'You do not have permission to change this QR code.' using errcode = '42501';
  end if;
  if v_m.status <> 'PUBLISHED' then
    raise exception 'Publish the meeting before creating its QR code.' using errcode = '23514', hint = 'NOT_PUBLISHED';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The expiry must be in the future.' using errcode = '23514', hint = 'EXPIRY_PAST';
  end if;
  update public.qr_codes set status = 'REVOKED', revoked_at = now(), revoked_by = auth.uid()
   where meeting_id = p_meeting and status = 'ACTIVE';
  insert into public.qr_codes (organisation_id, meeting_id, expires_at, created_by)
  values (v_m.organisation_id, p_meeting, p_expires_at, auth.uid())
  returning token into v_token;
  perform app.audit('QR_REGENERATED', 'meeting', p_meeting::text, v_m.reference_no);
  return v_token;
end $$;

-- Switches the QR link off without creating a new one.
create function public.revoke_qr(p_meeting uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_manage_meeting(p_meeting) then
    raise exception 'You do not have permission to change this QR code.' using errcode = '42501';
  end if;
  update public.qr_codes set status = 'REVOKED', revoked_at = now(), revoked_by = auth.uid()
   where meeting_id = p_meeting and status = 'ACTIVE';
  perform app.audit('QR_REVOKED', 'meeting', p_meeting::text, null);
end $$;

create function public.set_qr_expiry(p_meeting uuid, p_expires_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_manage_meeting(p_meeting) then
    raise exception 'You do not have permission to change this QR code.' using errcode = '42501';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The expiry must be in the future.' using errcode = '23514', hint = 'EXPIRY_PAST';
  end if;
  update public.qr_codes set expires_at = p_expires_at where meeting_id = p_meeting and status = 'ACTIVE';
  perform app.audit('QR_EXPIRY_CHANGED', 'meeting', p_meeting::text, coalesce(p_expires_at::text, 'no expiry'));
end $$;

-- Sets (or with null/empty, removes) the meeting passcode.
create function public.set_meeting_passcode(p_meeting uuid, p_passcode text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_edit_meeting_content(p_meeting) then
    raise exception 'You do not have permission to change this meeting.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_passcode, '')), '') is null then
    delete from app.meeting_secrets where meeting_id = p_meeting;
    update public.meetings set has_passcode = false where id = p_meeting;
    perform app.audit('MEETING_PASSCODE_REMOVED', 'meeting', p_meeting::text, null);
    return;
  end if;
  if length(trim(p_passcode)) < 4 or length(trim(p_passcode)) > 40 then
    raise exception 'The passcode must have 4 to 40 characters.' using errcode = '23514', hint = 'PASSCODE_LENGTH';
  end if;
  insert into app.meeting_secrets (meeting_id, passcode_hash)
  values (p_meeting, extensions.crypt(trim(p_passcode), extensions.gen_salt('bf', 10)))
  on conflict (meeting_id) do update set passcode_hash = excluded.passcode_hash;
  update public.meetings set has_passcode = true where id = p_meeting;
  perform app.audit('MEETING_PASSCODE_SET', 'meeting', p_meeting::text, null);
end $$;

revoke execute on function public.regenerate_qr(uuid, timestamptz), public.revoke_qr(uuid),
  public.set_qr_expiry(uuid, timestamptz), public.set_meeting_passcode(uuid, text) from public, anon;
grant execute on function public.regenerate_qr(uuid, timestamptz), public.revoke_qr(uuid),
  public.set_qr_expiry(uuid, timestamptz), public.set_meeting_passcode(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Row-Level Security (staff)
-- -----------------------------------------------------------------------------
alter table public.qr_codes      enable row level security;
alter table public.participants  enable row level security;
alter table public.attendance    enable row level security;
alter table public.access_events enable row level security;
revoke all on public.qr_codes, public.participants, public.attendance, public.access_events from anon, authenticated;

-- QR codes: everyone who can see the meeting may display its code (presenters too).
create policy qr_select on public.qr_codes for select to authenticated
  using (app.can_view_meeting(meeting_id));

-- Participant data: organisation admins and organisers only (not the Super Admin, not presenters).
create function app.can_view_participants(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_perm('PARTICIPANT_VIEW') and app.can_view_meeting(p_meeting)
$$;
grant execute on function app.can_view_participants(uuid) to authenticated, service_role;

create policy participants_select on public.participants for select to authenticated
  using (organisation_id = (select app.current_org_id()) and app.has_perm('PARTICIPANT_VIEW'));
create policy attendance_select on public.attendance for select to authenticated
  using (app.can_view_participants(meeting_id));
create policy access_events_select on public.access_events for select to authenticated
  using (app.can_view_participants(meeting_id));

grant select on public.qr_codes, public.participants, public.attendance, public.access_events to authenticated;

-- Audit: QR changes are recorded by the functions above; settings changes by the meeting trigger.

-- -----------------------------------------------------------------------------
-- Retention (runs every night at 02:00 India time)
--   * Participant details: removed when the organisation's retention period
--     (Organisation → Participants) has passed after the meeting ended. Counts
--     stay, so attendance numbers and reports still add up.
--   * IP addresses and browser details in logs: blanked after
--     security.ip_retention_days (system setting, default 90).
-- -----------------------------------------------------------------------------
create function app.apply_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ip_days integer := coalesce((select (value #>> '{}')::integer from public.system_settings where key = 'security.ip_retention_days'), 90);
  v_attendance integer;
  v_people integer;
  v_devices integer;
  v_ips integer := 0;
  v_n integer;
begin
  update public.attendance a
     set details = '{}'::jsonb, ip = null, user_agent = null, anonymised_at = now()
    from public.meetings m, public.organisation_settings s
   where a.meeting_id = m.id and s.organisation_id = m.organisation_id
     and a.anonymised_at is null and s.participant_retention_days is not null
     and m.ends_at < now() - make_interval(days => s.participant_retention_days);
  get diagnostics v_attendance = row_count;

  -- A person's directory entry goes once none of their attendance records keep details.
  update public.participants p
     set full_name = null, designation = null, organisation_name = null, mobile = null, email = null,
         department = null, location = null, mobile_norm = null, email_norm = null, anonymised_at = now()
    from public.organisation_settings s
   where s.organisation_id = p.organisation_id and p.anonymised_at is null and s.participant_retention_days is not null
     and p.created_at < now() - make_interval(days => s.participant_retention_days)
     and not exists (select 1 from public.attendance a where a.participant_id = p.id and a.anonymised_at is null);
  get diagnostics v_people = row_count;

  delete from app.participant_devices d
   where d.expires_at < now()
      or exists (select 1 from public.participants p where p.id = d.participant_id and p.anonymised_at is not null);
  get diagnostics v_devices = row_count;

  update public.access_events set ip = null, user_agent = null
   where occurred_at < now() - make_interval(days => v_ip_days) and (ip is not null or user_agent is not null);
  get diagnostics v_n = row_count; v_ips := v_ips + v_n;
  update public.attendance set ip = null, user_agent = null
   where registered_at < now() - make_interval(days => v_ip_days) and (ip is not null or user_agent is not null);
  get diagnostics v_n = row_count; v_ips := v_ips + v_n;
  perform set_config('app.audit_redaction', 'on', true);
  update public.audit_logs set ip = null, user_agent = null
   where occurred_at < now() - make_interval(days => v_ip_days) and (ip is not null or user_agent is not null);
  get diagnostics v_n = row_count; v_ips := v_ips + v_n;
  perform set_config('app.audit_redaction', 'off', true);

  if v_attendance + v_people + v_devices + v_ips > 0 then
    perform app.audit('RETENTION_APPLIED', 'system', null,
      format('%s attendance records and %s people anonymised; %s remembered devices removed; %s IP/browser entries blanked',
             v_attendance, v_people, v_devices, v_ips),
      jsonb_build_object('attendance', v_attendance, 'participants', v_people, 'devices', v_devices, 'ip_entries', v_ips));
  end if;
  return jsonb_build_object('attendance', v_attendance, 'participants', v_people, 'devices', v_devices, 'ip_entries', v_ips);
end $$;

create extension if not exists pg_cron;
select cron.schedule('presentify-retention', '30 20 * * *', 'select app.apply_retention()');

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.custom_access_token_hook(jsonb), app.password_verification_hook(jsonb),
  app.mfa_verification_hook(jsonb), app.verification_attempt(uuid, boolean, text),
  app.attendance_for(uuid, text), app.resolve_qr(text), app.apply_retention()
  from public, authenticated, anon;
