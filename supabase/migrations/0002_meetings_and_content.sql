-- =============================================================================
-- Presentify 0002 — presenters, meetings, sessions, presentations (with
-- versions), supporting material and uploaded files.
--
-- Access rules
--   * Organisation Admins see and manage every meeting of their organisation.
--   * Organisers see every meeting; they manage the meetings they organise
--     (when allowed to create meetings).
--   * Presenters with a login see only meetings in which they present, and may
--     upload material to their own sessions.
--   * Archived meetings are read-only (they can be un-archived).
--   * Files are uploaded through the "uploads" server function: the database
--     reserves space (limits are checked here), the function checks the real
--     size and content, and the database then records the version/attachment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Presenter directory
-- -----------------------------------------------------------------------------
create table public.presenters (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null default app.current_org_id() references public.organisations(id),
  full_name         text not null check (length(trim(full_name)) between 2 and 120),
  designation       text check (length(designation) <= 120),
  office            text check (length(office) <= 150),
  email             extensions.citext check (email is null or email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  phone             text check (phone is null or phone ~ '^[0-9+()\- ]{6,20}$'),
  user_id           uuid references public.profiles(user_id) on delete set null,
  is_active         boolean not null default true,
  created_by        uuid default auth.uid() references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organisation_id, id)
);
create unique index presenters_user_uq on public.presenters (organisation_id, user_id) where user_id is not null;
create index presenters_org_name_idx on public.presenters (organisation_id, lower(full_name));
create trigger presenters_touch before update on public.presenters
  for each row execute function app.touch_updated_at();

-- A presenter may be linked only to a staff login of the same organisation.
create function app.presenters_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and not exists (
    select 1 from public.profiles p where p.user_id = new.user_id and p.organisation_id = new.organisation_id) then
    raise exception 'The selected login does not belong to this organisation.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger presenters_guard before insert or update on public.presenters
  for each row execute function app.presenters_guard();

-- -----------------------------------------------------------------------------
-- Meetings and sessions
-- -----------------------------------------------------------------------------
create type public.meeting_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');

create table public.meeting_counters (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  year            integer not null,
  last_number     integer not null default 0,
  primary key (organisation_id, year)
);

create table public.meetings (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null default app.current_org_id() references public.organisations(id),
  reference_no       text check (length(reference_no) <= 40),
  title              text not null check (length(trim(title)) between 3 and 200),
  description        text check (length(description) <= 4000),
  unit_label         text check (length(unit_label) <= 120),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  venue              text check (length(venue) <= 200),
  organiser_user_id  uuid default auth.uid() references public.profiles(user_id),
  chairperson        text check (length(chairperson) <= 150),
  status             meeting_status not null default 'DRAFT',
  -- Participants may download files (each file may override). Default from organisation settings.
  downloads_allowed  boolean,
  -- ALL: every session's material visible at once; ON_START: released when each session starts.
  session_release    text not null default 'ALL' check (session_release in ('ALL', 'ON_START')),
  published_at       timestamptz,
  archived_at        timestamptz,
  created_by         uuid default auth.uid() references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint meetings_time_order check (ends_at > starts_at),
  unique (organisation_id, id),
  unique (organisation_id, reference_no)
);
create index meetings_org_time_idx on public.meetings (organisation_id, starts_at desc);
create index meetings_org_status_idx on public.meetings (organisation_id, status);
create index meetings_search_idx on public.meetings using gin (to_tsvector('simple', title || ' ' || coalesce(reference_no, '') || ' ' || coalesce(venue, '')));
create trigger meetings_touch before update on public.meetings
  for each row execute function app.touch_updated_at();

create table public.meeting_sessions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default app.current_org_id(),
  meeting_id       uuid not null,
  title            text not null check (length(trim(title)) between 2 and 200),
  presenter_id     uuid,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  sort_order       integer not null default 0,
  notes            text check (length(notes) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sessions_time_order check (ends_at > starts_at),
  unique (organisation_id, id),
  foreign key (organisation_id, meeting_id) references public.meetings (organisation_id, id) on delete cascade,
  foreign key (organisation_id, presenter_id) references public.presenters (organisation_id, id)
);
create index sessions_meeting_idx on public.meeting_sessions (meeting_id, starts_at, sort_order);
create index sessions_presenter_idx on public.meeting_sessions (presenter_id);
create trigger sessions_touch before update on public.meeting_sessions
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Uploaded files (metadata; the bytes live in the private "content" bucket)
-- -----------------------------------------------------------------------------
create table public.stored_files (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations(id),
  bucket           text not null default 'content',
  object_path      text not null unique,
  original_name    text not null check (length(original_name) between 1 and 200),
  extension        text not null check (extension ~ '^[a-z0-9]{2,5}$'),
  declared_size    bigint not null check (declared_size > 0),
  size_bytes       bigint check (size_bytes > 0),
  mime_type        text,
  purpose          text not null check (purpose in ('PRESENTATION', 'ATTACHMENT', 'VIEW_PDF')),
  target_id        uuid not null,
  details          jsonb not null default '{}'::jsonb,
  status           text not null default 'PENDING' check (status in ('PENDING', 'READY', 'REJECTED', 'DELETED')),
  reject_reason    text,
  uploaded_by      uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (organisation_id, id)
);
create index stored_files_org_status_idx on public.stored_files (organisation_id, status);

