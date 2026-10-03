// Participant page texts (kept separate from the staff app so the page stays small).
import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'kn';

const en = {
  loading: 'Loading…',
  language: 'Language',
  invalidTitle: 'This QR code is not valid',
  invalidBody: 'It may have been replaced. Please scan the QR code currently displayed at the meeting.',
  unavailableTitle: 'Temporarily unavailable',
  unavailableBody: 'This meeting is not available at the moment. Please contact the organiser.',
  notYetTitle: 'This meeting has not opened yet',
  notYetBody: 'It opens at {{time}} on {{date}}. Please scan again then.',
  endedTitle: 'This meeting has ended',
  endedBody: 'The material is no longer available here. Please contact the organiser if you need it.',
  networkError: 'Cannot reach the Presentify server. Please check your Wi-Fi or mobile data and try again.',
  tryAgain: 'Try again',
  enterDetails: 'Please enter your details',
  welcomeBack: 'Welcome back — please check your details',
  fields: {
    name: 'Name', designation: 'Designation', organisation: 'Organisation', mobile: 'Mobile number',
    email: 'E-mail', department: 'Department', location: 'Location',
  } as Record<string, string>,
  optional: 'optional',
  required: 'Please fill in this field.',
  invalidMobile: 'Please enter a valid 10-digit mobile number.',
  invalidEmail: 'Please enter a valid e-mail address.',
  passcode: 'Meeting passcode',
  passcodeHelp: 'Announced by the organiser.',
  wrongPasscode: 'The meeting passcode is not correct.',
  consentDefault: '{{org}} records your details only for the attendance of this meeting. They are deleted {{days}} days after the meeting and are not shown to other participants.',
  consentDefaultIndefinite: '{{org}} records your details only for the attendance of this meeting. They are not shown to other participants.',
  consentAgree: 'I agree',
  consentRequired: 'Please tick "I agree" to continue.',
  remember: 'Remember my details on this phone for the next meeting',
  continue: 'Continue',
  skip: 'Continue without entering details',
  limitReached: 'This meeting has reached its participant limit. Please contact the organiser.',
  sessions: 'Sessions',
  now: 'Now',
  next: 'Next',
  availableFrom: 'Available from {{time}}',
  presentation: 'Presentation',
  supporting: 'Supporting material',
  open: 'Open',
  download: 'Download',
  viewOnly: 'Downloading is not permitted for this document.',
  noPreview: 'Preview not available on the phone.',
  noPreviewDownload: 'Preview not available — you can download the file.',
  nothingYet: 'No material has been shared for this session yet.',
  close: 'Close',
  page: 'Page {{n}} of {{total}}',
  fullScreen: 'Full screen',
  exitFullScreen: 'Exit full screen',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fit: 'Fit to screen',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  rotateHint: 'Turn your phone sideways for a larger view.',
  openFailed: 'The document could not be opened. Please try again.',
  presentedBy: 'Presenter',
  venue: 'Venue',
  poweredBy: 'Presentify — Present. Scan. Access.',
  register: 'Register again',
};

type Dict = typeof en;

