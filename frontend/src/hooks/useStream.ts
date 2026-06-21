import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ChannelPatch } from '../lib/api';
import { maybeNotify } from '../lib/notify';
import { cmpIdDesc } from '../lib/util';
import type {
  Channel,
  ConnectionState,
  Guild,
  Message,
  PollStatus,
  Settings,
} from '../types';

const FEED_LIVE_CAP = 500;
const CHANNEL_LIVE_CAP = 300;

function insertSorted(list: Message[], msg: Message, cap: number): Message[] {
  if (list.some((m) => m.id === msg.id)) return list;
  const next = [msg, ...list].sort((a, b) => cmpIdDesc(a.id, b.id));
  return next.length > cap ? next.slice(0, cap) : next;
}

function mergeSorted(list: Message[], incoming: Message[]): Message[] {
  if (!incoming.length) return list;
  const seen = new Set(list.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (!fresh.length) return list;
  return [...list, ...fresh].sort((a, b) => cmpIdDesc(a.id, b.id));
}

function flattenChannels(guilds: Guild[]): Record<string, Channel> {
  const out: Record<string, Channel> = {};
  for (const g of guilds) for (const c of g.channels) out[c.id] = c;
  return out;
}

export interface Stream {
  connection: ConnectionState;
  tokenStatus: string;
  guilds: Guild[];
  channelById: Record<string, Channel>;
  feed: Message[];
  byChannel: Record<string, Message[]>;
  unread: Record<string, number>;
  pollStatus: PollStatus | null;
  settings: Settings | null;
  setSettings: (s: Settings | null) => void;
  focusChannel: string | null;
  setFocusChannel: (id: string | null) => void;
  refreshDiscovery: () => Promise<void>;
  reloadGuilds: () => Promise<void>;
  updateChannel: (id: string, patch: ChannelPatch) => Promise<void>;
  reorderColumns: (orderedIds: string[]) => Promise<void>;
  saveSettings: (patch: Partial<Omit<Settings, 'token_status'>>) => Promise<void>;
  markRead: (channelId: string) => void;
  markAllRead: () => void;
  loadOlder: (channelId: string) => Promise<number>;
  loadOlderFeed: () => Promise<number>;
}

export function useStream(): Stream {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [tokenStatus, setTokenStatus] = useState('unknown');
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [channelById, setChannelById] = useState<Record<string, Channel>>({});
  const [feed, setFeed] = useState<Message[]>([]);
  const [byChannel, setByChannel] = useState<Record<string, Message[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [pollStatus, setPollStatus] = useState<PollStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [focusChannel, setFocusChannel] = useState<string | null>(null);

  // Refs so SSE handlers see fresh values without re-subscribing.
  const channelsRef = useRef(channelById);
  channelsRef.current = channelById;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const applyGuilds = useCallback((tree: Guild[]) => {
    setGuilds(tree);
    setChannelById(flattenChannels(tree));
    const counts: Record<string, number> = {};
    for (const g of tree) for (const c of g.channels) if (c.tracked) counts[c.id] = c.unread;
    setUnread(counts);
  }, []);

  const loadGuilds = useCallback(async () => {
    try {
      applyGuilds(await api.getGuilds());
    } catch (err) {
      console.error('loadGuilds failed', err);
    }
  }, [applyGuilds]);

  const seedMessages = useCallback(async () => {
    try {
      const msgs = await api.getMessages({ limit: 200 });
      setFeed((prev) => mergeSorted(prev, msgs));
      setByChannel((prev) => {
        const next = { ...prev };
        const grouped: Record<string, Message[]> = {};
        for (const m of msgs) (grouped[m.channel_id] ??= []).push(m);
        for (const [cid, list] of Object.entries(grouped)) {
          next[cid] = mergeSorted(next[cid] ?? [], list);
        }
        return next;
      });
    } catch (err) {
      console.error('seedMessages failed', err);
    }
  }, []);

  const insertLive = useCallback((msg: Message) => {
    setFeed((prev) => insertSorted(prev, msg, FEED_LIVE_CAP));
    setByChannel((prev) => ({
      ...prev,
      [msg.channel_id]: insertSorted(prev[msg.channel_id] ?? [], msg, CHANNEL_LIVE_CAP),
    }));
    setUnread((prev) => ({ ...prev, [msg.channel_id]: (prev[msg.channel_id] ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    void loadGuilds();
    void seedMessages();
    api.getSettings().then(setSettings).catch(() => undefined);

    const es = new EventSource('/api/sse');

    es.onopen = () => setConnection('connected');
    es.onerror = () => setConnection('reconnecting'); // EventSource auto-reconnects

    es.addEventListener('hello', (ev) => {
      const data = JSON.parse((ev as MessageEvent).data);
      setTokenStatus(data.token_status ?? 'unknown');
      if (data.unread) setUnread(data.unread);
      setConnection('connected');
      void seedMessages(); // fill any gap after reconnect/restart
    });

    es.addEventListener('message', (ev) => {
      const msg: Message = JSON.parse((ev as MessageEvent).data);
      insertLive(msg);
      maybeNotify(msg, channelsRef.current[msg.channel_id], settingsRef.current, () =>
        setFocusChannel(msg.channel_id),
      );
    });

    es.addEventListener('channel_backfilled', (ev) => {
      const { channel_id } = JSON.parse((ev as MessageEvent).data);
      api
        .getMessages({ channels: [channel_id], limit: 100 })
        .then((msgs) => {
          setByChannel((prev) => ({
            ...prev,
            [channel_id]: mergeSorted(prev[channel_id] ?? [], msgs),
          }));
          setFeed((prev) => mergeSorted(prev, msgs));
        })
        .catch(() => undefined);
      api.getUnread().then(setUnread).catch(() => undefined);
    });

    es.addEventListener('channel_inaccessible', (ev) => {
      const { channel_id } = JSON.parse((ev as MessageEvent).data);
      setChannelById((prev) => {
        const ch = prev[channel_id];
        return ch ? { ...prev, [channel_id]: { ...ch, accessible: false } } : prev;
      });
      setGuilds((prev) =>
        prev.map((g) => ({
          ...g,
          channels: g.channels.map((c) =>
            c.id === channel_id ? { ...c, accessible: false } : c,
          ),
        })),
      );
    });

    es.addEventListener('poll_status', (ev) => {
      const data: PollStatus = JSON.parse((ev as MessageEvent).data);
      setPollStatus(data);
      if (data.token_status) setTokenStatus(data.token_status);
    });

    es.addEventListener('auth_error', () => setTokenStatus('invalid'));

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshDiscovery = useCallback(async () => {
    applyGuilds(await api.refreshDiscovery());
  }, [applyGuilds]);

  const updateChannel = useCallback(async (id: string, patch: ChannelPatch) => {
    const updated = await api.updateChannel(id, patch);
    setChannelById((prev) => ({ ...prev, [id]: updated }));
    setGuilds((prev) =>
      prev.map((g) => ({
        ...g,
        channels: g.channels.map((c) => (c.id === id ? updated : c)),
      })),
    );
    if (patch.tracked === false) {
      setUnread((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, []);

  const reorderColumns = useCallback(async (orderedIds: string[]) => {
    setChannelById((prev) => {
      const next = { ...prev };
      orderedIds.forEach((cid, idx) => {
        if (next[cid]) next[cid] = { ...next[cid], column_order: idx };
      });
      return next;
    });
    await api.setChannelOrder(orderedIds);
  }, []);

  const saveSettings = useCallback(
    async (patch: Partial<Omit<Settings, 'token_status'>>) => {
      setSettings(await api.putSettings(patch));
    },
    [],
  );

  const markRead = useCallback((channelId: string) => {
    setUnread((prev) => ({ ...prev, [channelId]: 0 }));
    api
      .markRead(channelId)
      .then((res) => setUnread(res.unread))
      .catch(() => undefined);
  }, []);

  const markAllRead = useCallback(() => {
    setUnread({});
    api
      .markAllRead()
      .then((res) => setUnread(res.unread))
      .catch(() => undefined);
  }, []);

  const loadOlder = useCallback(
    async (channelId: string) => {
      const list = byChannel[channelId] ?? [];
      const oldest = list[list.length - 1];
      const msgs = await api.getMessages({
        channels: [channelId],
        before: oldest?.id,
        limit: 50,
      });
      setByChannel((prev) => ({
        ...prev,
        [channelId]: mergeSorted(prev[channelId] ?? [], msgs),
      }));
      return msgs.length;
    },
    [byChannel],
  );

  const loadOlderFeed = useCallback(async () => {
    const oldest = feed[feed.length - 1];
    const msgs = await api.getMessages({ before: oldest?.id, limit: 50 });
    setFeed((prev) => mergeSorted(prev, msgs));
    return msgs.length;
  }, [feed]);

  return {
    connection,
    tokenStatus,
    guilds,
    channelById,
    feed,
    byChannel,
    unread,
    pollStatus,
    settings,
    setSettings,
    focusChannel,
    setFocusChannel,
    refreshDiscovery,
    reloadGuilds: loadGuilds,
    updateChannel,
    reorderColumns,
    saveSettings,
    markRead,
    markAllRead,
    loadOlder,
    loadOlderFeed,
  };
}
