import { Alert, Anchor, Box, Button, Card, Center, Code, Group, Image, List, PasswordInput, PinInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthProvider';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { Logo } from '../../components/Logo';
import { TestModeBanner } from '../../components/TestModeBanner';
import { supabase } from '../../lib/supabase';
import i18n from '../../i18n';

/** Turns Supabase Auth errors into translated, actionable messages. */
export function authMessage(err: { message?: string; code?: string; status?: number } | null): string {
  const t = i18n.t.bind(i18n);
  if (!err) return '';
  const msg = err.message ?? '';
  if (err.code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return t('auth.invalidCredentials');
  if (/too many unsuccessful/i.test(msg)) return t('auth.locked');
  if (/deactivated/i.test(msg)) return t('auth.deactivated');
  if (/organisation is currently disabled/i.test(msg)) return t('auth.orgDisabled');
  if (/not set up yet/i.test(msg)) return t('auth.notSetUp');
  if (err.status === 429 || /rate limit|too many requests/i.test(msg)) return t('auth.rateLimited');
  if (err.code === 'mfa_verification_failed' || /invalid totp|mfa/i.test(msg)) return t('auth.invalidCode');
  if (err.code === 'weak_password' || /password/i.test(msg) && /characters|weak/i.test(msg)) return t('auth.weakPassword');
  if (err.code === 'same_password' || /should be different/i.test(msg)) return t('auth.samePassword');
  if (err.code === 'reauthentication_needed') return t('auth.reauthRequired');
  if (/fetch|network/i.test(msg)) return t('common.networkError');
  return msg || t('common.unknownError');
}

/** Centred card used by all sign-in steps. */
export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <TestModeBanner />
      <Box mih="100vh" bg="gray.0" py="xl" px="md">
        <Group justify="flex-end" maw={480} mx="auto" mb="md"><LanguageSwitch /></Group>
        <Center>
          <Card withBorder shadow="sm" padding="xl" w="100%" maw={480} component="main" id="main">
            <Box c="navy.7" mb="lg"><Logo size={44} withTagline /></Box>
            <Title order={1} fz={24} mb="md">{title}</Title>
            {children}
          </Card>
        </Center>
      </Box>
    </>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : t('common.invalidEmail')),
      password: (v) => (v ? null : t('common.required')),
    },
  });
  return (
    <AuthFrame title={t('auth.signInTitle')}>
      <Text c="dimmed" mb="lg">{t('auth.signInSubtitle')}</Text>
      <form
        noValidate
        onSubmit={form.onSubmit(async (values) => {
          setBusy(true);
          setError('');
          const { error: err } = await supabase.auth.signInWithPassword({ email: values.email.trim(), password: values.password });
          setBusy(false);
          if (err) {
            setError(authMessage(err));
            form.setFieldValue('password', '');
          }
        })}
      >
        <Stack>
          {error && <Alert color="red" icon={<IconAlertCircle />} role="alert">{error}</Alert>}
          <TextInput label={t('auth.email')} type="email" autoComplete="username" autoFocus required {...form.getInputProps('email')} />
          <PasswordInput label={t('auth.password')} autoComplete="current-password" required {...form.getInputProps('password')} />
          <Button type="submit" size="lg" loading={busy} fullWidth>{t('auth.signIn')}</Button>
          <Anchor component="button" type="button" onClick={() => setShowForgot((v) => !v)} ta="center">
            {t('auth.forgotPassword')}
          </Anchor>
          {showForgot && <Alert color="blue">{t('auth.forgotPasswordHelp')}</Alert>}
        </Stack>
      </form>
    </AuthFrame>
  );
}

/** Six-digit code entry shared by sign-in verification and set-up. */
function CodeEntry({ onSubmit, busy }: { onSubmit: (code: string) => void; busy: boolean }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (code.length === 6) onSubmit(code); }}>
      <Stack>
        <Text fw={600} id="code-label">{t('auth.code')}</Text>
        <PinInput
          length={6}
          type="number"
          oneTimeCode
          size="lg"
          value={code}
          onChange={setCode}
          onComplete={(v) => onSubmit(v)}
          aria-labelledby="code-label"
          autoFocus
        />
        <Button type="submit" size="lg" loading={busy} disabled={code.length !== 6}>{t('auth.verify')}</Button>
      </Stack>
    </form>
  );
}

