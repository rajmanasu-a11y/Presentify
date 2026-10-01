import { Accordion, Alert, Badge, Button, Card, Group, Modal, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { ConfirmButton } from '../components/ConfirmButton';
import { PageHeader } from '../components/PageHeader';
import { notifyError, notifySuccess } from '../components/notify';
import { supabase } from '../lib/supabase';
import { ChangePasswordForm, MfaEnrollment } from './auth/AuthPages';

export function AccountPage() {
  const { t, i18n } = useTranslation();
  const { me, hasMfa, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const form = useForm({
    initialValues: { full_name: me?.full_name ?? '', designation: me?.designation ?? '', phone: me?.phone ?? '' },
    validate: {
      full_name: (v) => (v.trim().length >= 2 ? null : t('common.required')),
      phone: (v) => (!v || /^[0-9+()\- ]{6,20}$/.test(v) ? null : t('common.invalidPhone')),
    },
  });
  if (!me) return null;

  const removeMfa = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.all ?? []) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (error) {
        notifyError(error);
        return;
      }
    }
    await supabase.auth.refreshSession();
    await refresh();
    notifySuccess(t('common.saved'));
  };

  return (
    <>
      <PageHeader title={t('account.title')} />
      <Stack gap="xl" maw={720}>
        <Card withBorder padding="lg">
          <Title order={2} fz="lg" mb="md">{t('account.profile')}</Title>
          <Group mb="md"><Badge variant="light">{t(`roles.${me.role}`)}</Badge><Text c="dimmed">{me.email}</Text></Group>
          <form
            noValidate
            onSubmit={form.onSubmit(async (v) => {
              setBusy(true);
              const { error } = await supabase.rpc('update_my_profile', {
                p_full_name: v.full_name, p_designation: v.designation, p_phone: v.phone, p_language: i18n.language === 'kn' ? 'kn' : 'en',
              });
              setBusy(false);
              if (error) return notifyError(error);
              await refresh();
              notifySuccess(t('common.saved'));
            })}
          >
            <Stack>
              <TextInput label={t('users.fullName')} required {...form.getInputProps('full_name')} />
              <TextInput label={t('users.designation')} {...form.getInputProps('designation')} />
              <TextInput label={t('users.phone')} type="tel" {...form.getInputProps('phone')} />
              <Group justify="flex-end"><Button type="submit" loading={busy}>{t('common.saveChanges')}</Button></Group>
            </Stack>
          </form>
        </Card>

        <Card withBorder padding="lg">
          <Title order={2} fz="lg" mb="md">{t('account.security')}</Title>
          <Stack gap="xl">
            <ChangePasswordForm onDone={() => notifySuccess(t('auth.passwordChanged'))} />
            <div>
              <Text mb="sm">{hasMfa ? t('account.mfaEnabled') : t('account.mfaNotEnabled')}</Text>
              {!hasMfa && <Button variant="light" onClick={() => setEnrolling(true)}>{t('account.setupMfa')}</Button>}
              {hasMfa && me.mfa_required && <Alert color="blue">{t('account.mfaRequiredNote')}</Alert>}
              {hasMfa && !me.mfa_required && (
                <ConfirmButton variant="light" color="red" message={t('account.confirmRemoveMfa')} onConfirm={removeMfa}>
                  {t('account.removeMfa')}
                </ConfirmButton>
              )}
            </div>
          </Stack>
        </Card>
      </Stack>
      <Modal opened={enrolling} onClose={() => setEnrolling(false)} title={t('auth.mfaSetupTitle')} size="md" centered>
        {enrolling && (
          <MfaEnrollment onDone={async () => { setEnrolling(false); await refresh(); notifySuccess(t('auth.mfaDone')); }} />
        )}
      </Modal>
    </>
  );
}

export function HelpPage() {
  const { t } = useTranslation();
  const topics = ['signIn', 'users', 'org', 'locked', 'coming'];
  return (
    <>
      <PageHeader title={t('help.title')} intro={t('help.intro')} />
      <Accordion variant="separated" maw={820} multiple defaultValue={['signIn']}>
        {topics.map((k) => (
          <Accordion.Item key={k} value={k}>
            <Accordion.Control><Text fw={600}>{t(`help.${k}Title`)}</Text></Accordion.Control>
            <Accordion.Panel><Text>{t(`help.${k}Body`)}</Text></Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Stack align="flex-start" maw={560}>
      <Title order={1}>{t('notFound.title')}</Title>
      <Text>{t('notFound.body')}</Text>
      <Button component={Link} to="/">{t('notFound.home')}</Button>
    </Stack>
  );
}
