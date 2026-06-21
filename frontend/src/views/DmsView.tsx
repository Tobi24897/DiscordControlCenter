import { CornerUpLeft, MessageSquare, Paperclip, RefreshCw, Send, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import MessageCard from '../components/MessageCard';
import { useDms } from '../hooks/useDms';
import { avatarUrl, colorForId } from '../lib/util';
import type { DmChannel } from '../types';

function dmTitle(dm: DmChannel): string {
  if (dm.is_group) {
    return (
      dm.name ||
      dm.recipients.map((r) => r.global_name || r.username || '?').join(', ') ||
      'Group'
    );
  }
  const u = dm.recipients[0];
  return u?.global_name || u?.username || 'Unknown';
}

function dmAvatar(dm: DmChannel): { url: string | null; seed: string; letter: string } {
  if (dm.is_group) {
    return {
      url: dm.icon ? `https://cdn.discordapp.com/channel-icons/${dm.id}/${dm.icon}.webp?size=64` : null,
      seed: dm.id,
      letter: (dmTitle(dm)[0] || '#').toUpperCase(),
    };
  }
  const u = dm.recipients[0];
  return {
    url: u ? avatarUrl(u.id, u.avatar) : null,
    seed: u?.id || dm.id,
    letter: (dmTitle(dm)[0] || '?').toUpperCase(),
  };
}

function Avatar({ url, seed, letter, size = 32 }: { url: string | null; seed: string; letter: string; size?: number }) {
  if (url) return <img src={url} alt="" className="shrink-0 rounded-full" style={{ width: size, height: size }} />;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, backgroundColor: colorForId(seed), fontSize: size * 0.4 }}
    >
      {letter}
    </div>
  );
}

