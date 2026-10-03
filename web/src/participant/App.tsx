// Participant page: Scan → (register) → view.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { call, PublicError, storage, type Content, type Item, type MeetingInfo } from './api';
import { applyDefaultLang, formatDate, formatTime, setLang, useT, type Lang } from './i18n';
import { Viewer } from './Viewer';

const qrToken = decodeURIComponent(window.location.pathname.replace(/^\/m\//, '').split(/[/?#]/)[0] ?? '');

type Stage =
  | { name: 'loading' }
  | { name: 'error'; code: string; opensAt?: string | null }
  | { name: 'register' }
  | { name: 'content'; content: Content };

function LanguageSwitch() {
  const { t, lang } = useT();
  return (
    <div className="p-lang" role="group" aria-label={t('language')}>
      {(['en', 'kn'] as Lang[]).map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l === 'en' ? 'English' : 'ಕನ್ನಡ'}</button>
      ))}
    </div>
  );
}

function Header({ info }: { info: MeetingInfo | null }) {
  const { lang } = useT();
  return (
    <header className="p-header">
      <div className="p-header-top">
        <div className="p-org">
          {info?.organisation.logo_url && <img src={info.organisation.logo_url} alt="" className="p-logo" />}
          <div>
            <div className="p-org-name">{info?.organisation.name ?? 'Presentify'}</div>
            {info?.organisation.tagline && <div className="p-tagline">{info.organisation.tagline}</div>}
          </div>
        </div>
        <LanguageSwitch />
      </div>
      {info && (
        <div className="p-meeting">
          <h1>{info.meeting.title}</h1>
          <p>
            {formatDate(info.meeting.starts_at, lang)} · {formatTime(info.meeting.starts_at, lang)} – {formatTime(info.meeting.ends_at, lang)}
            {info.meeting.venue ? ` · ${info.meeting.venue}` : ''}
          </p>
        </div>
      )}
    </header>
  );
}

