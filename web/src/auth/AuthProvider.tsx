import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { hasStoredLanguage, setLanguage, type Language } from '../i18n';

export type Role = 'SUPER_ADMIN' | 'ORG_ADMIN' | 'ORGANISER' | 'PRESENTER';
export type OrgAccess = 'ACTIVE' | 'GRACE' | 'READ_ONLY' | 'INACTIVE';

export interface MyContext {
  user_id: string;
  full_name: string;
  email: string;
  designation: string | null;
  phone: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  preferred_language: Language;
  mfa_required: boolean;
  permissions: string[];
  organisation: null | {
    id: string;
    name: string;
    short_name: string | null;
    tagline: string | null;
    logo_path: string | null;
    brand_color: string;
    access: OrgAccess;
    expires_at: string | null;
    grace_days: number;
  };
}

/**
 * Where the signed-in person is in the sign-in journey:
 *   needsMfa            has an authenticator app and must enter a code
 *   needsPasswordChange still using a temporary password
 *   needsMfaSetup       role requires an authenticator app that is not set up yet
 *   ready               may use Presentify
 */
export type AuthStatus = 'loading' | 'signedOut' | 'notSetUp' | 'needsMfa' | 'needsPasswordChange' | 'needsMfaSetup' | 'ready';

interface AuthValue {
  status: AuthStatus;
  session: Session | null;
  me: MyContext | null;
  hasMfa: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
  readOnly: boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<MyContext | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [hasMfa, setHasMfa] = useState(false);

  const evaluate = useCallback(async (current: Session | null) => {
    setSession(current);
    if (!current) {
      setMe(null);
      setHasMfa(false);
      setStatus('signedOut');
      return;
    }
    const [{ data: ctx, error }, aal, factors] = await Promise.all([
      supabase.rpc('my_context'),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    if (error || !ctx) {
      setMe(null);
      setStatus(error ? 'signedOut' : 'notSetUp');
      return;
    }
    const context = ctx as MyContext;
    setMe(context);
    if (!hasStoredLanguage() && context.preferred_language) setLanguage(context.preferred_language);
    const verifiedTotp = (factors.data?.totp ?? []).length > 0;
    setHasMfa(verifiedTotp);
    const level = aal.data;
    if (level && level.nextLevel === 'aal2' && level.currentLevel !== 'aal2') setStatus('needsMfa');
    else if (context.must_change_password) setStatus('needsPasswordChange');
    else if (context.mfa_required && !verifiedTotp) setStatus('needsMfaSetup');
    else setStatus('ready');
  }, []);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => { if (active) void evaluate(data.session); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // Token refreshes do not change who is signed in; avoid reloading everything.
      if (event === 'TOKEN_REFRESHED') {
        setSession(next);
        return;
      }
      // Defer: the auth client must not be called from inside its own callback.
      setTimeout(() => active && void evaluate(next), 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [evaluate]);

  const value = useMemo<AuthValue>(() => ({
    status,
    session,
    me,
    hasMfa,
    refresh: async () => {
      const { data } = await supabase.auth.getSession();
      await evaluate(data.session);
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
    can: (p) => Boolean(me?.permissions.includes(p)),
    readOnly: me?.organisation?.access === 'READ_ONLY' || me?.organisation?.access === 'INACTIVE',
  }), [status, session, me, hasMfa, evaluate]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