export default function DmsView({
  tokenStatus,
  goToSettings,
}: {
  tokenStatus: string;
  goToSettings: () => void;
}) {
  const dm = useDms();
  const [tab, setTab] = useState<'dms' | 'friends'>('dms');
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const newestRef = useRef<string | null>(null);

  const ordered = useMemo(() => [...dm.messages].reverse(), [dm.messages]); // oldest -> newest

  // Scroll to bottom on open and when a new newest message arrives (if near bottom).
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const newest = dm.messages[0]?.id ?? null;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (newest !== newestRef.current) {
      if (newestRef.current === null || nearBottom) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
      newestRef.current = newest;
    }
  }, [dm.messages, dm.activeId]);

  useEffect(() => {
    newestRef.current = null;
  }, [dm.activeId]);

  if (tokenStatus !== 'valid') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-gray-400">Connect your Discord token to use DMs.</p>
          <button
            onClick={goToSettings}
            className="mt-3 rounded-md border border-border-subtle bg-surface-input px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-border-subtle"
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  const active = dm.dms.find((d) => d.id === dm.activeId);
  const friends = dm.friends.filter((f) => f.type === 1);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list).filter((f) => f.size > 0);
    if (arr.length) setAttachments((prev) => [...prev, ...arr].slice(0, 10));
  };

  const removeAttachment = (i: number) =>
    setAttachments((prev) => prev.filter((_, idx) => idx !== i));

  const submit = () => {
    if ((!draft.trim() && attachments.length === 0) || dm.sending) return;
    void dm.send(draft, attachments);
    setDraft('');
    setAttachments([]);
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-border-subtle bg-surface-panel">
        <div className="flex items-center gap-1 border-b border-border-subtle p-2">
          <button
            onClick={() => setTab('dms')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium ${
              tab === 'dms' ? 'bg-surface-input text-gray-100' : 'text-gray-400 hover:bg-surface-card'
            }`}
          >
            <MessageSquare size={13} /> DMs
          </button>
          <button
            onClick={() => setTab('friends')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium ${
              tab === 'friends' ? 'bg-surface-input text-gray-100' : 'text-gray-400 hover:bg-surface-card'
            }`}
          >
            <Users size={13} /> Friends
          </button>
          <button
            onClick={() => void dm.refreshLists()}
            title="Refresh"
            className="rounded p-1.5 text-gray-500 hover:bg-surface-input hover:text-gray-200"
          >
            <RefreshCw size={13} className={dm.loadingLists ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {tab === 'dms' &&
            dm.dms.map((d) => {
              const a = dmAvatar(d);
              return (
                <button
                  key={d.id}
                  onClick={() => void dm.openConversation(d.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                    dm.activeId === d.id ? 'bg-surface-input' : 'hover:bg-surface-card'
                  }`}
                >
                  <Avatar {...a} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-200">{dmTitle(d)}</div>
                    {d.is_group && (
                      <div className="truncate text-[11px] text-gray-500">
                        {d.recipients.length + 1} members
                      </div>
                    )}
                  </div>
                </button>
              );
            })}

          {tab === 'friends' &&
            friends.map((f) => (
              <div
                key={f.user.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-card"
              >
                <Avatar
                  url={avatarUrl(f.user.id, f.user.avatar)}
                  seed={f.user.id}
                  letter={(f.user.global_name || f.user.username || '?')[0].toUpperCase()}
                  size={32}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
                  {f.user.global_name || f.user.username}
                </span>
                <button
                  onClick={() => void dm.openDmWithUser(f.user.id)}
                  title="Message"
                  className="rounded p-1 text-gray-500 hover:bg-surface-input hover:text-gray-200"
                >
                  <MessageSquare size={14} />
                </button>
              </div>
            ))}

          {tab === 'friends' && !dm.loadingLists && friends.length === 0 && (
            <div className="p-4 text-center text-xs text-gray-500">No friends found.</div>
          )}
          {tab === 'dms' && !dm.loadingLists && dm.dms.length === 0 && (
            <div className="p-4 text-center text-xs text-gray-500">No conversations yet.</div>
          )}
        </div>
      </aside>

      {/* conversation */}
      <section
        className="relative flex min-w-0 flex-1 flex-col bg-surface-page"
        onDragOver={(e) => {
          if (dm.activeId) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (dm.activeId) addFiles(e.dataTransfer.files);
        }}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-blue-500 bg-blue-500/10 text-sm font-medium text-blue-200">
            Drop files to attach
          </div>
        )}
        {!active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
            Select a conversation
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b border-border-subtle bg-surface-panel px-4 py-2.5">
              <Avatar {...dmAvatar(active)} size={26} />
              <span className="truncate text-sm font-semibold text-gray-100">{dmTitle(active)}</span>
            </header>

            <div ref={bodyRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
              {dm.messages.length >= 50 && (
                <button
                  onClick={() => void dm.loadOlder()}
                  className="mx-auto block rounded border border-border-subtle px-3 py-1 text-xs text-gray-400 hover:bg-surface-card"
                >
                  Load older
                </button>
              )}
              {dm.loadingConvo && (
                <div className="py-8 text-center text-xs text-gray-500">Loading…</div>
              )}
              {ordered.map((m) => (
                <div key={m.id} className="group relative">
                  <MessageCard msg={m} useProxy={false} />
                  <button
                    onClick={() => dm.setReplyTo(m)}
                    title="Reply"
                    className="absolute right-1.5 top-1.5 hidden rounded bg-surface-input p-1 text-gray-400 hover:text-gray-200 group-hover:block"
                  >
                    <CornerUpLeft size={12} />
                  </button>
                </div>
              ))}
            </div>

            {dm.error && (
              <div className="border-t border-red-500/30 bg-red-500/10 px-4 py-1.5 text-xs text-red-300">
                {dm.error}
              </div>
            )}

            {dm.replyTo && (
              <div className="flex items-center gap-2 border-t border-border-subtle bg-surface-panel px-4 py-1.5 text-xs text-gray-400">
                <CornerUpLeft size={12} />
                <span className="truncate">
                  Replying to <span className="text-gray-200">{dm.replyTo.author_name}</span>
                </span>
                <button onClick={() => dm.setReplyTo(null)} className="ml-auto hover:text-gray-200">
                  <X size={13} />
                </button>
              </div>
            )}

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-border-subtle bg-surface-panel px-3 pt-2">
                {attachments.map((f, i) => (
                  <div key={i} className="relative">
                    {f.type.startsWith('image/') ? (
                      <img
                        src={URL.createObjectURL(f)}
                        alt={f.name}
                        className="h-16 w-16 rounded border border-border-subtle object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded border border-border-subtle bg-surface-input p-1 text-center text-[9px] text-gray-300">
                        <span className="line-clamp-3 break-all">{f.name}</span>
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(i)}
                      className="absolute -right-1.5 -top-1.5 rounded-full border border-border-subtle bg-surface-input p-0.5 text-gray-300 hover:text-red-400"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2 border-t border-border-subtle bg-surface-panel p-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Attach files"
                className="flex h-[38px] w-[38px] items-center justify-center rounded-md border border-border-subtle text-gray-400 hover:bg-surface-input hover:text-gray-200"
              >
                <Paperclip size={15} />
              </button>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files || []);
                  if (files.length) {
                    e.preventDefault();
                    addFiles(files);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder={`Message ${dmTitle(active)}`}
                className="max-h-40 min-h-[38px] flex-1 resize-none rounded-md border border-border-subtle bg-surface-input px-3 py-2 text-sm text-gray-200 outline-none placeholder:text-gray-600"
              />
              <button
                onClick={submit}
                disabled={(!draft.trim() && attachments.length === 0) || dm.sending}
                className="flex h-[38px] items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
              >
                <Send size={14} />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
