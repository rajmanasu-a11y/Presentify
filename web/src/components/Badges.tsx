import { Badge } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { OrgAccess } from '../auth/AuthProvider';

const accessColor: Record<OrgAccess, string> = { ACTIVE: 'green', GRACE: 'orange', READ_ONLY: 'red', INACTIVE: 'gray' };

export function AccessBadge({ access }: { access: OrgAccess }) {
  const { t } = useTranslation();
  return <Badge color={accessColor[access]} variant="light" size="lg">{t(`access.${access}`)}</Badge>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return <Badge color={active ? 'green' : 'gray'} variant="light">{active ? t('common.active') : t('common.inactive')}</Badge>;
}
