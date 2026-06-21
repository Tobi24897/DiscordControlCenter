import { useEffect, useState } from 'react';
import Header, { type View } from './components/Header';
import { useStream } from './hooks/useStream';
import { api } from './lib/api';
import ColumnsView from './views/ColumnsView';
import DmsView from './views/DmsView';
import FeedView from './views/FeedView';
import SettingsView from './views/SettingsView';

export default function App() {
  const [view, setView] = useState<View>(
    () => (localStorage.getItem('dcc.view') as View) || 'feed',
  );
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('dcc.theme') as 'dark' | 'light') || 'dark',
  );
  const [authBanner, setAuthBanner] = useState<string | null>(null);
  const stream = useStream();

  useEffect(() => {
    localStorage.setItem('dcc.view', view);
  }, [view]);

  useEffect(() => {
    localStorage.setItem('dcc.theme', theme);
    if (theme === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  // One-click login: the Discord-Login bookmarklet opens the app with the token
  // in the URL fragment (#import_token=…). Read it, log in, then scrub the URL.
  useEffect(() => {
    const m = window.location.hash.match(/[#&]import_token=([^&]+)/);
    if (!m) return;
    const token = decodeURIComponent(m[1]);
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setAuthBanner('Logging in…');
    setView('settings');
    api
      .setToken(token)
      .then((r) => {
        setAuthBanner(`Logged in as ${r.discord_user ?? 'Discord'} ✓`);
        setTimeout(() => setAuthBanner(null), 4000);
      })
      .catch((e) => setAuthBanner(`Login failed: ${e instanceof Error ? e.message : String(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notification click → jump to the channel's column.
  useEffect(() => {
    if (stream.focusChannel) setView('columns');
  }, [stream.focusChannel]);

  return (
    <div className="flex h-screen flex-col bg-surface-page">
      <Header view={view} setView={setView} theme={theme} setTheme={setTheme} stream={stream} />
      {authBanner && (
        <div className="border-b border-blue-500/40 bg-blue-600/15 px-4 py-1.5 text-center text-xs text-blue-100">
          {authBanner}
        </div>
      )}
      {view === 'feed' && <FeedView stream={stream} />}
      {view === 'columns' && <ColumnsView stream={stream} goToSettings={() => setView('settings')} />}
      {view === 'dms' && (
        <DmsView tokenStatus={stream.tokenStatus} goToSettings={() => setView('settings')} />
      )}
      {view === 'settings' && <SettingsView stream={stream} />}
    </div>
  );
}
