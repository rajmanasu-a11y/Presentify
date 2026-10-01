import { Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

export function PageHeader({ title, intro, actions }: { title: string; intro?: string; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" mb="lg" gap="md">
      <Stack gap={4} style={{ flex: 1, minWidth: 240 }}>
        <Title order={1} fz={{ base: 24, sm: 28 }}>{title}</Title>
        {intro && <Text c="dimmed">{intro}</Text>}
      </Stack>
      {actions && <Group gap="sm">{actions}</Group>}
    </Group>
  );
}