function Message({ code, opensAt, onRetry }: { code: string; opensAt?: string | null; onRetry: () => void }) {
  const { t, lang } = useT();
  const [title, body] =
    code === 'NOT_YET' ? [t('notYetTitle'), t('notYetBody', { time: opensAt ? formatTime(opensAt, lang) : '', date: opensAt ? formatDate(opensAt, lang) : '' })]
    : code === 'ENDED' ? [t('endedTitle'), t('endedBody')]
    : code === 'UNAVAILABLE' ? [t('unavailableTitle'), t('unavailableBody')]
    : code === 'NETWORK' || code === 'BUSY' ? ['', t('networkError')]
    : [t('invalidTitle'), t('invalidBody')];
  return (
    <section className="p-card p-message" role="alert">
      {title && <h2>{title}</h2>}
      <p>{body}</p>
      {(code === 'NETWORK' || code === 'BUSY' || code === 'NOT_YET') && (
        <button type="button" className="p-button" onClick={onRetry}>{t('tryAgain')}</button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
function RegisterForm({ info, onDone }: { info: MeetingInfo; onDone: (access: string) => void }) {
  const { t, field, lang } = useT();
  const reg = info.registration;
  const remembered = info.remembered;
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of reg.fields) v[f.key] = (remembered?.[f.key === 'name' ? 'full_name' : f.key] as string | null) ?? '';
    return v;
  });
  const [consent, setConsent] = useState(false);
  const [remember, setRemember] = useState(Boolean(remembered));
  const [passcode, setPasscode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const needsDetails = reg.mode !== 'NONE';

  const consentText = (lang === 'kn' ? reg.consent_kn : reg.consent_en) || (reg.retention_days
    ? t('consentDefault', { org: info.organisation.name, days: reg.retention_days })
    : t('consentDefaultIndefinite', { org: info.organisation.name }));

  const submit = async (anonymous: boolean) => {
    const e: Record<string, string> = {};
    if (!anonymous && needsDetails) {
      for (const f of reg.fields) {
        const v = (values[f.key] ?? '').trim();
        if ((f.required || f.key === 'name') && !v) e[f.key] = t('required');
        else if (v && f.key === 'mobile' && v.replace(/\D/g, '').length < 10) e[f.key] = t('invalidMobile');
        else if (v && f.key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) e[f.key] = t('invalidEmail');
      }
      if (!consent) e.consent = t('consentRequired');
    }
    if (reg.passcode_required && !passcode.trim()) e.passcode = t('required');
    setErrors(e);
    if (Object.keys(e).length) {
      document.getElementById(`f-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      const r = await call<{ access_token: string; device_token: string | null }>('register', {
        token: qrToken, fields: values, consent, passcode: passcode.trim() || undefined,
        remember: remember && reg.remember_allowed, anonymous: anonymous || !needsDetails,
      });
      if (r.device_token) storage.setDevice(r.device_token);
      onDone(r.access_token);
    } catch (err) {
      const code = err instanceof PublicError ? err.code : 'ERROR';
      if (code === 'PASSCODE') setErrors({ passcode: t('wrongPasscode') });
      else if (code === 'LIMIT_PARTICIPANTS') setFormError(t('limitReached'));
      else if (code === 'NETWORK' || code === 'BUSY') setFormError(t('networkError'));
      else if (code.startsWith('FIELD_REQUIRED:')) setErrors({ [code.split(':')[1]]: t('required') });
      else if (code === 'FIELD_INVALID:mobile') setErrors({ mobile: t('invalidMobile') });
      else if (code === 'FIELD_INVALID:email') setErrors({ email: t('invalidEmail') });
      else setFormError(err instanceof Error ? err.message : t('networkError'));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void submit(false); };
  const inputType = (key: string) => (key === 'mobile' ? 'tel' : key === 'email' ? 'email' : 'text');
  const autoComplete = (key: string) =>
    ({ name: 'name', mobile: 'tel', email: 'email', organisation: 'organization', designation: 'organization-title' } as Record<string, string>)[key] ?? 'off';

  return (
    <form className="p-card" onSubmit={onSubmit} noValidate>
      {needsDetails && <h2>{remembered ? t('welcomeBack') : t('enterDetails')}</h2>}
      {formError && <p className="p-error-box" role="alert">{formError}</p>}
      {needsDetails && reg.fields.map((f) => {
        const label = field(f.key);
        const required = f.required || f.key === 'name';
        return (
          <div className="p-field" key={f.key}>
            <label htmlFor={`f-${f.key}`}>{label}{!required && <span className="p-optional"> ({t('optional')})</span>}</label>
            <input id={`f-${f.key}`} type={inputType(f.key)} inputMode={f.key === 'mobile' ? 'tel' : undefined}
              autoComplete={autoComplete(f.key)} value={values[f.key] ?? ''} maxLength={150}
              aria-invalid={Boolean(errors[f.key])} aria-describedby={errors[f.key] ? `e-${f.key}` : undefined} required={required}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
            {errors[f.key] && <p className="p-field-error" id={`e-${f.key}`}>{errors[f.key]}</p>}
          </div>
        );
      })}
      {reg.passcode_required && (
        <div className="p-field">
          <label htmlFor="f-passcode">{t('passcode')}</label>
          <input id="f-passcode" type="text" autoComplete="off" value={passcode} maxLength={40}
            aria-invalid={Boolean(errors.passcode)} aria-describedby="h-passcode" onChange={(e) => setPasscode(e.target.value)} />
          <p className="p-help" id="h-passcode">{t('passcodeHelp')}</p>
          {errors.passcode && <p className="p-field-error">{errors.passcode}</p>}
        </div>
      )}
      {needsDetails && (
        <>
          <div className="p-consent">
            <p>{consentText}</p>
            <label className="p-check">
              <input id="f-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                aria-invalid={Boolean(errors.consent)} />
              <span>{t('consentAgree')}</span>
            </label>
            {errors.consent && <p className="p-field-error">{errors.consent}</p>}
          </div>
          {reg.remember_allowed && (
            <label className="p-check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>{t('remember')}</span>
            </label>
          )}
        </>
      )}
      <button type="submit" className="p-button p-button-primary" disabled={busy}>{t('continue')}</button>
      {reg.mode === 'OPTIONAL' && (
        <button type="button" className="p-link" onClick={() => void submit(true)} disabled={busy}>{t('skip')}</button>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
function ItemRow({ item, onOpen, onDownload, busy }: { item: Item; onOpen: () => void; onDownload: () => void; busy: boolean }) {
  const { t } = useT();
  const sizeText = item.size ? ` · ${item.size >= 1048576 ? `${(item.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(item.size / 1024))} KB`}` : '';
  return (
    <li className={`p-item p-item-${item.kind}`}>
      <div className="p-item-text">
        <span className="p-item-kind">{item.kind === 'presentation' ? t('presentation') : t('supporting')}</span>
        <strong>{item.title}</strong>
        <span className="p-item-file">{item.extension.toUpperCase()}{sizeText}</span>
        {!item.view && <span className="p-item-note">{item.download ? t('noPreviewDownload') : t('noPreview')}</span>}
        {item.view && !item.download && <span className="p-item-note">{t('viewOnly')}</span>}
      </div>
      <div className="p-item-actions">
        {item.view && <button type="button" className="p-button p-button-primary" onClick={onOpen} disabled={busy}>{t('open')}</button>}
        {item.download && <button type="button" className="p-button" onClick={onDownload} disabled={busy}>{t('download')}</button>}
      </div>
    </li>
  );
}

function ContentView({ content, info, access, onExpired }: { content: Content; info: MeetingInfo; access: string; onExpired: (code: string) => void }) {
  const { t, lang } = useT();
  const [viewing, setViewing] = useState<{ title: string; url: string; kind: 'pdf' | 'image' | 'video'; downloadable: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = Date.now();
  const current = content.sessions.find((s) => now >= Date.parse(s.starts_at) && now <= Date.parse(s.ends_at));
  const next = content.sessions.find((s) => Date.parse(s.starts_at) > now);

  const request = async (item: Item, mode: 'view' | 'download') => {
    setBusy(true);
    setError('');
    try {
      const r = await call<{ url: string; kind: 'pdf' | 'image' | 'video' | 'file'; file_name: string }>('file', {
        token: qrToken, access, kind: item.kind, id: item.id, mode,
      });
      if (mode === 'download') {
        const a = document.createElement('a');
        a.href = r.url;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else if (r.kind !== 'file') {
        setViewing({ title: item.title, url: r.url, kind: r.kind, downloadable: item.download });
      }
    } catch (err) {
      const code = err instanceof PublicError ? err.code : 'ERROR';
      if (['ENDED', 'NOT_YET', 'INVALID', 'UNAVAILABLE', 'REGISTER'].includes(code)) onExpired(code);
      else setError(code === 'NETWORK' || code === 'BUSY' ? t('networkError') : t('openFailed'));
    } finally {
      setBusy(false);
    }
  };

  const stamp = useMemo(() => {
    const who = content.participant ?? info.meeting.reference_no;
    return `${who} · ${new Intl.DateTimeFormat(lang === 'kn' ? 'kn-IN' : 'en-IN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date())}`;
  }, [content.participant, info.meeting.reference_no, lang]);

  return (
    <>
      {error && <p className="p-error-box" role="alert">{error}</p>}
      <section aria-label={t('sessions')}>
        {content.sessions.map((s) => (
          <article key={s.id} className={`p-card p-session${current?.id === s.id ? ' p-session-now' : ''}`}>
            <div className="p-session-head">
              <span className="p-time">{formatTime(s.starts_at, lang)} – {formatTime(s.ends_at, lang)}</span>
              {current?.id === s.id && <span className="p-badge p-badge-now">{t('now')}</span>}
              {!current && next?.id === s.id && <span className="p-badge">{t('next')}</span>}
            </div>
            <h2>{s.title}</h2>
            {s.presenter && <p className="p-presenter">{s.presenter}{s.designation ? `, ${s.designation}` : ''}</p>}
            {!s.released && <p className="p-item-note">{t('availableFrom', { time: formatTime(s.starts_at, lang) })}</p>}
            {s.released && s.items.length === 0 && <p className="p-item-note">{t('nothingYet')}</p>}
            {s.items.length > 0 && (
              <ul className="p-items">
                {s.items.map((item) => (
                  <ItemRow key={`${item.kind}-${item.id}`} item={item} busy={busy}
                    onOpen={() => void request(item, 'view')} onDownload={() => void request(item, 'download')} />
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>
      {viewing && (
        <Viewer title={viewing.title} url={viewing.url} kind={viewing.kind}
          watermark={!viewing.downloadable && content.watermark ? stamp : null} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
export function App() {
  const { t } = useT();
  const [info, setInfo] = useState<MeetingInfo | null>(null);
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  const [access, setAccess] = useState<string | null>(() => storage.access(qrToken));

  const loadContent = useCallback(async (token: string) => {
    const content = await call<Content>('content', { token: qrToken, access: token });
    if (content.state === 'REGISTER') {
      storage.clearAccess(qrToken);
      setAccess(null);
      setStage({ name: 'register' });
    } else if (content.state !== 'OPEN') {
      setStage({ name: 'error', code: content.state, opensAt: content.opens_at });
    } else {
      setStage({ name: 'content', content });
    }
  }, []);

  const load = useCallback(async () => {
    setStage({ name: 'loading' });
    try {
      const i = await call<MeetingInfo>('info', { token: qrToken, device: storage.device() ?? undefined });
      setInfo(i);
      applyDefaultLang(i.organisation.default_language);
      document.title = `${i.meeting.title} · Presentify`;
      if (i.state !== 'OPEN') {
        setStage({ name: 'error', code: i.state, opensAt: i.opens_at });
        return;
      }
      if (access) await loadContent(access);
      else setStage({ name: 'register' });
    } catch (err) {
      setStage({ name: 'error', code: err instanceof PublicError ? err.code : 'ERROR' });
    }
  }, [access, loadContent]);

  useEffect(() => { if (!qrToken) setStage({ name: 'error', code: 'INVALID' }); else void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (info?.organisation.brand_color) document.documentElement.style.setProperty('--brand', info.organisation.brand_color);
  }, [info]);

  return (
    <div className="p-page">
      <Header info={info} />
      <main id="main" className="p-main">
        {stage.name === 'loading' && <div className="p-loading" role="status">{t('loading')}</div>}
        {stage.name === 'error' && <Message code={stage.code} opensAt={stage.opensAt} onRetry={() => void load()} />}
        {stage.name === 'register' && info && (
          <RegisterForm info={info} onDone={(token) => {
            storage.setAccess(qrToken, token);
            setAccess(token);
            setStage({ name: 'loading' });
            loadContent(token).catch((err) => setStage({ name: 'error', code: err instanceof PublicError ? err.code : 'ERROR' }));
          }} />
        )}
        {stage.name === 'content' && info && access && (
          <ContentView content={stage.content} info={info} access={access}
            onExpired={(code) => {
              if (code === 'REGISTER') { storage.clearAccess(qrToken); setAccess(null); setStage({ name: 'register' }); }
              else setStage({ name: 'error', code });
            }} />
        )}
      </main>
      <footer className="p-footer">{t('poweredBy')}</footer>
    </div>
  );
}
