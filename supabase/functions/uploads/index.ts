// uploads — presentation and supporting-material files.
//
// POST /functions/v1/uploads  { "action": "...", ... }
//
//   start   { purpose, target_id, file_name, size, details? }
//           purpose: PRESENTATION (target = presentation; creates a new version)
//                    ATTACHMENT   (target = session; adds supporting material)
//                    VIEW_PDF     (target = version or attachment; PDF copy for phones)
//           → { file_id, upload_url, content_type }   upload the bytes with PUT to upload_url
//   finish  { file_id }  → checks the stored file and records it
//           → { status: 'READY', ... } or { status: 'REJECTED', reason }
//   remove  { kind: 'presentation' | 'attachment', id }  → deletes it and its files
//
// The database decides who may upload where and enforces type, size and storage
// limits (begin_upload). This function then checks what was actually stored —
// real size, content type and the file's signature bytes — before it is accepted
// (finalize_upload). Files that fail are deleted.

import { badRequest, clientIp, forbidden, HttpError, json, serve, str, uuid } from '../_shared/http.ts';
import { DbRequestError, requireCaller, rest } from '../_shared/platform.ts';

const STORAGE_URL = Deno.env.get('PRESENTIFY_STORAGE_URL') ?? 'http://storage:5000';
const REST_URL = Deno.env.get('PRESENTIFY_REST_URL') ?? 'http://rest:3000';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BUCKET = 'content';

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pps: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  zip: 'application/zip',
};

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Does the file's content match its declared type? (signature bytes) */
function signatureMatches(ext: string, b: Uint8Array): boolean {
  switch (ext) {
    case 'pdf': {
      // "%PDF-" must appear within the first 1024 bytes.
      const head = new TextDecoder('latin1').decode(b.subarray(0, 1024));
      return head.includes('%PDF-');
    }
    case 'pptx': case 'ppsx': case 'docx': case 'xlsx': case 'zip':
      return startsWith(b, ZIP);
    case 'ppt': case 'pps': case 'doc': case 'xls':
      return startsWith(b, OLE);
    case 'jpg': case 'jpeg':
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'png':
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'mp4':
      return startsWith(b, [0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
    default:
      return false;
  }
}

/** Calls a database function as the signed-in person (their permissions apply). */
async function rpcAsCaller<T>(token: string, fn: string, args: Record<string, unknown>, ip: string | null): Promise<T> {
  const res = await fetch(`${REST_URL}/rpc/${fn}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      ...(ip ? { 'X-Real-IP': ip } : {}),
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = data?.code;
    if (code === '42501') throw forbidden(data?.message);
    if (code === '23514' || code === '22023') throw new HttpError(422, data?.hint ?? 'RULE_VIOLATION', data?.message ?? 'Not allowed.');
    throw new DbRequestError(res.status, data ?? {});
  }
  return data as T;
}

async function deleteObjects(paths: string[]) {
  for (const p of paths) {
    await fetch(`${STORAGE_URL}/object/${BUCKET}/${p}`, { method: 'DELETE', headers: { Authorization: `Bearer ${SERVICE_KEY}` } })
      .catch((err) => console.error('delete failed', p, err));
  }
}

interface FileRow {
  id: string;
  object_path: string;
  extension: string;
  status: string;
  uploaded_by: string;
  original_name: string;
}

serve(async (req, body) => {
  const caller = await requireCaller(req);
  const ip = clientIp(req);
  const action = str(body, 'action', { required: true });

  switch (action) {
    case 'start': {
      const purpose = str(body, 'purpose', { required: true });
      if (!['PRESENTATION', 'ATTACHMENT', 'VIEW_PDF'].includes(purpose!)) throw badRequest('Unknown upload type.');
      const size = body.size;
      if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) throw badRequest('The file size is missing.');
      const details = typeof body.details === 'object' && body.details !== null ? body.details : {};
      const begun = await rpcAsCaller<{ file_id: string; object_path: string; extension: string }>(caller.token, 'begin_upload', {
        p_purpose: purpose,
        p_target: uuid(body, 'target_id'),
        p_file_name: str(body, 'file_name', { required: true, max: 255, label: 'File name' }),
        p_size: size,
        p_details: details,
      }, ip);
      const res = await fetch(`${STORAGE_URL}/object/upload/sign/${BUCKET}/${begun.object_path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new HttpError(502, 'STORAGE', 'The file store is not available. Please try again.');
      const signed = await res.json() as { url: string };
      return json({
        file_id: begun.file_id,
        upload_url: `/storage/v1${signed.url}`,
        content_type: CONTENT_TYPES[begun.extension],
      });
    }

    case 'finish': {
      const fileId = uuid(body, 'file_id')!;
      const rows = await rest<FileRow[]>(`/stored_files?id=eq.${fileId}&select=id,object_path,extension,status,uploaded_by,original_name`);
      const file = rows[0];
      if (!file || file.uploaded_by !== caller.userId) throw forbidden();
      if (file.status !== 'PENDING') throw badRequest('This upload has already been completed.');

      // Read the first 4 KB: gives the signature bytes, the stored type and the true size.
      const res = await fetch(`${STORAGE_URL}/object/${BUCKET}/${file.object_path}`, {
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, Range: 'bytes=0-4095' },
      });
      let valid = res.ok;
      let reason = valid ? '' : 'The file was not received. Please try uploading again.';
      let size = 0;
      const storedType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (valid) {
        const range = res.headers.get('content-range'); // bytes 0-4095/123456
        size = Number(range?.split('/')[1] ?? res.headers.get('content-length') ?? 0);
        const head = new Uint8Array(await res.arrayBuffer());
        if (!size) {
          valid = false;
          reason = 'The file is empty.';
        } else if (storedType !== CONTENT_TYPES[file.extension]) {
          valid = false;
          reason = 'The file was sent with the wrong type. Please try again.';
        } else if (!signatureMatches(file.extension, head)) {
          valid = false;
          reason = `The content of "${file.original_name}" does not match a .${file.extension} file. It may be damaged or renamed.`;
        }
      } else {
        await res.body?.cancel();
      }

      const result = await rest<{ status: string; reason?: string; delete_paths?: string[] }>('/rpc/finalize_upload', {
        method: 'POST', actor: caller.userId, ip,
        body: { p_file_id: fileId, p_size: size || 1, p_valid: valid, p_reason: reason || null, p_mime: storedType || null },
      });
      if (result.status !== 'READY') await deleteObjects([file.object_path]);
      if (result.delete_paths?.length) await deleteObjects(result.delete_paths);
      if (result.status !== 'READY') {
        // Same shape as other errors, so the screens show the reason in plain words.
        return json({ ...result, error: { code: 'UPLOAD_REJECTED', message: result.reason ?? 'The file was not accepted.' } }, 422);
      }
      return json(result);
    }

    case 'remove': {
      const kind = str(body, 'kind', { required: true });
      if (kind !== 'presentation' && kind !== 'attachment') throw badRequest('Unknown item type.');
      const paths = await rpcAsCaller<string[]>(caller.token, 'remove_content', { p_kind: kind, p_id: uuid(body, 'id') }, ip);
      await deleteObjects(paths ?? []);
      return json({ ok: true, removed_files: (paths ?? []).length });
    }

    default:
      throw badRequest('Unknown action.');
  }
});
