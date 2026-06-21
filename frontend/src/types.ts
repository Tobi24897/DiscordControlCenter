export interface Attachment {
  id?: string;
  filename?: string;
  size?: number;
  content_type?: string;
  url?: string;
  width?: number;
  height?: number;
}

export interface EmbedField {
  name: string;
  value: string;
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  author?: { name?: string };
  footer?: { text?: string };
  image?: { url?: string };
  thumbnail?: { url?: string };
  fields?: EmbedField[];
}

export interface Message {
  id: string;
  channel_id: string;
  guild_id: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  attachments: Attachment[];
  embeds: Embed[];
  referenced_message_id: string | null;
  message_type: number;
  permalink?: string | null;
  source?: string;
  channel_name?: string | null;
  guild_name?: string | null;
}

export interface Channel {
  id: string;
  guild_id: string;
  name: string;
  topic: string | null;
  position: number | null;
  tracked: boolean;
  notify: boolean;
  notify_keywords_only: boolean;
  column_order: number | null;
  last_read_message_id: string | null;
  accessible: boolean;
  source: string;
  nitter_username?: string | null;
  feed_url?: string | null;
  unread: number;
}

export interface NewsPreset {
  name: string;
  url: string;
}

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  channels: Channel[];
}

export interface Settings {
  poll_interval: number;
  sound_enabled: boolean;
  notify_keywords: string[];
  notify_only_unfocused: boolean;
  lookback_days: number;
  nitter_instance: string;
  nitter_fallbacks: string[];
  token_status: string;
  discord_user?: string | null;
}

export interface DmUser {
  id: string;
  username: string | null;
  global_name: string | null;
  avatar: string | null;
}

export interface DmChannel {
  id: string;
  type: number;
  is_group: boolean;
  name: string | null;
  icon: string | null;
  last_message_id: string | null;
  recipients: DmUser[];
}

export interface Friend {
  type: number; // 1 = friend, 3 = incoming request, 4 = outgoing request
  user: DmUser;
}

export interface PollStatus {
  ts: string;
  cycle: number;
  channels_polled: number;
  channels_skipped: number;
  new_messages: number;
  errors: number;
  token_status: string;
}

export interface HealthInfo {
  status: string;
  token_status: string;
  discord_user: string | null;
  tracked_channels: number;
  effective_min_cycle_s: number;
  poller: Partial<PollStatus>;
  message_count: number;
  nitter_instance_active?: string | null;
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';
