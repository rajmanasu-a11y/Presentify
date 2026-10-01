import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// All services are reached through the same origin (the gateway), so the app
// works under any address: localhost, the laptop's Wi-Fi address or a domain.
export const supabase = createClient(window.location.origin, config.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'presentify-session',
  },
});
