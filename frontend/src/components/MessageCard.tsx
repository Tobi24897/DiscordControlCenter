import { CornerUpLeft, FileDown } from 'lucide-react';
import { memo } from 'react';
import { renderContent } from '../lib/markdown';
import {
  avatarUrl,
  colorForId,
  discordThumb,
  formatAbsolute,
  formatBytes,
  formatRelative,
} from '../lib/util';
import type { Attachment, Embed, Message } from '../types';

function AttachmentItem({
  att,
  thumbSrc,
  fullHref,
}: {
  att: Attachment;
  thumbSrc: string;
  fullHref: string;
}) {
  if (att.content_type?.startsWith('image/')) {
    return (
      // <img> loads a size-capped thumbnail; the link opens the full image.
      <a href={fullHref} target="_blank" rel="noreferrer">
        <img
          src={thumbSrc}
          alt={att.filename ?? 'image'}
          loading="lazy"
          decoding="async"
          className="max-h-64 max-w-full rounded border border-border-subtle"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </a>
    );
  }
  return (
    <a
      href={fullHref}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 rounded border border-border-subtle bg-surface-input px-2 py-1 text-xs text-gray-300 hover:border-[#3a3d4a]"
    >
      <FileDown size={12} />
      <span className="max-w-[180px] truncate">{att.filename ?? 'file'}</span>
      {att.size ? <span className="text-gray-500">{formatBytes(att.size)}</span> : null}
    </a>
  );
}

function EmbedCard({ embed }: { embed: Embed }) {
  const color =
    typeof embed.color === 'number' && embed.color > 0
      ? `#${embed.color.toString(16).padStart(6, '0')}`
      : '#2a2d3a';
  const image = embed.image?.url ?? embed.thumbnail?.url;
  return (
    <div
      className="mt-1.5 rounded border border-border-subtle bg-surface-card p-2 text-sm"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      {embed.author?.name && (
        <div className="text-[11px] font-semibold text-gray-400">{embed.author.name}</div>
      )}
      {embed.title &&
        (embed.url ? (
          <a
            href={embed.url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-blue-400 hover:underline"
          >
            {renderContent(embed.title)}
          </a>
        ) : (
          <div className="font-semibold text-gray-100">{renderContent(embed.title)}</div>
        ))}
      {embed.description && (
        <div className="mt-0.5 line-clamp-[8] whitespace-pre-wrap break-words text-[13px] text-gray-300">
          {renderContent(embed.description)}
        </div>
      )}
      {embed.fields && embed.fields.length > 0 && (
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {embed.fields.map((f, i) => (
            <div key={i} className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {f.name}
              </div>
              <div className="whitespace-pre-wrap break-words text-xs text-gray-300">
                {renderContent(f.value)}
              </div>
            </div>
          ))}
        </div>
      )}
      {image && (
        <img
          src={discordThumb(image, 480)}
          alt=""
          loading="lazy"
          decoding="async"
          className="mt-1.5 max-h-64 max-w-full rounded"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
      {embed.footer?.text && (
        <div className="mt-1 text-[10px] text-gray-500">{embed.footer.text}</div>
      )}
    </div>
  );
}

interface Props {
  msg: Message;
  showChannel?: boolean;
  /** DM messages aren't stored in the DB, so their images use the raw CDN url
   *  instead of the /api/attachments proxy. */
  useProxy?: boolean;
}

function MessageCard({ msg, showChannel, useProxy = true }: Props) {
  // Nitter messages carry a full http avatar url; Discord ones carry a hash.
  const av =
    msg.author_avatar && /^https?:\/\//.test(msg.author_avatar)
      ? msg.author_avatar
      : avatarUrl(msg.author_id, msg.author_avatar);
  return (
    <div className="rounded-md border border-border-subtle bg-surface-card p-2.5">
      <div className="flex items-center gap-2">
        {av ? (
          <img src={av} alt="" loading="lazy" className="h-6 w-6 shrink-0 rounded-full" />
        ) : (
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ backgroundColor: colorForId(msg.author_id) }}
          >
            {(msg.author_name || '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <span className="truncate text-sm font-semibold text-gray-100">{msg.author_name}</span>
        {showChannel && msg.channel_name && (
          <span className="truncate rounded bg-surface-input px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
            #{msg.channel_name}
            {msg.guild_name ? ` · ${msg.guild_name}` : ''}
          </span>
        )}
        {msg.permalink ? (
          <a
            href={msg.permalink}
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0 text-xs text-gray-500 hover:text-blue-400 hover:underline"
            title={`Open on X · ${formatAbsolute(msg.timestamp)}`}
          >
            {formatRelative(msg.timestamp)}
          </a>
        ) : (
          <span
            className="ml-auto shrink-0 text-xs text-gray-500"
            title={formatAbsolute(msg.timestamp)}
          >
            {formatRelative(msg.timestamp)}
          </span>
        )}
      </div>

      {msg.referenced_message_id && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-500">
          <CornerUpLeft size={11} /> reply
        </div>
      )}

      {msg.content && (
        <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug text-gray-200">
          {renderContent(msg.content)}
        </div>
      )}

      {msg.attachments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {msg.attachments.map((att, i) => {
            const proxy = `/api/attachments/${msg.id}/${i}`;
            return (
              <AttachmentItem
                key={i}
                att={att}
                thumbSrc={useProxy ? `${proxy}?w=480` : discordThumb(att.url, 480) ?? ''}
                fullHref={useProxy ? proxy : att.url ?? ''}
              />
            );
          })}
        </div>
      )}

      {msg.embeds.map((embed, i) => (
        <EmbedCard key={i} embed={embed} />
      ))}

      {msg.edited_timestamp && <span className="text-[10px] text-gray-600">(edited)</span>}
    </div>
  );
}

// Memoized: message objects are immutable by id, so unchanged cards skip
// re-rendering (and re-decoding their images) when new messages stream in.
export default memo(MessageCard);