export function MfaChallengePage() {
  const { t } = useTranslation();
  const { refresh, signOut } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const verify = async (code: string) => {
    setBusy(true);
    setError('');
    const factors = await supabase.auth.mfa.listFactors();
    const factor = factors.data?.totp[0];
    if (!factor) {
      setBusy(false);
      setError(t('common.unknownError'));
      return;
    }
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setBusy(false);
    if (err) {
      setError(authMessage(err));
      if (/too many unsuccessful/i.test(err.message)) await signOut();
      return;
    }
    await refresh();
  };
  return (
    <AuthFrame title={t('auth.mfaTitle')}>
      <Text mb="lg">{t('auth.mfaPrompt')}</Text>
      {error && <Alert color="red" mb="md" role="alert">{error}</Alert>}
      <CodeEntry onSubmit={verify} busy={busy} />
      <Button variant="subtle" mt="md" fullWidth onClick={() => void signOut()}>{t('common.signOut')}</Button>
    </AuthFrame>
  );
}

/** Authenticator-app set-up: used when required at sign-in, and from My account. */
export function MfaEnrollment({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [enrolment, setEnrolment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Remove unfinished earlier attempts so a fresh QR code is shown.
      const { data } = await supabase.auth.mfa.listFactors();
      for (const f of data?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: enrolled, error: err } = await supabase.auth.mfa.enroll({
        factorType: 'totp', friendlyName: `Presentify ${new Date().toISOString().slice(0, 16)}`, issuer: 'Presentify',
      });
      if (cancelled) return;
      if (err || !enrolled) setError(authMessage(err));
      else setEnrolment({ id: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
    })();
    return () => { cancelled = true; };
  }, []);

  const verify = async (code: string) => {
    if (!enrolment) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolment.id, code });
    setBusy(false);
    if (err) setError(authMessage(err));
    else onDone();
  };

  return (
    <Stack>
      <Text>{t('auth.mfaSetupIntro')}</Text>
      <List type="ordered" spacing="sm">
        <List.Item>{t('auth.mfaStep1')}</List.Item>
        <List.Item>{t('auth.mfaStep2')}</List.Item>
        <List.Item>{t('auth.mfaStep3')}</List.Item>
      </List>
      {enrolment && (
        <>
          <Center bg="white" p="sm" style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 8 }}>
            <Image src={enrolment.qr} alt="QR code for the authenticator app" w={200} h={200} data-testid="mfa-qr" />
          </Center>
          <Text fz="sm">{t('auth.cantScan')}</Text>
          <Code block fz="md" data-testid="mfa-secret" style={{ wordBreak: 'break-all' }}>{enrolment.secret}</Code>
        </>
      )}
      {error && <Alert color="red" role="alert">{error}</Alert>}
      <CodeEntry onSubmit={verify} busy={busy} />
    </Stack>
  );
}

export function MfaSetupPage() {
  const { t } = useTranslation();
  const { refresh, signOut } = useAuth();
  return (
    <AuthFrame title={t('auth.mfaSetupTitle')}>
      <MfaEnrollment onDone={() => void refresh()} />
      <Button variant="subtle" mt="md" fullWidth onClick={() => void signOut()}>{t('common.signOut')}</Button>
    </AuthFrame>
  );
}

export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { password: '', confirm: '' },
    validate: {
      password: (v) => (v.length >= 10 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v) ? null : t('auth.weakPassword')),
      confirm: (v, values) => (v === values.password ? null : t('auth.passwordMismatch')),
    },
  });
  return (
    <form
      noValidate
      onSubmit={form.onSubmit(async (values) => {
        setBusy(true);
        setError('');
        const { error: err } = await supabase.auth.updateUser({ password: values.password });
        setBusy(false);
        if (err) {
          setError(authMessage(err));
          return;
        }
        form.reset();
        onDone();
      })}
    >
      <Stack>
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <PasswordInput label={t('auth.newPassword')} description={t('auth.passwordRules')} autoComplete="new-password" required {...form.getInputProps('password')} />
        <PasswordInput label={t('auth.confirmPassword')} autoComplete="new-password" required {...form.getInputProps('confirm')} />
        <Button type="submit" loading={busy}>{t('auth.changePassword')}</Button>
      </Stack>
    </form>
  );
}

export function ForcedPasswordChangePage() {
  const { t } = useTranslation();
  const { refresh, signOut } = useAuth();
  return (
    <AuthFrame title={t('auth.changePasswordTitle')}>
      <Text mb="lg">{t('auth.changePasswordIntro')}</Text>
      <ChangePasswordForm onDone={() => void refresh()} />
      <Button variant="subtle" mt="md" fullWidth onClick={() => void signOut()}>{t('common.signOut')}</Button>
    </AuthFrame>
  );
}

export function NotSetUpPage() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  return (
    <AuthFrame title={t('auth.signInTitle')}>
      <Alert color="red" mb="md">{t('auth.notSetUp')}</Alert>
      <Button onClick={() => void signOut()}>{t('common.signOut')}</Button>
    </AuthFrame>
  );
}
