// manage-users — staff account administration.
//
// POST /functions/v1/manage-users   { "action": "...", ... }
//
//   create          { email, full_name, role, organisation_id?, designation?, phone?,
//                     can_create_meetings?, can_view_participant_count? }
//                   → { user_id, temporary_password }
//   update          { user_id, full_name?, designation?, phone?, role?, can_create_meetings?,
//                     can_view_participant_count? }
//   set_active      { user_id, active }
//   reset_password  { user_id }            → { temporary_password }
//   reset_mfa       { user_id }            (removes authenticator apps; user sets up again)
//
// Who may act on whom
//   Super Admin (MFA-verified): staff of any organisation (not other Super Admins,
//     who are managed from the server console).
//   Organisation Admin: staff of their own organisation while it is not read-only;
//     cannot change their own role or deactivate themselves.
//   Everyone else: not permitted.
// Limits (administrators, users) are enforced by the database in the same transaction.

import { badRequest, bool, clientIp, forbidden, HttpError, isEmail, json, notFound, serve, str, uuid } from '../_shared/http.ts';
import { authAdmin, Caller, dbToHttp, requireCaller, rest, temporaryPassword } from '../_shared/platform.ts';

type Role = 'ORG_ADMIN' | 'ORGANISER' | 'PRESENTER';
const STAFF_ROLES: Role[] = ['ORG_ADMIN', 'ORGANISER', 'PRESENTER'];

interface Profile {
  user_id: string;
  organisation_id: string | null;
  role: string;
  full_name: string;
  email: string;
  is_active: boolean;
}

function parseRole(v: unknown): Role {
  if (typeof v !== 'string' || !STAFF_ROLES.includes(v as Role)) {
    throw badRequest('Role must be Organisation Admin, Organiser or Presenter.');
  }
  return v as Role;
}

async function assertOrgWritable(orgId: string) {
  const access = await rest<string>('/rpc/organisation_access', { method: 'POST', body: { p_org: orgId } });
  if (access === null) throw notFound('Organisation not found.');
  if (access === 'INACTIVE') throw forbidden('This organisation is deactivated.');
  if (access === 'READ_ONLY') {
    throw forbidden('This organisation\'s subscription has expired. Changes are not possible until it is renewed.');
  }
}

/** Decides which organisation the caller may manage; throws if none. */
function managedOrg(caller: Caller, requestedOrg: string | null): string {
  const { role, organisation } = caller.context;
  if (role === 'SUPER_ADMIN') {
    if (!requestedOrg) throw badRequest('Please choose the organisation.');
    return requestedOrg;
  }
  if (role === 'ORG_ADMIN' && caller.context.permissions.includes('USER_MANAGE') && organisation) {
    if (requestedOrg && requestedOrg !== organisation.id) throw forbidden();
    return organisation.id;
  }
  throw forbidden();
}