-- -----------------------------------------------------------------------------
-- Presentations, versions and supporting material
-- -----------------------------------------------------------------------------
create table public.presentations (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null default app.current_org_id(),
  session_id          uuid not null,
  title               text not null check (length(trim(title)) between 2 and 200),
  description         text check (length(description) <= 2000),
  category            text check (length(category) <= 80),
  downloads_allowed   boolean,          -- null: follow the meeting
  is_visible          boolean not null default true,
  current_version_id  uuid,
  sort_order          integer not null default 0,
  created_by          uuid default auth.uid() references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (organisation_id, id),
  foreign key (organisation_id, session_id) references public.meeting_sessions (organisation_id, id)
);
create index presentations_session_idx on public.presentations (session_id, sort_order) where deleted_at is null;
create index presentations_org_idx on public.presentations (organisation_id, updated_at desc) where deleted_at is null;
create trigger presentations_touch before update on public.presentations
  for each row execute function app.touch_updated_at();

create table public.presentation_versions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  presentation_id   uuid not null,
  version_no        integer not null check (version_no >= 1),
  original_file_id  uuid not null,
  view_pdf_file_id  uuid,
  change_notes      text check (length(change_notes) <= 1000),
  restored_from     integer,
  uploaded_by       uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (presentation_id, version_no),
  unique (organisation_id, id),
  foreign key (organisation_id, presentation_id) references public.presentations (organisation_id, id),
  foreign key (organisation_id, original_file_id) references public.stored_files (organisation_id, id),
  foreign key (organisation_id, view_pdf_file_id) references public.stored_files (organisation_id, id)
);
alter table public.presentations
  add foreign key (organisation_id, current_version_id) references public.presentation_versions (organisation_id, id);

create table public.attachments (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  session_id        uuid not null,
  file_id           uuid not null,
  view_pdf_file_id  uuid,
  title             text not null check (length(trim(title)) between 1 and 200),
  downloads_allowed boolean,            -- null: follow the meeting
  sort_order        integer not null default 0,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (organisation_id, id),
  foreign key (organisation_id, session_id) references public.meeting_sessions (organisation_id, id),
  foreign key (organisation_id, file_id) references public.stored_files (organisation_id, id),
  foreign key (organisation_id, view_pdf_file_id) references public.stored_files (organisation_id, id)
);
create index attachments_session_idx on public.attachments (session_id, sort_order) where deleted_at is null;
create trigger attachments_touch before update on public.attachments
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Access helpers
-- -----------------------------------------------------------------------------
create function app.my_role() returns user_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.user_id = auth.uid() and p.is_active
$$;

-- Is the signed-in person the presenter of a session in this meeting?
create function app.presents_in(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meeting_sessions s
    join public.presenters pr on pr.id = s.presenter_id
    where s.meeting_id = p_meeting and pr.user_id = auth.uid() and pr.is_active)
$$;

-- Who may see a meeting (and everything in it).
create function app.can_view_meeting(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meetings m
    where m.id = p_meeting
      and m.organisation_id = app.current_org_id()
      and (app.my_role() in ('ORG_ADMIN', 'ORGANISER') or app.presents_in(m.id)))
$$;

-- Who may change a meeting's details, sessions and status.
create function app.can_manage_meeting(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meetings m
    where m.id = p_meeting
      and m.organisation_id = app.current_org_id()
      and app.org_writable(m.organisation_id)
      and app.has_perm('MEETING_MANAGE')
      and (app.my_role() = 'ORG_ADMIN' or m.organiser_user_id = auth.uid()))
$$;

