import { Card, Progress, Text } from '@mantine/core';

export function StatCard({ label, value, hint, percent }: { label: string; value: string | number; hint?: string; percent?: number }) {
  return (
    <Card withBorder padding="lg">
      <Text c="dimmed" fz="sm" fw={600}>{label}</Text>
      <Text fz={30} fw={700} lh={1.3}>{value}</Text>
      {hint && <Text fz="sm" c="dimmed">{hint}</Text>}
      {percent !== undefined && (
        <Progress mt="sm" value={Math.min(100, percent)} color={percent >= 90 ? 'red' : percent >= 75 ? 'orange' : 'navy'} aria-hidden />
      )}
    </Card>
  );
}
