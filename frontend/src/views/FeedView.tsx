import { Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import MessageCard from '../components/MessageCard';
import type { Stream } from '../hooks/useStream';
import { api } from '../lib/api';
import type { Message } from '../types';

function matchLocal(m: Message, q: string): boolean {
  return (
    m.content.toLowerCase().includes(q) ||
    m.author_name.toLowerCase().includes(q) ||
    (m.channel_name ?? '').toLowerCase().includes(q) ||
    m.embeds.some(
      (e) =>
        (e.title ?? '').toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q),
    )
  );
}

export default function FeedView({ stream }: { stream: Stream }) {
  const [query, setQuery] = useState('');
  const [serverResults, setServerResults] = useState<Message[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem('dcc.feedFilters') ?? '[]'));
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    localStorage.setItem('dcc.feedFilters', JSON.stringify([...excluded]));
  }, [excluded]);

  const tracked = useMemo(
    () =>
      Object.values(stream.channelById)
        .filter((c) => c.tracked)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stream.channelById],
  );

  const q = query.trim().toLowerCase();
  const base = serverResults ?? stream.feed;
  const visible = base.filter(
    (m) => !excluded.has(m.channel_id) && (serverResults !== null || !q || matchLocal(m, q)),
  );

  const runServerSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      setServerResults(await api.getMessages({ search: query.trim(), limit: 100 }));
    } catch (err) {
      console.error('search failed', err);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setServerResults(null);
  };

  const toggleChannel = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLoadOlder = async () => {
    setLoadingOlder(true);
    try {
      await stream.loadOlderFeed();
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border-subtle bg-surface-panel px-4 py-2">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          {searching ? (
            <Loader2 size={14} className="animate-spin text-gray-500" />
          ) : (
            <Search size={14} className="text-gray-500" />
          )}
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setServerResults(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runServerSearch();
            }}
            placeholder="Filter messages… (Enter = search full history)"
            className="flex-1 bg-transparent text-sm text-gray-200 outline-none placeholder:text-gray-600"
          />
          {(query || serverResults) && (
            <button onClick={clearSearch} className="text-gray-500 hover:text-gray-300">
              <X size={14} />
            </button>
          )}
        </div>
        {tracked.length > 1 && (
          <div className="mx-auto mt-2 flex max-w-3xl flex-wrap gap-1">
            {excluded.size > 0 && (
              <button
                onClick={() => setExcluded(new Set())}
                className="rounded-md border border-border-subtle px-2 py-0.5 text-[11px] text-gray-400 hover:bg-surface-input"
              >
                Show all
              </button>
            )}
            {tracked.map((c) => (
              <button
                key={c.id}
                onClick={() => toggleChannel(c.id)}
                className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                  excluded.has(c.id)
                    ? 'border-border-subtle text-gray-600'
                    : 'border-border-subtle bg-surface-input text-gray-300'
                }`}
                title={excluded.has(c.id) ? 'Show channel' : 'Hide channel'}
              >
                #{c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-1.5 p-3">
          {serverResults !== null && (
            <div className="text-xs text-gray-500">
              {serverResults.length} result{serverResults.length === 1 ? '' : 's'} from history for
              “{query.trim()}”
            </div>
          )}
          {visible.length === 0 && (
            <div className="py-16 text-center text-sm text-gray-500">
              {tracked.length === 0
                ? 'No channels tracked yet — pick channels in Settings.'
                : 'No messages match.'}
            </div>
          )}
          {visible.map((m) => (
            <MessageCard key={m.id} msg={m} showChannel />
          ))}
          {serverResults === null && stream.feed.length > 0 && (
            <button
              onClick={handleLoadOlder}
              disabled={loadingOlder}
              className="w-full rounded border border-border-subtle py-1.5 text-xs text-gray-400 hover:bg-surface-card disabled:opacity-50"
            >
              {loadingOlder ? 'Loading…' : 'Load older'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
