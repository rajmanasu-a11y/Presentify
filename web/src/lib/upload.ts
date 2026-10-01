import i18n from '../i18n';
import { AppError, callFunction } from './errors';
import { supabase } from './supabase';

export type UploadPurpose = 'PRESENTATION' | 'ATTACHMENT' | 'VIEW_PDF';

export interface UploadResult {
  status: 'READY';
  version_id?: string;
  version_no?: number;
  attachment_id?: string;
  file_id?: string;
}

/** PUT with progress (fetch cannot report upload progress). */
function put(url: string, file: File, contentType: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new AppError(i18n.t('upload.failed'))));
    xhr.onerror = () => reject(new AppError(i18n.t('common.networkError')));
    xhr.send(file);
  });
}

/**
 * Uploads one file: the server reserves space and checks permission, the bytes go
 * straight to the file store, then the server checks the stored file and records it.
 */
export async function uploadFile(opts: {
  purpose: UploadPurpose;
  targetId: string;
  file: File;
  details?: { title?: string; change_notes?: string };
  onProgress?: (pct: number) => void;
}): Promise<UploadResult> {
  const { purpose, targetId, file, details, onProgress } = opts;
  const started = await callFunction<{ file_id: string; upload_url: string; content_type: string }>('uploads', {
    action: 'start', purpose, target_id: targetId, file_name: file.name, size: file.size, details: details ?? {},
  });
  await put(`${window.location.origin}${started.upload_url}`, file, started.content_type, onProgress);
  const result = await callFunction<UploadResult & { status: string; reason?: string }>('uploads', {
    action: 'finish', file_id: started.file_id,
  });
  if (result.status !== 'READY') throw new AppError(result.reason ?? i18n.t('upload.failed'));
  return result;
}

export async function removeContent(kind: 'presentation' | 'attachment', id: string) {
  await callFunction('uploads', { action: 'remove', kind, id });
}

/** Opens a stored file in a new tab through a short-lived link. */
export async function openStoredFile(objectPath: string, downloadName?: string) {
  // Open the tab first (synchronously) so pop-up blockers allow it.
  const tab = window.open('', '_blank');
  const { data, error } = await supabase.storage.from('content')
    .createSignedUrl(objectPath, 300, downloadName ? { download: downloadName } : undefined);
  if (error || !data) {
    tab?.close();
    throw error ?? new AppError(i18n.t('common.unknownError'));
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = data.signedUrl;
  } else {
    window.location.href = data.signedUrl;
  }
}

export const ACCEPT: Record<string, string> = {
  pdf: '.pdf', ppt: '.ppt', pptx: '.pptx', doc: '.doc', docx: '.docx', xls: '.xls', xlsx: '.xlsx',
  jpg: '.jpg,.jpeg', jpeg: '.jpeg', png: '.png', mp4: '.mp4', zip: '.zip', pps: '.pps', ppsx: '.ppsx',
};

export function acceptFor(types: string[]): string {
  return types.map((t) => ACCEPT[t] ?? `.${t}`).join(',');
}
