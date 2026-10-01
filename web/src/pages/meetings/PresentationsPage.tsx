import { Anchor, Badge, ScrollArea, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { formatDate, formatDateTime } from '../../lib/format';
import { supabase } from '../../lib/supabase';

interface LibraryRow {
  id: string;
  title: string;
  category: string | null;
  updated_at: string;
  current: { version_no: number; view_pdf_file_id: string | null; original: { original_name: string; extension: string } } | null;
  session: { title: string; meeting: { id: string; title: string; starts_at: string; reference_no: string }; presenter: { full_name: string } | null };
}

export function useRecentPresentations(limit: number, search = '') {
  return useQuery({
    queryKey: ['presentations-library', limit, search],
    queryFn: async () => {
      let q = supabase.from('presentations')
        .select(`id, title, category, updated_at,
          current:presentation_versions!presentations_organisation_id_current_version_id_fkey(version_no, view_pdf_file_id,
            original:stored_files!presentation_versions_organisation_id_original_file_id_fkey(original_name, extension)),
          session:meeting_sessions!inner(title, meeting:meetings!inner(id, title, starts_at, reference_no),
            presenter:presenters(full_name))`)
        .order('updated_at', { ascending: false }).limit(limit);
      const term = search.trim().replace(/[%,()]/g, ' ');
      if (term) q = q.ilike('title', `%${term}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as LibraryRow[];
    },
  });
}

export function PresentationsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const { data = [], isLoading } = useRecentPresentations(300, debounced);
  return (
    <>
      <PageHeader title={t('presentations.title')} intro={t('presentations.intro')} />
      <TextInput placeholder={t('common.search')} aria-label={t('common.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={320} mb="md" />
      <ScrollArea>
        <Table striped highlightOnHover verticalSpacing="sm" miw={860}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('presentations.titleField')}</Table.Th><Table.Th>{t('presentations.meeting')}</Table.Th>
              <Table.Th>{t('sessions.presenter')}</Table.Th><Table.Th>{t('presentations.current')}</Table.Th><Table.Th>{t('presentations.updated')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading && <Table.Tr><Table.Td colSpan={5}>{t('common.loading')}</Table.Td></Table.Tr>}
            {!isLoading && data.length === 0 && <Table.Tr><Table.Td colSpan={5}>{t('presentations.noPresentations')}</Table.Td></Table.Tr>}
            {data.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td><Text fw={600}>{p.title}</Text>{p.category && <Text fz="xs" c="dimmed">{p.category}</Text>}</Table.Td>
                <Table.Td>
                  <Anchor component={Link} to={`/meetings/${p.session.meeting.id}`}>{p.session.meeting.title}</Anchor>
                  <Text fz="xs" c="dimmed">{p.session.meeting.reference_no} · {formatDate(p.session.meeting.starts_at)}</Text>
                </Table.Td>
                <Table.Td>{p.session.presenter?.full_name ?? '—'}</Table.Td>
                <Table.Td>
                  {p.current ? (
                    <>
                      <Text fz="sm">{t('presentations.version', { n: p.current.version_no })} · {p.current.original.original_name}</Text>
                      {!p.current.view_pdf_file_id && !['pdf', 'jpg', 'jpeg', 'png'].includes(p.current.original.extension) &&
                        <Badge color="orange" variant="light" size="sm">{t('presentations.uploadPdfCopy')}</Badge>}
                    </>
                  ) : <Text fz="sm" c="dimmed">{t('presentations.noFile')}</Text>}
                </Table.Td>
                <Table.Td>{formatDateTime(p.updated_at)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </>
  );
}
