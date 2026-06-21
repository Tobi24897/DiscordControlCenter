import type { Channel, Message, Settings } from '../types';

let audioCtx: AudioContext | null = null;
let lastPing = 0;

export function primeAudio(): void {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return;
    }
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
}

// Autoplay policy: unlock the AudioContext on the first user gesture.
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => primeAudio(), { once: true });
}

/** Short synthesized ping (~300ms, 880→1320 Hz) — no audio asset needed. */
export function playPing(force = false): void {
  const now = Date.now();
  if (!force && now - lastPing < 2000) return;
  lastPing = now;
  primeAudio();
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.32);
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}

const CASHTAG_RE = /\$[A-Za-z]{1,6}(?![A-Za-z])/;

/** Keyword match over content AND embed titles/descriptions (alerts often live in embeds). */
export function keywordMatch(msg: Message, keywords: string[]): boolean {
  const parts: string[] = [msg.content];
  for (const e of msg.embeds ?? []) {
    if (e.title) parts.push(e.title);
    if (e.description) parts.push(e.description);
  }
  const text = parts.join('\n');
  const lower = text.toLowerCase();
  return keywords.some((kw) => {
    if (!kw) return false;
    if (kw === '$') return CASHTAG_RE.test(text); // "$" = any cashtag
    return lower.includes(kw.toLowerCase());
  });
}

export function maybeNotify(
  msg: Message,
  channel: Channel | undefined,
  settings: Settings | null,
  onClick: () => void,
): void {
  if (!channel || !channel.notify || !settings) return;
  if (notificationPermission() !== 'granted') return;
  if (channel.notify_keywords_only && !keywordMatch(msg, settings.notify_keywords ?? [])) return;
  if (settings.notify_only_unfocused && document.hasFocus()) return;

  const guildName = msg.guild_name;
  const title = `#${channel.name}${guildName ? ` · ${guildName}` : ''}`;
  const bodyText =
    msg.content || msg.embeds?.[0]?.title || msg.embeds?.[0]?.description || '(attachment)';
  const body = `${msg.author_name}: ${bodyText}`.slice(0, 140);
  try {
    const n = new Notification(title, { body, tag: msg.id, silent: true });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    // Notification construction can throw on some platforms — sound still plays.
  }
  if (settings.sound_enabled) playPing();
}
