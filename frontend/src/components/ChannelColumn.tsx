import { Check, ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Channel, Message } from '../types';
import MessageCard from './MessageCard';

function feedHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'news';
  }
}

interface Props {
  channel: Channel;
  guildName?: string;
  messages: Message[];
  unread: number;
  onMarkRead: () => void;
  onClear: () => void;
  onLoadOlder: () => Promise<number>;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  highlight?: boolean;
  dragOver?: boolean;
  onHeaderDragStart?: () => void;
  onHeaderDragEnd?: () => void;
  width?: number;
  sizeLabel?: string;
  onCycleWidth?: () => void;
}

export default function ChannelColumn({
  channel,
  guildName,
  messages,
  unread,
  onMarkRead,
  onClear,
  onLoadOlder,
  onMoveLeft,
  onMoveRight,
  highlight,
  dragOver,
  onHeaderDragStart,
  onHeaderDragEnd,
  width = 340,
  sizeLabel = 'M',
  onCycleWidth,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevTopIdRef = useRef<string | null>(null);
  const prevHeightRef = useRef(0);
  const [atTop, setAtTop] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderExhausted, setOlderExhausted] = useState(false);

  // Keep reading position stable when new messages are prepended while scrolled down.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const newTopId = messages[0]?.id ?? null;
    if (
      prevTopIdRef.current &&
      newTopId &&
      newTopId !== prevTopIdRef.current &&
      el.scrollTop > 40
    ) {
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
    }
    prevTopIdRef.current = newTopId;
    prevHeightRef.current = el.scrollHeight;
  }, [messages]);

  // Auto-mark-read when the newest messages are visible and the tab has focus.
  // (Independent of the explicit "clear" action — reading doesn't empty the column.)
  useEffect(() => {
    if (!atTop || unread === 0) return;
    if (document.visibilityState !== 'visible') return;
    const t = setTimeout(onMarkRead, 1500);
    return () => clearTimeout(t);
  }, [atTop, unread, messages.length, onMarkRead]);

  const handleScroll = () => {
    const el = bodyRef.current;
    if (el) setAtTop(el.scrollTop < 40);
  };

  const handleLoadOlder = async () => {
    setLoadingOlder(true);
    try {
      const n = await onLoadOlder();
      if (n === 0) setOlderExhausted(true);
    } finally {
      setLoadingOlder(false);
    }
  };

  const jumpToTop = () => {
    bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    onMarkRead();
  };

  return (
    <div
      style={{ width }}
      className={`flex h-full shrink-0 flex-col rounded-lg border bg-surface-panel transition-colors ${
        dragOver
          ? 'border-blue-400 ring-2 ring-blue-500/40'
          : highlight
            ? 'border-blue-500'
            : 'border-border-subtle'
      }`}
    >
      <div className="flex items-center gap-1 border-b border-border-subtle px-2 py-2">
        {/* Drag handle: grab the title block to reorder columns (X Pro style). */}
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            onHeaderDragStart?.();
          }}
          onDragEnd={onHeaderDragEnd}
          title="Drag to reorder"
          className="flex min-w-0 flex-1 cursor-grab select-none items-start gap-1 active:cursor-grabbing"
        >
          <GripVertical size={14} className="mt-0.5 shrink-0 text-gray-600" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-gray-100">
                {channel.source === 'discord' ? `#${channel.name}` : channel.name}
              </span>
              {channel.source === 'nitter' && (
                <span className="shrink-0 rounded bg-surface-input px-1 text-[10px] font-bold text-gray-300">
                  𝕏
                </span>
              )}
              {channel.source === 'rss' && (
                <span className="shrink-0 rounded bg-surface-input px-1 text-[10px] font-bold text-gray-300">
                  📰
                </span>
              )}
              {unread > 0 && (
                <span className="shrink-0 rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
              {!channel.accessible && (
                <span className="shrink-0 rounded bg-red-500/15 px-1 text-[10px] font-medium text-red-400">
                  no access
                </span>
              )}
            </div>
            {channel.source === 'nitter' && channel.nitter_username ? (
              <div className="truncate text-[11px] text-gray-500">@{channel.nitter_username}</div>
            ) : channel.source === 'rss' && channel.feed_url ? (
              <div className="truncate text-[11px] text-gray-500">{feedHost(channel.feed_url)}</div>
            ) : (
              guildName && <div className="truncate text-[11px] text-gray-500">{guildName}</div>
            )}
          </div>
        </div>
        <button
          onClick={onCycleWidth}
          title="Column width"
          className="rounded px-1 py-1 text-[10px] font-bold text-gray-500 hover:bg-surface-input hover:text-gray-200"
        >
          {sizeLabel}
        </button>
        <button
          onClick={onClear}
          title="Clear column (show only new messages from now)"
          className="rounded p-1 text-gray-500 hover:bg-surface-input hover:text-gray-200"
        >
          <Check size={14} />
        </button>
        <button
          onClick={onMoveLeft}
          disabled={!onMoveLeft}
          title="Move left"
          className="rounded p-1 text-gray-500 hover:bg-surface-input hover:text-gray-200 disabled:opacity-25"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={onMoveRight}
          disabled={!onMoveRight}
          title="Move right"
          className="rounded p-1 text-gray-500 hover:bg-surface-input hover:text-gray-200 disabled:opacity-25"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div
        ref={bodyRef}
        onScroll={handleScroll}
        className="relative flex-1 space-y-1.5 overflow-y-auto p-2"
      >
        {!atTop && unread > 0 && (
          <button
            onClick={jumpToTop}
            className="sticky top-1 z-10 mx-auto block rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-lg hover:bg-blue-500"
          >
            {unread} new ↑
          </button>
        )}

        {messages.length === 0 && (
          <div className="py-10 text-center text-xs text-gray-500">
            Cleared — new messages appear here
          </div>
        )}

        {messages.map((m, i) => (
          <React.Fragment key={m.id}>
            <MessageCard msg={m} />
            {unread > 0 && i === unread - 1 && i < messages.length - 1 && (
              <div className="flex items-center gap-2 py-0.5">
                <div className="h-px flex-1 bg-red-500/60" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-red-400">
                  new
                </span>
                <div className="h-px flex-1 bg-red-500/60" />
              </div>
            )}
          </React.Fragment>
        ))}

        {messages.length > 0 && !olderExhausted && (
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
  );
}