-- Content (sessions, presentations, files) may change only while not archived.
create function app.can_edit_meeting_content(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_manage_meeting(p_meeting)
     and exists (select 1 from public.meetings m where m.id = p_meeting and m.status <> 'ARCHIVED')
$$;

-- Managers of the meeting, or the presenter of this session (with a login).
create function app.can_upload_to_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meeting_sessions s
    join public.meetings m on m.id = s.meeting_id
    where s.id = p_session
      and m.status <> 'ARCHIVED'
      and (
        app.can_manage_meeting(m.id)
        or (app.has_perm('CONTENT_UPLOAD')
            and app.org_writable(m.organisation_id)
            and m.organisation_id = app.current_org_id()
            and exists (select 1 from public.presenters pr where pr.id = s.presenter_id and pr.user_id = auth.uid()))
      ))
$$;

create function app.session_meeting(p_session uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select meeting_id from public.meeting_sessions where id = p_session
$$;

grant execute on function app.my_role(), app.presents_in(uuid), app.can_view_meeting(uuid), app.can_manage_meeting(uuid),
  app.can_edit_meeting_content(uuid), app.can_upload_to_session(uuid), app.session_meeting(uuid)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Rules (triggers)
-- -----------------------------------------------------------------------------

-- Meeting reference numbers: MTG-<year>-0001, per organisation, when not given.
create function app.meetings_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_count integer;
  v_year integer := extract(year from (new.starts_at at time zone 'Asia/Kolkata'))::integer;
  v_next integer;
begin
  perform 1 from public.organisations where id = new.organisation_id for update;
  select max_meetings into v_limit from public.organisation_limits where organisation_id = new.organisation_id;
  select count(*) into v_count from public.meetings where organisation_id = new.organisation_id;
  if v_count + 1 > v_limit then
    raise exception 'Your organisation has reached its limit of % meetings.', v_limit
      using errcode = '23514', hint = 'LIMIT_MEETINGS';
  end if;
  if new.downloads_allowed is null then
    select downloads_default into new.downloads_allowed from public.organisation_settings where organisation_id = new.organisation_id;
  end if;
  if new.reference_no is null or trim(new.reference_no) = '' then
    insert into public.meeting_counters as c (organisation_id, year, last_number) values (new.organisation_id, v_year, 1)
    on conflict (organisation_id, year) do update set last_number = c.last_number + 1
    returning last_number into v_next;
    new.reference_no := format('MTG-%s-%s', v_year, lpad(v_next::text, 4, '0'));
  end if;
  new.status := 'DRAFT';
  return new;
end $$;
create trigger meetings_before_insert before insert on public.meetings
  for each row execute function app.meetings_before_insert();

create function app.meetings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The organiser must be an active administrator or organiser of the same organisation.
  if new.organiser_user_id is not null
     and (tg_op = 'INSERT' or new.organiser_user_id is distinct from old.organiser_user_id)
     and not exists (select 1 from public.profiles p
                     where p.user_id = new.organiser_user_id and p.organisation_id = new.organisation_id
                       and p.is_active and p.role in ('ORG_ADMIN', 'ORGANISER')) then
    raise exception 'The organiser must be an administrator or organiser of this organisation.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.organisation_id <> old.organisation_id then
      raise exception 'A meeting cannot be moved to another organisation.' using errcode = '23514';
    end if;
    -- Only an organisation admin may hand a meeting to a different organiser.
    if new.organiser_user_id is distinct from old.organiser_user_id
       and auth.role() <> 'service_role' and app.my_role() is distinct from 'ORG_ADMIN' then
      raise exception 'Only an organisation administrator can change the organiser.' using errcode = '42501';
    end if;
    if old.status = 'ARCHIVED' and new.status = 'ARCHIVED' then
      raise exception 'This meeting is archived. Restore it before making changes.' using errcode = '23514';
    end if;
    if new.status is distinct from old.status then
      if new.status = 'PUBLISHED' then
        if not exists (select 1 from public.meeting_sessions where meeting_id = new.id) then
          raise exception 'Add at least one session before publishing the meeting.' using errcode = '23514', hint = 'NO_SESSIONS';
        end if;
        new.published_at := coalesce(new.published_at, now());
        new.archived_at := null;
      elsif new.status = 'ARCHIVED' then
        new.archived_at := now();
      else
        new.archived_at := null;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger meetings_guard before insert or update on public.meetings
  for each row execute function app.meetings_guard();

-- A presentation limit counts every presentation that has not been deleted.
create function app.presentations_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_count integer;
begin
  perform 1 from public.organisations where id = new.organisation_id for update;
  select max_presentations into v_limit from public.organisation_limits where organisation_id = new.organisation_id;
  select count(*) into v_count from public.presentations where organisation_id = new.organisation_id and deleted_at is null;
  if v_count + 1 > v_limit then
    raise exception 'Your organisation has reached its limit of % presentations.', v_limit
      using errcode = '23514', hint = 'LIMIT_PRESENTATIONS';
  end if;
  return new;
end $$;
create trigger presentations_limit before insert on public.presentations
  for each row execute function app.presentations_limit();

-- Storage in use: finished files plus uploads reserved in the last 24 hours.
create function app.storage_used(p_org uuid, p_exclude uuid default null) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select sum(coalesce(f.size_bytes, f.declared_size)) from public.stored_files f
    where f.organisation_id = p_org
      and (f.status = 'READY' or (f.status = 'PENDING' and f.created_at > now() - interval '24 hours'))
      and f.id is distinct from p_exclude), 0)
  + coalesce((
    select sum((o.metadata ->> 'size')::bigint) from storage.objects o
    where o.bucket_id = 'branding' and (storage.foldername(o.name))[1] = p_org::text), 0)
