import { Group, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import mark from '../assets/logo-mark.svg?raw';

/** Presentify mark (QR code over a projector screen), drawn in the current text colour. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }}
      // Static SVG bundled with the app — no user content.
      dangerouslySetInnerHTML={{ __html: mark.replace('<svg ', `<svg width="${size}" height="${size}" `) }}
    />
  );
}

export function Logo({ size = 36, withTagline = false }: { size?: number; withTagline?: boolean }) {
  const { t } = useTranslation();
  return (
    <Group gap="xs" wrap="nowrap">
      <LogoMark size={size} />
      <div>
        <Text fw={700} fz={size >= 48 ? 28 : 20} lh={1.1}>Presentify</Text>
        {withTagline && <Text fz="sm" c="dimmed">{t('app.tagline')}</Text>}
      </div>
    </Group>
  );
}
