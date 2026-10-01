import { SegmentedControl } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { setLanguage, type Language } from '../i18n';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const change = (lang: string) => {
    setLanguage(lang as Language);
    // Remember the choice for the signed-in person (best effort).
    if (auth.me) {
      void supabase.rpc('update_my_profile', { p_language: lang }).then(({ error }) => { if (error) console.warn('language not saved', error.message); });
    }
  };
  return (
    <SegmentedControl
      aria-label={t('app.language')}
      size="sm"
      value={i18n.language === 'kn' ? 'kn' : 'en'}
      onChange={change}
      data={[{ value: 'en', label: 'English' }, { value: 'kn', label: 'ಕನ್ನಡ' }]}
    />
  );
}
