import type { OrgAccess, Role } from '../auth/AuthProvider';

export interface Organisation {
  id: string;
  name: string;
  short_name: string | null;
  tagline: string | null;
  address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  logo_path: string | null;
  seal_path: string | null;
  package_id: string;
  max_admins: number | null;
  max_users: number | null;
  max_meetings: number | null;
  max_presentations: number | null;
  max_participants_per_meeting: number | null;
  storage_bytes: number | null;
  max_file_bytes: number | null;
  status: 'ACTIVE' | 'INACTIVE';
  expires_at: string | null;
  grace_days: number;
  created_at: string;
}

export interface Package {
  id: string;
  code: string;
  name: string;
  description: string | null;
  max_admins: number;
  max_users: number;
  max_meetings: number;
  max_presentations: number;
  max_participants_per_meeting: number;
  storage_bytes: number;
  max_file_bytes: number;
  max_retention_days: number | null;
  is_active: boolean;
}

export interface RegistrationField {
  key: string;
  enabled: boolean;
  required: boolean;
}

export interface OrganisationSettings {
  organisation_id: string;
  allowed_file_types: string[];
  downloads_default: boolean;
  registration_fields: RegistrationField[];
  consent_text_en: string | null;
  consent_text_kn: string | null;
  participant_retention_days: number | null;
  keep_participant_directory: boolean;
  require_mfa_for_admins: boolean;
  default_language: 'en' | 'kn';
  brand_color: string;
}

export interface Profile {
  user_id: string;
  organisation_id: string | null;
  role: Role;
  full_name: string;
  designation: string | null;
  phone: string | null;
  email: string;
  is_active: boolean;
  can_create_meetings: boolean;
  can_view_participant_count: boolean;
  must_change_password: boolean;
  last_sign_in_at: string | null;
  created_at: string;
}

export interface Usage {
  organisation_id: string;
  admins: number;
  users: number;
  storage_bytes: number;
  access: OrgAccess;
  limits: {
    max_admins: number;
    max_users: number;
    max_meetings: number;
    max_presentations: number;
    max_participants_per_meeting: number;
    storage_bytes: number;
    max_file_bytes: number;
    max_retention_days: number | null;
  };
}

export interface AuditRow {
  id: number;
  occurred_at: string;
  organisation_id: string | null;
  actor_user_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
}

export interface LoginEvent {
  id: number;
  occurred_at: string;
  user_id: string | null;
  organisation_id: string | null;
  email: string | null;
  event: string;
}

export const FILE_TYPES = ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'mp4', 'zip'];
export const RETENTION_OPTIONS = [30, 90, 180, 365];
