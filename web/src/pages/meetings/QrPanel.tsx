// "QR code & access" tab: the meeting's QR code (show, copy, download, print,
// display full screen, replace, switch off) and who may open it, and when.
import { Alert, Anchor, Badge, Button, Card, CopyButton, Grid, Group, NumberInput, PasswordInput, Radio, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconCopy, IconDownload, IconPrinter, IconScreenShare } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ConfirmButton } from '../../components/ConfirmButton';
import { notifyError, notifySuccess } from '../../components/notify';
import { config } from '../../config';
import { formatDateTime, fromIstParts, toIstParts } from '../../lib/format';
import { invalidateMeeting } from '../../lib/meetingsApi';
import { supabase } from '../../lib/supabase';
import type { Meeting, QrCode } from '../../lib/types';

export const participantLink = (token: string) => `${config.publicUrl.replace(/\/$/, '')}/m/${token}`;

export function useActiveQr(meetingId: string | undefined, refetchInterval?: number) {
  return useQuery({
    queryKey: ['qr', meetingId],
    enabled: Boolean(meetingId),
    refetchInterval,
    queryFn: async () => {
      const { data, error } = await supabase.from('qr_codes').select('*')
        .eq('meeting_id', meetingId!).eq('status', 'ACTIVE').maybeSingle();
      if (error) throw error;
      return data as QrCode | null;
    },
  });
}

/** QR image as a data URL (high resolution, so it stays sharp when printed or projected). */
export function useQrImage(text: string | null, size = 1024) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!text) { setSrc(null); return; }
    QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: size, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => { if (live) setSrc(url); })
      .catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [text, size]);
  return src;
}

/** When the link works, worked out the same way as the server does. */
export function accessWindow(m: Meeting): { opens: Date | null; closes: Date | null } {
  if (m.availability_mode === 'ALWAYS') return { opens: null, closes: null };
  if (m.availability_mode === 'CUSTOM') {
    return { opens: m.custom_from ? new Date(m.custom_from) : null, closes: m.custom_until ? new Date(m.custom_until) : null };
  }
  const opens = new Date(Date.parse(m.starts_at) - m.open_before_minutes * 60000);
  const closes = m.access_after_days === null ? null : new Date(Date.parse(m.ends_at) + m.access_after_days * 86400000);
  return { opens, closes };
}

function AccessState({ meeting, qr }: { meeting: Meeting; qr: QrCode | null }) {
  const { t } = useTranslation();
  const { opens, closes } = accessWindow(meeting);
  const now = Date.now();
  let color = 'green';
  let label = t('qr.stateOpen');
  if (!qr) { color = 'gray'; label = t('qr.stateOff'); }
  else if (meeting.status === 'ARCHIVED') { color = 'gray'; label = t('qr.stateEnded'); }
  else if (opens && now < opens.getTime()) { color = 'yellow'; label = t('qr.stateNotYet'); }
  else if (closes && now > closes.getTime()) { color = 'gray'; label = t('qr.stateEnded'); }
  return (
    <Stack gap={4}>
      <Group gap="xs"><Badge color={color} variant="light" size="lg">{label}</Badge></Group>
      <Text fz="sm">
        {opens ? t('qr.opensAt', { when: formatDateTime(opens) }) : t('qr.opensAlways')}
        {' · '}
        {closes ? t('qr.closesAt', { when: formatDateTime(closes) }) : t('qr.closesNever')}
      </Text>
      {qr?.expires_at && <Text fz="sm">{t('qr.expiresAt', { when: formatDateTime(qr.expires_at) })}</Text>}
    </Stack>
  );
}

