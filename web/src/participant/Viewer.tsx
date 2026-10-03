// Full-screen document viewer for phones (and desktops).
//
// PDF:   normal view = pages one below the other, fitted to the screen width;
//        full-screen view = one page at a time fitted to the whole screen,
//        swipe or tap the left/right edge to turn pages. Zoom buttons in both.
//        Pages are drawn only when near the screen, at the screen's pixel density.
// Image: fitted to the screen.  Video: the phone's own player.
//
// Honest limits: a browser cannot stop screenshots or photographs of the screen,
// and on iPhone Safari pages cannot enter true browser full screen — the viewer
// then fills the whole visible page instead.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { useT } from './i18n';

type Kind = 'pdf' | 'image' | 'video';

interface Props {
  title: string;
  url: string;
  kind: Kind;
  watermark: string | null;
  onClose: () => void;
}

const MAX_CANVAS_PIXELS = 12_000_000; // keeps memory safe on older phones

// ---------------------------------------------------------------------------
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer = 0;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 120); // re-fit after rotation / resize settles
    });
    ro.observe(el);
    return () => { ro.disconnect(); window.clearTimeout(timer); };
  }, []);
  return [ref, size] as const;
}

function Watermark({ text }: { text: string }) {
  const rows = Array.from({ length: 8 });
  return (
    <div className="pv-watermark" aria-hidden="true">
      {rows.map((_, i) => <span key={i}>{text} &nbsp;·&nbsp; {text}</span>)}
    </div>
  );
}

