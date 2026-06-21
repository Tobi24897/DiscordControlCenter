import { useEffect, useMemo, useRef, useState } from 'react';
import ChannelColumn from '../components/ChannelColumn';
import type { Stream } from '../hooks/useStream';
import { idGreater } from '../lib/util';

const WIDTHS = [280, 340, 420, 520];
const WIDTH_LABELS = ['S', 'M', 'L', 'XL'];
const DEFAULT_WIDTH = 340;

function widthTier(w: number): number {
  let best = 0;
  for (let i = 1; i < WIDTHS.length; i++) {
    if (Math.abs(WIDTHS[i] - w) < Math.abs(WIDTHS[best] - w)) best = i;
  }
  return best;
}

export default function ColumnsView({
  stream,
  goToSettings,
}: {
  stream: Stream;
  goToSettings: () => void;
}) {
  const tracked = useMemo(
    () =>
      Object.values(stream.channelById)
        .filter((c) => c.tracked)
        .sort(
          (a, b) =>
            (a.column_order ?? 1e9) - (b.column_order ?? 1e9) ||
            (a.position ?? 0) - (b.position ?? 0) ||
            a.name.localeCompare(b.name),
        ),
    [stream.channelById],
  );

  const guildNames = useMemo(
    () => Object.fromEntries(stream.guilds.map((g) => [g.id, g.name])),
    [stream.guilds],
  );

  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // "Cleared" marker per channel: hide everything up to this message id, so a
  // cleared column shows only messages that arrive afterwards. Persisted, and
  // independent of read-state (reading a message never empties the column).
  const [clearedBefore, setClearedBefore] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('dcc.clearedBefore') ?? '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    localStorage.setItem('dcc.clearedBefore', JSON.stringify(clearedBefore));
  }, [clearedBefore]);

  // Per-column width (X Pro style), persisted locally.
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem('dcc.colWidths') ?? '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    localStorage.setItem('dcc.colWidths', JSON.stringify(widths));
  }, [widths]);

  const cycleWidth = (chId: string) => {
    setWidths((prev) => {
      const cur = prev[chId] ?? DEFAULT_WIDTH;
      return { ...prev, [chId]: WIDTHS[(widthTier(cur) + 1) % WIDTHS.length] };
    });
  };

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    const target = stream.focusChannel;
    if (!target) return;
    columnRefs.current[target]?.scrollIntoView({ behavior: 'smooth', inline: 'start' });
    const t = setTimeout(() => stream.setFocusChannel(null), 2500);
    return () => clearTimeout(t);
  }, [stream.focusChannel, stream]);

  // Ensure every column has its own recent messages, even when the global
  // seed (newest 200 across all channels) doesn't reach every column.
  const fetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const ch of tracked) {
      if (!fetchedRef.current.has(ch.id) && (stream.byChannel[ch.id]?.length ?? 0) === 0) {
        fetchedRef.current.add(ch.id);
        void stream.loadOlder(ch.id);
      }
    }
  }, [tracked, stream.byChannel, stream.loadOlder]);

  const move = (idx: number, dir: -1 | 1) => {
    const ids = tracked.map((c) => c.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    void stream.reorderColumns(ids);
  };

  const clearColumn = (chId: string, latestId?: string) => {
    setClearedBefore((prev) => ({ ...prev, [chId]: latestId ?? prev[chId] ?? '0' }));
    stream.markRead(chId);
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const ids = tracked.map((c) => c.id);
    const from = ids.indexOf(dragId);
    if (from === -1) {
      setDragId(null);
      setOverId(null);
      return;
    }
    ids.splice(from, 1);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, dragId); // drop before the target column
    void stream.reorderColumns(ids);
    setDragId(null);
    setOverId(null);
  };

  if (tracked.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-gray-400">No channels tracked yet.</p>
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

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      {tracked.map((ch, i) => {
        const all = stream.byChannel[ch.id] ?? [];
        const cb = clearedBefore[ch.id];
        const visible = cb ? all.filter((m) => idGreater(m.id, cb)) : all;
        return (
          <div
            key={ch.id}
            ref={(el) => {
              columnRefs.current[ch.id] = el;
            }}
            className={`h-full transition-opacity ${dragId === ch.id ? 'opacity-40' : ''}`}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overId !== ch.id) setOverId(ch.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(ch.id);
            }}
          >
            <ChannelColumn
              channel={ch}
              guildName={guildNames[ch.guild_id]}
              messages={visible}
              unread={stream.unread[ch.id] ?? 0}
              onMarkRead={() => stream.markRead(ch.id)}
              onClear={() => clearColumn(ch.id, all[0]?.id)}
              onLoadOlder={() => stream.loadOlder(ch.id)}
              onMoveLeft={i > 0 ? () => move(i, -1) : undefined}
              onMoveRight={i < tracked.length - 1 ? () => move(i, 1) : undefined}
              highlight={stream.focusChannel === ch.id}
              dragOver={!!dragId && overId === ch.id && dragId !== ch.id}
              onHeaderDragStart={() => setDragId(ch.id)}
              onHeaderDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              width={widths[ch.id] ?? DEFAULT_WIDTH}
              sizeLabel={WIDTH_LABELS[widthTier(widths[ch.id] ?? DEFAULT_WIDTH)]}
              onCycleWidth={() => cycleWidth(ch.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
