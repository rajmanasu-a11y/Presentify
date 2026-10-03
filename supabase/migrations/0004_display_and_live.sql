-- =============================================================================
-- Presentify 0004 — meeting wizard, display / presenter mode, live count.
--
-- * A QR code can be created while the meeting is still a draft (the wizard's
--   "Generate QR" step comes before "Review & Publish", and organisers may want
--   to print it in advance). Until the meeting is published the code shows
--   "This meeting has not opened yet".
-- * Live figures for the display and presenter screens: numbers only, never
--   names. Administrators and organisers always see them; presenters only if
--   the organisation allows it (on by default).
-- =============================================================================

alter table public.organisation_settings
  add column presenters_see_count boolean not null default true;

-- QR codes of draft meetings resolve to "not yet open" (no date: it is not published yet).
create or replace function app.resolve_qr(p_token text)
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
  if v_m.id is null then
    return query select null::uuid, null::uuid, 'INVALID'::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  v_access := app.org_access(v_m.organisation_id);
  if v_access = 'INACTIVE' then
    return query select null::uuid, null::uuid, 'INVALID'::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  if v_m.status = 'DRAFT' then
    return query select v_m.id, v_m.organisation_id,
      case when v_access = 'READ_ONLY' then 'UNAVAILABLE' else 'NOT_YET' end, null::timestamptz, null::timestamptz;
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
revoke execute on function app.resolve_qr(text) from public, authenticated, anon;

-- Creates (or replaces) the meeting's QR code — drafts included, not archived meetings.
create or replace function public.regenerate_qr(p_meeting uuid, p_expires_at timestamptz default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.meetings;
  v_token text;
  v_replaced boolean;
begin
  select * into v_m from public.meetings where id = p_meeting;
  if not app.can_manage_meeting(p_meeting) then
    raise exception 'You do not have permission to change this QR code.' using errcode = '42501';
  end if;
  if v_m.status = 'ARCHIVED' then
    raise exception 'This meeting is archived. Restore it before changing its QR code.' using errcode = '23514', hint = 'ARCHIVED';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The expiry must be in the future.' using errcode = '23514', hint = 'EXPIRY_PAST';
  end if;
  update public.qr_codes set status = 'REVOKED', revoked_at = now(), revoked_by = auth.uid()
   where meeting_id = p_meeting and status = 'ACTIVE';
  v_replaced := found;
  insert into public.qr_codes (organisation_id, meeting_id, expires_at, created_by)
  values (v_m.organisation_id, p_meeting, p_expires_at, auth.uid())
  returning token into v_token;
  perform app.audit(case when v_replaced then 'QR_REGENERATED' else 'QR_GENERATED' end, 'meeting', p_meeting::text, v_m.reference_no);
  return v_token;
end $$;

-- Live figures for one meeting (counts only).
create function public.meeting_live_stats(p_meeting uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_allowed boolean;
  v_result jsonb;
begin
  v_allowed := app.can_view_meeting(p_meeting) and (
    app.has_perm('PARTICIPANT_VIEW')
    or (app.has_perm('QR_DISPLAY') and coalesce((
          select s.presenters_see_count from public.meetings m
            join public.organisation_settings s on s.organisation_id = m.organisation_id
           where m.id = p_meeting), false)));
  if not coalesce(v_allowed, false) then
    raise exception 'You do not have permission to see these figures.' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'total', count(*),
           'registered', count(*) filter (where not a.anonymous),
           'anonymous', count(*) filter (where a.anonymous),
           'active_now', count(*) filter (where a.last_access_at > now() - interval '10 minutes'),
           'joined_last_10_min', count(*) filter (where a.registered_at > now() - interval '10 minutes'))
    into v_result
    from public.attendance a where a.meeting_id = p_meeting;
  return v_result || jsonb_build_object(
    'views', (select count(*) from public.access_events e where e.meeting_id = p_meeting and e.action = 'VIEW'),
    'downloads', (select count(*) from public.access_events e where e.meeting_id = p_meeting and e.action = 'DOWNLOAD'),
    'as_of', now());
end $$;
revoke execute on function public.meeting_live_stats(uuid) from public, anon;
grant execute on function public.meeting_live_stats(uuid) to authenticated;