async function loadTarget(caller: Caller, userId: string): Promise<Profile> {
  const rows = await rest<Profile[]>(`/profiles?user_id=eq.${userId}&select=user_id,organisation_id,role,full_name,email,is_active`);
  const target = rows[0];
  if (!target) throw notFound('User not found.');
  if (target.role === 'SUPER_ADMIN') {
    throw forbidden('Super Admin accounts are managed from the server console.');
  }
  managedOrg(caller, target.organisation_id); // throws when outside the caller's organisation
  return target;
}

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const ip = clientIp(req);
  const actor = caller.userId;
  const action = str(body, 'action', { required: true });

  try {
    switch (action) {
      case 'create': {
        const orgId = managedOrg(caller, uuid(body, 'organisation_id', false));
        await assertOrgWritable(orgId);
        const email = str(body, 'email', { required: true, label: 'E-mail' })!.toLowerCase();
        if (!isEmail(email)) throw badRequest('Please enter a valid e-mail address.');
        const fullName = str(body, 'full_name', { required: true, min: 2, max: 120, label: 'Full name' })!;
        const role = parseRole(body.role);
        const password = temporaryPassword();

        const user = await authAdmin<{ id: string }>('/users', 'POST', {
          email, password, email_confirm: true, user_metadata: { full_name: fullName },
        });
        try {
          await rest('/profiles', {
            method: 'POST', actor, ip, prefer: 'return=minimal',
            body: {
              user_id: user.id,
              organisation_id: orgId,
              role,
              full_name: fullName,
              email,
              designation: str(body, 'designation', { max: 120 }),
              phone: str(body, 'phone', { max: 20 }),
              can_create_meetings: bool(body, 'can_create_meetings') ?? true,
              can_view_participant_count: bool(body, 'can_view_participant_count') ?? false,
              must_change_password: true,
              created_by: actor,
            },
          });
        } catch (err) {
          // Never leave a login without a profile (e.g. when a limit was reached).
          await authAdmin(`/users/${user.id}`, 'DELETE').catch(() => {});
          throw err;
        }
        return json({ user_id: user.id, temporary_password: password }, 201);
      }

      case 'update': {
        const userId = uuid(body, 'user_id')!;
        const target = await loadTarget(caller, userId);
        await assertOrgWritable(target.organisation_id!);
        const patch: Record<string, unknown> = {};
        const fullName = str(body, 'full_name', { min: 2, max: 120, label: 'Full name' });
        if (fullName) patch.full_name = fullName;
        if ('designation' in body) patch.designation = str(body, 'designation', { max: 120 });
        if ('phone' in body) patch.phone = str(body, 'phone', { max: 20 });
        if (body.role !== undefined) {
          const role = parseRole(body.role);
          if (userId === actor && role !== target.role) throw forbidden('You cannot change your own role.');
          patch.role = role;
        }
        const ccm = bool(body, 'can_create_meetings');
        if (ccm !== undefined) patch.can_create_meetings = ccm;
        const cvp = bool(body, 'can_view_participant_count');
        if (cvp !== undefined) patch.can_view_participant_count = cvp;
        if (Object.keys(patch).length === 0) throw badRequest('Nothing to change.');
        await rest(`/profiles?user_id=eq.${userId}`, { method: 'PATCH', body: patch, actor, ip, prefer: 'return=minimal' });
        return json({ ok: true });
      }

      case 'set_active': {
        const userId = uuid(body, 'user_id')!;
        const active = bool(body, 'active');
        if (active === undefined) throw badRequest('active is required.');
        if (userId === actor) throw forbidden('You cannot deactivate your own account.');
        const target = await loadTarget(caller, userId);
        await assertOrgWritable(target.organisation_id!);
        await rest(`/profiles?user_id=eq.${userId}`, { method: 'PATCH', body: { is_active: active }, actor, ip, prefer: 'return=minimal' });
        // A ban stops new sign-ins and token refreshes; the database already refuses
        // the account's requests because its profile is inactive.
        await authAdmin(`/users/${userId}`, 'PUT', { ban_duration: active ? 'none' : '876000h' });
        return json({ ok: true });
      }

      case 'reset_password': {
        const userId = uuid(body, 'user_id')!;
        if (userId === actor) throw forbidden('Use "Change password" to change your own password.');
        const target = await loadTarget(caller, userId);
        const password = temporaryPassword();
        await authAdmin(`/users/${userId}`, 'PUT', { password });
        await rest(`/profiles?user_id=eq.${userId}`, { method: 'PATCH', body: { must_change_password: true }, actor, ip, prefer: 'return=minimal' });
        await rest('/audit_logs', {
          method: 'POST', actor, ip, prefer: 'return=minimal',
          body: {
            organisation_id: target.organisation_id, actor_user_id: actor, actor_role: caller.context.role,
            actor_name: caller.context.full_name, action: 'USER_PASSWORD_RESET', entity_type: 'user',
            entity_id: userId, summary: `Temporary password issued for ${target.full_name}`, ip,
          },
        });
        return json({ temporary_password: password });
      }

      case 'reset_mfa': {
        const userId = uuid(body, 'user_id')!;
        const target = await loadTarget(caller, userId);
        const user = await authAdmin<{ factors?: { id: string }[] }>(`/users/${userId}`);
        for (const factor of user.factors ?? []) {
          await authAdmin(`/users/${userId}/factors/${factor.id}`, 'DELETE');
        }
        await rest('/audit_logs', {
          method: 'POST', actor, ip, prefer: 'return=minimal',
          body: {
            organisation_id: target.organisation_id, actor_user_id: actor, actor_role: caller.context.role,
            actor_name: caller.context.full_name, action: 'USER_MFA_RESET', entity_type: 'user',
            entity_id: userId, summary: `Authenticator app removed for ${target.full_name}`, ip,
          },
        });
        return json({ ok: true, removed: (user.factors ?? []).length });
      }

      default:
        throw badRequest('Unknown action.');
    }
  } catch (err) {
    const mapped = dbToHttp(err);
    if (mapped instanceof HttpError) throw mapped;
    throw err;
  }
});
