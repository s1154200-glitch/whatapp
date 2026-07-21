"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ChatManifest, ChatMessage, SearchEntry } from "./chat-types";

type Sheet = "date" | "info" | null;
type PendingScroll = { mode: "bottom" } | { mode: "prepend"; height: number; top: number } | { mode: "focus"; id: number };

const dateFormatter = new Intl.DateTimeFormat("zh-HK", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
  timeZone: "UTC",
});

const monthFormatter = new Intl.DateTimeFormat("en-HK", {
  year: "numeric",
  month: "long",
  timeZone: "UTC",
});

export default function ChatViewer() {
  const [manifest, setManifest] = useState<ChatManifest | null>(null);
  const [monthData, setMonthData] = useState<Record<string, ChatMessage[]>>({});
  const [loadedKeys, setLoadedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState<SearchEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [mediaPreview, setMediaPreview] = useState<{ src: string; alt: string } | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef<PendingScroll | null>(null);
  const deferredQuery = useDeferredValue(query.trim());

  useEffect(() => {
    let cancelled = false;
    async function start() {
      const manifestResponse = await fetch(archiveUrl("data/manifest.json"));
      if (!manifestResponse.ok) throw new Error("Could not open the chat archive.");
      const nextManifest = (await manifestResponse.json()) as ChatManifest;
      const lastMonth = nextManifest.months.at(-1);
      if (!lastMonth) throw new Error("The archive has no messages.");
      const messages = await fetchMonth(lastMonth.file);
      if (cancelled) return;
      setManifest(nextManifest);
      setMonthData({ [lastMonth.key]: messages });
      setLoadedKeys([lastMonth.key]);
      setSelectedDate(nextManifest.lastDate);
      pendingScrollRef.current = { mode: "bottom" };
      setLoading(false);
    }
    start().catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const messages = useMemo(
    () => loadedKeys.flatMap((key) => monthData[key] || []),
    [loadedKeys, monthData],
  );

  useEffect(() => {
    const pending = pendingScrollRef.current;
    const scroller = scrollerRef.current;
    if (!pending || !scroller || !messages.length) return;
    const frame = requestAnimationFrame(() => {
      if (pending.mode === "bottom") {
        scroller.scrollTop = scroller.scrollHeight;
      } else if (pending.mode === "prepend") {
        scroller.scrollTop = scroller.scrollHeight - pending.height + pending.top;
      } else {
        document.getElementById(`message-${pending.id}`)?.scrollIntoView({ block: "center" });
        setFocusedId(pending.id);
        window.setTimeout(() => setFocusedId(null), 1900);
      }
      pendingScrollRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  const currentFirstMonthIndex = manifest
    ? manifest.months.findIndex((month) => month.key === loadedKeys[0])
    : -1;
  const hasOlder = currentFirstMonthIndex > 0;

  const searchResults = useMemo(() => {
    if (!searchIndex || !deferredQuery) return [];
    const needle = normalizeSearch(deferredQuery);
    const results: SearchEntry[] = [];
    for (let index = searchIndex.length - 1; index >= 0 && results.length < 80; index -= 1) {
      const entry = searchIndex[index];
      if (normalizeSearch(entry.text).includes(needle)) results.push(entry);
    }
    return results;
  }, [deferredQuery, searchIndex]);

  async function loadOlder() {
    if (!manifest || !hasOlder || loadingOlder) return;
    const previousMonth = manifest.months[currentFirstMonthIndex - 1];
    const scroller = scrollerRef.current;
    setLoadingOlder(true);
    const oldHeight = scroller?.scrollHeight || 0;
    const oldTop = scroller?.scrollTop || 0;
    const olderMessages = monthData[previousMonth.key] || (await fetchMonth(previousMonth.file));
    pendingScrollRef.current = { mode: "prepend", height: oldHeight, top: oldTop };
    setMonthData((current) => ({ ...current, [previousMonth.key]: olderMessages }));
    setLoadedKeys((current) => [previousMonth.key, ...current]);
    setLoadingOlder(false);
  }

  async function openSearch() {
    setSearchOpen(true);
    setSheet(null);
    if (searchIndex || searchLoading) return;
    setSearchLoading(true);
    const response = await fetch(archiveUrl("data/search.json"));
    const entries = (await response.json()) as SearchEntry[];
    setSearchIndex(entries);
    setSearchLoading(false);
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
  }

  async function jumpTo(monthKey: string, id: number) {
    if (!manifest) return;
    const month = manifest.months.find((item) => item.key === monthKey);
    if (!month) return;
    const targetMessages = monthData[month.key] || (await fetchMonth(month.file));
    pendingScrollRef.current = { mode: "focus", id };
    setMonthData((current) => ({ ...current, [month.key]: targetMessages }));
    setLoadedKeys([month.key]);
    setSelectedDate(targetMessages.find((message) => message.id === id)?.date || month.firstDate);
    setSearchOpen(false);
    setQuery("");
    setSheet(null);
  }

  async function jumpToDate() {
    if (!manifest || !selectedDate) return;
    const exact = manifest.days.find((day) => day.date === selectedDate);
    const nearest = exact || manifest.days.find((day) => day.date >= selectedDate) || manifest.days.at(-1);
    if (nearest) await jumpTo(nearest.month, nearest.firstId);
  }

  function scrollToBottom() {
    const scroller = scrollerRef.current;
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }

  function onScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setIsNearBottom(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 260);
  }

  return (
    <main className="viewer-stage">
      <section className="phone-shell" aria-label="WhatsApp chat archive">
        <header className="chat-header">
          {searchOpen ? (
            <>
              <button className="header-action back-only" onClick={closeSearch} aria-label="Close search">
                <span className="chevron" />
              </button>
              <label className="search-field">
                <span className="search-glyph" aria-hidden="true" />
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search messages"
                  aria-label="Search messages"
                />
              </label>
              <span className="result-count" aria-live="polite">
                {deferredQuery ? searchResults.length : ""}
              </span>
            </>
          ) : (
            <>
              <button className="header-action back-button" aria-label="Back to chats">
                <span className="chevron" />
                <span className="back-copy">Chats</span>
              </button>
              <div className="avatar" aria-hidden="true">👩</div>
              <button className="contact-block" onClick={() => setSheet("info")} aria-label="Open archive details">
                <strong>{manifest?.title || "WhatsApp Chat"}</strong>
                <span>{manifest ? `${formatNumber(manifest.messageCount)} messages` : "Opening archive…"}</span>
              </button>
              <button className="header-action search-button" onClick={openSearch} aria-label="Search chat">
                <span className="search-glyph" aria-hidden="true" />
              </button>
              <button className="header-action menu-button" onClick={() => setSheet("date")} aria-label="Jump to a date">
                <span className="calendar-glyph" aria-hidden="true"><i /></span>
              </button>
            </>
          )}
        </header>

        {searchOpen && (
          <div className="search-panel">
            {searchLoading && <p className="search-state">Preparing all messages…</p>}
            {!searchLoading && !deferredQuery && <p className="search-state">Search across the full archive</p>}
            {!searchLoading && deferredQuery && !searchResults.length && <p className="search-state">No messages found</p>}
            {searchResults.map((result) => (
              <button className="search-result" key={result.id} onClick={() => jumpTo(result.month, result.id)}>
                <span className="result-avatar">{result.sender === manifest?.selfName ? "K" : "👩"}</span>
                <span className="result-copy">
                  <span className="result-meta">
                    <strong>{result.sender || "WhatsApp"}</strong>
                    <time>{formatCompactDate(result.date)}</time>
                  </span>
                  <span className="result-text">{highlight(result.text, deferredQuery)}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="chat-scroller" ref={scrollerRef} onScroll={onScroll}>
          <div className="wallpaper" aria-hidden="true" />
          {loading && <LoadingChat />}
          {!loading && manifest && (
            <div className="message-list">
              <div className="archive-notice">
                <span className="lock-glyph" aria-hidden="true">▣</span>
                Messages and calls are end-to-end encrypted in the original chat. This copy stays read-only.
              </div>
              {hasOlder ? (
                <button className="load-older" onClick={loadOlder} disabled={loadingOlder}>
                  {loadingOlder ? "Loading…" : `Load ${formatMonth(manifest.months[currentFirstMonthIndex - 1].key)}`}
                </button>
              ) : (
                <div className="archive-start">Beginning of the exported chat</div>
              )}
              {messages.map((message, index) => {
                const previous = messages[index - 1];
                const next = messages[index + 1];
                const startsDay = !previous || previous.date !== message.date;
                const sameAsPrevious = isGrouped(previous, message);
                const sameAsNext = isGrouped(message, next);
                return (
                  <div className="message-fragment" key={message.id}>
                    {startsDay && <div className="day-chip"><span>{formatDay(message.date)}</span></div>}
                    <MessageBubble
                      message={message}
                      mine={message.sender === manifest.selfName}
                      first={!sameAsPrevious}
                      last={!sameAsNext}
                      focused={focusedId === message.id}
                      onPreview={setMediaPreview}
                    />
                  </div>
                );
              })}
              <div className="archive-end">End of this exported archive</div>
            </div>
          )}
        </div>

        {!isNearBottom && !searchOpen && (
          <button className="jump-bottom" onClick={scrollToBottom} aria-label="Jump to latest loaded message">
            <span className="down-chevron" />
          </button>
        )}

        <footer className="archive-composer">
          <button className="composer-plus" aria-label="Attachments are read-only" disabled>+</button>
          <div className="composer-field">
            <span className="smile" aria-hidden="true">☺</span>
            <span>Read-only chat archive</span>
          </div>
          <button className="composer-mic" aria-label="Voice recording unavailable" disabled>
            <span className="mic-glyph" aria-hidden="true"><i /></span>
          </button>
        </footer>

        {sheet === "date" && manifest && (
          <ModalSheet title="Jump to date" onClose={() => setSheet(null)}>
            <p className="sheet-description">Choose a day. If there were no messages, the next active day will open.</p>
            <label className="date-picker">
              <span>Date</span>
              <input
                type="date"
                min={manifest.firstDate}
                max={manifest.lastDate}
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
            </label>
            <button className="primary-button" onClick={jumpToDate}>Show messages</button>
            <div className="month-grid" aria-label="Archive months">
              {manifest.months.map((month) => (
                <button key={month.key} onClick={() => jumpTo(month.key, month.firstId)}>
                  <strong>{formatMonth(month.key)}</strong>
                  <span>{formatNumber(month.count)} messages</span>
                </button>
              ))}
            </div>
          </ModalSheet>
        )}

        {sheet === "info" && manifest && (
          <ModalSheet title="Chat details" onClose={() => setSheet(null)}>
            <div className="large-avatar" aria-hidden="true">👩</div>
            <h2 className="sheet-contact">{manifest.title}</h2>
            <p className="sheet-range">{formatCompactDate(manifest.firstDate)} – {formatCompactDate(manifest.lastDate)}</p>
            <div className="stat-grid">
              <div><strong>{formatNumber(manifest.messageCount)}</strong><span>Messages</span></div>
              <div><strong>{formatNumber(manifest.attachmentCount)}</strong><span>Attachments</span></div>
              <div><strong>{manifest.months.length}</strong><span>Months</span></div>
            </div>
            <div className="detail-list">
              <div><span>Photos</span><strong>{formatNumber(manifest.attachmentCounts.photo)}</strong></div>
              <div><span>Voice notes</span><strong>{formatNumber(manifest.attachmentCounts.audio)}</strong></div>
              <div><span>Stickers</span><strong>{formatNumber(manifest.attachmentCounts.sticker)}</strong></div>
              <div><span>Videos & documents</span><strong>{formatNumber(manifest.attachmentCounts.video + manifest.attachmentCounts.document)}</strong></div>
            </div>
          </ModalSheet>
        )}

        {mediaPreview && (
          <div className="media-lightbox" role="dialog" aria-modal="true" aria-label="Image preview">
            <button className="lightbox-close" onClick={() => setMediaPreview(null)} aria-label="Close image preview">×</button>
            <img src={mediaPreview.src} alt={mediaPreview.alt} />
          </div>
        )}
      </section>
    </main>
  );
}

function MessageBubble({
  message,
  mine,
  first,
  last,
  focused,
  onPreview,
}: {
  message: ChatMessage;
  mine: boolean;
  first: boolean;
  last: boolean;
  focused: boolean;
  onPreview: (preview: { src: string; alt: string }) => void;
}) {
  if (!message.sender) return null;
  const attachment = message.attachment;
  const source = attachment ? archiveUrl(`media/${encodeURIComponent(attachment.filename)}`) : "";
  const stickerOnly = attachment?.kind === "sticker" && !message.text;

  return (
    <article
      id={`message-${message.id}`}
      className={[
        "message-row",
        mine ? "mine" : "theirs",
        first ? "group-first" : "",
        last ? "group-last" : "",
        focused ? "message-focused" : "",
        stickerOnly ? "sticker-row" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="message-bubble">
        {first && <span className="bubble-tail" aria-hidden="true" />}
        {attachment && (
          <MediaAttachment
            kind={attachment.kind}
            source={source}
            filename={attachment.filename}
            width={attachment.width}
            height={attachment.height}
            mine={mine}
            onPreview={() => onPreview({ src: source, alt: `Attachment from ${message.sender}` })}
          />
        )}
        {message.text && <p className="message-text">{linkify(message.text)}</p>}
        <span className="message-meta">
          <time dateTime={new Date(message.epoch).toISOString()}>{message.time}</time>
          {mine && <span className="checks" aria-label="Delivered and read">✓✓</span>}
        </span>
      </div>
    </article>
  );
}

function MediaAttachment({
  kind,
  source,
  filename,
  width,
  height,
  mine,
  onPreview,
}: {
  kind: string;
  source: string;
  filename: string;
  width?: number;
  height?: number;
  mine: boolean;
  onPreview: () => void;
}) {
  if (kind === "photo" || kind === "sticker") {
    return (
      <button className={`image-button ${kind}`} onClick={onPreview} aria-label={`Open ${kind}`}>
        <img src={source} alt="" width={width} height={height} loading="lazy" decoding="async" />
      </button>
    );
  }
  if (kind === "video") {
    return <video className="chat-video" src={source} controls playsInline preload="metadata" aria-label="Video attachment" />;
  }
  if (kind === "audio") {
    return (
      <div className="voice-note">
        <span className={`voice-avatar ${mine ? "voice-mine" : ""}`} aria-hidden="true">{mine ? "K" : "👩"}</span>
        <audio src={source} controls preload="none" aria-label="Voice message" />
      </div>
    );
  }
  return (
    <a className="document-card" href={source} target="_blank" rel="noreferrer">
      <span className="document-icon">PDF</span>
      <span><strong>{friendlyFilename(filename)}</strong><small>Tap to open document</small></span>
    </a>
  );
}

function ModalSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        <header><h2>{title}</h2><button onClick={onClose} aria-label={`Close ${title}`}>Done</button></header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

function LoadingChat() {
  return (
    <div className="loading-chat" aria-label="Opening chat archive">
      <div className="loading-chip" />
      <div className="loading-bubble left wide" />
      <div className="loading-bubble right medium" />
      <div className="loading-bubble left medium" />
      <div className="loading-bubble right wide" />
    </div>
  );
}

async function fetchMonth(file: string) {
  const response = await fetch(archiveUrl(file));
  if (!response.ok) throw new Error(`Could not load ${file}`);
  return (await response.json()) as ChatMessage[];
}

function archiveUrl(path: string) {
  const cleanPath = path.replace(/^\/+/, "");
  if (typeof document === "undefined") return `/${cleanPath}`;
  return new URL(cleanPath, document.baseURI).toString();
}

function isGrouped(first?: ChatMessage, second?: ChatMessage) {
  if (!first || !second || !first.sender || !second.sender) return false;
  return first.sender === second.sender && first.date === second.date && second.epoch - first.epoch <= 5 * 60 * 1000;
}

function parseDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function formatDay(date: string) {
  return dateFormatter.format(parseDate(date));
}

function formatCompactDate(date: string) {
  return new Intl.DateTimeFormat("en-HK", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parseDate(date));
}

function formatMonth(month: string) {
  return monthFormatter.format(new Date(`${month}-01T00:00:00Z`));
}

function formatNumber(number: number) {
  return new Intl.NumberFormat("en-HK").format(number);
}

function normalizeSearch(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-HK");
}

function highlight(text: string, query: string) {
  if (!query) return text;
  const normalizedText = text.toLocaleLowerCase("zh-HK");
  const normalizedQuery = query.toLocaleLowerCase("zh-HK");
  const index = normalizedText.indexOf(normalizedQuery);
  if (index < 0) return text;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
}

function linkify(text: string) {
  const urlPattern = /(https?:\/\/[^\s]+)/gi;
  return text.split(urlPattern).map((part, index) =>
    /^https?:\/\//i.test(part)
      ? <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">{part}</a>
      : part,
  );
}

function friendlyFilename(filename: string) {
  const match = filename.match(/\d{8}-(.+)$/);
  return match?.[1] || filename;
}
