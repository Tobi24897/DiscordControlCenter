import {
  AtSign,
  BellRing,
  ChevronDown,
  Copy,
  DownloadCloud,
  History,
  KeyRound,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Timer,
  Trash2,
  Volume2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ToggleSwitch from '../components/ToggleSwitch';
import type { Stream } from '../hooks/useStream';
import { api } from '../lib/api';
import {
  notificationPermission,
  playPing,
  requestNotificationPermission,
} from '../lib/notify';
import { guildIconUrl } from '../lib/util';
import type { HealthInfo, NewsPreset } from '../types';

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border-subtle bg-surface-panel">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <span className="text-gray-400">{icon}</span>
        <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function TokenStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    valid: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    invalid: 'border-red-500/40 bg-red-500/10 text-red-300',
    unset: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    unknown: 'border-border-subtle bg-surface-input text-gray-400',
  };
  const labels: Record<string, string> = {
    valid: 'valid',
    invalid: 'invalid',
    unset: 'not configured',
    unknown: 'checking…',
  };
  return (
    <span
      className={`rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide ${
        styles[status] ?? styles.unknown
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}

export default function SettingsView({ stream }: { stream: Stream }) {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [openGuilds, setOpenGuilds] = useState<Set<string>>(new Set());
  const [intervalDraft, setIntervalDraft] = useState<string>('');
  const [keywordsDraft, setKeywordsDraft] = useState<string>('');
  const [lookbackDraft, setLookbackDraft] = useState<string>('');
  const [permission, setPermission] = useState(notificationPermission());
  const [importing, setImporting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nitterUserDraft, setNitterUserDraft] = useState('');
  const [nitterInstanceDraft, setNitterInstanceDraft] = useState('');
  const [nitterFallbacksDraft, setNitterFallbacksDraft] = useState('');
  const [addingNitter, setAddingNitter] = useState(false);
  const [nitterError, setNitterError] = useState<string | null>(null);
  const [newsPresets, setNewsPresets] = useState<NewsPreset[]>([]);
  const [newsPresetUrl, setNewsPresetUrl] = useState('');
  const [newsUrlDraft, setNewsUrlDraft] = useState('');
  const [addingNews, setAddingNews] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

  // Reads the token from Discord's own storage (iframe trick — Discord blocks
  // window.localStorage directly) and opens this app with the token in the URL
  // fragment, which logs you in. Navigation isn't blocked by Discord's CSP, so
  // it works where a direct fetch can't. `window.location.origin` keeps the
  // port correct if you changed it.
  const BOOKMARKLET =
    'javascript:(function(){try{var f=document.createElement("iframe");document.body.appendChild(f);' +
    'var t=f.contentWindow.localStorage.getItem("token");f.remove();' +
    'if(t){window.open(' +
    JSON.stringify(window.location.origin) +
    '+"/#import_token="+encodeURIComponent(JSON.parse(t)),"_blank");}' +
    'else{alert("No Discord token found — open discord.com in this browser, log in, then click this again.");}' +
    '}catch(e){alert("Discord login error: "+e.message);}})();';

  const bookmarkletRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // Set the javascript: href via the DOM (React strips it from JSX) so the
    // link can be dragged to the bookmarks bar.
    bookmarkletRef.current?.setAttribute('href', BOOKMARKLET);
  }, [BOOKMARKLET]);

  const afterAuth = async () => {
    setTokenDraft('');
    api.health().then(setHealth).catch(() => undefined);
    api.getSettings().then(stream.setSettings).catch(() => undefined);
  };

  const importLocal = async () => {
    setImporting(true);
    setAuthError(null);
    try {
      await api.importLocalToken();
      await afterAuth();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const saveToken = async () => {
    if (!tokenDraft.trim()) return;
    setSavingToken(true);
    setAuthError(null);
    try {
      await api.setToken(tokenDraft.trim());
      await afterAuth();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingToken(false);
    }
  };

  const copyBookmarklet = () => {
    navigator.clipboard.writeText(BOOKMARKLET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const saveLookback = () => {
    const n = Number(lookbackDraft);
    if (Number.isFinite(n) && n >= 1 && n <= 90) {
      void stream.saveSettings({ lookback_days: Math.round(n) });
    } else if (stream.settings) {
      setLookbackDraft(String(stream.settings.lookback_days));
    }
  };

  useEffect(() => {
    api.health().then(setHealth).catch(() => undefined);
  }, [stream.tokenStatus]);

  useEffect(() => {
    api.getNewsPresets().then(setNewsPresets).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (stream.settings) {
      setIntervalDraft(String(stream.settings.poll_interval));
      setKeywordsDraft(stream.settings.notify_keywords.join(', '));
      setLookbackDraft(String(stream.settings.lookback_days));
      if (!nitterInstanceDraft) setNitterInstanceDraft(stream.settings.nitter_instance);
      if (!nitterFallbacksDraft) {
        setNitterFallbacksDraft((stream.settings.nitter_fallbacks ?? []).join('\n'));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.settings]);

  const nitterProfiles = Object.values(stream.channelById).filter((c) => c.source === 'nitter');

  const addNitter = async () => {
    const u = nitterUserDraft.trim();
    if (!u) return;
    setAddingNitter(true);
    setNitterError(null);
    try {
      await api.addNitterProfile(u, nitterInstanceDraft.trim() || undefined);
      setNitterUserDraft('');
      await stream.reloadGuilds();
    } catch (e) {
      setNitterError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingNitter(false);
    }
  };

  const removeNitter = async (id: string) => {
    try {
      await api.deleteNitterProfile(id);
      await stream.reloadGuilds();
    } catch (e) {
      setNitterError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveNitterInstance = () => {
    const v = nitterInstanceDraft.trim();
    if (v) void stream.saveSettings({ nitter_instance: v });
  };

  const saveNitterFallbacks = () => {
    const list = nitterFallbacksDraft
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    void stream.saveSettings({ nitter_fallbacks: list });
  };

  const newsFeeds = Object.values(stream.channelById).filter((c) => c.source === 'rss');

  const addNews = async (url: string, name?: string) => {
    if (!url.trim()) return;
    setAddingNews(true);
    setNewsError(null);
    try {
      await api.addNewsFeed(url.trim(), name);
      setNewsUrlDraft('');
      setNewsPresetUrl('');
      await stream.reloadGuilds();
    } catch (e) {
      setNewsError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingNews(false);
    }
  };

  const removeNews = async (id: string) => {
    try {
      await api.deleteNewsFeed(id);
      await stream.reloadGuilds();
    } catch (e) {
      setNewsError(e instanceof Error ? e.message : String(e));
    }
  };

  const runDiscovery = async () => {
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      await stream.refreshDiscovery();
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscovering(false);
    }
  };

  const toggleGuild = (id: string) => {
    setOpenGuilds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveInterval = () => {
    const n = Number(intervalDraft);
    if (Number.isFinite(n) && n >= 5 && n <= 600) {
      void stream.saveSettings({ poll_interval: Math.round(n) });
    } else if (stream.settings) {
      setIntervalDraft(String(stream.settings.poll_interval));
    }
  };

  const saveKeywords = () => {
    const keywords = keywordsDraft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    void stream.saveSettings({ notify_keywords: keywords });
  };

  const settings = stream.settings;
  const trackedCount = Object.values(stream.channelById).filter((c) => c.tracked).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <Card title="Discord Login" icon={<KeyRound size={14} />}>
          <div className="flex items-center gap-3">
            <TokenStatusBadge status={stream.tokenStatus} />
            {(health?.discord_user || settings?.discord_user) && (
              <span className="text-sm text-gray-300">
                logged in as{' '}
                <span className="font-semibold">
                  {health?.discord_user || settings?.discord_user}
                </span>
              </span>
            )}
          </div>

          {/* Primary: one-click login via a draggable bookmarklet (browser users). */}
          <div className="mt-3 rounded-md border border-blue-500/40 bg-blue-600/10 p-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a
                ref={bookmarkletRef}
                draggable
                onClick={(e) => e.preventDefault()}
                title="Drag me to your bookmarks bar"
                className="inline-flex cursor-grab items-center gap-1.5 rounded-md border border-blue-400/70 bg-blue-600/30 px-3 py-1.5 text-sm font-semibold text-blue-50 active:cursor-grabbing"
              >
                🔑 Discord Login
              </a>
              <button
                onClick={copyBookmarklet}
                title="Can't drag? Copy the bookmarklet and make a bookmark with it."
                className="flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1.5 text-xs text-gray-400 hover:bg-surface-input"
              >
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy instead'}
              </button>
            </div>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[11px] leading-relaxed text-gray-300">
              <li>
                Drag the <span className="font-semibold text-blue-200">🔑 Discord Login</span> button
                to your browser's bookmarks bar (one-time).
              </li>
              <li>
                Open <span className="font-mono">discord.com</span> in this browser (logged in), then
                click that bookmark — you're logged in here automatically. No copy-paste.
              </li>
            </ol>
          </div>

          {/* Secondary options. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={importLocal}
              disabled={importing}
              className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-input px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-border-subtle disabled:opacity-40"
            >
              {importing ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />}
              Import from Discord desktop app
            </button>
            <input
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveToken();
              }}
              placeholder="…or paste a token"
              className="min-w-[160px] flex-1 rounded-md border border-border-subtle bg-surface-input px-2 py-1.5 font-mono text-xs text-gray-200 outline-none"
            />
            <button
              onClick={saveToken}
              disabled={!tokenDraft.trim() || savingToken}
              className="rounded-md border border-border-subtle bg-surface-input px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-border-subtle disabled:opacity-40"
            >
              {savingToken ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-gray-500">
            Your token is saved locally and never leaves your machine.
          </p>

          {authError && <p className="mt-2 text-xs text-red-400">{authError}</p>}
        </Card>

        <Card title="Servers & Channels" icon={<RefreshCw size={14} />}>
          <div className="flex items-center gap-3">
            <button
              onClick={runDiscovery}
              disabled={discovering || stream.tokenStatus !== 'valid'}
              className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-input px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-border-subtle disabled:opacity-40"
            >
              {discovering ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Refresh servers & channels
            </button>
            <span className="text-xs text-gray-500">
              {stream.guilds.length} servers · {trackedCount} channels tracked
            </span>
          </div>
          {discoveryError && <p className="mt-2 text-xs text-red-400">{discoveryError}</p>}

          <div className="mt-3 space-y-2">
            {stream.guilds.length === 0 && !discovering && (
              <p className="text-xs text-gray-500">
                No servers loaded yet — run discovery once your token is valid.
              </p>
            )}
            {stream.guilds.map((g) => {
              const open = openGuilds.has(g.id);
              const icon = guildIconUrl(g.id, g.icon);
              const trackedHere = g.channels.filter((c) => c.tracked).length;
              return (
                <div key={g.id} className="rounded-md border border-border-subtle bg-surface-card">
                  <button
                    onClick={() => toggleGuild(g.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    {icon ? (
                      <img src={icon} alt="" className="h-5 w-5 rounded-full" />
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-input text-[10px] font-bold text-gray-300">
                        {g.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-gray-100">{g.name}</span>
                    <span className="text-xs text-gray-500">
                      {trackedHere}/{g.channels.length} tracked
                    </span>
                    <ChevronDown
                      size={14}
                      className={`ml-auto text-gray-500 transition-transform ${
                        open ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {open &&
                    g.channels.map((ch) => (
                      <div
                        key={ch.id}
                        className="flex items-center gap-3 border-t border-border-subtle px-3 py-1.5"
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={ch.tracked}
                            onChange={(e) =>
                              void stream.updateChannel(ch.id, { tracked: e.target.checked })
                            }
                            className="accent-blue-600"
                          />
                          <span className="truncate text-sm text-gray-200">#{ch.name}</span>
                          {!ch.accessible && (
                            <span className="shrink-0 rounded bg-red-500/15 px-1 text-[10px] text-red-400">
                              no access
                            </span>
                          )}
                        </label>
                        {ch.tracked && (
                          <>
                            <ToggleSwitch
                              label="Notify"
                              checked={ch.notify}
                              onChange={(v) => void stream.updateChannel(ch.id, { notify: v })}
                            />
                            <ToggleSwitch
                              label="Keywords only"
                              checked={ch.notify_keywords_only}
                              disabled={!ch.notify}
                              onChange={(v) =>
                                void stream.updateChannel(ch.id, { notify_keywords_only: v })
                              }
                            />
                          </>
                        )}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Nitter / X profiles" icon={<AtSign size={14} />}>
          <div className="flex items-center gap-2">
            <input
              value={nitterUserDraft}
              onChange={(e) => setNitterUserDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addNitter();
              }}
              placeholder="@username  or  x.com/username"
              className="flex-1 rounded-md border border-border-subtle bg-surface-input px-2 py-1.5 text-sm text-gray-200 outline-none"
            />
            <button
              onClick={addNitter}
              disabled={!nitterUserDraft.trim() || addingNitter}
              className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-input px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-border-subtle disabled:opacity-40"
            >
              {addingNitter ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Add column
            </button>
          </div>
          {nitterError && <p className="mt-2 text-xs text-red-400">{nitterError}</p>}

          <div className="mt-3 space-y-1.5">
            {nitterProfiles.length === 0 && (
              <p className="text-xs text-gray-500">
                No X profiles yet. Add one to get an X column you can mix with Discord channels in
                the dashboard.
              </p>
            )}
            {nitterProfiles.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-card px-3 py-1.5"
              >
                <span className="truncate text-sm text-gray-200">{c.name}</span>
                <span className="truncate text-[11px] text-gray-500">@{c.nitter_username}</span>
                <button
                  onClick={() => void removeNitter(c.id)}
                  title="Remove"
                  className="ml-auto rounded p-1 text-gray-500 hover:bg-surface-input hover:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label className="text-sm text-gray-300">Instance</label>
            <input
              value={nitterInstanceDraft}
              onChange={(e) => setNitterInstanceDraft(e.target.value)}
              onBlur={saveNitterInstance}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="flex-1 rounded-md border border-border-subtle bg-surface-input px-2 py-1.5 font-mono text-xs text-gray-200 outline-none"
            />
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            Nitter mirrors Twitter/X as a feed. Public instances come and go — nitter.net is the
            default and is tried first.
          </p>

          <div className="mt-3">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
              Fallback instances (one per line — auto-tried if the primary is down)
            </label>
            <textarea
              value={nitterFallbacksDraft}
              onChange={(e) => setNitterFallbacksDraft(e.target.value)}
              onBlur={saveNitterFallbacks}
              rows={4}
              spellCheck={false}
              className="w-full resize-y rounded-md border border-border-subtle bg-surface-input px-2 py-1.5 font-mono text-[11px] text-gray-200 outline-none"
            />
            {health?.nitter_instance_active && (
              <p className="mt-1.5 text-[11px] text-gray-500">
                Currently serving via{' '}
                <span className="font-mono text-emerald-300">{health.nitter_instance_active}</span>
              </p>
            )}
          </div>
        </Card>

        <Card title="News feeds" icon={<Newspaper size={14} />}>
          <div className="flex items-center gap-2">
            <select
              value={newsPresetUrl}
              onChange={(e) => setNewsPresetUrl(e.target.value)}
              className="flex-1 rounded-md border border-border-subtle bg-surface-input px-2 py-1.5 text-sm text-gray-200 outline-none"
            >
              <option value="">Add a source…</option>
              {newsPresets.map((p) => (
                <option key={p.url} value={p.url}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                const p = newsPresets.find((x) => x.url === newsPresetUrl);
                if (p) void addNews(p.url, p.name);
              }}
              disabled={!newsPresetUrl || addingNews}
              className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-input px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-border-subtle disabled:opacity-40"
            >
              {addingNews ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Add
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <input
              value={newsUrlDraft}
              onChange={(e) => setNewsUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addNews(newsUrlDraft);
              }}
              placeholder="…or paste any RSS feed URL"
              className="flex-1 rounded-md border border-border-subtle bg-surface-input px-2 py-1.5 text-sm text-gray-200 outline-none"
            />
            <button
              onClick={() => void addNews(newsUrlDraft)}
              disabled={!newsUrlDraft.trim() || addingNews}
              className="rounded-md border border-border-subtle bg-surface-input px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-border-subtle disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {newsError && <p className="mt-2 text-xs text-red-400">{newsError}</p>}

          <div className="mt-3 space-y-1.5">
            {newsFeeds.length === 0 && (
              <p className="text-xs text-gray-500">
                No news feeds yet. Add WSJ, FT, CNBC, MarketWatch, Bloomberg/Reuters (via Google
                News) and more as columns you can mix with Discord and X.
              </p>
            )}
            {newsFeeds.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-card px-3 py-1.5"
              >
                <span className="truncate text-sm text-gray-200">{c.name}</span>
                <button
                  onClick={() => void removeNews(c.id)}
                  title="Remove"
                  className="ml-auto rounded p-1 text-gray-500 hover:bg-surface-input hover:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            Free public RSS from reputable outlets. Bloomberg &amp; Reuters come via the free Google
            News bridge (their direct RSS was discontinued).
          </p>
        </Card>

        <Card title="Polling" icon={<Timer size={14} />}>
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-300">Poll interval</label>
            <input
              type="number"
              min={5}
              max={600}
              value={intervalDraft}
              onChange={(e) => setIntervalDraft(e.target.value)}
              onBlur={saveInterval}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="w-20 rounded-md border border-border-subtle bg-surface-input px-2 py-1 text-sm text-gray-200 outline-none"
            />
            <span className="text-sm text-gray-500">seconds</span>
          </div>
          {health && (
            <p className="mt-2 text-xs text-gray-500">
              {health.tracked_channels} tracked channels → minimum cycle ≈{' '}
              {health.effective_min_cycle_s}s (serial polling, ~0.4s per channel).{' '}
              {health.message_count.toLocaleString()} messages stored.
            </p>
          )}
        </Card>

        <Card title="History window" icon={<History size={14} />}>
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-300">Look back</label>
            <input
              type="number"
              min={1}
              max={90}
              value={lookbackDraft}
              onChange={(e) => setLookbackDraft(e.target.value)}
              onBlur={saveLookback}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="w-20 rounded-md border border-border-subtle bg-surface-input px-2 py-1 text-sm text-gray-200 outline-none"
            />
            <span className="text-sm text-gray-500">days</span>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            How far back to backfill a newly tracked channel, and how much history to keep —
            messages older than this are pruned. Applies to newly tracked channels going forward.
          </p>
        </Card>

        <Card title="Notifications" icon={<BellRing size={14} />}>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => void requestNotificationPermission().then(setPermission)}
                disabled={permission === 'granted'}
                className="rounded-md border border-border-subtle bg-surface-input px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-border-subtle disabled:opacity-40"
              >
                {permission === 'granted' ? 'Desktop notifications enabled' : 'Enable desktop notifications'}
              </button>
              {permission === 'denied' && (
                <span className="text-xs text-red-400">
                  Blocked by the browser — allow notifications for this site in the browser settings.
                </span>
              )}
            </div>

            {settings && (
              <>
                <div className="flex items-center gap-4">
                  <ToggleSwitch
                    label="Sound"
                    checked={settings.sound_enabled}
                    onChange={(v) => void stream.saveSettings({ sound_enabled: v })}
                  />
                  <button
                    onClick={() => playPing(true)}
                    className="flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1 text-xs text-gray-400 hover:bg-surface-input"
                  >
                    <Volume2 size={12} /> Test
                  </button>
                  <ToggleSwitch
                    label="Only when window unfocused"
                    checked={settings.notify_only_unfocused}
                    onChange={(v) => void stream.saveSettings({ notify_only_unfocused: v })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-gray-500">
                    Keywords (comma-separated, used by “keywords only” channels — “$” matches any
                    cashtag)
                  </label>
                  <input
                    value={keywordsDraft}
                    onChange={(e) => setKeywordsDraft(e.target.value)}
                    onBlur={saveKeywords}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    placeholder="$, BTO, entry"
                    className="w-full rounded-md border border-border-subtle bg-surface-input px-2 py-1.5 text-sm text-gray-200 outline-none"
                  />
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