$$;

create function app.check_file_limits(p_org uuid, p_size bigint, p_exclude uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_limits public.organisation_limits;
begin
  perform 1 from public.organisations where id = p_org for update;
  select * into v_limits from public.organisation_limits where organisation_id = p_org;
  if p_size > v_limits.max_file_bytes then
    raise exception 'This file is larger than the maximum allowed size of % MB.', round(v_limits.max_file_bytes / 1048576.0)
      using errcode = '23514', hint = 'LIMIT_FILE_SIZE';
  end if;
  if app.storage_used(p_org, p_exclude) + p_size > v_limits.storage_bytes then
    raise exception 'Your organisation''s storage space is full. Please remove old files or ask the Presentify administrator for more space.'
      using errcode = '23514', hint = 'LIMIT_STORAGE';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Upload workflow (called by the "uploads" server function)
-- -----------------------------------------------------------------------------

-- File types Presentify can ever accept; each organisation chooses a subset.
create function app.known_file_type(p_ext text) returns boolean
language sql immutable as $$
  select p_ext = any (array['pdf','ppt','pptx','pps','ppsx','doc','docx','xls','xlsx','jpg','jpeg','png','mp4','zip'])
$$;

-- Step 1 (as the signed-in person): checks permission, type, size and space,
-- and reserves the upload. Returns the storage path to upload to.
create function public.begin_upload(p_purpose text, p_target uuid, p_file_name text, p_size bigint,
                                    p_details jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := app.current_org_id();
  v_session uuid;
  v_name text;
  v_ext text;
  v_allowed text[];
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  if v_org is null then
    raise exception 'Please sign in to continue.' using errcode = '42501';
  end if;
  if p_purpose = 'PRESENTATION' then
    select session_id into v_session from public.presentations where id = p_target and organisation_id = v_org and deleted_at is null;
  elsif p_purpose = 'ATTACHMENT' then
    select id into v_session from public.meeting_sessions where id = p_target and organisation_id = v_org;
  elsif p_purpose = 'VIEW_PDF' then
    select p.session_id into v_session from public.presentation_versions v
      join public.presentations p on p.id = v.presentation_id
     where v.id = p_target and v.organisation_id = v_org;
    if v_session is null then
      select session_id into v_session from public.attachments where id = p_target and organisation_id = v_org and deleted_at is null;
    end if;
  else
    raise exception 'Unknown upload type.' using errcode = '22023';
  end if;
  if v_session is null or not app.can_upload_to_session(v_session) then
    raise exception 'You do not have permission to upload files here.' using errcode = '42501';
  end if;

  -- Keep only the file name (no folders), without control characters.
  v_name := left(trim(regexp_replace(regexp_replace(coalesce(p_file_name, ''), '^.*[\\/]', ''), '[[:cntrl:]]', '', 'g')), 200);
  v_ext := lower(substring(v_name from '\.([A-Za-z0-9]{2,5})$'));
  if v_name = '' or v_ext is null then
    raise exception 'The file has no recognisable type. Please upload PDF, PPTX, DOCX or another permitted format.'
      using errcode = '23514', hint = 'FILE_TYPE';
  end if;
  select allowed_file_types into v_allowed from public.organisation_settings where organisation_id = v_org;
  if p_purpose = 'VIEW_PDF' and v_ext <> 'pdf' then
    raise exception 'The viewing copy must be a PDF file.' using errcode = '23514', hint = 'FILE_TYPE_PDF';
  end if;
  if not app.known_file_type(v_ext)
     or not (case when v_ext = 'jpeg' then 'jpg' else v_ext end = any (v_allowed)) then
    raise exception 'This file type (.%) is not allowed. Please upload PDF, PPTX, DOCX or another permitted format.', v_ext
      using errcode = '23514', hint = 'FILE_TYPE';
  end if;
  if p_size is null or p_size <= 0 then
    raise exception 'The file is empty.' using errcode = '23514', hint = 'FILE_EMPTY';
  end if;
  perform app.check_file_limits(v_org, p_size, null);

  v_path := format('%s/%s/%s.%s', v_org, to_char(now(), 'YYYY-MM'), v_id, v_ext);
  insert into public.stored_files (id, organisation_id, object_path, original_name, extension, declared_size,
                                   purpose, target_id, details, uploaded_by)
  values (v_id, v_org, v_path, v_name, v_ext, p_size, p_purpose, p_target,
          jsonb_strip_nulls(jsonb_build_object(
            'title', left(nullif(trim(p_details ->> 'title'), ''), 200),
            'change_notes', left(nullif(trim(p_details ->> 'change_notes'), ''), 1000))),
          auth.uid());
  return jsonb_build_object('file_id', v_id, 'object_path', v_path, 'extension', v_ext);
end $$;

-- Step 2 (server function only, after checking the stored bytes): accepts or
-- rejects the upload and records the version / attachment / viewing copy.
create function public.finalize_upload(p_file_id uuid, p_size bigint, p_valid boolean, p_reason text,
                                       p_mime text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_file public.stored_files;
  v_version_no integer;
  v_version_id uuid;
  v_attachment_id uuid;
  v_presentation uuid;
  v_old_view uuid;
  v_old_path text;
begin
  select * into v_file from public.stored_files where id = p_file_id for update;
  if not found or v_file.status <> 'PENDING' then
    raise exception 'This upload is not waiting to be completed.' using errcode = '22023';
  end if;
  if not p_valid then
    update public.stored_files set status = 'REJECTED', reject_reason = p_reason, completed_at = now() where id = p_file_id;
    return jsonb_build_object('status', 'REJECTED', 'reason', p_reason);
  end if;
  begin
    perform app.check_file_limits(v_file.organisation_id, p_size, v_file.id);
  exception when check_violation then
    update public.stored_files set status = 'REJECTED', reject_reason = sqlerrm, completed_at = now() where id = p_file_id;
    return jsonb_build_object('status', 'REJECTED', 'reason', sqlerrm);
  end;
  update public.stored_files
     set status = 'READY', size_bytes = p_size, mime_type = p_mime, completed_at = now()
   where id = p_file_id;

  if v_file.purpose = 'PRESENTATION' then
    perform 1 from public.presentations where id = v_file.target_id for update;
    select coalesce(max(version_no), 0) + 1 into v_version_no from public.presentation_versions where presentation_id = v_file.target_id;
    insert into public.presentation_versions (organisation_id, presentation_id, version_no, original_file_id,
                                              view_pdf_file_id, change_notes, uploaded_by)
    values (v_file.organisation_id, v_file.target_id, v_version_no, v_file.id,
            case when v_file.extension = 'pdf' then v_file.id end,
            v_file.details ->> 'change_notes', v_file.uploaded_by)
    returning id into v_version_id;
    update public.presentations set current_version_id = v_version_id where id = v_file.target_id;
    return jsonb_build_object('status', 'READY', 'version_id', v_version_id, 'version_no', v_version_no);

  elsif v_file.purpose = 'ATTACHMENT' then
    insert into public.attachments (organisation_id, session_id, file_id, view_pdf_file_id, title, created_by, sort_order)
    values (v_file.organisation_id, v_file.target_id, v_file.id,
            case when v_file.extension = 'pdf' then v_file.id end,
            coalesce(v_file.details ->> 'title', regexp_replace(v_file.original_name, '\.[^.]+$', '')),
            v_file.uploaded_by,
            (select coalesce(max(sort_order), 0) + 1 from public.attachments where session_id = v_file.target_id))
    returning id into v_attachment_id;
    return jsonb_build_object('status', 'READY', 'attachment_id', v_attachment_id);

  else -- VIEW_PDF
    select view_pdf_file_id, presentation_id into v_old_view, v_presentation
      from public.presentation_versions where id = v_file.target_id;
    if v_presentation is not null then
      update public.presentation_versions set view_pdf_file_id = v_file.id where id = v_file.target_id;
    else
      select view_pdf_file_id into v_old_view from public.attachments where id = v_file.target_id;
      update public.attachments set view_pdf_file_id = v_file.id where id = v_file.target_id;
    end if;
    -- Release the previous viewing copy unless something still uses it (e.g. a restored version).
    if v_old_view is not null
       and not exists (select 1 from public.presentation_versions where original_file_id = v_old_view or view_pdf_file_id = v_old_view)
       and not exists (select 1 from public.attachments where file_id = v_old_view or view_pdf_file_id = v_old_view) then
      update public.stored_files set status = 'DELETED' where id = v_old_view returning object_path into v_old_path;
    end if;
    return jsonb_build_object('status', 'READY', 'file_id', v_file.id, 'delete_paths',
                              coalesce(to_jsonb(array_remove(array[v_old_path], null)), '[]'::jsonb));
  end if;
end $$;

-- Makes an earlier version current again (recorded as a new version).
create function public.restore_presentation_version(p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.presentation_versions;
  v_session uuid;
  v_no integer;
  v_id uuid;
begin
  select * into v_old from public.presentation_versions where id = p_version and organisation_id = app.current_org_id();
  select session_id into v_session from public.presentations where id = v_old.presentation_id;
  if v_old.id is null or not app.can_edit_meeting_content(app.session_meeting(v_session)) then
    raise exception 'You do not have permission to restore this version.' using errcode = '42501';
  end if;
  perform 1 from public.presentations where id = v_old.presentation_id for update;
  select max(version_no) + 1 into v_no from public.presentation_versions where presentation_id = v_old.presentation_id;
  insert into public.presentation_versions (organisation_id, presentation_id, version_no, original_file_id, view_pdf_file_id,
                                            change_notes, restored_from, uploaded_by)
  values (v_old.organisation_id, v_old.presentation_id, v_no, v_old.original_file_id, v_old.view_pdf_file_id,
          format('Restored from version %s', v_old.version_no), v_old.version_no, auth.uid())
  returning id into v_id;
  update public.presentations set current_version_id = v_id where id = v_old.presentation_id;
  return jsonb_build_object('version_id', v_id, 'version_no', v_no);
end $$;

-- Removes a presentation or a supporting document. Returns the storage paths
-- the server function must delete. Every version's files are released.
create function public.remove_content(p_kind text, p_id uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid;
  v_files uuid[];
  v_paths text[];
begin
  if p_kind = 'presentation' then
    select session_id into v_session from public.presentations where id = p_id and organisation_id = app.current_org_id() and deleted_at is null;
  elsif p_kind = 'attachment' then
    select session_id into v_session from public.attachments where id = p_id and organisation_id = app.current_org_id() and deleted_at is null;
  end if;
  if v_session is null or not app.can_upload_to_session(v_session) then
    raise exception 'You do not have permission to remove this.' using errcode = '42501';
  end if;
  if p_kind = 'presentation' then
    update public.presentations set deleted_at = now() where id = p_id;
    select array_agg(distinct f) into v_files from (
      select original_file_id f from public.presentation_versions where presentation_id = p_id
      union select view_pdf_file_id from public.presentation_versions where presentation_id = p_id and view_pdf_file_id is not null) x;
    perform app.audit('PRESENTATION_DELETED', 'presentation', p_id::text, null);
  else
    update public.attachments set deleted_at = now() where id = p_id;
    select array_remove(array[file_id, view_pdf_file_id], null) into v_files from public.attachments where id = p_id;
    perform app.audit('ATTACHMENT_DELETED', 'attachment', p_id::text, null);
  end if;
  update public.stored_files set status = 'DELETED' where id = any (v_files) and status <> 'DELETED';
  select array_agg(object_path) into v_paths from public.stored_files where id = any (v_files);
  return coalesce(v_paths, '{}');
end $$;

-- Deletes a draft meeting that has no material yet.
create function public.delete_draft_meeting(p_meeting uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_manage_meeting(p_meeting)
     or not exists (select 1 from public.meetings where id = p_meeting and status = 'DRAFT') then
    raise exception 'Only draft meetings can be deleted. Archive published meetings instead.' using errcode = '42501';
  end if;
  -- Once material has been added, its history is kept: archive instead.
  if exists (select 1 from public.presentations p join public.meeting_sessions s on s.id = p.session_id where s.meeting_id = p_meeting)
     or exists (select 1 from public.attachments a join public.meeting_sessions s on s.id = a.session_id where s.meeting_id = p_meeting) then
    raise exception 'This meeting already has material, so it cannot be deleted. Archive it instead.' using errcode = '23514', hint = 'HAS_CONTENT';
  end if;
  perform app.audit('MEETING_DELETED', 'meeting', p_meeting::text,
                    (select title from public.meetings where id = p_meeting));
  delete from public.meetings where id = p_meeting;
end $$;

revoke execute on function public.begin_upload(text, uuid, text, bigint, jsonb), public.restore_presentation_version(uuid),
  public.remove_content(text, uuid), public.delete_draft_meeting(uuid) from public, anon;
grant execute on function public.begin_upload(text, uuid, text, bigint, jsonb), public.restore_presentation_version(uuid),
  public.remove_content(text, uuid), public.delete_draft_meeting(uuid) to authenticated;
revoke execute on function public.finalize_upload(uuid, bigint, boolean, text, text) from public, anon, authenticated;
grant execute on function public.finalize_upload(uuid, bigint, boolean, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- Audit
-- -----------------------------------------------------------------------------
create trigger presenters_audit after insert or update on public.presenters
  for each row execute function app.audit_row_change('presenter', 'id', 'organisation_id');
create trigger meetings_audit after insert or update on public.meetings
  for each row execute function app.audit_row_change('meeting', 'id', 'organisation_id');
create trigger sessions_audit after insert or update or delete on public.meeting_sessions
  for each row execute function app.audit_row_change('session', 'id', 'organisation_id');
create trigger presentations_audit after insert or update on public.presentations
  for each row execute function app.audit_row_change('presentation', 'id', 'organisation_id');
create trigger versions_audit after insert on public.presentation_versions
  for each row execute function app.audit_row_change('presentation_version', 'id', 'organisation_id');
create trigger attachments_audit after insert or update on public.attachments
  for each row execute function app.audit_row_change('attachment', 'id', 'organisation_id');

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------
alter table public.presenters            enable row level security;
alter table public.meeting_counters      enable row level security;
alter table public.meetings              enable row level security;
alter table public.meeting_sessions      enable row level security;
alter table public.stored_files          enable row level security;
alter table public.presentations         enable row level security;
alter table public.presentation_versions enable row level security;
alter table public.attachments           enable row level security;

revoke all on public.presenters, public.meeting_counters, public.meetings, public.meeting_sessions, public.stored_files,
  public.presentations, public.presentation_versions, public.attachments from anon, authenticated;

-- presenters: every staff member of the organisation can see the directory.
create policy presenters_select on public.presenters for select to authenticated
  using (organisation_id = (select app.current_org_id()));
create policy presenters_insert on public.presenters for insert to authenticated
  with check (organisation_id = (select app.current_org_id()) and app.has_perm('PRESENTER_MANAGE') and app.org_writable(organisation_id));
create policy presenters_update on public.presenters for update to authenticated
  using (organisation_id = (select app.current_org_id()) and app.has_perm('PRESENTER_MANAGE') and app.org_writable(organisation_id))
  with check (organisation_id = (select app.current_org_id()));

-- meetings
-- (Uses the row's own columns, so a newly inserted meeting is visible to its creator.)
create policy meetings_select on public.meetings for select to authenticated
  using (organisation_id = (select app.current_org_id())
         and (app.my_role() in ('ORG_ADMIN', 'ORGANISER') or app.presents_in(id)));
create policy meetings_insert on public.meetings for insert to authenticated
  with check (organisation_id = (select app.current_org_id()) and app.has_perm('MEETING_MANAGE') and app.org_writable(organisation_id)
              and (organiser_user_id = auth.uid() or app.my_role() = 'ORG_ADMIN'));
create policy meetings_update on public.meetings for update to authenticated
  using (app.can_manage_meeting(id)) with check (organisation_id = (select app.current_org_id()));

-- sessions
create policy sessions_select on public.meeting_sessions for select to authenticated
  using (app.can_view_meeting(meeting_id));
create policy sessions_insert on public.meeting_sessions for insert to authenticated
  with check (organisation_id = (select app.current_org_id()) and app.can_edit_meeting_content(meeting_id));
create policy sessions_update on public.meeting_sessions for update to authenticated
  using (app.can_edit_meeting_content(meeting_id)) with check (app.can_edit_meeting_content(meeting_id));
create policy sessions_delete on public.meeting_sessions for delete to authenticated
  using (app.can_edit_meeting_content(meeting_id));

-- presentations
create policy presentations_select on public.presentations for select to authenticated
  using (deleted_at is null and app.can_view_meeting(app.session_meeting(session_id)));
create policy presentations_insert on public.presentations for insert to authenticated
  with check (organisation_id = (select app.current_org_id()) and current_version_id is null and deleted_at is null
              and app.can_upload_to_session(session_id));
create policy presentations_update on public.presentations for update to authenticated
  using (deleted_at is null and app.can_upload_to_session(session_id))
  with check (deleted_at is null and app.can_upload_to_session(session_id));

-- versions and attachments are created by the upload workflow; readable with their meeting.
create policy versions_select on public.presentation_versions for select to authenticated
  using (exists (select 1 from public.presentations p where p.id = presentation_id));
create policy attachments_select on public.attachments for select to authenticated
  using (deleted_at is null and app.can_view_meeting(app.session_meeting(session_id)));
create policy attachments_update on public.attachments for update to authenticated
  using (deleted_at is null and app.can_upload_to_session(session_id))
  with check (deleted_at is null and app.can_upload_to_session(session_id));

-- files: visible when the presentation/attachment using them is visible, or to the uploader.
create policy stored_files_select on public.stored_files for select to authenticated
  using (organisation_id = (select app.current_org_id())
         and (uploaded_by = auth.uid()
              or app.my_role() in ('ORG_ADMIN', 'ORGANISER')
              or exists (select 1 from public.presentation_versions v
                         where v.original_file_id = stored_files.id or v.view_pdf_file_id = stored_files.id)
              or exists (select 1 from public.attachments a
                         where a.file_id = stored_files.id or a.view_pdf_file_id = stored_files.id)));

grant select on public.presenters, public.meetings, public.meeting_sessions, public.stored_files, public.presentations,
  public.presentation_versions, public.attachments to authenticated;
grant insert (organisation_id, full_name, designation, office, email, phone, user_id),
      update (full_name, designation, office, email, phone, user_id, is_active) on public.presenters to authenticated;
grant insert (organisation_id, reference_no, title, description, unit_label, starts_at, ends_at, venue, organiser_user_id,
              chairperson, downloads_allowed, session_release),
      update (reference_no, title, description, unit_label, starts_at, ends_at, venue, organiser_user_id, chairperson,
              status, downloads_allowed, session_release) on public.meetings to authenticated;
grant insert (organisation_id, meeting_id, title, presenter_id, starts_at, ends_at, sort_order, notes),
      update (title, presenter_id, starts_at, ends_at, sort_order, notes), delete on public.meeting_sessions to authenticated;
grant insert (organisation_id, session_id, title, description, category, downloads_allowed, is_visible, sort_order),
      update (title, description, category, downloads_allowed, is_visible, sort_order) on public.presentations to authenticated;
grant update (title, downloads_allowed, sort_order) on public.attachments to authenticated;

-- -----------------------------------------------------------------------------
-- Private "content" bucket. No direct uploads: only signed upload links issued
-- by the server function. Reading follows the stored_files rules above.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('content', 'content', false, 524288000)
on conflict (id) do nothing;

create policy content_select on storage.objects for select to authenticated
  using (bucket_id = 'content'
         and exists (select 1 from public.stored_files f where f.object_path = objects.name and f.status = 'READY'));

-- -----------------------------------------------------------------------------
-- Usage now includes meetings, presentations and all stored files.
-- -----------------------------------------------------------------------------
create or replace function public.organisation_usage(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not (app.is_super_admin() or p_org = app.current_org_id()) then
    raise exception 'You do not have permission to view this organisation.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'organisation_id', p_org,
    'admins', (select count(*) from public.profiles where organisation_id = p_org and is_active and role = 'ORG_ADMIN'),
    'users', (select count(*) from public.profiles where organisation_id = p_org and is_active),
    'meetings', (select count(*) from public.meetings where organisation_id = p_org),
    'presentations', (select count(*) from public.presentations where organisation_id = p_org and deleted_at is null),
    'storage_bytes', app.storage_used(p_org),
    'access', app.org_access(p_org))
    into v_result;
  return v_result || jsonb_build_object('limits', (select to_jsonb(l) - 'organisation_id'
                                                  from public.organisation_limits l where l.organisation_id = p_org));
end $$;

grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.custom_access_token_hook(jsonb), app.password_verification_hook(jsonb),
  app.mfa_verification_hook(jsonb), app.verification_attempt(uuid, boolean, text)
  from public, authenticated, anon, service_role;
