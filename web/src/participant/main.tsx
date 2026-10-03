// English uses the phone's own font (nothing to download); Kannada uses Noto Sans Kannada,
// fetched only when Kannada text is on the screen.
import '@fontsource/noto-sans-kannada/kannada-400.css';
import '@fontsource/noto-sans-kannada/kannada-700.css';
import './participant.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
