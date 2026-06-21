/** Snowflake-safe helpers (IDs are strings; numbers would lose precision past 2^53). */

export function idGreater(a: string, b: string): boolean {
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

/** Comparator for newest-first ordering. */
export function cmpIdDesc(a: string, b: string): number {
  if (a === b) return 0;
  return idGreater(a, b) ? -1 : 1;
}

export function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export function avatarUrl(authorId: string, hash: string | null): string | null {
  return hash ? `https://cdn.discordapp.com/avatars/${authorId}/${hash}.webp?size=64` : null;
}

export function guildIconUrl(guildId: string, hash: string | null): string | null {
  return hash ? `https://cdn.discordapp.com/icons/${guildId}/${hash}.webp?size=64` : null;
}

/** Cap a Discord-hosted image to a thumbnail size so the browser decodes a small
 *  bitmap instead of the full-res source (huge memory saver for chart images).
 *  Non-Discord URLs are returned unchanged. */
export function discordThumb(url: string | undefined, width = 480): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.host !== 'cdn.discordapp.com' && u.host !== 'media.discordapp.net') return url;
    u.host = 'media.discordapp.net';
    u.searchParams.set('width', String(width));
    u.searchParams.set('height', String(width));
    return u.toString();
  } catch {
    return url;
  }
}

export function formatBytes(n?: number): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const FALLBACK_COLORS = ['#5865f2', '#3ba55c', '#faa61a', '#eb459e', '#ed4245', '#9b59b6'];

export function colorForId(id: string): string {
  let sum = 0;
  for (let i = Math.max(0, id.length - 4); i < id.length; i++) sum += id.charCodeAt(i);
  return FALLBACK_COLORS[sum % FALLBACK_COLORS.length];
}