const kn: Dict = {
  loading: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
  language: 'ಭಾಷೆ',
  invalidTitle: 'ಈ QR ಕೋಡ್ ಮಾನ್ಯವಾಗಿಲ್ಲ',
  invalidBody: 'ಇದನ್ನು ಬದಲಾಯಿಸಿರಬಹುದು. ದಯವಿಟ್ಟು ಸಭೆಯಲ್ಲಿ ಈಗ ಪ್ರದರ್ಶಿಸಲಾಗಿರುವ QR ಕೋಡ್ ಅನ್ನು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.',
  unavailableTitle: 'ತಾತ್ಕಾಲಿಕವಾಗಿ ಲಭ್ಯವಿಲ್ಲ',
  unavailableBody: 'ಈ ಸಭೆ ಸದ್ಯಕ್ಕೆ ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಸಂಘಟಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.',
  notYetTitle: 'ಈ ಸಭೆ ಇನ್ನೂ ತೆರೆದಿಲ್ಲ',
  notYetBody: 'ಇದು {{date}} ರಂದು {{time}} ಕ್ಕೆ ತೆರೆಯುತ್ತದೆ. ದಯವಿಟ್ಟು ಆಗ ಮತ್ತೆ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.',
  endedTitle: 'ಈ ಸಭೆ ಮುಕ್ತಾಯಗೊಂಡಿದೆ',
  endedBody: 'ಸಾಮಗ್ರಿ ಇನ್ನು ಇಲ್ಲಿ ಲಭ್ಯವಿಲ್ಲ. ಅಗತ್ಯವಿದ್ದರೆ ದಯವಿಟ್ಟು ಸಂಘಟಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.',
  networkError: 'ಪ್ರೆಸೆಂಟಿಫೈ ಸರ್ವರ್ ಅನ್ನು ತಲುಪಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ Wi-Fi ಅಥವಾ ಮೊಬೈಲ್ ಡೇಟಾವನ್ನು ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  tryAgain: 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
  enterDetails: 'ದಯವಿಟ್ಟು ನಿಮ್ಮ ವಿವರಗಳನ್ನು ನಮೂದಿಸಿ',
  welcomeBack: 'ಮರಳಿ ಸ್ವಾಗತ — ದಯವಿಟ್ಟು ನಿಮ್ಮ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ',
  fields: {
    name: 'ಹೆಸರು', designation: 'ಹುದ್ದೆ', organisation: 'ಸಂಸ್ಥೆ', mobile: 'ಮೊಬೈಲ್ ಸಂಖ್ಯೆ',
    email: 'ಇ-ಮೇಲ್', department: 'ಇಲಾಖೆ', location: 'ಸ್ಥಳ',
  },
  optional: 'ಐಚ್ಛಿಕ',
  required: 'ದಯವಿಟ್ಟು ಈ ಮಾಹಿತಿ ನಮೂದಿಸಿ.',
  invalidMobile: 'ದಯವಿಟ್ಟು ಸರಿಯಾದ 10-ಅಂಕಿಯ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ.',
  invalidEmail: 'ದಯವಿಟ್ಟು ಸರಿಯಾದ ಇ-ಮೇಲ್ ವಿಳಾಸ ನಮೂದಿಸಿ.',
  passcode: 'ಸಭೆಯ ಪಾಸ್‌ಕೋಡ್',
  passcodeHelp: 'ಸಂಘಟಕರು ಪ್ರಕಟಿಸುತ್ತಾರೆ.',
  wrongPasscode: 'ಸಭೆಯ ಪಾಸ್‌ಕೋಡ್ ಸರಿಯಾಗಿಲ್ಲ.',
  consentDefault: '{{org}} ನಿಮ್ಮ ವಿವರಗಳನ್ನು ಈ ಸಭೆಯ ಹಾಜರಾತಿಗಾಗಿ ಮಾತ್ರ ದಾಖಲಿಸುತ್ತದೆ. ಸಭೆಯ {{days}} ದಿನಗಳ ನಂತರ ಇವುಗಳನ್ನು ಅಳಿಸಲಾಗುತ್ತದೆ ಮತ್ತು ಇತರ ಭಾಗವಹಿಸುವವರಿಗೆ ತೋರಿಸಲಾಗುವುದಿಲ್ಲ.',
  consentDefaultIndefinite: '{{org}} ನಿಮ್ಮ ವಿವರಗಳನ್ನು ಈ ಸಭೆಯ ಹಾಜರಾತಿಗಾಗಿ ಮಾತ್ರ ದಾಖಲಿಸುತ್ತದೆ. ಇವುಗಳನ್ನು ಇತರ ಭಾಗವಹಿಸುವವರಿಗೆ ತೋರಿಸಲಾಗುವುದಿಲ್ಲ.',
  consentAgree: 'ನಾನು ಒಪ್ಪುತ್ತೇನೆ',
  consentRequired: 'ಮುಂದುವರಿಯಲು ದಯವಿಟ್ಟು "ನಾನು ಒಪ್ಪುತ್ತೇನೆ" ಆಯ್ಕೆಮಾಡಿ.',
  remember: 'ಮುಂದಿನ ಸಭೆಗಾಗಿ ನನ್ನ ವಿವರಗಳನ್ನು ಈ ಫೋನ್‌ನಲ್ಲಿ ನೆನಪಿಡಿ',
  continue: 'ಮುಂದುವರಿಯಿರಿ',
  skip: 'ವಿವರಗಳನ್ನು ನಮೂದಿಸದೆ ಮುಂದುವರಿಯಿರಿ',
  limitReached: 'ಈ ಸಭೆ ಭಾಗವಹಿಸುವವರ ಮಿತಿಯನ್ನು ತಲುಪಿದೆ. ದಯವಿಟ್ಟು ಸಂಘಟಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.',
  sessions: 'ಅವಧಿಗಳು',
  now: 'ಈಗ',
  next: 'ಮುಂದೆ',
  availableFrom: '{{time}} ರಿಂದ ಲಭ್ಯ',
  presentation: 'ಪ್ರಸ್ತುತಿ',
  supporting: 'ಪೂರಕ ಸಾಮಗ್ರಿ',
  open: 'ತೆರೆಯಿರಿ',
  download: 'ಡೌನ್‌ಲೋಡ್',
  viewOnly: 'ಈ ದಾಖಲೆಯನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಲು ಅನುಮತಿ ಇಲ್ಲ.',
  noPreview: 'ಫೋನ್‌ನಲ್ಲಿ ಪೂರ್ವವೀಕ್ಷಣೆ ಲಭ್ಯವಿಲ್ಲ.',
  noPreviewDownload: 'ಪೂರ್ವವೀಕ್ಷಣೆ ಲಭ್ಯವಿಲ್ಲ — ನೀವು ಫೈಲ್ ಡೌನ್‌ಲೋಡ್ ಮಾಡಬಹುದು.',
  nothingYet: 'ಈ ಅವಧಿಗೆ ಇನ್ನೂ ಯಾವುದೇ ಸಾಮಗ್ರಿ ಹಂಚಿಕೊಂಡಿಲ್ಲ.',
  close: 'ಮುಚ್ಚಿ',
  page: 'ಪುಟ {{n}} / {{total}}',
  fullScreen: 'ಪೂರ್ಣ ಪರದೆ',
  exitFullScreen: 'ಪೂರ್ಣ ಪರದೆಯಿಂದ ಹೊರಬನ್ನಿ',
  zoomIn: 'ದೊಡ್ಡದಾಗಿಸಿ',
  zoomOut: 'ಚಿಕ್ಕದಾಗಿಸಿ',
  fit: 'ಪರದೆಗೆ ಹೊಂದಿಸಿ',
  previousPage: 'ಹಿಂದಿನ ಪುಟ',
  nextPage: 'ಮುಂದಿನ ಪುಟ',
  rotateHint: 'ದೊಡ್ಡ ನೋಟಕ್ಕಾಗಿ ನಿಮ್ಮ ಫೋನ್ ಅನ್ನು ಅಡ್ಡಲಾಗಿ ತಿರುಗಿಸಿ.',
  openFailed: 'ದಾಖಲೆಯನ್ನು ತೆರೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  presentedBy: 'ಪ್ರಸ್ತುತಕರ್ತರು',
  venue: 'ಸ್ಥಳ',
  poweredBy: 'ಪ್ರೆಸೆಂಟಿಫೈ — ಪ್ರಸ್ತುತಪಡಿಸಿ. ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. ಪಡೆಯಿರಿ.',
  register: 'ಮತ್ತೆ ನೋಂದಾಯಿಸಿ',
};

