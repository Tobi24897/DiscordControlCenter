import React, { useState } from 'react';

/** Discord markdown subset + cashtag → TradingView links + emoji/timestamp cleanup. */

function tradingViewOpenUrl(symbol: string): string {
  const params = new URLSearchParams();
  params.set('symbol', symbol.toUpperCase());
  return `https://www.tradingview.com/chart/?${params.toString()}`;
}

const INLINE_SOURCE = [
  '(`[^`\\n]+`)', // 1 inline code
  '(\\*\\*[^*]+\\*\\*)', // 2 bold
  '(__[^_]+__)', // 3 underline
  '(\\*[^*\\n]+\\*)', // 4 italic *
  '(\\b_[^_\\n]+_\\b)', // 5 italic _
  '(~~[^~]+~~)', // 6 strikethrough
  '(\\|\\|[^|]+\\|\\|)', // 7 spoiler
  '(<a?:\\w+:\\d+>)', // 8 custom emoji
  '(<t:\\d+(?::[tTdDfFR])?>)', // 9 timestamp
  '(https?:\\/\\/[^\\s<>]+)', // 10 url
  '(\\$[A-Za-z]{1,6}(?![A-Za-z]))', // 11 cashtag
].join('|');

function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed(true)}
      title={revealed ? undefined : 'Click to reveal'}
      className={
        revealed
          ? 'rounded bg-surface-input px-1'
          : 'cursor-pointer select-none rounded bg-surface-input px-1 text-transparent'
      }
    >
      {children}
    </span>
  );
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  if (!text) return [];
  const nodes: React.ReactNode[] = [];
  const re = new RegExp(INLINE_SOURCE, 'g');
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}.${k++}`;
    if (m[1]) {
      nodes.push(
        <code key={key} className="rounded bg-surface-input px-1 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      nodes.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    } else if (m[3]) {
      nodes.push(<u key={key}>{renderInline(tok.slice(2, -2), key)}</u>);
    } else if (m[4]) {
      nodes.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    } else if (m[5]) {
      nodes.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    } else if (m[6]) {
      nodes.push(<s key={key}>{renderInline(tok.slice(2, -2), key)}</s>);
    } else if (m[7]) {
      nodes.push(<Spoiler key={key}>{renderInline(tok.slice(2, -2), key)}</Spoiler>);
    } else if (m[8]) {
      const em = tok.match(/^<(a?):(\w+):(\d+)>$/);
      if (em) {
        nodes.push(
          <img
            key={key}
            src={`https://cdn.discordapp.com/emojis/${em[3]}.${em[1] ? 'gif' : 'webp'}?size=24`}
            alt={`:${em[2]}:`}
            title={`:${em[2]}:`}
            loading="lazy"
            className="inline h-5 w-5 align-text-bottom"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />,
        );
      }
    } else if (m[9]) {
      const ts = tok.match(/^<t:(\d+)/);
      if (ts) {
        nodes.push(
          <span key={key} className="rounded bg-surface-input px-1 text-[0.9em]">
            {new Date(Number(ts[1]) * 1000).toLocaleString()}
          </span>,
        );
      }
    } else if (m[10]) {
      nodes.push(
        <a
          key={key}
          href={tok}
          target="_blank"
          rel="noreferrer"
          className="break-all text-blue-400 hover:underline"
        >
          {tok}
        </a>,
      );
    } else if (m[11]) {
      nodes.push(
        <a
          key={key}
          href={tradingViewOpenUrl(tok.slice(1))}
          target="_blank"
          rel="noreferrer"
          title={`Open ${tok.slice(1).toUpperCase()} on TradingView`}
          className="font-mono font-semibold text-blue-300 hover:text-blue-200"
        >
          {tok.toUpperCase()}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderLines(lines: string[], keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push('\n');
    out.push(<React.Fragment key={`${keyPrefix}.l${i}`}>{renderInline(line, `${keyPrefix}.l${i}`)}</React.Fragment>);
  });
  return out;
}

function renderTextBlock(text: string, keyPrefix: string): React.ReactNode[] {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let plain: string[] = [];
  let quote: string[] = [];
  let k = 0;

  const flushPlain = () => {
    if (plain.length) {
      out.push(
        <React.Fragment key={`${keyPrefix}.p${k++}`}>
          {renderLines(plain, `${keyPrefix}.p${k}`)}
        </React.Fragment>,
      );
      plain = [];
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(
        <blockquote
          key={`${keyPrefix}.q${k++}`}
          className="my-0.5 border-l-2 border-border-subtle pl-2 text-gray-400"
        >
          {renderLines(quote, `${keyPrefix}.q${k}`)}
        </blockquote>,
      );
      quote = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith('> ') || line === '>') {
      flushPlain();
      quote.push(line === '>' ? '' : line.slice(2));
    } else {
      flushQuote();
      plain.push(line);
    }
  }
  flushPlain();
  flushQuote();
  return out;
}

const FENCE_RE = /```(?:[a-zA-Z0-9+#-]*\n)?([\s\S]*?)```/g;

export function renderContent(content: string): React.ReactNode {
  if (!content) return null;
  const nodes: React.ReactNode[] = [];
  const re = new RegExp(FENCE_RE.source, 'g');
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      nodes.push(
        <React.Fragment key={`t${k++}`}>
          {renderTextBlock(content.slice(last, m.index), `t${k}`)}
        </React.Fragment>,
      );
    }
    nodes.push(
      <pre
        key={`c${k++}`}
        className="my-1 overflow-x-auto rounded bg-surface-input p-2 font-mono text-xs"
      >
        {m[1].replace(/\n$/, '')}
      </pre>,
    );
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    nodes.push(
      <React.Fragment key={`t${k++}`}>
        {renderTextBlock(content.slice(last), `t${k}`)}
      </React.Fragment>,
    );
  }
  return <>{nodes}</>;
}
