import type {
  Channel,
  DmChannel,
  Friend,
  Guild,
  HealthInfo,
  Message,
  NewsPreset,
  Settings,
} from '../types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData bodies must NOT get a JSON content-type (the browser sets the
  // multipart boundary itself).
  const isForm = init?.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export interface ChannelPatch {
  tracked?: boolean;
  notify?: boolean;
  notify_keywords_only?: boolean;
}

export interface MessageQuery {
  channels?: string[];
  search?: string;
  before?: string;
  limit?: number;
}

export const api = {
  health: () => req<HealthInfo>('/api/health'),

  getSettings: () => req<Settings>('/api/settings'),

  putSettings: (patch: Partial<Omit<Settings, 'token_status'>>) =>
    req<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  refreshDiscovery: () => req<Guild[]>('/api/discovery/refresh', { method: 'POST' }),

  getGuilds: () => req<Guild[]>('/api/guilds'),

  updateChannel: (id: string, patch: ChannelPatch) =>
    req<Channel>(`/api/channels/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),

  setChannelOrder: (orderedIds: string[]) =>
    req<{ ok: boolean }>('/api/channels/order', {
      method: 'PUT',
      body: JSON.stringify({ ordered_ids: orderedIds }),
    }),

  getMessages: (opts: MessageQuery = {}) => {
    const p = new URLSearchParams();
    if (opts.channels?.length) p.set('channels', opts.channels.join(','));
    if (opts.search) p.set('search', opts.search);
    if (opts.before) p.set('before', opts.before);
    if (opts.limit) p.set('limit', String(opts.limit));
    return req<Message[]>(`/api/messages?${p.toString()}`);
  },

  markRead: (channelId: string, messageId?: string) =>
    req<{ unread: Record<string, number> }>(`/api/channels/${channelId}/read`, {
      method: 'POST',
      body: JSON.stringify(messageId ? { message_id: messageId } : {}),
    }),

  markAllRead: () =>
    req<{ unread: Record<string, number> }>('/api/read-all', { method: 'POST' }),

  getUnread: () => req<Record<string, number>>('/api/unread'),

  // --- auth ---
  importLocalToken: () =>
    req<{ token_status: string; discord_user: string | null }>('/api/auth/import-local', {
      method: 'POST',
    }),

  setToken: (token: string) =>
    req<{ token_status: string; discord_user: string | null }>('/api/auth/token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  // --- DMs ---
  getDms: () => req<DmChannel[]>('/api/dms'),

  getFriends: () => req<Friend[]>('/api/friends'),

  getDmMessages: (channelId: string, before?: string) => {
    const p = new URLSearchParams();
    if (before) p.set('before', before);
    return req<Message[]>(`/api/dms/${channelId}/messages?${p.toString()}`);
  },

  sendDm: (channelId: string, content: string, replyTo?: string, files?: File[]) => {
    const fd = new FormData();
    fd.append('content', content);
    if (replyTo) fd.append('reply_to', replyTo);
    (files ?? []).forEach((f) => fd.append('files', f));
    return req<Message>(`/api/dms/${channelId}/messages`, { method: 'POST', body: fd });
  },

  openDm: (userId: string) =>
    req<DmChannel>('/api/dms/open', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),

  // --- Nitter (Twitter/X mirror) profiles ---
  addNitterProfile: (username: string, instance?: string) =>
    req<Channel>('/api/nitter/profiles', {
      method: 'POST',
      body: JSON.stringify({ username, instance: instance ?? null }),
    }),

  deleteNitterProfile: (channelId: string) =>
    req<{ ok: boolean }>(`/api/nitter/profiles/${channelId}`, { method: 'DELETE' }),

  // --- News (generic RSS) feeds ---
  getNewsPresets: () => req<NewsPreset[]>('/api/news/presets'),

  addNewsFeed: (url: string, name?: string) =>
    req<Channel>('/api/news/feeds', {
      method: 'POST',
      body: JSON.stringify({ url, name: name ?? null }),
    }),

  deleteNewsFeed: (channelId: string) =>
    req<{ ok: boolean }>(`/api/news/feeds/${channelId}`, { method: 'DELETE' }),
};