// ---------------------------------------------------------------------------
function PdfPage({ doc, number, cssWidth, cssHeight, active, watermark }: {
  doc: PDFDocumentProxy; number: number; cssWidth: number; cssHeight: number; active: boolean; watermark: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const task = useRef<RenderTask | null>(null);
  const [drawn, setDrawn] = useState('');

  useEffect(() => {
    const key = `${Math.round(cssWidth)}x${Math.round(cssHeight)}`;
    if (!active || cssWidth <= 0 || drawn === key) return;
    let cancelled = false;
    (async () => {
      const page: PDFPageProxy = await doc.getPage(number);
      if (cancelled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      let scale = (cssWidth / base.width) * (window.devicePixelRatio || 1);
      const pixels = base.width * base.height * scale * scale;
      if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
      const viewport = page.getViewport({ scale });
      const c = canvas.current;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      task.current?.cancel();
      task.current = page.render({ canvas: c, viewport });
      try {
        await task.current.promise;
        if (!cancelled) setDrawn(key);
      } catch {
        /* cancelled by a newer render */
      }
    })();
    return () => { cancelled = true; };
  }, [doc, number, cssWidth, cssHeight, active, drawn]);

  // Release memory of pages far away from the screen.
  useEffect(() => {
    if (!active && drawn && canvas.current) {
      task.current?.cancel();
      canvas.current.width = 0;
      canvas.current.height = 0;
      setDrawn('');
    }
  }, [active, drawn]);

  return (
    <div className="pv-page" style={{ width: cssWidth, height: cssHeight }} data-page={number}>
      <canvas ref={canvas} style={{ width: cssWidth, height: cssHeight }} aria-label={`Page ${number}`} role="img" />
      {watermark && <Watermark text={watermark} />}
    </div>
  );
}

function PdfView({ url, watermark, paged, zoom, page, setPage, onPages, onError }: {
  url: string; watermark: string | null; paged: boolean; zoom: number; page: number;
  setPage: (n: number) => void; onPages: (sizes: { w: number; h: number }[]) => void; onError: () => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [visible, setVisible] = useState<Set<number>>(new Set([1]));
  const [box, size] = useElementSize<HTMLDivElement>();
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let destroyed = false;
    let task: { destroy(): Promise<void> } | null = null;
    (async () => {
      try {
        // The "legacy" build carries the polyfills that phones a few years old need
        // (the modern build relies on JavaScript features only the newest browsers have).
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const loading = pdfjs.getDocument({
          url,
          disableRange: true,            // fetch once: the link is short-lived
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          wasmUrl: '/pdfjs/wasm/',
          iccUrl: '/pdfjs/iccs/',
        });
        task = loading;
        const loaded = await loading.promise;
        if (destroyed) return;
        const dims: { w: number; h: number }[] = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const vp = (await loaded.getPage(i)).getViewport({ scale: 1 });
          dims.push({ w: vp.width, h: vp.height });
        }
        if (destroyed) return;
        setSizes(dims);
        onPages(dims);
        setDoc(loaded);
      } catch {
        if (!destroyed) onError();
      }
    })();
    return () => { destroyed = true; void task?.destroy(); };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which pages are near the screen (normal view).
  useEffect(() => {
    if (paged || !box.current || !doc) return;
    const io = new IntersectionObserver((entries) => {
      setVisible((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) next.add(n); else next.delete(n);
        }
        return next;
      });
    }, { root: box.current, rootMargin: '150% 0px' });
    box.current.querySelectorAll('.pv-page').forEach((el) => io.observe(el));
    // Current page = the one crossing the middle of the screen.
    const onScroll = () => {
      const mid = box.current!.scrollTop + box.current!.clientHeight / 2;
      let n = 1;
      box.current!.querySelectorAll<HTMLElement>('.pv-page').forEach((el) => { if (el.offsetTop <= mid) n = Number(el.dataset.page); });
      setPage(n);
    };
    box.current.addEventListener('scroll', onScroll, { passive: true });
    const el = box.current;
    return () => { io.disconnect(); el.removeEventListener('scroll', onScroll); };
  }, [paged, doc, sizes, zoom, size.width, setPage, box]);

  // Jump to the current page when switching to normal view.
  useEffect(() => {
    if (!paged && box.current) {
      const el = box.current.querySelector<HTMLElement>(`.pv-page[data-page="${page}"]`);
      if (el) box.current.scrollTop = el.offsetTop - 8;
    }
  }, [paged]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((delta: number) => {
    if (!sizes.length) return;
    setPage(Math.min(sizes.length, Math.max(1, page + delta)));
  }, [page, sizes.length, setPage]);

  // One container element for every state, so its size is always measured.
  let content: ReactNode = <div className="pv-spinner" role="status" />;
  const gap = 12;
  if (doc && size.width > 0 && sizes.length) {
    if (paged) {
      const s = sizes[Math.min(page, sizes.length) - 1];
      const fit = Math.min((size.width - 8) / s.w, (size.height - 8) / s.h);
      const w = s.w * fit * zoom;
      const h = s.h * fit * zoom;
      content = (
        <div className="pv-paged-inner" style={{ minWidth: w, minHeight: h }}>
          <PdfPage key={page} doc={doc} number={page} cssWidth={w} cssHeight={h} active watermark={watermark} />
        </div>
      );
    } else {
      const width = Math.max(120, (size.width - gap * 2) * zoom);
      content = (
        <div className="pv-pages" style={{ width: width + gap * 2 }}>
          {sizes.map((s, i) => (
            <PdfPage key={i + 1} doc={doc} number={i + 1} cssWidth={width} cssHeight={(width * s.h) / s.w}
              active={visible.has(i + 1)} watermark={watermark} />
          ))}
        </div>
      );
    }
  }

  return (
    <div
      ref={box}
      className={paged ? 'pv-paged' : 'pv-scroll'}
      onTouchStart={paged ? (e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; } : undefined}
      onTouchEnd={paged ? (e) => {
        if (!touch.current || zoom > 1) return;
        const dx = e.changedTouches[0].clientX - touch.current.x;
        const dy = e.changedTouches[0].clientY - touch.current.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
        touch.current = null;
      } : undefined}
      onClick={paged ? (e) => {
        if (zoom > 1) return;
        const x = e.clientX / window.innerWidth;
        if (x < 0.25) go(-1); else if (x > 0.75) go(1);
      } : undefined}
    >
      {content}
    </div>
  );
}

// ---------------------------------------------------------------------------
function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className="pv-icon" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const ICON = {
  close: svg('M6 6l12 12M18 6L6 18'),
  plus: svg('M12 5v14M5 12h14'),
  minus: svg('M5 12h14'),
  full: svg('M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5'),
  exitFull: svg('M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5'),
  prev: svg('M15 6l-6 6 6 6'),
  next: svg('M9 6l6 6-6 6'),
};

export function Viewer({ title, url, kind, watermark, onClose }: Props) {
  const { t } = useT();
  const shell = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<{ w: number; h: number }[]>([]);
  const [failed, setFailed] = useState(false);
  const [hint, setHint] = useState(false);

  // Escape / arrow keys; lock page scrolling behind the viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
      if (kind === 'pdf' && full && (e.key === 'ArrowRight' || e.key === 'PageDown')) setPage((p) => Math.min(pages.length, p + 1));
      if (kind === 'pdf' && full && (e.key === 'ArrowLeft' || e.key === 'PageUp')) setPage((p) => Math.max(1, p - 1));
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose, kind, full, pages.length]);

  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // "Turn your phone" hint for landscape slides viewed upright.
  useEffect(() => {
    if (pages.length && pages[0].w > pages[0].h && window.innerHeight > window.innerWidth) {
      setHint(true);
      const timer = window.setTimeout(() => setHint(false), 5000);
      return () => window.clearTimeout(timer);
    }
  }, [pages]);

  const toggleFull = async () => {
    setZoom(1);
    if (!full) {
      setFull(true);
      // True browser full screen where allowed (Android, desktop); otherwise the viewer already fills the page.
      try { await shell.current?.requestFullscreen?.(); } catch { /* not supported (iPhone Safari) */ }
    } else {
      setFull(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    }
  };

  const close = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    onClose();
  };

  return (
    <div ref={shell} className={`pv-shell${full ? ' pv-full' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="pv-bar">
        <IconButton label={t('close')} onClick={() => void close()}>{ICON.close}</IconButton>
        <div className="pv-title">
          <strong>{title}</strong>
          {kind === 'pdf' && pages.length > 0 && <span>{t('page', { n: page, total: pages.length })}</span>}
        </div>
        {kind !== 'video' && (
          <>
            <IconButton label={t('zoomOut')} onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))} disabled={zoom <= 1}>{ICON.minus}</IconButton>
            <IconButton label={t('zoomIn')} onClick={() => setZoom((z) => Math.min(4, +(z + 0.5).toFixed(1)))} disabled={zoom >= 4}>{ICON.plus}</IconButton>
          </>
        )}
        {kind === 'pdf' && (
          <IconButton label={full ? t('exitFullScreen') : t('fullScreen')} onClick={() => void toggleFull()}>
            {full ? ICON.exitFull : ICON.full}
          </IconButton>
        )}
      </div>

      <div className="pv-body">
        {failed && <p className="pv-error" role="alert">{t('openFailed')}</p>}
        {!failed && kind === 'pdf' && (
          <PdfView url={url} watermark={watermark} paged={full} zoom={zoom} page={page} setPage={setPage}
            onPages={setPages} onError={() => setFailed(true)} />
        )}
        {!failed && kind === 'image' && (
          <div className="pv-image" style={{ overflow: zoom > 1 ? 'auto' : 'hidden' }}>
            <img src={url} alt={title} style={zoom > 1 ? { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: 'none' } : undefined}
              onError={() => setFailed(true)} />
            {watermark && <Watermark text={watermark} />}
          </div>
        )}
        {!failed && kind === 'video' && (
          <div className="pv-image">
            <video src={url} controls playsInline preload="metadata" controlsList={watermark ? 'nodownload' : undefined} onError={() => setFailed(true)} />
          </div>
        )}
        {kind === 'pdf' && full && pages.length > 1 && (
          <>
            <button type="button" className="pv-nav pv-nav-prev" aria-label={t('previousPage')} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>{ICON.prev}</button>
            <button type="button" className="pv-nav pv-nav-next" aria-label={t('nextPage')} onClick={() => setPage((p) => Math.min(pages.length, p + 1))} disabled={page >= pages.length}>{ICON.next}</button>
          </>
        )}
        {hint && !full && <div className="pv-hint" role="status">{t('rotateHint')}</div>}
      </div>
    </div>
  );
}
