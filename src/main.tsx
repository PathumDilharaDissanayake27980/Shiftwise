import '@fontsource/familjen-grotesk/latin-600.css';
import '@fontsource/familjen-grotesk/latin-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Ask the browser not to evict our IndexedDB data under storage pressure.
if (navigator.storage?.persist) void navigator.storage.persist().catch(() => undefined);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
