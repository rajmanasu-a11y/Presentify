import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Attachment, Meeting, MeetingSession, Presentation, PresentationVersion, Presenter, Profile } from './types';

const FILE_COLS = 'id, object_path, original_name, extension, size_bytes, status';

export type MeetingFilter = 'upcoming' | 'today' | 'past' | 'drafts' | 'archived' | 'all';

export type MeetingRow = Meeting & { meeting_sessions: { count: number }[] };

export function useMeetings(filter: MeetingFilter, search: string) {
  return useQuery({
    queryKey: ['meetings', filter, search],
    queryFn: async () => {
      const now = new Date();
      const dayStart = new Date(`${new Date(now.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10)}T00:00:00+05:30`);
      const dayEnd = new Date(dayStart.getTime() + 86400e3);
      let q = supabase.from('meetings').select('*, meeting_sessions(count)').limit(200);
      if (filter === 'upcoming') q = q.gte('ends_at', now.toISOString()).neq('status', 'ARCHIVED').order('starts_at');
      else if (filter === 'today') q = q.lt('starts_at', dayEnd.toISOString()).gte('ends_at', dayStart.toISOString()).neq('status', 'ARCHIVED').order('starts_at');
      else if (filter === 'past') q = q.lt('ends_at', now.toISOString()).neq('status', 'ARCHIVED').order('starts_at', { ascending: false });
      else if (filter === 'drafts') q = q.eq('status', 'DRAFT').order('starts_at');
      else if (filter === 'archived') q = q.eq('status', 'ARCHIVED').order('starts_at', { ascending: false });
      else q = q.order('starts_at', { ascending: false });
      const term = search.trim().replace(/[%,()]/g, ' ');
      if (term) q = q.or(`title.ilike.%${term}%,reference_no.ilike.%${term}%,venue.ilike.%${term}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data as MeetingRow[];
    },
  });
}

export function useMeeting(id: string | undefined) {
  return useQuery({
    queryKey: ['meeting', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('meetings').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data as Meeting | null;
    },
  });
}

export type PresentationWithVersions = Presentation & { versions: PresentationVersion[] };

export interface MeetingContent {
  sessions: MeetingSession[];
  presentations: PresentationWithVersions[];
  attachments: Attachment[];
}

/** Sessions, presentations (with every version and its files) and supporting material of one meeting. */
export function useMeetingContent(meetingId: string | undefined) {
  return useQuery({
    queryKey: ['meeting-content', meetingId],
    enabled: Boolean(meetingId),
    queryFn: async (): Promise<MeetingContent> => {
      const { data: sessions, error } = await supabase.from('meeting_sessions').select('*')
        .eq('meeting_id', meetingId!).order('starts_at').order('sort_order');
      if (error) throw error;
      const ids = (sessions ?? []).map((s) => s.id);
      if (ids.length === 0) return { sessions: [], presentations: [], attachments: [] };
      const [pres, att] = await Promise.all([
        supabase.from('presentations')
          .select(`*, versions:presentation_versions!presentation_versions_organisation_id_presentation_id_fkey(
              id, presentation_id, version_no, change_notes, restored_from, created_at, uploaded_by,
              original:stored_files!presentation_versions_organisation_id_original_file_id_fkey(${FILE_COLS}),
              view_pdf:stored_files!presentation_versions_organisation_id_view_pdf_file_id_fkey(${FILE_COLS}))`)
          .in('session_id', ids).order('sort_order').order('created_at'),
        supabase.from('attachments')
          .select(`id, session_id, title, downloads_allowed, sort_order,
              file:stored_files!attachments_organisation_id_file_id_fkey(${FILE_COLS}),
              view_pdf:stored_files!attachments_organisation_id_view_pdf_file_id_fkey(${FILE_COLS})`)
          .in('session_id', ids).order('sort_order'),
      ]);
      if (pres.error) throw pres.error;
      if (att.error) throw att.error;
      const presentations = (pres.data as unknown as PresentationWithVersions[]).map((p) => ({
        ...p, versions: [...p.versions].sort((a, b) => b.version_no - a.version_no),
      }));
      return { sessions: sessions as MeetingSession[], presentations, attachments: att.data as unknown as Attachment[] };
    },
  });
}

export function usePresenters(includeInactive = false) {
  return useQuery({
    queryKey: ['presenters', includeInactive],
    queryFn: async () => {
      let q = supabase.from('presenters').select('*').order('full_name');
      if (!includeInactive) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      return data as Presenter[];
    },
  });
}

/** Staff of my organisation (for organiser and presenter-login choices). */
export function useStaff(orgId: string | undefined) {
  return useQuery({
    queryKey: ['users', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('organisation_id', orgId!).order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });
}

export const invalidateMeeting = async (qc: { invalidateQueries: (o: { queryKey: unknown[] }) => Promise<void> }, id: string): Promise<void> => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['meeting', id] }),
    qc.invalidateQueries({ queryKey: ['meeting-content', id] }),
    qc.invalidateQueries({ queryKey: ['qr', id] }),          // publishing creates the QR code
    qc.invalidateQueries({ queryKey: ['meetings'] }),
    qc.invalidateQueries({ queryKey: ['presentations-library'] }),
    qc.invalidateQueries({ queryKey: ['usage'] }),
  ]);
};
