import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import kn from './kn.json';

export type Language = 'en' | 'kn';
const STORAGE_KEY = 'presentify-language';

function storedLanguage(): Language | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'en' || v === 'kn' ? v : null;
  } catch {
    return null;
  }
}

export function hasStoredLanguage() {
  return storedLanguage() !== null;
}

export function setLanguage(lang: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  void i18n.changeLanguage(lang);
}

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, kn: { translation: kn } },
  lng: storedLanguage() ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes output
  returnNull: false,
});

export default i18n;
