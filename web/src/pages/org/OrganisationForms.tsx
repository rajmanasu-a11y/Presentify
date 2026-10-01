import {
  Alert, Box, Button, Checkbox, ColorInput, Grid, Group, Image, Radio, Select, Stack, Switch, Table, Text, TextInput, Textarea,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { notifyError, notifySuccess } from '../../components/notify';
import { supabase } from '../../lib/supabase';
import { FILE_TYPES, RETENTION_OPTIONS, type Organisation, type OrganisationSettings, type RegistrationField } from '../../lib/types';

const emailOk = (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const phoneOk = (v: string) => !v || /^[0-9+()\- ]{6,20}$/.test(v);
const blank = (v: string) => (v.trim() === '' ? null : v.trim());

// ---------------------------------------------------------------------------
// Branding images (logo / seal), stored privately in the "branding" bucket.
// ---------------------------------------------------------------------------
function useSignedImage(path: string | null) {
  return useQuery({
    queryKey: ['branding-image', path],
    enabled: Boolean(path),
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('branding').createSignedUrl(path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

function BrandingImage({ org, kind, disabled }: { org: Organisation; kind: 'logo' | 'seal'; disabled: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const column = kind === 'logo' ? 'logo_path' : 'seal_path';
  const path = org[column];
  const { data: url } = useSignedImage(path);

  const upload = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return notifyError(new Error(t('org.imageWrongType')));
    if (file.size > 2 * 1024 * 1024) return notifyError(new Error(t('org.imageTooLarge')));
    setBusy(true);
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const newPath = `${org.id}/${kind}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('branding').upload(newPath, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase.from('organisations').update({ [column]: newPath }).eq('id', org.id);
      if (error) {
        await supabase.storage.from('branding').remove([newPath]);
        throw error;
      }
      if (path) await supabase.storage.from('branding').remove([path]);
      await qc.invalidateQueries({ queryKey: ['organisation', org.id] });
      await qc.invalidateQueries({ queryKey: ['organisations'] });
      notifySuccess(t('common.saved'));
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    if (!path) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('organisations').update({ [column]: null }).eq('id', org.id);
      if (error) throw error;
      await supabase.storage.from('branding').remove([path]);
      await qc.invalidateQueries({ queryKey: ['organisation', org.id] });
      notifySuccess(t('common.saved'));
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const label = kind === 'logo' ? t('org.logo') : t('org.seal');
  return (
    <Stack gap="xs">
      <Text fw={600}>{label}</Text>
      <Box w={160} h={120} bg="gray.0" style={{ border: '1px dashed var(--mantine-color-gray-4)', borderRadius: 8, display: 'grid', placeItems: 'center' }}>
        {url ? <Image src={url} alt={label} mah={110} maw={150} fit="contain" /> : <Text fz="sm" c="dimmed" ta="center" px="xs">{t('org.noImage')}</Text>}
      </Box>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label={label}
        data-testid={`${kind}-input`}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
      />
      <Group gap="xs">
        <Button size="sm" variant="light" loading={busy} disabled={disabled} onClick={() => input.current?.click()}>
          {path ? t('org.replaceImage') : t('org.uploadImage')}
        </Button>
        {path && <Button size="sm" variant="subtle" color="red" disabled={disabled || busy} onClick={() => void remove()}>{t('common.remove')}</Button>}
      </Group>
      <Text fz="xs" c="dimmed">{t('org.imageHelp')}</Text>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Profile & branding
// ---------------------------------------------------------------------------
export function OrganisationProfileForm({ org, settings, disabled }: { org: Organisation; settings: OrganisationSettings; disabled: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: {
      name: org.name,
      short_name: org.short_name ?? '',
      tagline: org.tagline ?? '',
      address: org.address ?? '',
      contact_name: org.contact_name ?? '',
      contact_email: org.contact_email ?? '',
      contact_phone: org.contact_phone ?? '',
      brand_color: settings.brand_color,
    },
    validate: {
      name: (v) => (v.trim().length >= 2 ? null : t('common.required')),
      contact_email: (v) => (emailOk(v) ? null : t('common.invalidEmail')),
      contact_phone: (v) => (phoneOk(v) ? null : t('common.invalidPhone')),
      brand_color: (v) => (/^#[0-9A-Fa-f]{6}$/.test(v) ? null : t('common.required')),
    },
  });

  return (
    <Stack gap="xl">
      <Group align="flex-start" gap="xl">
        <BrandingImage org={org} kind="logo" disabled={disabled} />
        <BrandingImage org={org} kind="seal" disabled={disabled} />
      </Group>
      <form
        noValidate
        onSubmit={form.onSubmit(async (v) => {
          setBusy(true);
          try {
            const { error } = await supabase.from('organisations').update({
              name: v.name.trim(), short_name: blank(v.short_name), tagline: blank(v.tagline), address: blank(v.address),
              contact_name: blank(v.contact_name), contact_email: blank(v.contact_email), contact_phone: blank(v.contact_phone),
            }).eq('id', org.id);
            if (error) throw error;
            if (v.brand_color !== settings.brand_color) {
              const { error: sErr } = await supabase.from('organisation_settings').update({ brand_color: v.brand_color }).eq('organisation_id', org.id);
              if (sErr) throw sErr;
            }
            await qc.invalidateQueries({ queryKey: ['organisation', org.id] });
            await qc.invalidateQueries({ queryKey: ['organisations'] });
            notifySuccess(t('common.saved'));
          } catch (err) {
            notifyError(err);
          } finally {
            setBusy(false);
          }
        })}
      >
        <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
          <Grid>
            <Grid.Col span={{ base: 12, md: 8 }}><TextInput label={t('org.name')} required {...form.getInputProps('name')} /></Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}><TextInput label={t('org.shortName')} maxLength={30} {...form.getInputProps('short_name')} /></Grid.Col>
            <Grid.Col span={12}><TextInput label={t('org.tagline')} maxLength={200} {...form.getInputProps('tagline')} /></Grid.Col>
            <Grid.Col span={12}><Textarea label={t('org.address')} maxLength={500} {...form.getInputProps('address')} /></Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}><TextInput label={t('org.contactName')} {...form.getInputProps('contact_name')} /></Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}><TextInput label={t('org.contactEmail')} type="email" {...form.getInputProps('contact_email')} /></Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}><TextInput label={t('org.contactPhone')} type="tel" {...form.getInputProps('contact_phone')} /></Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <ColorInput label={t('org.brandColor')} format="hex" swatches={['#0B2E5C', '#7A1F1F', '#1F5F3A', '#3B3B3B', '#5B2C83']} {...form.getInputProps('brand_color')} />
            </Grid.Col>
          </Grid>
          <Group justify="flex-end" mt="lg"><Button type="submit" loading={busy}>{t('common.saveChanges')}</Button></Group>
        </fieldset>
      </form>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Participant / files / security settings
// ---------------------------------------------------------------------------
type Section = 'participants' | 'files' | 'security';

export function OrganisationSettingsForm({ settings, section, maxRetentionDays, disabled }: {
  settings: OrganisationSettings;
  section: Section;
  maxRetentionDays: number | null;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: {
      registration_fields: settings.registration_fields.map((f) => ({ ...f })),
      consent_text_en: settings.consent_text_en ?? '',
      consent_text_kn: settings.consent_text_kn ?? '',
      participant_retention_days: settings.participant_retention_days === null ? 'indefinite' : String(settings.participant_retention_days),
      keep_participant_directory: settings.keep_participant_directory,
      default_language: settings.default_language,
      allowed_file_types: settings.allowed_file_types,
      downloads_default: settings.downloads_default,
      require_mfa_for_admins: settings.require_mfa_for_admins,
    },
  });

  const retentionOptions = [
    ...RETENTION_OPTIONS.filter((d) => maxRetentionDays === null || d <= maxRetentionDays)
      .map((d) => ({ value: String(d), label: t('org.retentionDays', { count: d }) })),
    ...(maxRetentionDays === null ? [{ value: 'indefinite', label: t('console.packages.indefinite') }] : []),
  ];

  const setField = (index: number, patch: Partial<RegistrationField>) => {
    const fields = form.values.registration_fields.map((f, i) => {
      if (i !== index) return f;
      const next = { ...f, ...patch };
      if (!next.enabled) next.required = false;
      return next;
    });
    form.setFieldValue('registration_fields', fields);
  };

  return (
    <form
      noValidate
      onSubmit={form.onSubmit(async (v) => {
        setBusy(true);
        try {
          const patch: Partial<OrganisationSettings> =
            section === 'participants' ? {
              registration_fields: v.registration_fields,
              consent_text_en: blank(v.consent_text_en),
              consent_text_kn: blank(v.consent_text_kn),
              participant_retention_days: v.participant_retention_days === 'indefinite' ? null : Number(v.participant_retention_days),
              keep_participant_directory: v.keep_participant_directory,
              default_language: v.default_language,
            } : section === 'files' ? {
              allowed_file_types: v.allowed_file_types,
              downloads_default: v.downloads_default,
            } : { require_mfa_for_admins: v.require_mfa_for_admins };
          const { error } = await supabase.from('organisation_settings').update(patch).eq('organisation_id', settings.organisation_id);
          if (error) throw error;
          await qc.invalidateQueries({ queryKey: ['organisation', settings.organisation_id] });
          notifySuccess(t('common.saved'));
        } catch (err) {
          notifyError(err);
        } finally {
          setBusy(false);
        }
      })}
    >
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
        {section === 'participants' && (
          <Stack gap="lg">
            <div>
              <Text fw={700} mb={4}>{t('org.registrationFields')}</Text>
              <Text c="dimmed" fz="sm" mb="sm">{t('org.registrationHelp')}</Text>
              <Table maw={520} withTableBorder>
                <Table.Thead>
                  <Table.Tr><Table.Th>{t('org.field')}</Table.Th><Table.Th>{t('org.show')}</Table.Th><Table.Th>{t('org.requiredField')}</Table.Th></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {form.values.registration_fields.map((f, i) => (
                    <Table.Tr key={f.key}>
                      <Table.Td>{t(`org.fields.${f.key}`)}</Table.Td>
                      <Table.Td>
                        <Checkbox
                          aria-label={`${t(`org.fields.${f.key}`)} — ${t('org.show')}`}
                          checked={f.enabled}
                          disabled={f.key === 'name'}
                          onChange={(e) => setField(i, { enabled: e.currentTarget.checked })}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Checkbox
                          aria-label={`${t(`org.fields.${f.key}`)} — ${t('org.requiredField')}`}
                          checked={f.required}
                          disabled={!f.enabled || f.key === 'name'}
                          onChange={(e) => setField(i, { required: e.currentTarget.checked })}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
            <Textarea label={t('org.consentEn')} description={t('org.consentHelp')} {...form.getInputProps('consent_text_en')} />
            <Textarea label={t('org.consentKn')} description={t('org.consentHelp')} {...form.getInputProps('consent_text_kn')} lang="kn" />
            <Select
              label={t('org.retention')}
              description={t('org.retentionHelp')}
              data={retentionOptions}
              allowDeselect={false}
              maw={360}
              {...form.getInputProps('participant_retention_days')}
            />
            <Switch label={t('org.keepDirectory')} {...form.getInputProps('keep_participant_directory', { type: 'checkbox' })} />
            <Radio.Group label={t('org.defaultLanguage')} {...form.getInputProps('default_language')}>
              <Group mt="xs"><Radio value="en" label="English" /><Radio value="kn" label="ಕನ್ನಡ" /></Group>
            </Radio.Group>
          </Stack>
        )}
        {section === 'files' && (
          <Stack gap="lg">
            <Checkbox.Group label={t('org.allowedTypes')} {...form.getInputProps('allowed_file_types')}>
              <Group mt="xs">{FILE_TYPES.map((ft) => <Checkbox key={ft} value={ft} label={ft.toUpperCase()} />)}</Group>
            </Checkbox.Group>
            <Switch label={t('org.downloadsDefault')} {...form.getInputProps('downloads_default', { type: 'checkbox' })} />
            <Alert color="blue">{t('org.downloadsHelp')}</Alert>
          </Stack>
        )}
        {section === 'security' && (
          <Stack gap="xs">
            <Switch label={t('org.requireMfa')} {...form.getInputProps('require_mfa_for_admins', { type: 'checkbox' })} />
            <Text fz="sm" c="dimmed">{t('org.requireMfaHelp')}</Text>
          </Stack>
        )}
        <Group justify="flex-end" mt="lg"><Button type="submit" loading={busy}>{t('common.saveChanges')}</Button></Group>
      </fieldset>
    </form>
  );
}

/** Loads one organisation with its settings (RLS decides whether the caller may see it). */
export function useOrganisation(orgId: string | undefined) {
  return useQuery({
    queryKey: ['organisation', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const [org, settings, limits] = await Promise.all([
        supabase.from('organisations').select('*').eq('id', orgId!).single(),
        supabase.from('organisation_settings').select('*').eq('organisation_id', orgId!).single(),
        supabase.from('organisation_limits').select('*').eq('organisation_id', orgId!).single(),
      ]);
      if (org.error) throw org.error;
      if (settings.error) throw settings.error;
      if (limits.error) throw limits.error;
      return {
        org: org.data as Organisation,
        settings: settings.data as OrganisationSettings,
        limits: limits.data as { max_retention_days: number | null } & Record<string, unknown>,
      };
    },
  });
}
