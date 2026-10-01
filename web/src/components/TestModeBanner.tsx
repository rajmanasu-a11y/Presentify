import { Box } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { config } from '../config';

export function TestModeBanner() {
  const { t } = useTranslation();
  if (!config.testMode) return null;
  return (
    <Box role="note" bg="yellow.3" c="dark.9" ta="center" fz="sm" fw={600} py={4} px="sm">
      {t('app.testMode')}
    </Box>
  );
}