const dictionaries: Record<Lang, Dict> = { en, kn };
const KEY = 'presentify-language';

let current: Lang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'kn' || v === 'en' ? v : 'en';
  } catch {
    return 'en';
  }
})();
let chosen = (() => { try { return Boolean(localStorage.getItem(KEY)); } catch { return false; } })();
const listeners = new Set<() => void>();

export function setLang(lang: Lang, remember = true) {
  current = lang;
  document.documentElement.lang = lang;
  if (remember) {
    chosen = true;
    try { localStorage.setItem(KEY, lang); } catch { /* private mode */ }
  }
  listeners.forEach((l) => l());
}

/** Use the organisation's default language unless the person has chosen one. */
export function applyDefaultLang(lang: Lang) {
  if (!chosen) setLang(lang, false);
}

export function useLang(): Lang {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current);
}

type Key = Exclude<keyof Dict, 'fields'>;

export function useT() {
  const lang = useLang();
  const dict = dictionaries[lang];
  const t = (key: Key, vars: Record<string, string | number> = {}) =>
    (dict[key] as string).replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));
  const field = (key: string) => dict.fields[key] ?? key;
  return { t, field, lang };
}

export function formatDate(iso: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === 'kn' ? 'kn-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
    .format(new Date(iso));
}
export function formatTime(iso: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === 'kn' ? 'kn-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    .format(new Date(iso));
}