function DateTimeIst({ label, value, onChange, disabled }: { label: string; value: string | null; onChange: (iso: string | null) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const parts = toIstParts(value);
  const [date, setDate] = useState(parts.date);
  const [time, setTime] = useState(parts.time || '09:00');
  useEffect(() => { const p = toIstParts(value); setDate(p.date); setTime(p.time || '09:00'); }, [value]);
  const emit = (d: string, tm: string) => onChange(d && tm ? fromIstParts(d, tm) : null);
  return (
    <Group gap="xs" align="flex-end" wrap="nowrap">
      <TextInput type="date" label={label} value={date} disabled={disabled} style={{ flex: 1 }}
        onChange={(e) => { setDate(e.currentTarget.value); emit(e.currentTarget.value, time); }} />
      <TextInput type="time" label={t('qr.time')} value={time} disabled={disabled} w={120}
        onChange={(e) => { setTime(e.currentTarget.value); emit(date, e.currentTarget.value); }} />
    </Group>
  );
}

function QrCard({ meeting, canManage }: { meeting: Meeting; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const qr = useActiveQr(meeting.id);
  const link = qr.data ? participantLink(qr.data.token) : null;
  const image = useQrImage(link);
  const [expiry, setExpiry] = useState<string | null>(null);
  useEffect(() => setExpiry(qr.data?.expires_at ?? null), [qr.data?.expires_at]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['qr', meeting.id] });

  const rpc = async (fn: string, args: Record<string, unknown>, message: string) => {
    const { error } = await supabase.rpc(fn, args);
    if (error) { notifyError(error); return; }
    await refresh();
    notifySuccess(message);
  };

  if (meeting.status === 'DRAFT') return <Alert color="blue">{t('qr.publishFirst')}</Alert>;
  if (qr.isLoading) return <Text>{t('common.loading')}</Text>;

  const fileName = `${meeting.reference_no}-QR.png`;
  return (
    <Card withBorder padding="lg">
      <Grid gap="xl">
        <Grid.Col span={{ base: 12, sm: 5 }}>
          {image ? (
            <img src={image} alt={t('qr.imageAlt', { title: meeting.title })} data-testid="qr-image"
              style={{ width: '100%', maxWidth: 320, aspectRatio: '1', display: 'block', border: '1px solid var(--mantine-color-gray-3)', borderRadius: 8 }} />
          ) : (
            <Alert color="gray">{t('qr.noActive')}</Alert>
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 7 }}>
          <Stack gap="md">
            <AccessState meeting={meeting} qr={qr.data ?? null} />
            {link && (
              <>
                <TextInput label={t('qr.link')} value={link} readOnly onFocus={(e) => e.currentTarget.select()} data-testid="qr-link" />
                <Group gap="sm">
                  <CopyButton value={link}>
                    {({ copied, copy }) => (
                      <Button variant="default" leftSection={<IconCopy size={18} />} onClick={copy}>{copied ? t('qr.copied') : t('qr.copy')}</Button>
                    )}
                  </CopyButton>
                  <Button variant="default" component="a" href={image ?? undefined} download={fileName} leftSection={<IconDownload size={18} />}>{t('qr.download')}</Button>
                  <Button variant="default" component={Link} to={`/display/meetings/${meeting.id}/qr?print=1`} target="_blank" leftSection={<IconPrinter size={18} />}>{t('qr.print')}</Button>
                  <Button component={Link} to={`/display/meetings/${meeting.id}/qr`} target="_blank" leftSection={<IconScreenShare size={18} />}>{t('qr.display')}</Button>
                </Group>
                <Anchor href={link} target="_blank" rel="noopener" fz="sm">{t('qr.openAsParticipant')}</Anchor>
              </>
            )}
            {canManage && meeting.status === 'PUBLISHED' && (
              <Stack gap="sm" mt="sm">
                <Title order={4}>{t('qr.manage')}</Title>
                {qr.data && (
                  <Group align="flex-end" gap="sm">
                    <DateTimeIst label={t('qr.expiry')} value={expiry} onChange={setExpiry} />
                    <Button variant="default" onClick={() => void rpc('set_qr_expiry', { p_meeting: meeting.id, p_expires_at: expiry }, t('common.saved'))}>{t('qr.saveExpiry')}</Button>
                    {qr.data.expires_at && (
                      <Button variant="subtle" onClick={() => void rpc('set_qr_expiry', { p_meeting: meeting.id, p_expires_at: null }, t('common.saved'))}>{t('qr.noExpiry')}</Button>
                    )}
                  </Group>
                )}
                <Group gap="sm">
                  <ConfirmButton variant="default" message={t('qr.confirmRegenerate')}
                    onConfirm={() => rpc('regenerate_qr', { p_meeting: meeting.id, p_expires_at: null }, t('qr.regenerated'))}>
                    {qr.data ? t('qr.regenerate') : t('qr.create')}
                  </ConfirmButton>
                  {qr.data && (
                    <ConfirmButton variant="default" color="red" message={t('qr.confirmRevoke')}
                      onConfirm={() => rpc('revoke_qr', { p_meeting: meeting.id }, t('qr.revoked'))}>
                      {t('qr.revoke')}
                    </ConfirmButton>
                  )}
                </Group>
                <Text fz="sm" c="dimmed">{t('qr.regenerateHelp')}</Text>
              </Stack>
            )}
          </Stack>
        </Grid.Col>
      </Grid>
    </Card>
  );
}

const AFTER_DAYS = [0, 1, 3, 7, 15, 30, 90, 180, 365];

function AccessSettings({ meeting, disabled }: { meeting: Meeting; disabled: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(meeting.custom_from);
  const [until, setUntil] = useState(meeting.custom_until);
  const [passcode, setPasscode] = useState('');
  // Choices show at once; they go back if saving fails.
  const [regMode, setRegMode] = useState(meeting.registration_mode);
  const [availMode, setAvailMode] = useState(meeting.availability_mode);
  useEffect(() => setRegMode(meeting.registration_mode), [meeting.registration_mode]);
  useEffect(() => setAvailMode(meeting.availability_mode), [meeting.availability_mode]);

  const save = async (patch: Partial<Meeting>) => {
    setBusy(true);
    const { error } = await supabase.from('meetings').update(patch).eq('id', meeting.id);
    setBusy(false);
    if (error) {
      notifyError(error);
      setRegMode(meeting.registration_mode);
      setAvailMode(meeting.availability_mode);
      return false;
    }
    await invalidateMeeting(qc, meeting.id);
    notifySuccess(t('common.saved'));
    return true;
  };
  const setCode = async (value: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('set_meeting_passcode', { p_meeting: meeting.id, p_passcode: value });
    setBusy(false);
    if (error) { notifyError(error); return; }
    setPasscode('');
    await invalidateMeeting(qc, meeting.id);
    notifySuccess(value ? t('qr.passcodeSet') : t('qr.passcodeRemoved'));
  };

  return (
    <Card withBorder padding="lg">
      <Stack gap="xl" maw={720}>
        <Title order={3}>{t('qr.accessTitle')}</Title>
        <Radio.Group label={t('qr.registration')} value={regMode}
          onChange={(v) => { setRegMode(v as Meeting['registration_mode']); void save({ registration_mode: v as Meeting['registration_mode'] }); }}>
          <Stack mt="xs">
            <Radio value="REQUIRED" label={t('qr.regRequired')} disabled={disabled || busy} />
            <Radio value="OPTIONAL" label={t('qr.regOptional')} disabled={disabled || busy} />
            <Radio value="NONE" label={t('qr.regNone')} disabled={disabled || busy} />
          </Stack>
        </Radio.Group>

        <Stack gap="sm">
          <Radio.Group label={t('qr.availability')} value={availMode}
            onChange={(v) => { setAvailMode(v as Meeting['availability_mode']); void save({ availability_mode: v as Meeting['availability_mode'] }); }}>
            <Stack mt="xs">
              <Radio value="MEETING" label={t('qr.availMeeting')} disabled={disabled || busy} />
              <Radio value="CUSTOM" label={t('qr.availCustom')} disabled={disabled || busy} />
              <Radio value="ALWAYS" label={t('qr.availAlways')} disabled={disabled || busy} />
            </Stack>
          </Radio.Group>
          {availMode === 'MEETING' && (
            <Group align="flex-end" gap="md">
              <NumberInput label={t('qr.openBefore')} min={0} max={1440} step={15} w={220} disabled={disabled || busy}
                defaultValue={meeting.open_before_minutes} key={`ob-${meeting.open_before_minutes}`}
                onBlur={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (Number.isInteger(n) && n !== meeting.open_before_minutes) void save({ open_before_minutes: n });
                }} />
              <Select label={t('qr.accessAfter')} w={260} disabled={disabled || busy} allowDeselect={false}
                value={meeting.access_after_days === null ? 'archive' : String(meeting.access_after_days)}
                data={[
                  ...AFTER_DAYS.map((d) => ({ value: String(d), label: d === 0 ? t('qr.afterEnd') : t('qr.afterDays', { count: d }) })),
                  { value: 'archive', label: t('qr.untilArchived') },
                ]}
                onChange={(v) => v && void save({ access_after_days: v === 'archive' ? null : Number(v) })} />
            </Group>
          )}
          {availMode === 'CUSTOM' && (
            <Group align="flex-end" gap="md">
              <DateTimeIst label={t('qr.from')} value={from} onChange={setFrom} disabled={disabled || busy} />
              <DateTimeIst label={t('qr.until')} value={until} onChange={setUntil} disabled={disabled || busy} />
              <Button variant="default" disabled={disabled || busy}
                onClick={() => void save({ custom_from: from, custom_until: until })}>{t('common.save')}</Button>
            </Group>
          )}
        </Stack>

        <Stack gap="xs">
          <Text fw={600}>{t('qr.passcode')}</Text>
          <Text fz="sm" c="dimmed">{meeting.has_passcode ? t('qr.passcodeOn') : t('qr.passcodeOff')}</Text>
          <Group align="flex-end" gap="sm">
            <PasswordInput label={meeting.has_passcode ? t('qr.newPasscode') : t('qr.setPasscode')} w={260} maxLength={40}
              value={passcode} onChange={(e) => setPasscode(e.currentTarget.value)} disabled={disabled || busy} autoComplete="new-password" />
            <Button variant="default" disabled={disabled || busy || passcode.trim().length < 4} onClick={() => void setCode(passcode)}>{t('common.save')}</Button>
            {meeting.has_passcode && (
              <ConfirmButton variant="subtle" color="red" message={t('qr.confirmRemovePasscode')} onConfirm={() => setCode('')}>{t('qr.removePasscode')}</ConfirmButton>
            )}
          </Group>
        </Stack>
      </Stack>
    </Card>
  );
}

export function QrPanel({ meeting, canManage, canEditContent }: { meeting: Meeting; canManage: boolean; canEditContent: boolean }) {
  const archived = meeting.status === 'ARCHIVED';
  return (
    <Stack gap="lg">
      <QrCard meeting={meeting} canManage={canManage} />
      <AccessSettings meeting={meeting} disabled={!canEditContent || archived} />
    </Stack>
  );
}
