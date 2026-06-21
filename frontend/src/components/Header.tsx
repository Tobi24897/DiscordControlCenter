import {
  CheckCheck,
  Columns3,
  MessageSquare,
  Moon,
  Newspaper,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react';
import type { Stream } from '../hooks/useStream';

export type View = 'feed' | 'columns' | 'dms' | 'settings';

interface Props {
  view: View;
  setView: (v: View) => void;
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  stream: Stream;
}

const VIEWS: { id: View; label: string; icon: typeof Newspaper }[] = [
  { id: 'feed', label: 'Feed', icon: Newspaper },
  { id: 'columns', label: 'Columns', icon: Columns3 },
  { id: 'dms', label: 'DMs', icon: MessageSquare },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function ConnectionPill({ stream, onClick }: { stream: Stream; onClick: () => void }) {
  let dot = 'bg-emerald-400';
  let text = 'Live';
  let extra = '';
  if (stream.tokenStatus === 'invalid') {
    dot = 'bg-red-400';
    text = 'Token invalid';
    extra = ' cursor-pointer hover:bg-surface-input';
  } else if (stream.tokenStatus === 'unset') {
    dot = 'bg-amber-400';
    text = 'No token';
    extra = ' cursor-pointer hover:bg-surface-input';
  } else if (stream.connection !== 'connected') {
    dot = 'bg-amber-400';
    text = 'Reconnecting…';
  }
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1 text-xs text-gray-300${extra}`}
      title={stream.pollStatus ? `Last cycle: ${stream.pollStatus.channels_polled} channels polled` : undefined}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </button>
  );
}

export default function Header({ view, setView, theme, setTheme, stream }: Props) {
  const totalUnread = Object.values(stream.unread).reduce((a, b) => a + b, 0);
  return (
    <header className="flex items-center gap-3 border-b border-border-subtle bg-surface-panel px-4 py-2.5">
      <h1 className="text-sm font-semibold tracking-wide text-gray-100">
        Discord Control Center
      </h1>

      <nav className="flex overflow-hidden rounded-md border border-border-subtle">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              view === id
                ? 'bg-surface-input text-gray-100'
                : 'text-gray-400 hover:bg-surface-card hover:text-gray-200'
            }`}
          >
            <Icon size={13} />
            {label}
            {id === 'columns' && totalUnread > 0 && (
              <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {totalUnread > 0 && (
          <button
            onClick={stream.markAllRead}
            title="Mark all read"
            className="flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1 text-xs text-gray-400 hover:bg-surface-input hover:text-gray-200"
          >
            <CheckCheck size={13} />
            Mark all read
          </button>
        )}
        <ConnectionPill stream={stream} onClick={() => setView('settings')} />
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle theme"
          className="rounded-md border border-border-subtle p-1.5 text-gray-400 hover:bg-surface-input hover:text-gray-200"
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>
    </header>
  );
}
