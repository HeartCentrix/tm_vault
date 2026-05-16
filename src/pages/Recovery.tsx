import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  SnapshotService, CONTENT_TABS, CONTENT_TAB_LABELS,
  type SnapshotItem, type SnapshotFolder, type ResourceWithBackups, type CalendarEvent, type ContentTab,
  type ContentSnapshotsResponse,
} from '../services/snapshot';
import { type RecoveryItem } from '../services/recovery';
import { getResourcesByType } from '../services/resource';
import { RestoreModal } from '../components/RestoreModal';
import AzureDbRecoverModal from '../components/AzureDbRecoverModal';
import AzurePgRecoverModal from '../components/AzurePgRecoverModal';
import AzureVmView, { type AzureVmViewHandle } from '../components/AzureVmView';
import { DownloadModal } from '../components/DownloadModal';
import BackupSizeSummary from '../components/BackupSizeSummary';
import RecoveryToolbar from '../components/RecoveryToolbar';
import { API } from '../config/api';
import { parseAsUtc, fmtLocal, fmtLocalDate, fmtLocalTime } from '../utils/datetime';
import './Recovery.css';

// Five fixed content tabs — was previously a string discovered at runtime
// from the snapshot's actual item types.
type ContentType = ContentTab | '';

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(1)} TB`;
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    office_user: 'User',
    shared_mailbox: 'Shared mailbox',
    room_mailbox: 'Room',
    onedrive: 'OneDrive',
    sharepoint_site: 'SharePoint',
    teams_channel: 'Teams channel',
    teams_chat: 'Teams chat',
    entra_directory: 'Azure Active Directory',
    power_bi: 'Power BI workspace',
    azure_vm: 'Azure VM',
    azure_sql: 'Azure SQL',
    azure_postgresql: 'Azure PostgreSQL',
  };
  return labels[kind] || kind;
}

// ==================== Teams chat helpers ====================

type QuotedMessage = { messageId: string; preview: string; senderName: string };

const MESSAGE_REF_TYPES = new Set(['messageReference', 'forwardedMessageReference']);

function isMessageReferenceAttachment(att: any): boolean {
  return MESSAGE_REF_TYPES.has((att?.contentType || '').trim());
}

/** Teams "Fluid Embed Cards" / Loop components / meeting cards are inline
 *  UI elements (rendered via a `<span itemtype="...">` placeholder in the
 *  message body), not file attachments. Their `name` field is just the
 *  GUID `itemid`, which surfaces as a useless "9185cd56-..." chip when we
 *  render them in the attachment row. Filter them out — the body
 *  placeholder already conveys "there was a card here". */
const INLINE_CARD_CONTENT_TYPE_PREFIX = 'application/vnd.microsoft.card.';
function isInlineCardAttachment(att: any): boolean {
  const ct = (att?.contentType || '').trim().toLowerCase();
  return ct.startsWith(INLINE_CARD_CONTENT_TYPE_PREFIX);
}

/** A chat attachment row only makes sense to render as a chip if it
 *  represents real downloadable content (file reference, image, etc.)
 *  rather than a quoted message reply or an inline card. */
function isRenderableChatAttachment(att: any): boolean {
  return !isMessageReferenceAttachment(att) && !isInlineCardAttachment(att);
}

/** Extract Teams quoted-reply metadata from `attachments`. Graph stores
 *  the quoted message as a JSON string in `attachment.content` with
 *  shape `{ messageId, messagePreview, messageSender: { user: { displayName } } }`. */
function parseMessageReferences(attachments: any[]): QuotedMessage[] {
  const out: QuotedMessage[] = [];
  for (const att of attachments || []) {
    if (!isMessageReferenceAttachment(att)) continue;
    let parsed: any = null;
    const c = att?.content;
    if (typeof c === 'string') {
      try { parsed = JSON.parse(c); } catch { parsed = null; }
    } else if (c && typeof c === 'object') {
      parsed = c;
    }
    const messageId = String(parsed?.messageId || att?.id || '');
    const rawPreview = parsed?.messagePreview || '';
    // Preview is plain text already; collapse any stray whitespace.
    const preview = String(rawPreview).replace(/\s+/g, ' ').trim();
    const senderName = parsed?.messageSender?.user?.displayName
      || parsed?.messageSender?.application?.displayName
      || '';
    if (messageId || preview) {
      out.push({ messageId, preview, senderName });
    }
  }
  return out;
}

/** Remove `<attachment id="..."></attachment>` placeholders from a chat
 *  body's HTML for ids we've already rendered as a quote block.
 *  Teams inlines these empty custom elements as a marker; without
 *  handling, the id can surface as visible text in certain renderers. */
function stripAttachmentPlaceholders(html: string, ids: Set<string>): string {
  if (!ids.size) return html;
  return html.replace(/<attachment[^>]*\sid=["']([^"']+)["'][^>]*>\s*<\/attachment>/gi, (m, id) => ids.has(id) ? '' : m);
}

// ==================== Specialized Preview Components ====================

export function EmailPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const from = raw.from?.emailAddress || {};
  const toList: any[] = raw.toRecipients || [];
  const ccList: any[] = raw.ccRecipients || [];
  const subject = raw.subject || item.subject || item.name || '(No subject)';
  const bodyContent = raw.body?.content || item.body || item.preview || '';
  const isHtml = raw.body?.contentType === 'html';
  const sentAt = raw.sentDateTime || raw.receivedDateTime || item.date;
  const fromStr = [from.name, from.address ? `<${from.address}>` : ''].filter(Boolean).join(' ') || item.from || '—';
  const toStr = toList.map((r: any) => { const e = r.emailAddress || {}; return e.name ? `${e.name} <${e.address}>` : (e.address || ''); }).join('; ');

  // Fetch persisted EMAIL_ATTACHMENT rows for this email — only these are
  // actually restorable + downloadable from blob storage. The raw.attachments
  // array from the Graph message is still useful as a fallback label list
  // (e.g. when the backup ran before attachment capture was wired), but any
  // items with resolved=true link to our own content endpoint.
  const [attachments, setAttachments] = useState<Array<{
    id: string; name: string; size: number;
    kind: string | null;
    contentType: string | null;
    isInline: boolean; contentId: string | null;
    resolved: boolean; sourceUrl: string | null;
  }>>([]);
  useEffect(() => {
    if (!item.snapshotId || !item.id) return;
    let cancelled = false;
    SnapshotService.getItemAttachments(item.snapshotId, item.id)
      .then(data => { if (!cancelled) setAttachments(data); })
      .catch(() => { if (!cancelled) setAttachments([]); });
    return () => { cancelled = true; };
  }, [item.snapshotId, item.id]);

  const fmtBytes = (n: number) => {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const hasAny = attachments.length > 0 || raw.hasAttachments;

  // Rewrite inline-image cid: URLs to blob: object URLs so the iframe
  // can render embedded logos/signatures/screenshots. The iframe has
  // sandbox="allow-same-origin" but can't attach the Bearer token when
  // loading <img>, so a direct rewrite to our authenticated content
  // endpoint would 401. Instead we:
  //   1. Fetch each inline attachment's content as a blob (with token)
  //   2. Create a URL.createObjectURL(blob) for each
  //   3. String-replace `src="cid:<contentId>"` → `src="<blob: url>"`
  //   4. Revoke the object URLs on unmount to avoid a memory leak
  const [cidBlobUrls, setCidBlobUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!isHtml || !item.snapshotId) {
      setCidBlobUrls(new Map());
      return;
    }
    let cancelled = false;
    const created: string[] = [];
    const headers: Record<string, string> = {};
    (async () => {
      const out = new Map<string, string>();
      for (const a of attachments) {
        if (!a.contentId || !a.resolved) continue;
        try {
          const r = await fetch(
            API.SNAPSHOTS.ITEM_CONTENT(item.snapshotId, a.id),
            { headers },
          );
          if (!r.ok) continue;
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          created.push(url);
          const cid = String(a.contentId).replace(/^<|>$/g, '').toLowerCase();
          out.set(cid, url);
        } catch {
          /* skip unreachable attachment — cid will stay as broken img */
        }
      }
      if (!cancelled) setCidBlobUrls(out);
    })();
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [isHtml, item.snapshotId, attachments]);

  const renderedBody = useMemo(() => {
    if (!isHtml || !bodyContent) return bodyContent;
    if (cidBlobUrls.size === 0) return bodyContent;
    return String(bodyContent).replace(
      /src=(["'])cid:<?([^"'>]+?)>?\1/gi,
      (match, q, cid) => {
        const url = cidBlobUrls.get(String(cid).toLowerCase());
        return url ? `src=${q}${url}${q}` : match;
      },
    );
  }, [isHtml, bodyContent, cidBlobUrls]);

  return (
    <div className="email-preview">
      <div className="email-ol-header">
        <div className="email-ol-meta">
          <div className="email-ol-row"><span className="email-ol-label">From:</span><span className="email-ol-val">{fromStr}</span></div>
          {toStr && <div className="email-ol-row"><span className="email-ol-label">To:</span><span className="email-ol-val">{toStr}</span></div>}
          {ccList.length > 0 && (
            <div className="email-ol-row">
              <span className="email-ol-label">Cc:</span>
              <span className="email-ol-val">{ccList.map((r: any) => r.emailAddress?.address).join('; ')}</span>
            </div>
          )}
          <div className="email-ol-subject">{subject}</div>
          {hasAny && (
            <div className="email-ol-attachments">
              <svg viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" style={{width:13,height:13,flexShrink:0}}>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
              {attachments.length === 0
                ? <span className="email-ol-attach-chip">Has attachments (capturing…)</span>
                : attachments.map((a) => {
                    const label = a.size ? `${a.name} · ${fmtBytes(a.size)}` : a.name;
                    if (a.resolved && item.snapshotId) {
                      // Hits the backend content endpoint with ?download=1,
                      // which sets Content-Disposition so the browser
                      // downloads with the original filename.
                      return (
                        <a
                          key={a.id}
                          className="email-ol-attach-chip email-ol-attach-link"
                          href={API.SNAPSHOTS.ITEM_CONTENT_DOWNLOAD(item.snapshotId, a.id)}
                          download={a.name || undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Download ${a.name}`}
                        >
                          {label}
                        </a>
                      );
                    }
                    // Unresolved referenceAttachment — show the source URL
                    // if we have one, else just show the name as metadata.
                    if (a.sourceUrl) {
                      return (
                        <a
                          key={a.id}
                          className="email-ol-attach-chip email-ol-attach-link"
                          href={a.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open original share link"
                        >
                          {label} ↗
                        </a>
                      );
                    }
                    return <span key={a.id} className="email-ol-attach-chip">{label}</span>;
                  })
              }
            </div>
          )}
        </div>
        {sentAt && (
          <div className="email-ol-date">
            {fmtLocal(sentAt, {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true})}
          </div>
        )}
      </div>
      <div className="email-body">
        {isHtml
          ? <iframe srcDoc={renderedBody} sandbox="allow-same-origin" className="email-iframe" title="email-body" />
          : <pre className="email-plain">{bodyContent || 'No content'}</pre>
        }
      </div>
    </div>
  );
}
export function ChatPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const sender = raw.from?.user?.displayName || raw.from?.application?.displayName || (item as any).sender || 'Unknown';
  const senderInitials = sender.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
  const rawBody = raw.body?.content || (item as any).body || item.body || item.preview || '';
  const attachments: any[] = raw.attachments || [];
  // Teams replies reference the quoted message via a messageReference
  // attachment. The `content` field is JSON with messageId + messagePreview
  // + messageSender. Extract those so we can render a quote block and
  // strip the <attachment id="..."> placeholders Graph inlines in the
  // body HTML (otherwise the empty custom element leaves the raw id
  // visible in the rendered message).
  const quotedRefs = parseMessageReferences(attachments);
  const quotedIds = new Set(quotedRefs.map(q => q.messageId));
  // Strip <img> (Graph hostedContents → 401s) and inline reply
  // placeholders we've already surfaced as a quote block.
  const bodyContent = typeof rawBody === 'string'
    ? stripAttachmentPlaceholders(rawBody.replace(/<img[^>]*>/gi, ''), quotedIds)
    : rawBody;
  const isHtml = (raw.body?.contentType || (item as any).bodyContentType) === 'html';
  const sentAt = raw.createdDateTime || (item as any).date || item.date;
  // Real file/card attachments — excludes messageReference pointers which
  // render as the quote block above the body.
  const realAttachments = attachments.filter(a => !isMessageReferenceAttachment(a));
  const mentions: any[] = raw.mentions || [];
  const isDeleted = raw.deletedDateTime != null;
  // chatTopic / channelName ride at the TOP level of the recovery item
  // (see snapshot-service _fmt — they are NOT under metadata). The
  // folder_path fallback is last-resort and intentionally a no-op when
  // the topic resolved (so we never expose the "chats/Group Chat (19:xxx)"
  // synthetic write-time fallback that may be baked into legacy rows).
  const context = (item as any).chatTopic || item.metadata?.chatTopic
    || (item as any).channelName || item.metadata?.channelName
    || item.folderPath?.replace('chats/', '').replace('channels/', '') || '';

  return (
    <div className="chat-preview">
      {context && <div className="chat-context-label">{context}</div>}
      <div className={`chat-bubble-wrap${isDeleted ? ' deleted' : ''}`}>
        <div className="chat-avatar">{senderInitials}</div>
        <div className="chat-bubble">
          <div className="chat-bubble-header">
            <span className="chat-sender">{sender}</span>
            {sentAt && <span className="chat-time">{fmtLocal(sentAt)}</span>}
            {item.itemType === 'TEAMS_MESSAGE_REPLY' && <span className="chat-reply-badge">Reply</span>}
          </div>
          {quotedRefs.length > 0 && (
            <div className="chat-quote-stack">
              {quotedRefs.map((q, i) => (
                <div key={i} className="chat-quote">
                  <div className="chat-quote-sender">
                    {q.senderName ? `${q.senderName} wrote:` : 'In reply to:'}
                  </div>
                  <div className="chat-quote-body">{q.preview || <em>(quoted message)</em>}</div>
                </div>
              ))}
            </div>
          )}
          {isDeleted
            ? <div className="chat-deleted">This message was deleted</div>
            : isHtml
              ? <div className="chat-body" dangerouslySetInnerHTML={{ __html: bodyContent }} />
              : <div className="chat-body">{bodyContent || <em>No content</em>}</div>
          }
          {realAttachments.length > 0 && (
            <div className="chat-attachments">
              {realAttachments.map((a: any, i: number) => (
                <div key={i} className="chat-attachment-chip">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12 }}>
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  {a.name || 'Attachment'}
                </div>
              ))}
            </div>
          )}
          {mentions.length > 0 && (
            <div className="chat-mentions">
              {mentions.map((m: any, i: number) => (
                <span key={i} className="chat-mention">
                  @{m.mentioned?.user?.displayName || m.mentionText}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ContactPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const name = raw.displayName || item.name || '(Unnamed)';
  const given = raw.givenName;
  const surname = raw.surname;
  const company = raw.companyName;
  const title = raw.jobTitle;
  const initials = name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
  const emails: Array<{ address?: string; name?: string }> = raw.emailAddresses || [];
  const phones: string[] = [
    ...(raw.businessPhones || []),
    ...(raw.homePhones || []),
    ...(raw.mobilePhone ? [raw.mobilePhone] : []),
  ];
  const fullName = [given, surname].filter(Boolean).join(' ') || name;
  const created = raw.createdDateTime || item.createdAt;

  return (
    <div className="item-preview">
      <div className="preview-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="chat-avatar" aria-hidden style={{ width: 40, height: 40, fontSize: 14 }}>{initials}</div>
        <div>
          <div className="preview-status" style={{ fontSize: 16 }}>{fullName}</div>
          {(title || company) && (
            <div style={{ color: '#555', fontSize: 13 }}>
              {[title, company].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </div>
      <div className="preview-body">
        {emails.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Email</div>
            {emails.map((e, i) => (
              <div key={i} style={{ fontSize: 13 }}>
                <a href={e.address ? `mailto:${e.address}` : undefined} style={{ color: '#D31245' }}>
                  {e.name ? `${e.name} <${e.address}>` : e.address}
                </a>
              </div>
            ))}
          </div>
        )}
        {phones.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Phone</div>
            {phones.map((p, i) => <div key={i} style={{ fontSize: 13 }}>{p}</div>)}
          </div>
        )}
        <PreviewLabel label="Department" value={raw.department} />
        <PreviewLabel label="Office" value={raw.officeLocation} />
        <PreviewLabel label="Created" value={fmtDate(created)} />
      </div>
    </div>
  );
}

function ContactItemRow({ item, selected, checked, onSelect, onCheck }: {
  item: any; selected: boolean; checked: boolean;
  onSelect: () => void; onCheck: (e: React.MouseEvent) => void;
}) {
  const raw = item.metadata?.raw || {};
  const name = raw.displayName || item.name || '(Unnamed)';
  const initials = name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
  const email = (raw.emailAddresses?.[0]?.address) || '';
  const subtitle = [raw.jobTitle, raw.companyName].filter(Boolean).join(' · ');
  return (
    <div className={`chat-item-row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <input type="checkbox" checked={checked} onChange={() => {}} onClick={onCheck} />
      <div className="chat-item-avatar">{initials}</div>
      <div className="chat-item-body">
        <div className="chat-item-header">
          <span className="chat-item-sender">{name}</span>
          {email && <span className="chat-item-time">{email}</span>}
        </div>
        {subtitle && <div className="chat-item-text">{subtitle}</div>}
      </div>
    </div>
  );
}

export function CalendarPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const subject = raw.subject || item.subject || item.name || 'Event';
  const start = raw.start?.dateTime || raw.start?.date || item.date;
  const end = raw.end?.dateTime || raw.end?.date;
  const location = raw.location?.displayName || '';
  const organizer = raw.organizer?.emailAddress?.name || raw.organizer?.emailAddress?.address || '';
  const attendees: any[] = raw.attendees || [];
  const body = raw.body?.content || item.body || '';
  const isHtml = raw.body?.contentType === 'html';
  const isAllDay = raw.isAllDay || (!raw.start?.dateTime && !!raw.start?.date);
  const isOnline = raw.isOnlineMeeting;
  const recurrence = raw.recurrence?.pattern?.type;
  const showAs = raw.showAs || '';

  const startDate = parseAsUtc(start);
  const endDate = parseAsUtc(end);

  const eventDay = startDate?.getDate();
  const eventMonth = startDate
    ? startDate.toLocaleString('default', { month: 'long', year: 'numeric' })
    : '';
  const firstDow = startDate
    ? new Date(startDate.getFullYear(), startDate.getMonth(), 1).getDay()
    : 0;
  const daysInMonth = startDate
    ? new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate()
    : 0;
  const calCells = Array.from({ length: firstDow + daysInMonth }, (_, i) =>
    i < firstDow ? null : i - firstDow + 1
  );

  return (
    <div className="calendar-preview">
      <div className="cal-event-header">
        <div className="cal-event-title">{subject}</div>
        <div className="cal-event-badges">
          {isAllDay && <span className="cal-badge">All day</span>}
          {isOnline && <span className="cal-badge online">Online meeting</span>}
          {recurrence && <span className="cal-badge recur">Recurring · {recurrence}</span>}
          {showAs && <span className="cal-badge status">{showAs}</span>}
        </div>
      </div>

      <div className="cal-layout">
        {startDate && (
          <div className="cal-mini">
            <div className="cal-mini-month">{eventMonth}</div>
            <div className="cal-mini-grid">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                <div key={d} className="cal-mini-dow">{d}</div>
              ))}
              {calCells.map((day, i) => (
                <div
                  key={i}
                  className={`cal-mini-day${day === eventDay ? ' event-day' : ''}${!day ? ' empty' : ''}`}
                >
                  {day ?? ''}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="cal-event-details">
          {startDate && (
            <div className="cal-detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15, flexShrink: 0 }}>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <div>
                <div>{startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
                {!isAllDay && (
                  <div className="cal-time">
                    {startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    {endDate && ` – ${endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`}
                  </div>
                )}
              </div>
            </div>
          )}
          {location && (
            <div className="cal-detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15, flexShrink: 0 }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
              </svg>
              <span>{location}</span>
            </div>
          )}
          {organizer && (
            <div className="cal-detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15, flexShrink: 0 }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
              <span>Organized by <strong>{organizer}</strong></span>
            </div>
          )}
          {attendees.length > 0 && (
            <div className="cal-detail-row cal-attendees-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15, flexShrink: 0, marginTop: 2 }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <div className="cal-attendees">
                {attendees.slice(0, 8).map((a: any, i: number) => {
                  const name = a.emailAddress?.name || a.emailAddress?.address || 'Attendee';
                  const resp = (a.status?.response || '').toLowerCase();
                  return (
                    <span key={i} className={`cal-attendee-chip resp-${resp}`} title={resp}>
                      {name}
                    </span>
                  );
                })}
                {attendees.length > 8 && (
                  <span className="cal-attendee-more">+{attendees.length - 8} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {body && (
        <div className="cal-event-body">
          {isHtml
            ? <div dangerouslySetInnerHTML={{ __html: body }} />
            : <pre className="cal-body-plain">{body}</pre>
          }
        </div>
      )}
    </div>
  );
}

// ==================== Workload-specific Preview Components ====================
// Each preview reads from item.metadata.raw (populated by backup handlers) and
// falls back to flat fields. Styles piggyback on the existing .item-preview /
// .preview-* CSS classes plus inline for card-specific details.

function PreviewLabel({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="preview-meta-row">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function fmtDate(v?: string | null): string {
  if (!v) return '';
  try {
    return fmtLocal(v, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return v || ''; }
}

export function OneNotePagePreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const title = raw.title || item.name || '(Untitled page)';
  const createdBy = raw.createdByAppId || raw.lastModifiedBy?.user?.displayName || raw.createdBy?.user?.displayName;
  const modified = raw.lastModifiedDateTime || raw.createdDateTime;
  // ONENOTE_PAGE_CONTENT blobs are HTML. When the caller already loaded content
  // into item.content (via get_item_content endpoint) we render it sandboxed.
  const html = item.content || item.htmlContent;
  const isHtmlItem = item.itemType === 'ONENOTE_PAGE_CONTENT' && typeof html === 'string';
  return (
    <div className="item-preview">
      <div className="preview-header">
        <div className="preview-status">{title}</div>
        <PreviewLabel label="Created by" value={createdBy} />
        <PreviewLabel label="Modified" value={fmtDate(modified)} />
        {item.metadata?.notebookId && <PreviewLabel label="Notebook" value={item.metadata.notebookId} />}
        {item.metadata?.sectionId && <PreviewLabel label="Section" value={item.metadata.sectionId} />}
      </div>
      <div className="preview-body">
        {isHtmlItem ? (
          <iframe
            title={title}
            sandbox=""
            srcDoc={html}
            style={{ width: '100%', minHeight: 420, border: '1px solid #e5e7eb', borderRadius: 4 }}
          />
        ) : (
          <p style={{ color: '#6b7280' }}>
            Page metadata only. Load full HTML content via the item content endpoint to render the body.
          </p>
        )}
      </div>
    </div>
  );
}

export function PlannerTaskPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const title = raw.title || item.name;
  const dueDate = raw.dueDateTime;
  const progress = raw.percentComplete ?? 0;
  const priority = raw.priority;
  const assignees = Object.keys(raw.assignments || {});
  const plan = item.metadata?.planId;
  // Task details (description + checklist + references) live in a sibling item
  // but callers may also inline them on .raw.details for convenience.
  const details = raw.details || {};
  const checklist = details.checklist ? Object.values(details.checklist) : [];
  const description = details.description;
  return (
    <div className="item-preview">
      <div className="preview-header">
        <div className="preview-status">{title}</div>
        <PreviewLabel label="Plan" value={plan} />
        <PreviewLabel label="Due" value={fmtDate(dueDate)} />
        <PreviewLabel label="Priority" value={priority != null ? `P${priority}` : null} />
        <PreviewLabel label="Progress" value={progress != null ? `${progress}%` : null} />
        <PreviewLabel label="Assignees" value={assignees.length ? `${assignees.length} user(s)` : null} />
      </div>
      <div className="preview-body">
        {description && <p style={{ whiteSpace: 'pre-wrap' }}>{description}</p>}
        {checklist.length > 0 && (
          <>
            <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 6 }}>Checklist</div>
            <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
              {checklist.map((c: any, i: number) => (
                <li key={i} style={{ padding: '4px 0' }}>
                  <span style={{ marginRight: 8 }}>{c.isChecked ? '☑' : '☐'}</span>
                  <span style={{ textDecoration: c.isChecked ? 'line-through' : 'none' }}>{c.title}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {!description && checklist.length === 0 && (
          <p style={{ color: '#6b7280' }}>No description or checklist items.</p>
        )}
      </div>
    </div>
  );
}

export function TodoTaskPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const title = raw.title || item.name;
  const body = raw.body?.content;
  const status = raw.status;
  const due = raw.dueDateTime?.dateTime || raw.dueDateTime;
  const importance = raw.importance;
  const subtasks = item.metadata?.checklist || raw.checklistItems || [];
  const linked = item.metadata?.linked || raw.linkedResources || [];
  return (
    <div className="item-preview">
      <div className="preview-header">
        <div className="preview-status">{title}</div>
        <PreviewLabel label="Status" value={status} />
        <PreviewLabel label="Importance" value={importance} />
        <PreviewLabel label="Due" value={fmtDate(typeof due === 'string' ? due : due?.dateTime)} />
        <PreviewLabel label="Categories" value={(raw.categories || []).join(', ') || null} />
      </div>
      <div className="preview-body">
        {body && <p style={{ whiteSpace: 'pre-wrap' }}>{body}</p>}
        {subtasks.length > 0 && (
          <>
            <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 6 }}>Subtasks</div>
            <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
              {subtasks.map((c: any, i: number) => (
                <li key={i} style={{ padding: '4px 0' }}>
                  <span style={{ marginRight: 8 }}>{c.isChecked ? '☑' : '☐'}</span>
                  {c.displayName || c.title}
                </li>
              ))}
            </ul>
          </>
        )}
        {linked.length > 0 && (
          <>
            <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 6 }}>Linked resources</div>
            <ul style={{ paddingLeft: 20 }}>
              {linked.map((l: any, i: number) => (
                <li key={i} style={{ padding: '2px 0' }}>
                  {l.webUrl ? <a href={l.webUrl} target="_blank" rel="noopener noreferrer">{l.displayName || l.webUrl}</a> : (l.displayName || l.applicationName)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export function PowerAppPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const props = raw.properties || raw;
  const name = props.displayName || item.name;
  const env = item.metadata?.environmentId || props.environment?.name;
  const owner = props.owner?.displayName || props.createdBy?.displayName;
  const appType = props.appType;
  const created = props.createdTime;
  const modified = props.lastModifiedTime;
  const hasPackage = item.itemType === 'POWER_APP_PACKAGE';
  return (
    <div className="item-preview">
      <div className="preview-header">
        <div className="preview-status">{name}</div>
        <PreviewLabel label="Environment" value={env} />
        <PreviewLabel label="Owner" value={owner} />
        <PreviewLabel label="Type" value={appType} />
        <PreviewLabel label="Created" value={fmtDate(created)} />
        <PreviewLabel label="Modified" value={fmtDate(modified)} />
        {hasPackage && (
          <PreviewLabel
            label="Backup"
            value={<span style={{ color: '#059669', fontWeight: 600 }}>Full package (.zip)</span>}
          />
        )}
      </div>
      <div className="preview-body">
        {hasPackage ? (
          <p>Canvas/model-driven app package stored. Restore reimports into the chosen environment.</p>
        ) : (
          <p>Definition only. Restore requires a package backup (re-run backup with package export).</p>
        )}
      </div>
    </div>
  );
}

export function PowerFlowPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const props = raw.properties || raw;
  const name = props.displayName || item.name;
  const state = props.state;
  const triggerKind = props.definitionSummary?.triggers
    ? Object.keys(props.definitionSummary.triggers)[0]
    : props.trigger?.type;
  const actionCount = props.definitionSummary?.actions
    ? Object.keys(props.definitionSummary.actions).length
    : null;
  const env = item.metadata?.environmentId;
  const connections = item.itemType === 'POWER_FLOW_CONNECTIONS'
    ? (item.metadata?.count || (raw.value || []).length)
    : null;
  const stateColor = state === 'Started' ? '#059669' : state === 'Stopped' ? '#dc2626' : '#6b7280';
  return (
    <div className="item-preview">
      <div className="preview-header">
        <div className="preview-status">{name}</div>
        <PreviewLabel
          label="State"
          value={state ? <span style={{ color: stateColor, fontWeight: 600 }}>{state}</span> : null}
        />
        <PreviewLabel label="Environment" value={env} />
        <PreviewLabel label="Trigger" value={triggerKind} />
        <PreviewLabel label="Actions" value={actionCount} />
        {connections !== null && <PreviewLabel label="Connections" value={`${connections} connection(s)`} />}
      </div>
      <div className="preview-body">
        {item.itemType === 'POWER_FLOW_PACKAGE' && (
          <p><span style={{ color: '#059669', fontWeight: 600 }}>Full package (.zip)</span> captured — restore reimports into the target environment.</p>
        )}
        {item.itemType === 'POWER_FLOW_CONNECTIONS' && (
          <p>Connection references captured. These are reused during restore to keep the flow functional.</p>
        )}
        {item.itemType === 'POWER_FLOW_DEFINITION' && (
          <p>Trigger and action logic captured as JSON. Use package export for full-fidelity restore.</p>
        )}
      </div>
    </div>
  );
}

export function PowerDlpPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const props = raw.properties || raw;
  const name = props.displayName || item.name;
  const classified = props.connectorGroups || [];
  const groupCounts: Record<string, number> = {};
  for (const g of classified) {
    const label = g.classification || 'Unknown';
    groupCounts[label] = (groupCounts[label] || 0) + (g.connectors?.length || 0);
  }
  const envType = props.environmentType;
  return (
    <div className="item-preview">
      <div className="preview-header">
        <div className="preview-status">{name}</div>
        <PreviewLabel label="Scope" value={envType} />
        <PreviewLabel label="Policy type" value={props.policyType} />
        <PreviewLabel label="Created" value={fmtDate(props.createdTime)} />
        <PreviewLabel label="Modified" value={fmtDate(props.lastModifiedTime)} />
      </div>
      <div className="preview-body">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Connector groups</div>
        {Object.keys(groupCounts).length === 0 ? (
          <p style={{ color: '#6b7280' }}>No connector classification data.</p>
        ) : (
          <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
            {Object.entries(groupCounts).map(([label, count]) => (
              <li key={label} style={{ padding: '4px 0' }}>
                <span style={{ fontWeight: 600, marginRight: 8 }}>{label}:</span>
                {count} connector(s)
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function FilePreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const name = raw.name || item.name;
  const size = raw.size ?? item.contentSize;
  const mime = raw.file?.mimeType || raw.mimeType;
  const checksum = raw.file?.hashes?.quickXorHash || item.contentChecksum;
  const webUrl = raw.webUrl;
  const path = raw.parentReference?.path || item.folderPath;
  return (
    <div className="item-preview">
      <div className="preview-header">
        <div className="preview-status">{name}</div>
        <PreviewLabel label="Size" value={size != null ? formatSize(size) : null} />
        <PreviewLabel label="Type" value={mime} />
        <PreviewLabel label="Path" value={path} />
        <PreviewLabel label="Modified" value={fmtDate(raw.lastModifiedDateTime)} />
        <PreviewLabel label="Checksum" value={checksum ? <code style={{ fontSize: 11 }}>{String(checksum).slice(0, 16)}...</code> : null} />
      </div>
      <div className="preview-body">
        {webUrl
          ? <a href={webUrl} target="_blank" rel="noopener noreferrer">Open in source (may require SSO)</a>
          : <p style={{ color: '#6b7280' }}>No direct link available — restore to retrieve content.</p>}
      </div>
    </div>
  );
}

// ==================== Entra User Relationship Previews ====================
// One dispatcher + four cards for USER_PROFILE and the three relationship subtypes.
// Shared visual language: circular avatar, identity line, a directional accent bar
// on the left that signals relationship direction (↑ manager, ↓ direct report,
// ↔ group membership, ● self). Keeps them feeling like parts of an org view.

function entraInitials(name?: string | null): string {
  if (!name) return '??';
  return name.split(/\s+/).map((w: string) => w[0] || '').join('').toUpperCase().slice(0, 2);
}

function EntraRelationshipCard({
  accent, icon, label, name, subtitle, meta,
}: {
  accent: string;
  icon: React.ReactNode;
  label: string;
  name: string;
  subtitle?: string | null;
  meta?: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <div className="item-preview">
      <div
        className="preview-header"
        style={{
          display: 'flex', gap: 16, alignItems: 'center',
          borderLeft: `4px solid ${accent}`, paddingLeft: 16,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 56, height: 56, borderRadius: '50%',
            background: `${accent}14`, color: accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 600, flexShrink: 0,
          }}
        >
          {icon || entraInitials(name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: accent, fontWeight: 600 }}>
            {label}
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#0f172a', marginTop: 2 }}>
            {name}
          </div>
          {subtitle && (
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
      </div>
      {meta && meta.length > 0 && (
        <div className="preview-body">
          {meta.map((m, i) => (
            <PreviewLabel key={i} label={m.label} value={m.value} />
          ))}
        </div>
      )}
    </div>
  );
}

export function EntraUserProfilePreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const name = raw.displayName || item.name;
  const email = raw.mail || raw.userPrincipalName;
  return (
    <EntraRelationshipCard
      accent="#7c3aed"
      icon={entraInitials(name)}
      label="User profile"
      name={name}
      subtitle={email}
      meta={[
        { label: 'Job title', value: raw.jobTitle },
        { label: 'Department', value: raw.department },
        { label: 'Office', value: raw.officeLocation },
        { label: 'Mobile', value: raw.mobilePhone },
        { label: 'Business phone', value: (raw.businessPhones || [])[0] },
        { label: 'Account enabled', value: raw.accountEnabled === false ? 'Disabled' : raw.accountEnabled === true ? 'Enabled' : null },
      ]}
    />
  );
}

export function EntraManagerPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const name = raw.displayName || item.name || '(Unknown)';
  const email = raw.mail || raw.userPrincipalName;
  return (
    <EntraRelationshipCard
      accent="#1e40af"
      icon={<span style={{ fontSize: 22 }}>↑</span>}
      label="Reports to"
      name={name}
      subtitle={email}
      meta={[
        { label: 'Job title', value: raw.jobTitle },
        { label: 'Department', value: raw.department },
        { label: 'Office', value: raw.officeLocation },
      ]}
    />
  );
}

export function EntraDirectReportPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const name = raw.displayName || item.name || '(Unknown)';
  const email = raw.mail || raw.userPrincipalName;
  return (
    <EntraRelationshipCard
      accent="#D31245"
      icon={<span style={{ fontSize: 22 }}>↓</span>}
      label="Direct report"
      name={name}
      subtitle={email}
      meta={[
        { label: 'Job title', value: raw.jobTitle },
        { label: 'Department', value: raw.department },
      ]}
    />
  );
}

export function EntraGroupMembershipPreview({ item }: { item: any }) {
  const raw = item.metadata?.raw || {};
  const name = raw.displayName || item.name || '(Unnamed group)';
  const description = raw.description;
  const isSecurity = raw.securityEnabled;
  const isMail = raw.mailEnabled;
  const groupType = [
    isSecurity ? 'Security' : null,
    isMail ? 'Mail-enabled' : null,
    (raw.groupTypes || []).includes('Unified') ? 'Microsoft 365' : null,
    (raw.groupTypes || []).includes('DynamicMembership') ? 'Dynamic' : null,
  ].filter(Boolean).join(' · ');
  return (
    <EntraRelationshipCard
      accent="#d97706"
      icon={<span style={{ fontSize: 20 }}>⌘</span>}
      label="Member of"
      name={name}
      subtitle={groupType || null}
      meta={[
        { label: 'Description', value: description },
        { label: 'Visibility', value: raw.visibility },
        { label: 'Classification', value: raw.classification },
        { label: 'Mail alias', value: raw.mailNickname },
        { label: 'Created', value: fmtDate(raw.createdDateTime) },
      ]}
    />
  );
}

export function EntraUserRelationshipPreview({ item }: { item: any }) {
  const t = item.itemType;
  if (t === 'USER_PROFILE' || t === 'ENTRA_USER_PROFILE') return <EntraUserProfilePreview item={item} />;
  if (t === 'USER_MANAGER') return <EntraManagerPreview item={item} />;
  if (t === 'USER_DIRECT_REPORT') return <EntraDirectReportPreview item={item} />;
  if (t === 'USER_GROUP_MEMBERSHIP') return <EntraGroupMembershipPreview item={item} />;
  return <JsonPreview item={item} />;
}

export function JsonPreview({ item }: { item: any }) {
  // Deliberately-final fallback: pretty-print whatever we have as read-only JSON.
  // Better than the old generic that read item.from/subject/body which usually returned nothing.
  const payload = item.metadata?.raw ?? item.metadata ?? item;
  let serialized: string;
  try { serialized = JSON.stringify(payload, null, 2); } catch { serialized = String(payload); }
  return (
    <div className="item-preview">
      <div className="preview-header">
        <div className="preview-status">{item.name || item.itemType || 'Item'}</div>
        <PreviewLabel label="Type" value={item.itemType} />
        <PreviewLabel label="Size" value={item.contentSize ? formatSize(item.contentSize) : null} />
      </div>
      <div className="preview-body">
        <pre style={{
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4,
          padding: 12, fontSize: 12, maxHeight: 520, overflow: 'auto', whiteSpace: 'pre-wrap',
        }}>{serialized}</pre>
      </div>
    </div>
  );
}


// Convert ISO-8601 duration (e.g. "PT1H1M30S", "PT45M", "PT12S")
// into a compact human string like "1h 1m 30s". Returns "" on parse
// failure so callers can decide whether to print a label or drop it.
function formatIsoDuration(raw: any): string {
  if (!raw || typeof raw !== 'string') return '';
  const m = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!m) return '';
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? Math.round(parseFloat(m[3])) : 0;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (min) parts.push(`${min}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

// Teams system event renderer. Graph delivers lifecycle messages (members
// joined/left/added, chat renamed, calls started/ended, recordings) with
// body=<systemEventMessage/> and from=null — the actual content is in
// raw.eventDetail. Without this, every such message looks empty in the
// feed. We render them as small centered chips like Teams does.
function formatSystemEvent(eventDetail: any): string | null {
  if (!eventDetail) return null;
  const type = String(eventDetail['@odata.type'] || '');
  // Use ONLY the real display name. userIdentityType ("aadUser") is the
  // identity class, not a user name — falling back to it produced rows
  // like "Akshat Verma added aadUser, aadUser" when Graph omitted names.
  // If the backend resolver also failed to fill displayName, fall back
  // to a generic "someone" rather than leaking the type string.
  const names = (members: any[]) => {
    const resolved = (members || [])
      .map(m => m?.displayName || m?.user?.displayName)
      .filter(Boolean) as string[];
    if (resolved.length) return resolved.join(', ');
    const count = (members || []).length;
    if (!count) return '';
    return count === 1 ? 'someone' : `${count} members`;
  };
  const initiator =
    eventDetail.initiator?.user?.displayName ||
    eventDetail.initiator?.application?.displayName ||
    'Someone';
  if (type.includes('membersJoinedEventMessageDetail')) {
    const who = names(eventDetail.members) || 'someone';
    return `${who} joined the chat`;
  }
  if (type.includes('membersLeftEventMessageDetail')) {
    const who = names(eventDetail.members) || 'someone';
    return `${who} left the chat`;
  }
  if (type.includes('membersAddedEventMessageDetail')) {
    const members = eventDetail.members || [];
    const initiatorId = eventDetail.initiator?.user?.id || eventDetail.initiator?.id;
    const others = initiatorId
      ? members.filter((m: any) => m?.id !== initiatorId)
      : members;
    if (!others.length) {
      return `${initiator} joined the chat`;
    }
    const who = names(others) || 'a member';
    return `${initiator} added ${who}`;
  }
  if (type.includes('membersDeletedEventMessageDetail')) {
    const members = eventDetail.members || [];
    const initiatorId = eventDetail.initiator?.user?.id || eventDetail.initiator?.id;
    const others = initiatorId
      ? members.filter((m: any) => m?.id !== initiatorId)
      : members;
    if (!others.length) {
      return `${initiator} left the chat`;
    }
    const who = names(others) || 'a member';
    return `${initiator} removed ${who}`;
  }
  if (type.includes('chatRenamedEventMessageDetail')) {
    const next = eventDetail.chatDisplayName || '(no name)';
    return `${initiator} renamed the chat to “${next}”`;
  }
  if (type.includes('callStartedEventMessageDetail')) {
    return `${initiator} started a call`;
  }
  if (type.includes('callEndedEventMessageDetail')) {
    const dur = formatIsoDuration(eventDetail.callDuration);
    return dur ? `Call ended · ${dur}` : 'Call ended';
  }
  if (type.includes('callRecordingEventMessageDetail')) {
    return 'Call recording available';
  }
  if (type.includes('callTranscriptEventMessageDetail')) {
    return 'Call transcript available';
  }
  if (type.includes('teamsAppInstalledEventMessageDetail')) {
    return `${initiator} installed an app`;
  }
  // Fallback — humanise the type name.
  const friendly = type
    .replace('#microsoft.graph.', '')
    .replace(/EventMessageDetail$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());
  return friendly || null;
}

function ChatItemRow({ item, selected, checked, onSelect, onCheck }: {
  item: any; selected: boolean; checked: boolean;
  onSelect: () => void; onCheck: (e: React.MouseEvent) => void;
}) {
  const raw = item.metadata?.raw || {};
  // System-event short-circuit — render as a centered lifecycle chip
  // instead of a sender/body row. Detected by body=<systemEventMessage/>
  // or presence of raw.eventDetail.
  const _bodyHtml = String(raw.body?.content || '');
  const _isSystemEvent =
    !!raw.eventDetail ||
    _bodyHtml.includes('<systemEventMessage/>');
  if (_isSystemEvent) {
    const label = formatSystemEvent(raw.eventDetail) || 'System event';
    const sentAt = raw.createdDateTime || item.date;
    return (
      <div
        className={`chat-item-row chat-item-system${selected ? ' selected' : ''}`}
        onClick={onSelect}
        title={label}
      >
        <input type="checkbox" checked={checked} onChange={() => {}} onClick={onCheck} />
        <div className="chat-system-event">
          <span className="chat-system-event-label">{label}</span>
          {sentAt && (
            <span className="chat-system-event-time">
              {fmtLocal(sentAt, {
                month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', hour12: true,
              })}
            </span>
          )}
        </div>
      </div>
    );
  }
  const sender = raw.from?.user?.displayName || raw.from?.application?.displayName
    // item.name for chat messages is the first 100 chars of body.content,
    // or the message id when body.content is empty (reply-only messages).
    // A numeric-looking id masquerading as a sender is worse than 'Unknown'.
    || (/^\d{10,}$/.test(String(item.name || '')) ? '' : item.name)
    || 'Unknown';
  const senderEmail = item.metadata?.senderEmail || raw.from?.user?.email || raw.from?.user?.userPrincipalName || '';
  const initials = sender.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
  const rawAttachmentsForQuote: any[] = Array.isArray(raw.attachments) ? raw.attachments : [];
  const quotedRefs = parseMessageReferences(rawAttachmentsForQuote);
  const quotedIds = new Set(quotedRefs.map(q => q.messageId));
  const rawBodyField = raw.body?.content || item.preview || item.body || '';
  // Strip <attachment id="..."> placeholders for quotes we render below,
  // so the visible text isn't an empty residue / visible ID.
  const body = typeof rawBodyField === 'string'
    ? stripAttachmentPlaceholders(rawBodyField, quotedIds)
    : rawBodyField;
  const isHtml = raw.body?.contentType === 'html';
  const sentAt = raw.createdDateTime || item.date;
  // HTML → plain text with structure + entity preservation. Regex-strip
  // collapsed paragraph breaks into one unbreakable line and didn't decode
  // entities (&nbsp;, &amp;, …). Here:
  //   Step 1: rewrite block-level closings as newlines so paragraph breaks
  //           survive the text extraction.
  //   Step 2: use a detached <div> so the browser's HTML parser does the
  //           entity decoding. textContent is XSS-safe — the parsed nodes
  //           never enter the live DOM.
  //   Step 3: normalize decoded &nbsp; back to plain space so wrap points
  //           exist at every word boundary, and cap blank-line runs at 2.
  const displayBody = isHtml
    ? (() => {
        // Strip <img> tags BEFORE feeding HTML into a detached <div> —
        // even on a never-attached element, modern browsers still try to
        // fetch img src on innerHTML assignment, which for Teams inline
        // images points to /graph.microsoft.com/.../hostedContents/.../$value
        // and 401s because the browser has no Graph token. Pre-stripping
        // makes the 401s go away and costs nothing visually because
        // textContent drops <img> content anyway.
        const noImages = body.replace(/<img[^>]*>/gi, '');
        // Teams tokenises every word of an @mention into its own <at>
        // tag, e.g. `<at>Gajraj</at>&nbsp;<at>Singh</at>&nbsp;<at>Rathore</at>`.
        // Merge contiguous runs (optionally separated by whitespace/&nbsp;)
        // so the feed reads `@Gajraj Singh Rathore` instead of three
        // separate `@\u2026` tokens.
        const mentionsMerged = noImages.replace(
          /(<at\b[^>]*>[^<]*<\/at>)(?:(?:\s|&nbsp;|&#160;)+<at\b[^>]*>[^<]*<\/at>)+/gi,
          (run: string) => {
            const parts: string[] = [];
            run.replace(/<at\b[^>]*>([^<]*)<\/at>/gi, (_m: string, inner: string) => {
              parts.push(inner);
              return '';
            });
            return `<at>${parts.join(' ')}</at>`;
          },
        );
        // Drop the <at> wrapper but prepend "@" so the mention shows up
        // inline in the extracted text.
        const withMentions = mentionsMerged.replace(
          /<at\b[^>]*>([^<]*)<\/at>/gi,
          (_m: string, name: string) => `@${name}`,
        );
        const withBreaks = withMentions
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, '\n')
          .replace(/<\/(ul|ol|table)>/gi, '\n');
        const d = document.createElement('div');
        d.innerHTML = withBreaks;
        return (d.textContent || '')
          .replace(/\u00a0/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      })()
    : body;

  // Chat attachment chips — lazy-fetched only when this message actually
  // has attachments (most don't). Messages with an `attachments` array on
  // the raw Graph payload trigger one /attachments call per row at mount.
  // Fine in practice because of the infinite-scroll rendering window; if
  // it becomes a bottleneck we can batch by snapshot.
  const rawAttachments: any[] = Array.isArray(raw.attachments) ? raw.attachments : [];
  const [chatAttachments, setChatAttachments] = useState<Array<{
    id: string; name: string; size: number; contentType: string | null;
    isInline: boolean; resolved: boolean; sourceUrl: string | null;
  }>>([]);
  useEffect(() => {
    if (!item.snapshotId || !item.id || rawAttachments.length === 0) return;
    let cancelled = false;
    SnapshotService.getItemAttachments(item.snapshotId, item.id)
      .then(data => { if (!cancelled) setChatAttachments(data); })
      .catch(() => { if (!cancelled) setChatAttachments([]); });
    return () => { cancelled = true; };
  }, [item.snapshotId, item.id, rawAttachments.length]);

  const fmtBytes = (n: number) => {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className={`chat-item-row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <input type="checkbox" checked={checked} onChange={() => {}} onClick={onCheck} />
      <div className="chat-item-avatar">{initials}</div>
      <div className="chat-item-body">
        <div className="chat-item-header">
          <span className="chat-item-sender">{sender}{senderEmail && senderEmail !== sender ? ` <${senderEmail}>` : ''}</span>
          {sentAt && (
            <span className="chat-item-time">
              {fmtLocal(sentAt, {
                month:'short', day:'numeric', year:'numeric',
                hour:'numeric', minute:'2-digit', hour12:true,
              })}
            </span>
          )}
        </div>
        {quotedRefs.length > 0 && (
          <div className="chat-item-quote-stack">
            {quotedRefs.map((q, i) => (
              <div key={i} className="chat-item-quote">
                {q.senderName && <span className="chat-item-quote-sender">{q.senderName}: </span>}
                <span className="chat-item-quote-preview">{q.preview || '(quoted message)'}</span>
              </div>
            ))}
          </div>
        )}
        <div className="chat-item-text">{displayBody || (quotedRefs.length > 0 ? '' : '\u00a0')}</div>
        {rawAttachments.filter(isRenderableChatAttachment).length > 0 && (
          <div className="chat-item-attachments" onClick={(e) => e.stopPropagation()}>
            {chatAttachments.length === 0
              ? <span className="email-ol-attach-chip">Attachment{rawAttachments.length === 1 ? '' : 's'} (capturing…)</span>
              : chatAttachments
                  .filter(a => {
                    // Mirror the rawAttachments filter so cards that
                    // sneak through the backend's CHAT_ATTACHMENT row don't
                    // render a bare GUID chip. The backend persists card
                    // rows as metadata-only (no blob) and stores the card
                    // GUID in `name`; the row should not surface as a
                    // downloadable artefact.
                    if (!a.contentType) return true;
                    const ct = a.contentType.trim().toLowerCase();
                    return !ct.startsWith(INLINE_CARD_CONTENT_TYPE_PREFIX);
                  })
                  .map((a) => {
                  const label = a.size ? `${a.name} · ${fmtBytes(a.size)}` : a.name;
                  // CHAT_ATTACHMENT with resolved=true → real blob-backed
                  // download. Else fall back to the source contentUrl if
                  // we have one, else a static label.
                  if (a.resolved && item.snapshotId) {
                    return (
                      <a
                        key={a.id}
                        className="email-ol-attach-chip email-ol-attach-link"
                        href={API.SNAPSHOTS.ITEM_CONTENT_DOWNLOAD(item.snapshotId, a.id)}
                        download={a.name || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Download ${a.name}`}
                      >📎 {label}</a>
                    );
                  }
                  if (a.sourceUrl) {
                    return (
                      <a
                        key={a.id}
                        className="email-ol-attach-chip email-ol-attach-link"
                        href={a.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open original share link"
                      >🔗 {label} ↗</a>
                    );
                  }
                  return <span key={a.id} className="email-ol-attach-chip">{label}</span>;
                })}
          </div>
        )}
        {Array.isArray(raw.reactions) && raw.reactions.length > 0 && (
          <div className="chat-item-reactions">
            {(() => {
              // Graph's reactionType IS the emoji glyph (e.g. "👍", "❤️",
              // "😂") — earlier I mapped it through a word→emoji lookup
              // which silently fell back to "·" because the keys never
              // matched. Group by the glyph itself and show "emoji ×N"
              // with a tooltip listing the reactor names where we have
              // them (some entries arrive with displayName=null).
              const groups: Record<string, {
                count: number; names: string[]; reactionName: string;
              }> = {};
              for (const r of raw.reactions) {
                const glyph = String(r?.reactionType || '');
                if (!glyph) continue;
                const reactionName = String(r?.displayName || '');
                const n =
                  r?.user?.user?.displayName ||
                  r?.user?.application?.displayName ||
                  '';
                if (!groups[glyph]) {
                  groups[glyph] = { count: 0, names: [], reactionName };
                }
                groups[glyph].count += 1;
                if (n) groups[glyph].names.push(n);
              }
              return Object.entries(groups).map(([glyph, g]) => (
                <span
                  key={glyph}
                  className="chat-item-reaction-chip"
                  title={`${g.reactionName || ''}${g.reactionName ? ': ' : ''}${
                    g.names.join(', ') || `${g.count} reaction${g.count === 1 ? '' : 's'}`
                  }`}
                >
                  <span className="chat-item-reaction-glyph">{glyph}</span>
                  <span className="chat-item-reaction-count">{g.count}</span>
                </span>
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function EmailItemRow({ item, selected, checked, onSelect, onCheck }: {
  item: any; selected: boolean; checked: boolean;
  onSelect: () => void; onCheck: (e: React.MouseEvent) => void;
}) {
  const raw = item.metadata?.raw || {};
  const from = raw.from?.emailAddress || {};
  const sender = from.name || from.address || item.from || item.name || '(Unknown)';
  const subject = raw.subject || item.subject || item.name || '(No subject)';
  const preview = raw.bodyPreview || item.preview || '';
  const sentAt = raw.sentDateTime || raw.receivedDateTime || item.date;
  const dateStr = sentAt
    ? fmtLocalDate(sentAt, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className={`email-item-row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <input type="checkbox" checked={checked} onChange={() => {}} onClick={onCheck} />
      <div className="email-item-body">
        <div className="email-item-top">
          <span className="email-item-sender">{sender}</span>
          <span className="email-item-date">{dateStr}</span>
        </div>
        <div className="email-item-subject">{subject}</div>
        {preview && <div className="email-item-preview">{preview}</div>}
      </div>
    </div>
  );
}

export function ItemPreview({ item }: { item: any }) {
  const type = item.itemType || '';

  // Mail / Teams / Calendar — existing rich previews
  if (type === 'EMAIL') return <EmailPreview item={item} />;
  if (type === 'TEAMS_CHAT_MESSAGE' || type === 'TEAMS_MESSAGE' || type === 'TEAMS_MESSAGE_REPLY')
    return <ChatPreview item={item} />;
  if (type === 'CALENDAR_EVENT') return <CalendarPreview item={item} />;
  if (type === 'USER_CONTACT' || type === 'CONTACT') return <ContactPreview item={item} />;

  // OneNote
  if (type === 'ONENOTE_PAGE' || type === 'ONENOTE_PAGE_CONTENT'
      || type === 'ONENOTE_SECTION' || type === 'ONENOTE_NOTEBOOK'
      || type === 'ONENOTE_RESOURCE')
    return <OneNotePagePreview item={item} />;

  // Planner
  if (type === 'PLANNER_PLAN' || type === 'PLANNER_TASK' || type === 'PLANNER_TASK_DETAILS')
    return <PlannerTaskPreview item={item} />;

  // Microsoft To Do
  if (type === 'TODO_LIST' || type === 'TODO_TASK'
      || type === 'TODO_TASK_CHECKLIST' || type === 'TODO_TASK_LINKED')
    return <TodoTaskPreview item={item} />;

  // Power Platform
  if (type === 'POWER_APP_DEFINITION' || type === 'POWER_APP_PACKAGE')
    return <PowerAppPreview item={item} />;
  if (type === 'POWER_FLOW_DEFINITION' || type === 'POWER_FLOW_PACKAGE' || type === 'POWER_FLOW_CONNECTIONS')
    return <PowerFlowPreview item={item} />;
  if (type === 'POWER_DLP_POLICY')
    return <PowerDlpPreview item={item} />;

  // Files (OneDrive / SharePoint)
  if (type === 'FILE' || type === 'ONEDRIVE_FILE' || type === 'SHAREPOINT_FILE'
      || type === 'SHAREPOINT_LIST_ITEM')
    return <FilePreview item={item} />;

  // Entra user + relationship sub-items (manager / direct report / group membership)
  if (type === 'USER_PROFILE' || type === 'ENTRA_USER_PROFILE'
      || type === 'USER_MANAGER' || type === 'USER_DIRECT_REPORT'
      || type === 'USER_GROUP_MEMBERSHIP')
    return <EntraUserRelationshipPreview item={item} />;

  // Anything else — formatted JSON beats the old empty-looking fallback.
  return <JsonPreview item={item} />;
}

// ==================== Calendar Month View ====================

const EVENT_TYPE_COLORS: Record<string, string> = {
  'Cancelled':      '#dc2626',
  'All Day':        '#7c3aed',
  'Online Meeting': '#0284c7',
  'Recurring':      '#D31245',
  'Recurring Series': '#D31245',
  'Exception':      '#d97706',
  'Meeting':        '#16a34a',
  'Appointment':    '#16a34a',
};

function CalendarMonthView({ snapshotId, selectedItems, onItemCheck, onFilteredIdsChange, onCalendarFilterChange }: {
  snapshotId: string;
  selectedItems: Set<string>;
  onItemCheck: (itemId: string) => void;
  // Emitted whenever the sidebar filter set changes so the parent can
  // scope Download to just those event IDs.
  onFilteredIdsChange?: (ids: string[]) => void;
  // Emitted whenever the per-calendar filter set changes (the
  // "Calendar" section of the sidebar — values are folderPath strings
  // like "Calendar/United States holidays"). Parent passes these to
  // DownloadModal as ``folderPaths`` so PST export becomes available
  // and the backend gets the right calendar-source scope.
  onCalendarFilterChange?: (paths: string[]) => void;
}) {
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  // Per-calendar filter — keys are the folderPath value stored on each
  // CALENDAR_EVENT item (e.g. "Calendar/United States holidays"). Empty
  // set = show events from every calendar.
  const [activeCalendarFilters, setActiveCalendarFilters] = useState<Set<string>>(new Set());
  const [viewDate, setViewDate] = useState<Date>(new Date());
  // Active popover state. Anchored to the day-cell's bounding rect (not
  // the cursor) so the popover stays put while the user moves toward it.
  // `pinned` flips to true on click — disables auto-close on mouseLeave.
  // We store the full rect (left/right/top/bottom) so the popover can
  // right-align with the cell when it would overflow the viewport on
  // the right edge — last-2-columns case.
  const [popover, setPopover] = useState<{
    day: number;
    cellLeft: number;
    cellRight: number;
    cellTop: number;
    cellBottom: number;
    pinned: boolean;
  } | null>(null);

  // Hover-bridge close timer. Cell-mouseLeave does NOT close immediately;
  // it schedules a close in CLOSE_DELAY_MS so the cursor can travel from
  // the cell to the popover without losing state. The popover's own
  // mouseEnter cancels this timer; its mouseLeave reschedules it.
  // Without this bridge, the popover repositioned to whatever day-cell
  // sat underneath the popover area, breaking single-event selection.
  const closeTimer = useRef<number | null>(null);
  const CLOSE_DELAY_MS = 180;
  const cancelClose = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setPopover(prev => (prev?.pinned ? prev : null));
    }, CLOSE_DELAY_MS);
  };

  // Dismiss pinned popover on outside-click or Escape (menu-style).
  useEffect(() => {
    if (!popover?.pinned) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.cal-hover-tooltip, .cal-day-cell')) return;
      setPopover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover?.pinned]);

  // Load all events for this snapshot. viewDate stays on today's month
  // (the initial value passed to useState) so the user always lands on
  // the current month when they open the Calendar tab.
  useEffect(() => {
    if (!snapshotId) return;
    setLoading(true);
    SnapshotService.listCalendarEvents(snapshotId, 1, 1000)
      .then(data => {
        setAllEvents(data.content);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [snapshotId]);

  // Collect unique event types for filter sidebar
  const eventTypes = Array.from(new Set(allEvents.map(e => e.eventType))).sort();

  // Collect unique calendar folder paths for the per-calendar filter.
  // Each event is tagged with folderPath = "Calendar/<calendarName>" at
  // backup time — we use the full path as the filter key and strip the
  // "Calendar/" prefix for display.
  const calendarPaths = Array.from(new Set(
    allEvents.map(e => e.folderPath).filter((p): p is string => !!p)
  )).sort();

  // Apply both filters. Type filter and calendar filter are AND'ed; an
  // empty filter set on either side means "don't filter on that axis".
  const visibleEvents = allEvents.filter(e => {
    if (activeFilters.size > 0 && !activeFilters.has(e.eventType)) return false;
    if (activeCalendarFilters.size > 0 && (!e.folderPath || !activeCalendarFilters.has(e.folderPath))) return false;
    return true;
  });

  // Notify parent of the current filtered ID set so Download can scope
  // to just these events. When all filter sets are empty this is all ids.
  useEffect(() => {
    if (!onFilteredIdsChange) return;
    onFilteredIdsChange(visibleEvents.map(e => e.id));
  }, [allEvents, activeFilters, activeCalendarFilters, onFilteredIdsChange]);

  // Notify parent whenever the "Calendar" filter section selection
  // changes. The DownloadModal uses this to enable PST export — PST
  // only makes sense when the user has picked a calendar source from
  // the sidebar (a real folder), not when they're just filtering by
  // event-type or browsing all events.
  useEffect(() => {
    if (!onCalendarFilterChange) return;
    onCalendarFilterChange(Array.from(activeCalendarFilters));
  }, [activeCalendarFilters, onCalendarFilterChange]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // Group visible events by day. Parse UTC-as-UTC so the bucketed day
  // reflects the viewer's local calendar.
  const eventsByDay: Record<number, CalendarEvent[]> = {};
  visibleEvents.forEach(ev => {
    if (!ev.start) return;
    const d = parseAsUtc(ev.start);
    if (!d) return;
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!eventsByDay[day]) eventsByDay[day] = [];
      eventsByDay[day].push(ev);
    }
  });

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const toggleFilter = (type: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const totalVisible = visibleEvents.filter(e => {
    if (!e.start) return false;
    const d = parseAsUtc(e.start);
    if (!d) return false;
    return d.getFullYear() === year && d.getMonth() === month;
  }).length;

  return (
    <div className="cal-full-view">
      {/* Left: Filter sidebar */}
      <div className="cal-filter-sidebar">
        <div className="cal-filter-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:14,height:14}}>
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          Calendars
        </div>

        <div className="cal-filter-section">
          <label
            className={`cal-filter-all${activeFilters.size === 0 && activeCalendarFilters.size === 0 ? ' active' : ''}`}
            style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',width:'100%'}}
          >
            <input
              type="checkbox"
              checked={activeFilters.size === 0 && activeCalendarFilters.size === 0}
              onChange={() => { setActiveFilters(new Set()); setActiveCalendarFilters(new Set()); }}
              style={{margin:0}}
            />
            <span className="cal-filter-dot" style={{background:'#16a34a'}} />
            <span style={{flex:1,textAlign:'left'}}>All events</span>
            <span className="cal-filter-count">{allEvents.length}</span>
          </label>
        </div>

        <div className="cal-filter-divider" />

        <div className="cal-filter-section-label">Event Type</div>
        <div className="cal-filter-section">
          {eventTypes.map(type => {
            const color = EVENT_TYPE_COLORS[type] || '#64748b';
            const count = allEvents.filter(e => e.eventType === type).length;
            const isActive = activeFilters.has(type);
            return (
              <label
                key={type}
                className={`cal-filter-item${isActive ? ' active' : ''}`}
                style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',width:'100%'}}
              >
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={() => toggleFilter(type)}
                  style={{margin:0}}
                />
                <span className="cal-filter-dot" style={{background: color}} />
                <span className="cal-filter-label" style={{flex:1,textAlign:'left'}}>{type}</span>
                <span className="cal-filter-count">{count}</span>
              </label>
            );
          })}
        </div>

        {/* Per-calendar filter — every event rows carries
            folderPath="Calendar/<calendarName>" from the backup handler.
            Split on / and show the tail as a display label. Empty set =
            "show all calendars". */}
        {calendarPaths.length > 0 && (
          <>
            <div className="cal-filter-divider" />
            <div className="cal-filter-section-label">Calendar</div>
            <div className="cal-filter-section">
              {calendarPaths.map(path => {
                const display = path.includes('/') ? path.slice(path.indexOf('/') + 1) : path;
                const count = allEvents.filter(e => e.folderPath === path).length;
                const isActive = activeCalendarFilters.has(path);
                return (
                  <label
                    key={path}
                    className={`cal-filter-item${isActive ? ' active' : ''}`}
                    style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',width:'100%'}}
                  >
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => {
                        setActiveCalendarFilters(prev => {
                          const next = new Set(prev);
                          if (next.has(path)) next.delete(path);
                          else next.add(path);
                          return next;
                        });
                      }}
                      style={{margin:0}}
                    />
                    <span className="cal-filter-dot" style={{background: '#2d3748'}} />
                    <span className="cal-filter-label" style={{flex:1,textAlign:'left'}} title={path}>{display}</span>
                    <span className="cal-filter-count">{count}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {loading && (
          <div className="cal-filter-loading">
            <div className="spinner-sm" />
          </div>
        )}

        <div className="cal-filter-divider" />
        <div className="cal-filter-stat">
          <span>{totalVisible} event{totalVisible !== 1 ? 's' : ''} this month</span>
        </div>
      </div>

      {/* Right: Calendar grid */}
      <div className="cal-month-view">
        {/* Navigation bar */}
        <div className="cal-month-nav">
          <button className="cal-nav-today" onClick={() => setViewDate(new Date())}>Today</button>
          <div className="cal-nav-arrows">
            <button className="cal-nav-arrow" onClick={() => setViewDate(new Date(year, month - 1, 1))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width:14,height:14}}><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button className="cal-nav-arrow" onClick={() => setViewDate(new Date(year, month + 1, 1))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width:14,height:14}}><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <span className="cal-month-label">{monthLabel}</span>
          <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
            {activeFilters.size > 0 && (
              <button className="cal-clear-filters" onClick={() => setActiveFilters(new Set())}>
                Clear filters ({activeFilters.size})
              </button>
            )}
          </div>
        </div>

        {/* DOW row — separate from the cell grid so the 6 week rows can
            share the remaining vertical space equally without a scrollbar. */}
        <div className="cal-month-dow-row">
          {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(d => (
            <div key={d} className="cal-dow-header">{d}</div>
          ))}
        </div>

        <div className="cal-month-grid">
          {cells.map((day, i) => {
            const dayEvents = day ? (eventsByDay[day] || []) : [];
            const hasEvents = dayEvents.length > 0;
            return (
              <div
                key={i}
                className={`cal-day-cell${!day ? ' cal-day-empty' : ''}${day && isToday(day) ? ' cal-day-today' : ''}${hasEvents ? ' cal-day-has-events' : ''}${popover?.day === day ? ' cal-day-pinned' : ''}`}
                onMouseEnter={day && hasEvents ? (e) => {
                  // While pinned, hovering other cells must NOT replace
                  // the pinned popover.
                  if (popover?.pinned && popover.day !== day) return;
                  cancelClose();
                  // Capture rect synchronously — see onClick comment.
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setPopover(prev => ({
                    day,
                    cellLeft: r.left,
                    cellRight: r.right,
                    cellTop: r.top,
                    cellBottom: r.bottom,
                    pinned: prev?.pinned && prev.day === day ? true : false,
                  }));
                } : undefined}
                onMouseLeave={() => {
                  // Schedule (don't immediately close) so cursor can
                  // travel onto the popover within CLOSE_DELAY_MS.
                  if (!popover?.pinned) scheduleClose();
                }}
                onClick={day && hasEvents ? (e) => {
                  e.stopPropagation();
                  cancelClose();
                  // Capture rect BEFORE the state-updater callback —
                  // React reuses synthetic events and `e.currentTarget`
                  // is null by the time the updater runs asynchronously.
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setPopover(prev => {
                    if (prev?.pinned && prev.day === day) {
                      // Clicking the same pinned cell again closes.
                      return null;
                    }
                    return {
                      day,
                      cellLeft: r.left, cellRight: r.right,
                      cellTop: r.top, cellBottom: r.bottom,
                      pinned: true,
                    };
                  });
                } : undefined}
                role={day && hasEvents ? 'button' : undefined}
                tabIndex={day && hasEvents ? 0 : undefined}
                onKeyDown={day && hasEvents ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    cancelClose();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setPopover({
                      day,
                      cellLeft: r.left, cellRight: r.right,
                      cellTop: r.top, cellBottom: r.bottom,
                      pinned: true,
                    });
                  }
                } : undefined}
              >
                {day && (
                  <>
                    <span className="cal-day-number">{day}</span>
                    {hasEvents && (
                      <div className="cal-day-events-list" aria-label={`${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}`}>
                        {dayEvents.map(ev => {
                          const cancelled = ev.isCancelled || /^(canceled|cancelled):\s*/i.test(ev.subject || '');
                          return (
                            <div
                              key={ev.id}
                              className={`cal-day-event-label${cancelled ? ' cancelled' : ''}`}
                              style={{ borderLeftColor: cancelled ? '#dc2626' : (EVENT_TYPE_COLORS[ev.eventType] || '#16a34a') }}
                              title={(cancelled ? '[Cancelled] ' : '') + (ev.subject || '(no subject)')}
                            >
                              {cancelled && <span className="cal-day-event-tag">Cancelled</span>}
                              <span className="cal-day-event-name">{ev.subject || '(no subject)'}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Single popover anchored to the active day-cell's bounding rect.
            Always interactive — checkboxes are clickable in both hover and
            pinned modes. The hover bridge (onMouseEnter cancels the close
            timer, onMouseLeave reschedules) keeps it visible while the
            cursor travels between the cell and the popover. */}
        {popover && (eventsByDay[popover.day]?.length ?? 0) > 0 && (
          <CalendarHoverTooltip
            day={popover.day}
            cellLeft={popover.cellLeft}
            cellRight={popover.cellRight}
            cellTop={popover.cellTop}
            cellBottom={popover.cellBottom}
            events={eventsByDay[popover.day] || []}
            selectedItems={selectedItems}
            onItemCheck={onItemCheck}
            interactive={true}
            pinned={popover.pinned}
            onPopoverEnter={cancelClose}
            onPopoverLeave={() => { if (!popover.pinned) scheduleClose(); }}
            onClose={() => setPopover(null)}
          />
        )}
      </div>
    </div>
  );
}

function CalendarHoverTooltip({
  day, cellLeft, cellRight, cellTop, cellBottom,
  events, selectedItems, onItemCheck,
  interactive = false, pinned = false,
  onClose, onPopoverEnter, onPopoverLeave,
}: {
  day: number;
  // Full day-cell rect — needed so popover can right-align with cell
  // when it would overflow the viewport on the right (last 2 columns).
  cellLeft: number;
  cellRight: number;
  cellTop: number;
  cellBottom: number;
  events: CalendarEvent[];
  selectedItems: Set<string>;
  onItemCheck: (id: string) => void;
  interactive?: boolean;
  pinned?: boolean;
  onClose?: () => void;
  onPopoverEnter?: () => void;
  onPopoverLeave?: () => void;
}) {
  // Offset the popover so it doesn't sit on top of the trigger. Clamp
  // to viewport so cells in the right column / bottom row don't push it
  // off-screen.
  const GAP = 6;
  const PAD = 8;
  const maxW = 280;
  const estimatedH = Math.min(360, 56 + events.length * 22);
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;

  // Default: popover sits just below the cell, left-aligned with it.
  let left = cellLeft;
  let top = cellBottom + GAP;

  // Right-overflow → shift left only by the OVERFLOW amount (not
  // right-aligning to the cell's right edge). Right-aligning made the
  // popover land on the 3rd-last column visually because the popover
  // is wider than a cell; a small viewport-clamping shift keeps it
  // attached to the originating cell.
  const overflow = (left + maxW) - (vw - PAD);
  if (overflow > 0) {
    left = Math.max(PAD, left - overflow);
  }
  // Bottom-overflow → flip above the cell.
  let placeAbove = false;
  if (top + estimatedH > vh - PAD) {
    top = Math.max(PAD, cellTop - GAP - estimatedH);
    placeAbove = true;
  }

  // Arrow position — points at the source cell's center. Computed in
  // popover-local coordinates so the arrow stays glued to the cell
  // even when the popover shifts left to avoid right-overflow. Clamped
  // so the arrow never sits outside the popover's visible area.
  const cellCenter = (cellLeft + cellRight) / 2;
  const arrowX = Math.max(14, Math.min(maxW - 14, cellCenter - left));
  return (
    <div
      className={`cal-hover-tooltip${pinned ? ' cal-hover-tooltip-pinned' : ''}${placeAbove ? ' cal-hover-tooltip-above' : ''}`}
      style={{
        left, top, maxWidth: maxW,
        // CSS custom prop drives the arrow ::after positioning so it
        // always points at the source cell, even when the popover
        // shifted left to fit the viewport.
        ['--cal-arrow-x' as any]: `${arrowX}px`,
      }}
      role={interactive ? 'dialog' : undefined}
      aria-label={interactive ? `Day ${day} events` : undefined}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onMouseEnter={onPopoverEnter}
      onMouseLeave={onPopoverLeave}
    >
      <div className="cal-hover-header">
        <span>Day {day} · {events.length} event{events.length === 1 ? '' : 's'}</span>
        {interactive && onClose && (
          <button
            className="cal-hover-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >×</button>
        )}
      </div>
      <div className="cal-hover-list">
        {events.map(ev => {
          const cancelled = ev.isCancelled || /^(canceled|cancelled):\s*/i.test(ev.subject || '');
          const color = cancelled ? '#dc2626' : (EVENT_TYPE_COLORS[ev.eventType] || '#16a34a');
          const isChecked = selectedItems.has(ev.id);
          const when = ev.start
            ? fmtLocalTime(ev.start, { hour: 'numeric', minute: '2-digit' })
            : '';
          return (
            <div key={ev.id} className={`cal-hover-row${isChecked ? ' checked' : ''}${cancelled ? ' cancelled' : ''}`}>
              <input
                type="checkbox"
                className="cal-hover-check"
                checked={isChecked}
                onChange={() => onItemCheck(ev.id)}
                onClick={e => e.stopPropagation()}
              />
              <span className="cal-hover-dot" style={{ background: color }} />
              <span className="cal-hover-subject" title={ev.subject}>
                {cancelled && <span className="cal-day-event-tag" style={{ marginRight: 6 }}>Cancelled</span>}
                {ev.subject || '(no subject)'}
              </span>
              {when && <span className="cal-hover-time">{when}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== OneDrive Drive-style components ====================
// Dedicated left panel + middle table for the OneDrive tab. Renders a
// Google-Drive-style layout (My Drive tree on the left, file table in the
// middle) and takes the full width — the right preview panel is hidden for
// this tab so the table has room to breathe.

function bytesToSize(bytes: number): string {
  if (!bytes) return '—';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const v = bytes / Math.pow(k, i);
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

// Normalize Graph paths so the tree lines up with the items returned by
// /onedrive: backend strips "/drives/{id}/root:" and we treat "/" as the
// "My Drive" root. Empty path or "/" → root.
function odNormalizePath(p: string | null | undefined): string {
  if (!p || p === '') return '/';
  return p.startsWith('/') ? p : '/' + p;
}

// Return the direct-child folder names for a given parent path, sorted.
// e.g. folders=["/Documents", "/Documents/Sub", "/Attachments"],
// parent="/" → ["Attachments", "Documents"]; parent="/Documents" → ["Sub"].
function odDirectSubfolders(folders: Array<{ path: string; count: number }>, parent: string): Array<{ name: string; fullPath: string }> {
  const p = parent === '/' ? '' : parent;
  const seen = new Map<string, string>();
  for (const f of folders) {
    const full = odNormalizePath(f.path);
    if (parent === '/') {
      // direct children of root: one segment after "/"
      const rest = full.slice(1);
      if (!rest) continue;
      const first = rest.split('/')[0];
      seen.set(first, '/' + first);
    } else {
      if (!full.startsWith(p + '/')) continue;
      const rest = full.slice(p.length + 1);
      if (!rest) continue;
      const first = rest.split('/')[0];
      if (first) seen.set(first, p + '/' + first);
    }
  }
  return Array.from(seen.entries())
    .map(([name, fullPath]) => ({ name, fullPath }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function OneDriveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.92,11a6,6,0,0,0-11.16-2A4.5,4.5,0,0,0,7.5,18h10a3.49,3.49,0,0,0,.42-7Z" />
    </svg>
  );
}

function RecentIcon() {
  return (
    <svg viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M7.5 7.5H7C7 7.63261 7.05268 7.75979 7.14645 7.85355L7.5 7.5ZM7.5 14C3.91015 14 1 11.0899 1 7.5H0C0 11.6421 3.35786 15 7.5 15V14ZM14 7.5C14 11.0899 11.0899 14 7.5 14V15C11.6421 15 15 11.6421 15 7.5H14ZM7.5 1C11.0899 1 14 3.91015 14 7.5H15C15 3.35786 11.6421 0 7.5 0V1ZM7.5 0C3.35786 0 0 3.35786 0 7.5H1C1 3.91015 3.91015 1 7.5 1V0ZM7 3V7.5H8V3H7ZM7.14645 7.85355L10.1464 10.8536L10.8536 10.1464L7.85355 7.14645L7.14645 7.85355Z" />
    </svg>
  );
}

// Used for folder rows in the middle-panel table (My Drive mode).
const FolderIcon = (
  <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M0.5 12.5V2.5C0.5 1.94772 0.947715 1.5 1.5 1.5H5.5L7.5 3.5H13.5C14.0523 3.5 14.5 3.94772 14.5 4.5V12.5C14.5 13.0523 14.0523 13.5 13.5 13.5H1.5C0.947715 13.5 0.5 13.0523 0.5 12.5Z" />
  </svg>
);

function OneDriveLeftPanel({
  view, setView,
}: {
  view: 'my-drive' | 'recent';
  setView: (v: 'my-drive' | 'recent') => void;
}) {
  // Only ONE handler per click — setView already writes both view+folder
  // atomically via patchSearchParams in the caller. Calling a separate
  // setSelectedFolder right after would just overwrite view with a stale
  // value (that was the Recent-does-nothing bug).
  return (
    <div className="od-left">
      <button
        className={`od-left-section ${view === 'my-drive' ? 'active' : ''}`}
        onClick={() => setView('my-drive')}
      >
        <span className="od-left-icon od-left-icon-svg" aria-hidden><OneDriveIcon /></span>
        <span className="od-left-label">My Drive</span>
      </button>
      <button
        className={`od-left-section ${view === 'recent' ? 'active' : ''}`}
        onClick={() => setView('recent')}
      >
        <span className="od-left-icon od-left-icon-svg" aria-hidden><RecentIcon /></span>
        <span className="od-left-label">Recent</span>
      </button>
    </div>
  );
}

// File-type icons drawn as inline SVG so they scale with `currentColor`
// and don't depend on emoji font support. All five share a 15×15 viewBox
// so spacing is uniform in the table's Name column.

const FIcon_Default = (
  <svg viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M10.5 0.5L10.8536 0.146447L10.7071 0H10.5V0.5ZM13.5 3.5H14V3.29289L13.8536 3.14645L13.5 3.5ZM12.5 14H2.5V15H12.5V14ZM2 13.5V1.5H1V13.5H2ZM2.5 1H10.5V0H2.5V1ZM13 3.5V13.5H14V3.5H13ZM10.1464 0.853553L13.1464 3.85355L13.8536 3.14645L10.8536 0.146447L10.1464 0.853553ZM2.5 14C2.22386 14 2 13.7761 2 13.5H1C1 14.3284 1.67157 15 2.5 15V14ZM12.5 15C13.3284 15 14 14.3284 14 13.5H13C13 13.7761 12.7761 14 12.5 14V15ZM2 1.5C2 1.22386 2.22386 1 2.5 1V0C1.67157 0 1 0.671574 1 1.5H2Z" />
  </svg>
);

const FIcon_PNG = (
  <svg viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M2.5 6.5V6H2V6.5H2.5ZM10.5 10.5H10V11H10.5V10.5ZM12.5 10.5V11H13V10.5H12.5ZM13.5 3.5H14V3.29289L13.8536 3.14645L13.5 3.5ZM10.5 0.5L10.8536 0.146447L10.7071 0H10.5V0.5ZM6.5 6.5L6.94721 6.27639L6 6.5H6.5ZM6 10.5V11H7V10.5H6ZM8.5 10.5L8.05279 10.7236C8.15649 10.931 8.38919 11.0399 8.61488 10.9866C8.84056 10.9333 9 10.7319 9 10.5H8.5ZM9 6.5V6H8V6.5H9ZM2.5 7H3.5V6H2.5V7ZM3 11V8.5H2V11H3ZM3 8.5V6.5H2V8.5H3ZM3.5 8H2.5V9H3.5V8ZM4 7.5C4 7.77614 3.77614 8 3.5 8V9C4.32843 9 5 8.32843 5 7.5H4ZM3.5 7C3.77614 7 4 7.22386 4 7.5H5C5 6.67157 4.32843 6 3.5 6V7ZM10 6V10.5H11V6H10ZM10.5 11H12.5V10H10.5V11ZM13 10.5V8.5H12V10.5H13ZM10.5 7H13V6H10.5V7ZM2 5V1.5H1V5H2ZM13 3.5V5H14V3.5H13ZM2.5 1H10.5V0H2.5V1ZM10.1464 0.853553L13.1464 3.85355L13.8536 3.14645L10.8536 0.146447L10.1464 0.853553ZM2 1.5C2 1.22386 2.22386 1 2.5 1V0C1.67157 0 1 0.671573 1 1.5H2ZM1 12V13.5H2V12H1ZM2.5 15H12.5V14H2.5V15ZM14 13.5V12H13V13.5H14ZM12.5 15C13.3284 15 14 14.3284 14 13.5H13C13 13.7761 12.7761 14 12.5 14V15ZM1 13.5C1 14.3284 1.67157 15 2.5 15V14C2.22386 14 2 13.7761 2 13.5H1ZM6 6.5V10.5H7V6.5H6ZM6.05279 6.72361L8.05279 10.7236L8.94721 10.2764L6.94721 6.27639L6.05279 6.72361ZM8 6.5V10.5H9V6.5H8Z" />
  </svg>
);

const FIcon_CSV = (
  <svg viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M13.5 3.5H14V3.29289L13.8536 3.14645L13.5 3.5ZM10.5 0.5L10.8536 0.146447L10.7071 0H10.5V0.5ZM6.5 6.5V6H6V6.5H6.5ZM6.5 8.5H6V9H6.5V8.5ZM8.5 8.5H9V8H8.5V8.5ZM8.5 10.5V11H9V10.5H8.5ZM10.5 9.5H10V9.70711L10.1464 9.85355L10.5 9.5ZM11.5 10.5L11.1464 10.8536L11.5 11.2071L11.8536 10.8536L11.5 10.5ZM12.5 9.5L12.8536 9.85355L13 9.70711V9.5H12.5ZM2.5 6.5V6H2V6.5H2.5ZM2.5 10.5H2V11H2.5V10.5ZM2 5V1.5H1V5H2ZM13 3.5V5H14V3.5H13ZM2.5 1H10.5V0H2.5V1ZM10.1464 0.853553L13.1464 3.85355L13.8536 3.14645L10.8536 0.146447L10.1464 0.853553ZM2 1.5C2 1.22386 2.22386 1 2.5 1V0C1.67157 0 1 0.671573 1 1.5H2ZM1 12V13.5H2V12H1ZM2.5 15H12.5V14H2.5V15ZM14 13.5V12H13V13.5H14ZM12.5 15C13.3284 15 14 14.3284 14 13.5H13C13 13.7761 12.7761 14 12.5 14V15ZM1 13.5C1 14.3284 1.67157 15 2.5 15V14C2.22386 14 2 13.7761 2 13.5H1ZM9 6H6.5V7H9V6ZM6 6.5V8.5H7V6.5H6ZM6.5 9H8.5V8H6.5V9ZM8 8.5V10.5H9V8.5H8ZM8.5 10H6V11H8.5V10ZM10 6V9.5H11V6H10ZM10.1464 9.85355L11.1464 10.8536L11.8536 10.1464L10.8536 9.14645L10.1464 9.85355ZM11.8536 10.8536L12.8536 9.85355L12.1464 9.14645L11.1464 10.1464L11.8536 10.8536ZM13 9.5V6H12V9.5H13ZM5 6H2.5V7H5V6ZM2 6.5V10.5H3V6.5H2ZM2.5 11H5V10H2.5V11Z" />
  </svg>
);

const FIcon_PDF = (
  <svg viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M2.5 6.5V6H2V6.5H2.5ZM6.5 6.5V6H6V6.5H6.5ZM6.5 10.5H6V11H6.5V10.5ZM13.5 3.5H14V3.29289L13.8536 3.14645L13.5 3.5ZM10.5 0.5L10.8536 0.146447L10.7071 0H10.5V0.5ZM2.5 7H3.5V6H2.5V7ZM3 11V8.5H2V11H3ZM3 8.5V6.5H2V8.5H3ZM3.5 8H2.5V9H3.5V8ZM4 7.5C4 7.77614 3.77614 8 3.5 8V9C4.32843 9 5 8.32843 5 7.5H4ZM3.5 7C3.77614 7 4 7.22386 4 7.5H5C5 6.67157 4.32843 6 3.5 6V7ZM6 6.5V10.5H7V6.5H6ZM6.5 11H7.5V10H6.5V11ZM9 9.5V7.5H8V9.5H9ZM7.5 6H6.5V7H7.5V6ZM9 7.5C9 6.67157 8.32843 6 7.5 6V7C7.77614 7 8 7.22386 8 7.5H9ZM7.5 11C8.32843 11 9 10.3284 9 9.5H8C8 9.77614 7.77614 10 7.5 10V11ZM10 6V11H11V6H10ZM10.5 7H13V6H10.5V7ZM10.5 9H12V8H10.5V9ZM2 5V1.5H1V5H2ZM13 3.5V5H14V3.5H13ZM2.5 1H10.5V0H2.5V1ZM10.1464 0.853553L13.1464 3.85355L13.8536 3.14645L10.8536 0.146447L10.1464 0.853553ZM2 1.5C2 1.22386 2.22386 1 2.5 1V0C1.67157 0 1 0.671573 1 1.5H2ZM1 12V13.5H2V12H1ZM2.5 15H12.5V14H2.5V15ZM14 13.5V12H13V13.5H14ZM12.5 15C13.3284 15 14 14.3284 14 13.5H13C13 13.7761 12.7761 14 12.5 14V15ZM1 13.5C1 14.3284 1.67157 15 2.5 15V14C2.22386 14 2 13.7761 2 13.5H1Z" />
  </svg>
);

const FIcon_DOC = (
  <svg viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M2.5 6.5V6H2V6.5H2.5ZM2.5 10.5H2V11H2.5V10.5ZM12.5 6.5H13V6H12.5V6.5ZM12.5 10.5V11H13V10.5H12.5ZM13.5 3.5H14V3.29289L13.8536 3.14645L13.5 3.5ZM10.5 0.5L10.8536 0.146447L10.7071 0H10.5V0.5ZM2 6.5V10.5H3V6.5H2ZM2.5 11H3.5V10H2.5V11ZM5 9.5V7.5H4V9.5H5ZM3.5 6H2.5V7H3.5V6ZM5 7.5C5 6.67157 4.32843 6 3.5 6V7C3.77614 7 4 7.22386 4 7.5H5ZM3.5 11C4.32843 11 5 10.3284 5 9.5H4C4 9.77614 3.77614 10 3.5 10V11ZM6 7.5V9.5H7V7.5H6ZM9 9.5V7.5H8V9.5H9ZM9 7.5C9 6.67157 8.32843 6 7.5 6V7C7.77614 7 8 7.22386 8 7.5H9ZM7.5 11C8.32843 11 9 10.3284 9 9.5H8C8 9.77614 7.77614 10 7.5 10V11ZM6 9.5C6 10.3284 6.67157 11 7.5 11V10C7.22386 10 7 9.77614 7 9.5H6ZM7 7.5C7 7.22386 7.22386 7 7.5 7V6C6.67157 6 6 6.67157 6 7.5H7ZM10 6V11H11V6H10ZM10.5 7H12.5V6H10.5V7ZM12 6.5V8H13V6.5H12ZM10.5 11H12.5V10H10.5V11ZM13 10.5V9H12V10.5H13ZM2 5V1.5H1V5H2ZM13 3.5V5H14V3.5H13ZM2.5 1H10.5V0H2.5V1ZM10.1464 0.853553L13.1464 3.85355L13.8536 3.14645L10.8536 0.146447L10.1464 0.853553ZM2 1.5C2 1.22386 2.22386 1 2.5 1V0C1.67157 0 1 0.671573 1 1.5H2ZM1 12V13.5H2V12H1ZM2.5 15H12.5V14H2.5V15ZM14 13.5V12H13V13.5H14ZM12.5 15C13.3284 15 14 14.3284 14 13.5H13C13 13.7761 12.7761 14 12.5 14V15ZM1 13.5C1 14.3284 1.67157 15 2.5 15V14C2.22386 14 2 13.7761 2 13.5H1Z" />
  </svg>
);

const FIcon_PPT = (
  <svg viewBox="0 0 15 15" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M2.5 6.5V6H2V6.5H2.5ZM6.5 6.5V6H6V6.5H6.5ZM13.5 3.5H14V3.29289L13.8536 3.14645L13.5 3.5ZM10.5 0.5L10.8536 0.146447L10.7071 0H10.5V0.5ZM2.5 7H3.5V6H2.5V7ZM3 11V8.5H2V11H3ZM3 8.5V6.5H2V8.5H3ZM3.5 8H2.5V9H3.5V8ZM4 7.5C4 7.77614 3.77614 8 3.5 8V9C4.32843 9 5 8.32843 5 7.5H4ZM3.5 7C3.77614 7 4 7.22386 4 7.5H5C5 6.67157 4.32843 6 3.5 6V7ZM6.5 7H7.5V6H6.5V7ZM7 11V8.5H6V11H7ZM7 8.5V6.5H6V8.5H7ZM7.5 8H6.5V9H7.5V8ZM8 7.5C8 7.77614 7.77614 8 7.5 8V9C8.32843 9 9 8.32843 9 7.5H8ZM7.5 7C7.77614 7 8 7.22386 8 7.5H9C9 6.67157 8.32843 6 7.5 6V7ZM11 6V11H12V6H11ZM10 7H13V6H10V7ZM2 5V1.5H1V5H2ZM13 3.5V5H14V3.5H13ZM2.5 1H10.5V0H2.5V1ZM10.1464 0.853553L13.1464 3.85355L13.8536 3.14645L10.8536 0.146447L10.1464 0.853553ZM2 1.5C2 1.22386 2.22386 1 2.5 1V0C1.67157 0 1 0.671573 1 1.5H2ZM1 12V13.5H2V12H1ZM2.5 15H12.5V14H2.5V15ZM14 13.5V12H13V13.5H14ZM12.5 15C13.3284 15 14 14.3284 14 13.5H13C13 13.7761 12.7761 14 12.5 14V15ZM1 13.5C1 14.3284 1.67157 15 2.5 15V14C2.22386 14 2 13.7761 2 13.5H1Z" />
  </svg>
);

function odFileIcon(name: string): React.ReactNode {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff'].includes(ext)) return FIcon_PNG;
  if (['csv', 'xls', 'xlsx', 'tsv'].includes(ext)) return FIcon_CSV;
  if (ext === 'pdf') return FIcon_PDF;
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return FIcon_DOC;
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return FIcon_PPT;
  return FIcon_Default;
}

function OneDriveTable({
  items, folders, view, selectedFolder, onOpenFolder,
  selectedItems, onToggleItem, onSelectAll, allChecked,
  onFolderCheck, folderBusy, folderSelected,
  snapshotId,
}: {
  items: RecoveryItem[];
  folders: Array<{ path: string; count: number }>;
  view: 'my-drive' | 'recent';
  selectedFolder: string;
  onOpenFolder: (path: string) => void;
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectAll: (checked: boolean) => void;
  allChecked: boolean;
  onFolderCheck: (folderPath: string) => void;
  folderBusy: Set<string>;
  folderSelected: Set<string>;
  snapshotId: string | null;
}) {
  // In My Drive mode we interleave direct subfolders at the top of the list
  // so the UX mirrors a real file explorer. In Recent mode we skip folders
  // entirely — the whole point of Recent is a flat timeline.
  const currentParent = selectedFolder === 'all' ? '/' : (selectedFolder || '/');
  const subFolders = view === 'my-drive' ? odDirectSubfolders(folders, currentParent) : [];

  return (
    <div className="od-table">
      <div className="od-table-head">
        <div className="od-th od-th-check">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={e => onSelectAll(e.target.checked)}
          />
        </div>
        <div className="od-th od-th-name">Name <span className="od-th-arrow">↓</span></div>
        <div className="od-th od-th-owner">Owner</div>
        <div className="od-th od-th-modified">Last modified</div>
        <div className="od-th od-th-size">File size</div>
      </div>

      <div className="od-table-body">
        {subFolders.map(sf => {
          const busy = folderBusy.has(sf.fullPath);
          const checked = folderSelected.has(sf.fullPath);
          return (
            <div
              key={`folder:${sf.fullPath}`}
              className={`od-row od-row-folder ${checked ? 'selected' : ''}`}
              onClick={() => onOpenFolder(sf.fullPath)}
            >
              <div className="od-td od-td-check" onClick={e => e.stopPropagation()}>
                {/* Checkbox selects EVERY file under this folder (recursive).
                    Backend returns all ids where folder_path starts with
                    sf.fullPath; those get toggled into selectedItems.
                    Checked state flips immediately for UX feedback; the id
                    fetch resolves asynchronously underneath. */}
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={(e) => { e.stopPropagation(); onFolderCheck(sf.fullPath); }}
                  onClick={e => e.stopPropagation()}
                />
                {busy && <span style={{ marginLeft: 4, fontSize: 10, color: '#6b7280' }}>...</span>}
              </div>
              <div className="od-td od-td-name">
                <span className="od-row-icon" aria-hidden>{FolderIcon}</span>
                <span className="od-row-name">{sf.name}</span>
              </div>
              <div className="od-td od-td-owner">—</div>
              <div className="od-td od-td-modified">—</div>
              <div className="od-td od-td-size">—</div>
            </div>
          );
        })}

        {items.map((item: any) => {
          const raw = item.metadata?.raw || item;
          const owner = raw.createdBy?.user?.displayName
            || raw.lastModifiedBy?.user?.displayName
            || '—';
          const modified = raw.lastModifiedDateTime || raw.createdDateTime || item.date || item.createdAt;
          const size = item.contentSize ?? raw.size ?? 0;
          const hasBlob = !!item.blobPath;
          return (
            <div
              key={item.id}
              className={`od-row od-row-file ${selectedItems.has(item.id) ? 'selected' : ''}`}
            >
              <div className="od-td od-td-check" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedItems.has(item.id)}
                  onChange={() => onToggleItem(item.id)}
                />
              </div>
              <div className="od-td od-td-name" title={item.name}>
                {hasBlob && snapshotId ? (
                  <a
                    className="od-row-link"
                    href={API.SNAPSHOTS.ITEM_CONTENT_DOWNLOAD(snapshotId, item.id)}
                    // `download` attribute hints the browser to save with
                    // this filename even if Content-Disposition gets
                    // stripped by a proxy/gateway along the way.
                    download={item.name || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    title={`Download ${item.name}`}
                  >
                    <span className="od-row-icon" aria-hidden>{odFileIcon(item.name || '')}</span>
                    <span className="od-row-name">{item.name}</span>
                  </a>
                ) : (
                  <>
                    <span className="od-row-icon" aria-hidden>{odFileIcon(item.name || '')}</span>
                    <span className="od-row-name">{item.name}</span>
                    {!hasBlob && <span className="od-row-tag">metadata only</span>}
                  </>
                )}
              </div>
              <div className="od-td od-td-owner">{owner}</div>
              <div className="od-td od-td-modified">{modified ? fmtLocalDate(modified, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</div>
              <div className="od-td od-td-size">{size ? bytesToSize(size) : '—'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== SharePoint Site Recovery view ====================
// SharePoint sites don't fit the five fixed tabs either. The left rail has
// two options — "Site content" (all files captured in the latest snapshot)
// and "Subsites" (live list from Graph). Middle panel swaps based on which
// is selected. Similar shape to OneDrive's My Drive / Recent pattern.

function SiteContentIcon() {
  return (
    <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M3.5 8.5V1.5C3.5 0.947715 3.94772 0.5 4.5 0.5H7.5L9.5 2.5H13.5C14.0523 2.5 14.5 2.94772 14.5 3.5V8.5C14.5 9.05228 14.0523 9.5 13.5 9.5H4.5M3.5 8.5C3.5 9.05229 3.94772 9.5 4.5 9.5M3.5 8.5V5.5H1.5C0.947715 5.5 0.5 5.94772 0.5 6.5V13.5C0.5 14.0523 0.947715 14.5 1.5 14.5H10.5C11.0523 14.5 11.5 14.0523 11.5 13.5V9.5H4.5" />
    </svg>
  );
}

function SubsitesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M3 12H21M12 8V12M6.5 12V16M17.5 12V16M10.1 8H13.9C14.4601 8 14.7401 8 14.954 7.89101C15.1422 7.79513 15.2951 7.64215 15.391 7.45399C15.5 7.24008 15.5 6.96005 15.5 6.4V4.6C15.5 4.03995 15.5 3.75992 15.391 3.54601C15.2951 3.35785 15.1422 3.20487 14.954 3.10899C14.7401 3 14.4601 3 13.9 3H10.1C9.53995 3 9.25992 3 9.04601 3.10899C8.85785 3.20487 8.70487 3.35785 8.60899 3.54601C8.5 3.75992 8.5 4.03995 8.5 4.6V6.4C8.5 6.96005 8.5 7.24008 8.60899 7.45399C8.70487 7.64215 8.85785 7.79513 9.04601 7.89101C9.25992 8 9.53995 8 10.1 8ZM15.6 21H19.4C19.9601 21 20.2401 21 20.454 20.891C20.6422 20.7951 20.7951 20.6422 20.891 20.454C21 20.2401 21 19.9601 21 19.4V17.6C21 17.0399 21 16.7599 20.891 16.546C20.7951 16.3578 20.6422 16.2049 20.454 16.109C20.2401 16 19.9601 16 19.4 16H15.6C15.0399 16 14.7599 16 14.546 16.109C14.3578 16.2049 14.2049 16.3578 14.109 16.546C14 16.7599 14 17.0399 14 17.6V19.4C14 19.9601 14 20.2401 14.109 20.454C14.2049 20.6422 14.3578 20.7951 14.546 20.891C14.7599 21 15.0399 21 15.6 21ZM4.6 21H8.4C8.96005 21 9.24008 21 9.45399 20.891C9.64215 20.7951 9.79513 20.6422 9.89101 20.454C10 20.2401 10 19.9601 10 19.4V17.6C10 17.0399 10 16.7599 9.89101 16.546C9.79513 16.3578 9.64215 16.2049 9.45399 16.109C9.24008 16 8.96005 16 8.4 16H4.6C4.03995 16 3.75992 16 3.54601 16.109C3.35785 16.2049 3.20487 16.3578 3.10899 16.546C3 16.7599 3 17.0399 3 17.6V19.4C3 19.9601 3 20.2401 3.10899 20.454C3.20487 20.6422 3.35785 20.7951 3.54601 20.891C3.75992 21 4.03995 21 4.6 21Z" />
    </svg>
  );
}

// SharePoint lists ship their list-item columns through SP REST's
// $expand=FieldValuesAsText. Rather than dump every field SP returns
// (AFI's default view shows 30+ columns, most of them plumbing), we
// curate an "essentials" set per list template below. Unknown
// templates fall back to dynamic derivation.
type CatalogColumn = { key: string; label: string; isUrl?: boolean };

// Normalized SharePoint list template name → columns the Recovery
// grid should surface. Keys match TEMPLATE_NUM_TO_NAME on the backend
// (workers/backup-worker/main.py) so a list row's metadata.template
// value indexes directly into this map.
const CATALOG_COLUMNS: Record<string, CatalogColumn[]> = {
  // ── Catalog / gallery lists ────────────────────────────────
  // Composed Looks (124) — each row is a theme. AFI view:
  // Title / Modified / Name / MasterPageUrl / ThemeUrl / ImageUrl / FontSchemeUrl.
  composedlooks: [
    { key: 'Title', label: 'Title' },
    { key: 'Modified', label: 'Modified' },
    { key: 'FileLeafRef', label: 'Name' },
    { key: 'MasterPageUrl', label: 'Master Page URL', isUrl: true },
    { key: 'ThemeUrl', label: 'Theme URL', isUrl: true },
    { key: 'ImageUrl', label: 'Image URL', isUrl: true },
    { key: 'FontSchemeUrl', label: 'Font Scheme URL', isUrl: true },
  ],
  // Master Page Gallery (116) — .master / .preview / display templates.
  masterpagecatalog: [
    { key: 'Title', label: 'Title' },
    { key: 'Modified', label: 'Modified' },
    { key: 'FileLeafRef', label: 'Name' },
    { key: 'MasterPageDescription', label: 'Description' },
  ],
  themecatalog: [
    { key: 'Title', label: 'Title' },
    { key: 'Modified', label: 'Modified' },
    { key: 'FileLeafRef', label: 'Name' },
  ],
  webpartcatalog: [
    { key: 'Title', label: 'Title' },
    { key: 'Modified', label: 'Modified' },
    { key: 'FileLeafRef', label: 'Name' },
    { key: 'Description', label: 'Description' },
  ],
  webtemplatecatalog: [
    { key: 'Title', label: 'Title' },
    { key: 'Modified', label: 'Modified' },
    { key: 'FileLeafRef', label: 'Name' },
  ],
  solutioncatalog: [
    { key: 'Title', label: 'Title' },
    { key: 'Modified', label: 'Modified' },
    { key: 'FileLeafRef', label: 'Name' },
    { key: 'SolutionVersion', label: 'Version' },
  ],
  appdatacatalog: [
    { key: 'Title', label: 'Title' },
    { key: 'Modified', label: 'Modified' },
    { key: 'FileLeafRef', label: 'Name' },
  ],
  appfilescatalog: [
    { key: 'Title', label: 'Title' },
    { key: 'Modified', label: 'Modified' },
    { key: 'FileLeafRef', label: 'Name' },
  ],

  // ── Standard lists ─────────────────────────────────────────
  // Tasks (107 / 171) — classic project tracking.
  tasks: [
    { key: 'Title', label: 'Title' },
    { key: 'AssignedTo', label: 'Assigned To' },
    { key: 'DueDate', label: 'Due Date' },
    { key: 'Status', label: 'Status' },
    { key: 'Priority', label: 'Priority' },
    { key: 'PercentComplete', label: '% Complete' },
  ],
  // Events / Calendar (106).
  events: [
    { key: 'Title', label: 'Title' },
    { key: 'EventDate', label: 'Start Time' },
    { key: 'EndDate', label: 'End Time' },
    { key: 'Location', label: 'Location' },
    { key: 'Category', label: 'Category' },
    { key: 'Description', label: 'Description' },
  ],
  announcements: [
    { key: 'Title', label: 'Title' },
    { key: 'Body', label: 'Body' },
    { key: 'Expires', label: 'Expires' },
    { key: 'Modified', label: 'Modified' },
  ],
  contacts: [
    { key: 'FullName', label: 'Name' },
    { key: 'EMail', label: 'Email' },
    { key: 'WorkPhone', label: 'Work Phone' },
    { key: 'Company', label: 'Company' },
    { key: 'JobTitle', label: 'Job Title' },
  ],
  links: [
    { key: 'URL', label: 'URL', isUrl: true },
    { key: 'Comments', label: 'Comments' },
    { key: 'Modified', label: 'Modified' },
  ],
  discussion: [
    { key: 'Title', label: 'Subject' },
    { key: 'Author', label: 'Author' },
    { key: 'Modified', label: 'Modified' },
  ],
  survey: [
    { key: 'Title', label: 'Title' },
    { key: 'Author', label: 'Author' },
    { key: 'Modified', label: 'Modified' },
  ],
  genericlist: [
    { key: 'Title', label: 'Title' },
    { key: 'Modified', label: 'Modified' },
    { key: 'Author', label: 'Created By' },
    { key: 'Editor', label: 'Modified By' },
  ],
  documentlibrary: [
    { key: 'Title', label: 'Title' },
    { key: 'FileLeafRef', label: 'Name' },
    { key: 'Modified', label: 'Modified' },
    { key: 'Editor', label: 'Modified By' },
  ],
  picturelibrary: [
    { key: 'Title', label: 'Title' },
    { key: 'FileLeafRef', label: 'Name' },
    { key: 'Modified', label: 'Modified' },
    { key: 'ImageWidth', label: 'Width' },
    { key: 'ImageHeight', label: 'Height' },
  ],
  sitepages: [
    { key: 'Title', label: 'Title' },
    { key: 'FileLeafRef', label: 'Name' },
    { key: 'Modified', label: 'Modified' },
    { key: 'Editor', label: 'Modified By' },
  ],
  maintenancelog: [
    { key: 'Title', label: 'Title' },
    { key: 'FileLeafRef', label: 'Name' },
    { key: 'Modified', label: 'Modified' },
  ],
};

// SP Graph returns list template as either a name string OR a numeric
// ListTemplate id. Frontend-side map — matches TEMPLATE_NUM_TO_NAME on
// the backup worker so a snapshot produced under either normalization
// regime looks up the right column set.
const TEMPLATE_NUM_MAP: Record<string, string> = {
  '100': 'genericlist',
  '101': 'documentlibrary',
  '102': 'survey',
  '103': 'links',
  '104': 'announcements',
  '105': 'contacts',
  '106': 'events',
  '107': 'tasks',
  '108': 'discussion',
  '109': 'picturelibrary',
  '113': 'webpartcatalog',
  '114': 'webtemplatecatalog',
  '116': 'masterpagecatalog',
  '119': 'sitepages',
  '121': 'solutioncatalog',
  '123': 'themecatalog',
  '124': 'composedlooks',
  '125': 'appdatacatalog',
  '126': 'appfilescatalog',
  '171': 'tasks',
  '175': 'maintenancelog',
};

function normalizeTemplate(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase();
  return TEMPLATE_NUM_MAP[s] ?? s;
}

// Truly opaque plumbing fields SP REST returns for every row — IDs,
// click-to-edit shims, sort keys. AFI's list view still surfaces many
// `_`-prefixed and `_x0020_`-encoded fields (_Level, _ColorTag,
// HTML_x0020_File_x0020_Type, …) so we DON'T blanket-exclude those.
// FileRef / FileDirRef / EncodedAbsUrl are useful URL columns — kept in.
const SP_INTERNAL_FIELDS = new Set<string>([
  'ID', 'GUID', 'UniqueId', 'InstanceID', 'WorkflowInstanceID',
  'ContentTypeId', 'ScopeId', 'OriginatorId', 'ComplianceAssetId',
  'MetaInfo', 'Order', 'DocIcon', 'Edit', 'IconOverlay', 'PermMask',
  'SelectTitle', 'SelectFilename',
  'LinkFilename', 'LinkFilename2', 'LinkFilenameNoMenu',
  'LinkTitle', 'LinkTitleNoMenu',
  'FileSizeDisplay', 'SortBehavior', 'BaseName',
  'Attachments',
  'AppAuthor', 'AppEditor', 'AccessPolicy',
  'ParentVersionString', 'ParentLeafName', 'ProgId',
  'AverageRating', 'RatingCount', 'NoExecute',
  'WorkflowVersion', 'owshiddenversion',
  'SMTotalFileCount', 'SMTotalSize', 'SMLastModifiedDate', 'SMTotalFileStreamSize',
  'ItemChildCount', 'FolderChildCount',
]);

function isSpInternalField(key: string): boolean {
  if (!key) return true;
  if (key.startsWith('ows_')) return true;           // legacy OWS fields
  if (SP_INTERNAL_FIELDS.has(key)) return true;
  return false;
}

function humanizeSpFieldName(key: string): string {
  if (key === 'FileLeafRef') return 'Name';
  if (key === 'Modified') return 'Modified';
  if (key === 'Created') return 'Created';
  if (key === 'Author') return 'Created By';
  if (key === 'Editor') return 'Modified By';
  // Strip Microsoft's _x0020_ space-encoding, then camelCase → words.
  const decoded = key.replace(/_x([0-9a-fA-F]{4})_/g, (_m, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  const spaced = decoded.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced
    .replace(/\bUrl\b/g, 'URL')
    .replace(/\bUri\b/g, 'URI')
    .replace(/\bId\b/g, 'ID');
}

// Pull the column definition for a grid view from the rows' metadata.columns.
// Returns null when no row has any user-visible column data, which tells the
// caller to fall back to the file-centric Owner / Modified / Size grid.
function deriveDynamicColumns(rows: any[]): CatalogColumn[] | null {
  const keys = new Set<string>();
  for (const it of rows) {
    const cols = (it?.metadata || {}).columns;
    if (cols && typeof cols === 'object') {
      for (const k of Object.keys(cols)) {
        if (!isSpInternalField(k)) keys.add(k);
      }
    }
  }
  if (keys.size === 0) return null;
  // Preferred order: Title → Modified → Name, then everything else
  // alphabetically. Keeps the "key identity" columns on the left.
  const preferred = ['Title', 'Modified', 'FileLeafRef'];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const k of preferred) {
    if (keys.has(k)) { ordered.push(k); seen.add(k); }
  }
  for (const k of Array.from(keys).sort()) {
    if (!seen.has(k)) ordered.push(k);
  }
  return ordered.map(key => ({
    key,
    label: humanizeSpFieldName(key),
    isUrl: /Url$|URL$/.test(key),
  }));
}

function SharePointView({
  resourceId, snapshots, selectedItems, onToggleItem, onSelectAll,
}: {
  resourceId: string;
  snapshots: SnapshotItem[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectAll: (ids: string[], checked: boolean) => void;
}) {
  const [view, setView] = useState<'content' | 'subsites'>('content');

  // Latest COMPLETED snapshot for this site — holds the captured files.
  const latestSnapshot = useMemo(() => {
    return snapshots
      .filter(s => s.resourceId === resourceId && s.status === 'COMPLETED')
      .sort((a, b) => {
        const ta = parseAsUtc(a.createdAt)?.getTime() ?? 0;
        const tb = parseAsUtc(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      })[0] || null;
  }, [snapshots, resourceId]);

  // Site content = items in the latest snapshot (loaded lazily on demand).
  const [items, setItems] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  // Path inside "{site_label}/lists/" — e.g. ["Site Pages"] or ["Site Pages","Templates"].
  // Empty array shows the lists themselves as folders.
  const [spPath, setSpPath] = useState<string[]>([]);

  useEffect(() => {
    if (view !== 'content' || !latestSnapshot) return;
    setItemsLoading(true); setItemsError(null);
    SnapshotService.listSnapshotFiles(latestSnapshot.id, 1, 5000)
      .then(data => setItems(data.content || []))
      .catch(err => { setItemsError(err.message || 'Failed to load files'); setItems([]); })
      .finally(() => setItemsLoading(false));
  }, [view, latestSnapshot?.id]);

  // Reset drill-down path whenever the snapshot changes.
  useEffect(() => { setSpPath([]); }, [latestSnapshot?.id]);

  // SharePoint breadcrumb navigation (`spPath`) is local state and
  // bypasses the parent's selectedFolder-based clear. Drop the parent's
  // checked items whenever the user drills in/out so selections from one
  // list/folder don't survive into another.
  useEffect(() => {
    onSelectAll([], false);
    // onSelectAll is a stable handler from the parent; only spPath
    // should drive this clear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spPath]);

  // Derive the site_label prefix ("Communication site/lists/") from any
  // row — all rows share the same parent. Needed because folder_path
  // is ABSOLUTE and we strip it to site-relative for navigation.
  const spPrefix = useMemo(() => {
    const probe = items.find(i => (i.folderPath || '').includes('/lists'));
    if (!probe?.folderPath) return '';
    const marker = '/lists';
    const idx = probe.folderPath.indexOf(marker);
    return idx >= 0 ? probe.folderPath.slice(0, idx + marker.length) : '';
  }, [items]);

  // Group by folderPath → what shows at the current drill-down level.
  //
  // Rendering matches the AFI-style Site tab: the root level presents
  // each SharePoint library/list as a folder row (appdata, appfiles,
  // Documents, Site Pages, Style Library, ...) with a Modified date;
  // drilling into one reveals its files and nested folders. SP list-
  // container rows (item_type = SHAREPOINT_LIST) carry the list's
  // name + last_modified, so we promote THEM into the folder rows
  // at root instead of collecting folder names from deeper items.
  //
  // `folderMeta` carries the metadata we need to render the row
  // (name, last_modified) so the table can show dates next to each
  // library without a separate lookup pass.
  const { displayRows, displayFolders, folderMeta } = useMemo(() => {
    const prefix = spPrefix + (spPath.length ? '/' + spPath.join('/') : '');
    const files: any[] = [];
    const folderSet = new Set<string>();
    const meta: Record<string, { lastModified?: string; source?: 'list' | 'derived' }> = {};

    // At the root of the Site tab, SHAREPOINT_LIST rows ARE the visible
    // folders. Seed folderSet with their display names first so every
    // library shows up even if it has zero captured items yet.
    if (spPath.length === 0) {
      for (const it of items) {
        if ((it.itemType || '') !== 'SHAREPOINT_LIST') continue;
        const fp: string = it.folderPath || '';
        if (!fp.startsWith(spPrefix)) continue;
        const listName = String(it.name || '').trim();
        if (!listName) continue;
        folderSet.add(listName);
        const ed = it.metadata || {};
        const lastModified = ed.last_modified || (ed.raw && ed.raw.lastModifiedDateTime) || it.updatedAt || undefined;
        meta[listName] = { lastModified, source: 'list' };
      }
      return {
        displayRows: [],
        displayFolders: Array.from(folderSet).sort((a, b) => a.localeCompare(b)),
        folderMeta: meta,
      };
    }

    // Inside a list: check whether the top-level list should render as
    // a FLAT table (every row at one level, no folder drilldown). This
    // matches SharePoint's native list-view UX for catalogs AND standard
    // lists like Tasks / Events / Announcements. We flatten whenever
    // either the list row says is_catalog OR we have a curated column
    // set for its template (which implies "this is a list, not a file
    // library"). Plain document libraries without a curated entry keep
    // the classic folder drill-down.
    const listRow = items.find(it =>
      (it.itemType || '') === 'SHAREPOINT_LIST' &&
      String(it.name || '').trim() === spPath[0]
    );
    const listTemplate = normalizeTemplate((listRow?.metadata || {}).template);
    const listHasCuratedGrid = Boolean(CATALOG_COLUMNS[listTemplate]);
    const listIsCatalog = Boolean(listRow?.metadata?.is_catalog) || listHasCuratedGrid;

    for (const it of items) {
      if ((it.itemType || '') === 'SHAREPOINT_LIST') continue;  // handled above
      const fp: string = it.folderPath || '';
      if (!fp.startsWith(prefix)) continue;
      const rest = fp.slice(prefix.length).replace(/^\//, '');
      if (rest === '' || listIsCatalog) {
        // Flat view: every descendant is a row; no folder nesting.
        files.push(it);
      } else {
        const seg = rest.split('/')[0];
        if (!seg) continue;
        folderSet.add(seg);
        // Keep the newest lastModifiedDateTime seen under each folder
        // so the "Last modified" column shows meaningful values.
        const ed = it.metadata || {};
        const candidate = ed.raw && ed.raw.lastModifiedDateTime;
        if (candidate) {
          const prev = meta[seg]?.lastModified;
          if (!prev || candidate > prev) meta[seg] = { lastModified: candidate, source: meta[seg]?.source || 'derived' };
        }
      }
    }

    return {
      displayRows: files,
      displayFolders: listIsCatalog
        ? []
        : Array.from(folderSet).sort((a, b) => a.localeCompare(b)),
      folderMeta: meta,
    };
  }, [items, spPrefix, spPath]);

  // Subsites = live Graph lookup. Doesn't depend on snapshots.
  const [subsites, setSubsites] = useState<any[]>([]);
  const [subsitesLoading, setSubsitesLoading] = useState(false);
  const [subsitesError, setSubsitesError] = useState<string | null>(null);

  useEffect(() => {
    if (view !== 'subsites') return;
    setSubsitesLoading(true); setSubsitesError(null);
    SnapshotService.listSharePointSubsites(resourceId)
      .then(data => setSubsites(data.subsites || []))
      .catch(err => { setSubsitesError(err.message || 'Failed to load subsites'); setSubsites([]); })
      .finally(() => setSubsitesLoading(false));
  }, [view, resourceId]);

  const allChecked = items.length > 0 && items.every(i => selectedItems.has(i.id));

  // Pick the column grid for the current folder:
  //   1. If the current list's template has a curated CATALOG_COLUMNS
  //      entry (Composed Looks / Tasks / Events / Master Page Gallery …),
  //      use it — only the essentials the user asked for.
  //   2. Else, if any row has FieldValuesAsText columns we haven't seen
  //      a template for, derive columns dynamically as a best-effort.
  //   3. Else, null → render the default file grid (Owner/Modified/Size).
  const currentListRow = spPath.length > 0
    ? items.find(it =>
        (it.itemType || '') === 'SHAREPOINT_LIST' &&
        String(it.name || '').trim() === spPath[0]
      )
    : null;
  const currentTemplate = normalizeTemplate((currentListRow?.metadata || {}).template);
  const catalogColumns = useMemo(() => {
    const curated = CATALOG_COLUMNS[currentTemplate];
    if (curated) return curated;
    return deriveDynamicColumns(displayRows);
  }, [currentTemplate, displayRows]);
  const isCatalogView = Boolean(catalogColumns);

  // Every list row stores a server-relative URL (e.g. /_catalogs/design/1_.000).
  // Prepending the site's hostname produces the live SharePoint URL the
  // user can open in a new tab. Hostname is derived from the list's
  // webUrl (set at backup-time from Graph's SP list.webUrl field).
  const siteOrigin = useMemo(() => {
    const webUrl = spPath.length > 0
      ? (items.find(it =>
          (it.itemType || '') === 'SHAREPOINT_LIST' &&
          String(it.name || '').trim() === spPath[0]
        )?.metadata?.web_url as string | undefined)
      : undefined;
    if (!webUrl) {
      // Fall back to any list's webUrl on the site — they all share host.
      const anyList = items.find(it =>
        (it.itemType || '') === 'SHAREPOINT_LIST' && (it.metadata as any)?.web_url
      );
      if (anyList) {
        try { return new URL((anyList.metadata as any).web_url).origin; } catch { /* ignore */ }
      }
      return '';
    }
    try { return new URL(webUrl).origin; } catch { return ''; }
  }, [items, spPath]);

  // Turn a possibly-server-relative value into a full URL. Returns null
  // when we can't build one (no hostname, empty value, not a URL shape).
  const buildLiveUrl = (v: unknown): string | null => {
    if (typeof v !== 'string' || !v) return null;
    if (v.startsWith('http://') || v.startsWith('https://')) return v;
    if (v.startsWith('/') && siteOrigin) return siteOrigin + v;
    return null;
  };

  return (
    <>
      <div className="panel-left od-panel-left">
        <div className="od-left">
          <button
            className={`od-left-section ${view === 'content' ? 'active' : ''}`}
            onClick={() => setView('content')}
          >
            <span className="od-left-icon od-left-icon-svg" aria-hidden><SiteContentIcon /></span>
            <span className="od-left-label">Site content</span>
          </button>
          <button
            className={`od-left-section ${view === 'subsites' ? 'active' : ''}`}
            onClick={() => setView('subsites')}
          >
            <span className="od-left-icon od-left-icon-svg" aria-hidden><SubsitesIcon /></span>
            <span className="od-left-label">Subsites</span>
          </button>
        </div>
      </div>

      <div className="panel-middle od-panel-middle">
        {view === 'content' ? (
          <>
            <div className="od-main-header">
              <span className="od-breadcrumb">
                <button
                  className="od-breadcrumb-link"
                  onClick={() => setSpPath([])}
                  disabled={spPath.length === 0}
                >Site content</button>
                {spPath.map((seg, i) => (
                  <span key={i}>
                    <span className="od-breadcrumb-sep"> / </span>
                    <button
                      className="od-breadcrumb-link"
                      onClick={() => setSpPath(spPath.slice(0, i + 1))}
                      disabled={i === spPath.length - 1}
                    >{seg}</button>
                  </span>
                ))}
              </span>
              <span className="od-count">
                {(displayFolders.length + displayRows.length) > 0
                  ? `${displayFolders.length} folder${displayFolders.length === 1 ? '' : 's'}, ${displayRows.length} item${displayRows.length === 1 ? '' : 's'}`
                  : ''}
              </span>
            </div>
            {!latestSnapshot ? (
              <div className="pbi-empty"><p>No completed backup for this site yet.</p></div>
            ) : itemsLoading ? (
              <div className="loading-container"><div className="spinner" /><p>Loading files...</p></div>
            ) : itemsError ? (
              <div className="pbi-empty"><p>{itemsError}</p></div>
            ) : items.length === 0 ? (
              <div className="pbi-empty"><p>No items captured in this snapshot yet.</p></div>
            ) : (
              <div className="od-list">
                <div
                  className={`od-table ${isCatalogView ? 'od-table-catalog' : ''}`}
                  style={isCatalogView
                    ? ({ '--cat-cols': catalogColumns!.length } as React.CSSProperties)
                    : undefined}
                >
                  <div className="od-table-head">
                    <div className="od-th od-th-check">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={e => onSelectAll(displayRows.map(i => i.id), e.target.checked)}
                      />
                    </div>
                    <div className="od-th od-th-name">Name</div>
                    {isCatalogView ? (
                      catalogColumns!.map(col => (
                        <div key={col.key} className="od-th od-th-catalog">{col.label}</div>
                      ))
                    ) : (
                      <>
                        <div className="od-th od-th-owner">Owner</div>
                        <div className="od-th od-th-modified">Last modified</div>
                        <div className="od-th od-th-size">File size</div>
                      </>
                    )}
                  </div>
                  <div className="od-table-body">
                    {displayFolders.map((seg) => {
                      const m = folderMeta[seg];
                      const lastMod = m?.lastModified
                        ? fmtLocalDate(m.lastModified, { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—';
                      // Recursive folder select: match every non-container item
                      // whose folder_path sits at or under this folder's full
                      // prefix. SHAREPOINT_LIST rows are containers, not files
                      // the user would download — excluded from the id set.
                      const folderPrefix = spPrefix + '/' + [...spPath, seg].join('/');
                      const folderItemIds = items
                        .filter(it => {
                          if ((it.itemType || '') === 'SHAREPOINT_LIST') return false;
                          const fp = it.folderPath || '';
                          return fp === folderPrefix || fp.startsWith(folderPrefix + '/');
                        })
                        .map(it => it.id);
                      const folderChecked = folderItemIds.length > 0 && folderItemIds.every(id => selectedItems.has(id));
                      return (
                      <div
                        key={`folder-${seg}`}
                        className={`od-row od-row-folder ${folderChecked ? 'selected' : ''}`}
                        onClick={() => setSpPath([...spPath, seg])}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="od-td od-td-check" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={folderChecked}
                            disabled={folderItemIds.length === 0}
                            onChange={e => onSelectAll(folderItemIds, e.target.checked)}
                            title={folderItemIds.length === 0
                              ? 'No selectable files in this folder'
                              : 'Select all files in this folder recursively'}
                          />
                        </div>
                        <div className="od-td od-td-name" title={seg}>
                          <span className="od-row-icon" aria-hidden>{FolderIcon}</span>
                          <span className="od-row-name">{seg}</span>
                        </div>
                        {isCatalogView ? (
                          catalogColumns!.map(col => (
                            <div key={col.key} className="od-td od-td-catalog">—</div>
                          ))
                        ) : (
                          <>
                            <div className="od-td od-td-owner">—</div>
                            <div className="od-td od-td-modified">{lastMod}</div>
                            <div className="od-td od-td-size">—</div>
                          </>
                        )}
                      </div>
                      );
                    })}
                    {displayRows.map((item: any) => {
                      const md = item.metadata || {};
                      const owner = md.created_by || md.modified_by || '—';
                      const modified = md.modified || md.created || item.createdAt;
                      const size = item.contentSize ?? md.file?.Length ?? 0;
                      const hasBlob = !!item.blobPath;
                      // Catalog column values live on extra_data.columns
                      // (FieldValuesAsText from SP REST $expand). Fall back
                      // to top-level extra_data so a partial / older
                      // snapshot still renders whatever it captured (e.g.
                      // `title`, `modified`) instead of going all-blank.
                      const cols = (md.columns || {}) as Record<string, any>;
                      // Live SP URL for this row — server-relative URL
                      // stored at backup time, prepended with the site's
                      // origin. Null when we don't have either.
                      const liveUrl = buildLiveUrl(md.server_relative_url)
                        ?? buildLiveUrl(cols['FileRef'])
                        ?? buildLiveUrl(cols['EncodedAbsUrl']);
                      const renderCatalogCell = (col: CatalogColumn) => {
                        let v: any = cols[col.key];
                        if (v == null || v === '') {
                          if (col.key === 'Title') v = md.title;
                          else if (col.key === 'Modified') v = modified;
                          else if (col.key === 'FileLeafRef') v = item.name;
                        }
                        if (v == null || v === '') return '—';
                        if (col.key === 'Modified' && v) {
                          const fmt = fmtLocalDate(v, { month: 'short', day: 'numeric', year: 'numeric' });
                          return fmt || String(v);
                        }
                        // Treat anything shaped like a URL (http…, or a
                        // server-relative path that we can anchor against
                        // the site origin) as a clickable link. Covers
                        // Composed Looks' MasterPageUrl/ThemeUrl/etc AND
                        // raw FileRef-like columns in any list.
                        if (typeof v === 'string') {
                          const asLink = buildLiveUrl(v);
                          if (asLink) {
                            return <a href={asLink} target="_blank" rel="noopener noreferrer" title={asLink}>{v}</a>;
                          }
                        }
                        return String(v);
                      };
                      return (
                        <div
                          key={item.id}
                          className={`od-row od-row-file ${selectedItems.has(item.id) ? 'selected' : ''}`}
                          title={md.server_relative_url || ''}
                        >
                          <div className="od-td od-td-check" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedItems.has(item.id)}
                              onChange={() => onToggleItem(item.id)}
                            />
                          </div>
                          <div className="od-td od-td-name" title={item.name}>
                            {hasBlob && latestSnapshot ? (
                              <a
                                className="od-row-link"
                                href={API.SNAPSHOTS.ITEM_CONTENT_DOWNLOAD(latestSnapshot.id, item.id)}
                                download={item.name || undefined}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                title={`Download ${item.name}`}
                              >
                                <span className="od-row-icon" aria-hidden>{odFileIcon(item.name || '')}</span>
                                <span className="od-row-name">{item.name}</span>
                              </a>
                            ) : liveUrl ? (
                              // No captured blob — link to the live SP URL
                              // instead so the user can still open it.
                              <a
                                className="od-row-link"
                                href={liveUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                title={`Open in SharePoint: ${liveUrl}`}
                              >
                                <span className="od-row-icon" aria-hidden>{odFileIcon(item.name || '')}</span>
                                <span className="od-row-name">{item.name}</span>
                              </a>
                            ) : (
                              <>
                                <span className="od-row-icon" aria-hidden>{odFileIcon(item.name || '')}</span>
                                <span className="od-row-name">{item.name}</span>
                                {!hasBlob && !isCatalogView && <span className="od-row-tag">metadata only</span>}
                              </>
                            )}
                          </div>
                          {isCatalogView ? (
                            catalogColumns!.map(col => (
                              <div key={col.key} className="od-td od-td-catalog" title={String(cols[col.key] ?? '')}>
                                {renderCatalogCell(col)}
                              </div>
                            ))
                          ) : (
                            <>
                              <div className="od-td od-td-owner">{owner}</div>
                              <div className="od-td od-td-modified">{modified ? fmtLocalDate(modified, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</div>
                              <div className="od-td od-td-size">{size ? bytesToSize(size) : '—'}</div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="od-main-header">
              <span className="od-breadcrumb">Subsites</span>
              <span className="od-count">{subsites.length ? `${subsites.length.toLocaleString()} subsites` : ''}</span>
            </div>
            {subsitesLoading ? (
              <div className="loading-container"><div className="spinner" /><p>Loading subsites...</p></div>
            ) : subsitesError ? (
              <div className="pbi-empty"><p>{subsitesError}</p></div>
            ) : subsites.length === 0 ? (
              <div className="pbi-empty"><p>No subsites under this site.</p></div>
            ) : (
              <div className="od-list">
                <div className="od-table">
                  <div className="od-table-head sp-subsite-head">
                    <div className="od-th od-th-name">Name</div>
                    <div className="od-th">URL</div>
                    <div className="od-th od-th-modified">Last modified</div>
                  </div>
                  <div className="od-table-body">
                    {subsites.map((sub: any) => (
                      <div key={sub.id} className="od-row od-row-file sp-subsite-row">
                        <div className="od-td od-td-name" title={sub.displayName}>
                          <span className="od-row-icon" aria-hidden><SubsitesIcon /></span>
                          <span className="od-row-name">{sub.displayName}</span>
                        </div>
                        <div className="od-td" title={sub.webUrl}>
                          {sub.webUrl ? (
                            <a href={sub.webUrl} target="_blank" rel="noopener noreferrer" className="od-row-link">{sub.webUrl}</a>
                          ) : '—'}
                        </div>
                        <div className="od-td od-td-modified">
                          {sub.lastModifiedDateTime ? fmtLocalDate(sub.lastModifiedDateTime, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ==================== Power BI Files view ====================
// Power BI workspaces don't fit the five fixed Mail/OneDrive/... tabs —
// they have reports, datasets, dashboards, permissions blobs, etc. The
// Recovery page collapses all that into a single "Files" panel for
// power_bi resources: one flat list pulled from the generic
// /snapshots/{id}/files endpoint.

/**
 * Azure SQL / PostgreSQL Recovery view — 3 tabs matching AFI's layout:
 *   Configuration → structured detail card (Essential / Compute /
 *                   Backup / Networking / HA / Replication).
 *   Schema        → 2-panel. Left: list of databases. Right: schema
 *                   files / folders for the selected database.
 *   Data          → 3-panel. Left: databases tree. Middle: tables.
 *                   Right: row detail (empty state until backups
 *                   capture table-row snapshots).
 *
 * Expected snapshot_item shapes (backup handlers land later; frontend
 * renders empty states cleanly until then):
 *   - AZURE_DB_CONFIG        — one per resource. extra_data.raw holds
 *                              the full server JSON (subscriptionId,
 *                              resourceGroup, serverName, location,
 *                              endpoint, adminLogin, sku, version,
 *                              availabilityZone, timeCreated, pricingTier,
 *                              computeSize, storageGB, backupRetentionDays,
 *                              maintenance, connectivityMethod, firewallRules,
 *                              haEnabled, replicationRole, …).
 *   - AZURE_DB_DATABASE      — one per database. name = db name,
 *                              folder_path empty.
 *   - AZURE_DB_SCHEMA_FILE   — dump / sql files for a database.
 *                              folder_path = db_name.
 *   - AZURE_DB_TABLE         — each table. folder_path = db_name/schema.
 *   - AZURE_DB_ROW           — future: per-row snapshots for the Data tab.
 */
type AzureDbTab = 'configuration' | 'database' | 'schema';
const AZURE_DB_TAB_LABELS: Record<AzureDbTab, string> = {
  configuration: 'Configuration',
  database: 'Database',
  schema: 'Schema',
};

// ── Configuration tab helpers — format fields from the captured JSON.
function AzureDbConfiguration({ raw, snapshotId, itemId }: { raw: any; snapshotId: string; itemId: string | null }) {
  const copy = (v: string) => navigator.clipboard?.writeText(v);
  const Row = ({ label, value, copyable, link }: { label: string; value: React.ReactNode; copyable?: string; link?: boolean }) => (
    <div className="az-db-field">
      <span className="az-db-field-label">{label}</span>
      <span className={`az-db-field-val${link ? ' az-db-link' : ''}`}>
        {value}
        {copyable && (
          <button className="az-db-copy" onClick={() => copy(copyable)} title="Copy">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 12, height: 12 }}>
              <rect x="4" y="4" width="9" height="9" rx="1.2" />
              <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2h7" />
            </svg>
          </button>
        )}
      </span>
    </div>
  );

  const fmtTime = (v?: string) => v ? fmtLocal(v, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  // Firewall rules — prefer the new scalar count emitted by the handler;
  // fall back to the array-length of any legacy firewallRules list.
  let fwLabel = '';
  const fwCount = raw.firewallRuleCount ?? raw.firewall_rule_count;
  if (typeof fwCount === 'number') {
    fwLabel = `${fwCount} firewall rules`;
  } else {
    const fw = raw.firewallRules || raw.firewall_rules;
    if (Array.isArray(fw)) fwLabel = `${fw.length} firewall rules`;
    else if (fw) fwLabel = String(fw);
  }

  return (
    <div className="az-db-config">
      <div className="az-db-config-actions">
        {snapshotId && itemId && (
          <a
            className="az-db-action-btn"
            href={API.SNAPSHOTS.ITEM_CONTENT_DOWNLOAD(snapshotId, itemId)}
            target="_blank" rel="noopener noreferrer"
            title="Download raw config JSON"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
        )}
      </div>

      {/* Normalise both key shapes — new backups emit snake_case
          (administrator_login, fully_qualified_domain_name, …) and
          older captures may have flat sku/tier strings instead of an
          object. Each field tries camelCase → snake_case → legacy key. */}
      {(() => { return null; })()}
      <section className="az-db-section">
        <h4 className="az-db-section-title">Essential</h4>
        <div className="az-db-grid">
          <Row label="Subscription ID" value={raw.subscriptionId || raw.subscription_id || ''} copyable={raw.subscriptionId || raw.subscription_id} />
          <Row label="Resource Group" value={raw.resourceGroup || raw.resource_group || ''} copyable={raw.resourceGroup || raw.resource_group} link />
          <Row label="Server Name" value={raw.serverName || raw.server_name || raw.name || ''} copyable={raw.serverName || raw.server_name || raw.name} link />
          <Row label="Location" value={raw.location || ''} />
          <Row label="Endpoint" value={raw.fullyQualifiedDomainName || raw.fully_qualified_domain_name || raw.endpoint || ''} copyable={raw.fullyQualifiedDomainName || raw.fully_qualified_domain_name || raw.endpoint} link />
          <Row label="Administrator Login" value={raw.administratorLogin || raw.administrator_login || raw.admin_login || ''} />
          <Row label="Configuration" value={(() => {
            const name = (typeof raw.sku === 'object' ? raw.sku?.name : raw.sku) || '';
            const tier = (typeof raw.sku === 'object' ? raw.sku?.tier : raw.tier) || '';
            if (!name && !tier) return raw.configuration || '';
            return tier ? `${name} (${tier})` : name;
          })()} />
          <Row label={raw.server_type === 'FLEXIBLE' || raw.server_type === 'SINGLE (DEPRECATED)' || raw.engine === 'postgres' ? 'PostgreSQL Version' : 'Version'} value={raw.version || ''} />
          <Row label="Availability Zone" value={raw.availabilityZone || raw.availability_zone || ''} />
          <Row label="Time created" value={fmtTime(raw.timeCreated || raw.time_created || raw.createdAt)} />
        </div>
      </section>

      <div className="az-db-split">
        <section className="az-db-section">
          <h4 className="az-db-section-title">Compute + storage</h4>
          <div className="az-db-grid">
            <Row label="Pricing Tier" value={raw.sku?.tier || raw.pricing_tier || ''} />
            <Row label="Compute size" value={raw.sku?.name || raw.compute_size || ''} />
            <Row label="Storage" value={raw.storage?.storageSizeGB ? `${raw.storage.storageSizeGB} GB` : (raw.storage_gb ? `${raw.storage_gb} GB` : '')} />
            <Row label="Storage autogrow" value={raw.storage?.autoGrow || raw.storage_autogrow || ''} />
          </div>
          <h4 className="az-db-section-title" style={{ marginTop: 16 }}>Backup</h4>
          <div className="az-db-grid">
            <Row label="Retention period" value={String(raw.backup?.backupRetentionDays ?? raw.backup_retention_days ?? '')} />
            <Row label="Maintenance" value={
              raw.maintenance?.customWindow
              || raw.maintenance?.configurationName
              || (typeof raw.maintenance === 'string' ? raw.maintenance : '')
              || 'System-managed schedule'
            } />
          </div>
        </section>

        <section className="az-db-section">
          <h4 className="az-db-section-title">Networking</h4>
          <div className="az-db-grid">
            <Row label="Connectivity method" value={raw.network?.publicNetworkAccess === 'Enabled' ? 'Public access (allowed)' : (raw.connectivity_method || raw.network?.publicNetworkAccess || '')} />
            <Row label="Firewall rules" value={fwLabel} />
          </div>
          <h4 className="az-db-section-title" style={{ marginTop: 16 }}>High availability</h4>
          <div className="az-db-grid">
            <Row label="High availability" value={raw.highAvailability?.mode || raw.ha_enabled || 'Disabled'} />
          </div>
          <h4 className="az-db-section-title" style={{ marginTop: 16 }}>Replication</h4>
          <div className="az-db-grid">
            <Row label="Replication role" value={raw.replicationRole || raw.replication_role || 'None'} />
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Azure SQL Configuration card — distinct from the Postgres one because
 * SQL exposes a different field set (Pricing tier / Compute+storage /
 * Availability / Backups / Networking / Connections / Authentication /
 * Security). Server-type branching happens in AzureDbView.
 */
function AzureSqlConfiguration({ raw, snapshotId, itemId }: { raw: any; snapshotId: string; itemId: string | null }) {
  const copy = (v: string) => navigator.clipboard?.writeText(v);
  const Row = ({ label, value, copyable }: { label: string; value: React.ReactNode; copyable?: string }) => (
    <div className="az-db-field">
      <span className="az-db-field-label">{label}</span>
      <span className="az-db-field-val">
        {value || <span className="az-db-muted">—</span>}
        {copyable && (
          <button className="az-db-copy" onClick={() => copy(copyable)} title="Copy">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 12, height: 12 }}>
              <rect x="4" y="4" width="9" height="9" rx="1.2" />
              <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2h7" />
            </svg>
          </button>
        )}
      </span>
    </div>
  );

  const sku = raw.sku || {};
  const tier = sku.tier || '';
  const skuName = sku.name || '';
  const capacity = sku.capacity;
  const pricingTier = tier && skuName
    ? `${tier} - ${skuName}${capacity ? `, ${capacity} vCore` : ''}`
    : '';
  const maxGb = raw.storage?.storageSizeGB != null ? `${raw.storage.storageSizeGB} GB` : '';
  const identity = raw.identity || {};
  const auth = raw.authentication || {};
  const ledger = raw.ledger || {};
  const replication = raw.replication || {};
  const fwCount = raw.firewallRuleCount ?? (Array.isArray(raw.firewall_rules) ? raw.firewall_rules.length : null);
  const fwLabel = fwCount != null ? `${fwCount} firewall rule${fwCount === 1 ? '' : 's'}` : '';
  const peCount = raw.network?.privateEndpointCount ?? 0;
  const uaidCount = identity.user_assigned_count ?? 0;

  return (
    <div className="az-db-config">
      <div className="az-db-config-actions">
        {snapshotId && itemId && (
          <a
            className="az-db-action-btn"
            href={API.SNAPSHOTS.ITEM_CONTENT_DOWNLOAD(snapshotId, itemId)}
            target="_blank" rel="noopener noreferrer"
            title="Download raw config JSON"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
        )}
      </div>

    <div className="az-db-config-card az-db-config-2col">
      <section className="az-db-config-col az-db-config-col-full">
        <h4 className="az-db-section-title">Essential</h4>
        <div className="az-db-grid">
          <Row label="Subscription ID" value={raw.subscription_id || ''} copyable={raw.subscription_id} />
          <Row label="Resource Group" value={raw.resource_group || ''} />
          <Row label="Location" value={raw.location || ''} />
          <Row label="Server name" value={raw.fully_qualified_domain_name || raw.server_name || ''} copyable={raw.fully_qualified_domain_name} />
          <Row label="Pricing tier" value={pricingTier} />
          <Row label="Auto-pause delay" value={raw.auto_pause_delay || 'Disabled'} />
        </div>
      </section>

      <div className="az-db-config-col">
        <section>
          <h4 className="az-db-section-title">Compute + storage</h4>
          <div className="az-db-grid">
            <Row label="Service tier" value={tier} />
            <Row label="Compute tier" value={skuName} />
            <Row label="vCores" value={capacity != null ? `${capacity} vCore` : ''} />
            <Row label="Max storage" value={maxGb} />
            <Row label="Auto-pause delay" value={raw.auto_pause_delay || 'Disabled'} />
          </div>
        </section>

        <section>
          <h4 className="az-db-section-title">Availability</h4>
          <div className="az-db-grid">
            <Row label="Replication" value={String(replication.replica_count ?? 0)} />
            <Row label="Availability Zone" value={raw.availability_zone || ''} />
          </div>
        </section>

        <section>
          <h4 className="az-db-section-title">Backups</h4>
          <div className="az-db-grid">
            <Row label="Storage redundancy" value={raw.backup_storage_redundancy || ''} />
          </div>
        </section>
      </div>

      <div className="az-db-config-col">
        <section>
          <h4 className="az-db-section-title">Networking</h4>
          <div className="az-db-grid">
            <Row label="Public access" value={raw.network?.publicNetworkAccess || ''} />
            <Row label="Firewall rules" value={fwLabel} />
            <Row label="Private access" value={`${peCount} private endpoint connection${peCount === 1 ? '' : 's'}`} />
          </div>
        </section>

        <section>
          <h4 className="az-db-section-title">Connections</h4>
          <div className="az-db-grid">
            <Row label="Primary endpoint" value={raw.fully_qualified_domain_name || ''} copyable={raw.fully_qualified_domain_name} />
          </div>
        </section>

        <section>
          <h4 className="az-db-section-title">Authentication</h4>
          <div className="az-db-grid">
            <Row label="Authentication method" value={auth.method || ''} />
            <Row label="SQL admin" value={auth.sql_admin || ''} />
            <Row label="Entra ID admin" value={auth.entra_admin || ''} />
          </div>
        </section>

        <section>
          <h4 className="az-db-section-title">Security</h4>
          <div className="az-db-grid">
            <Row label="System-assigned identity" value={identity.system_assigned || 'Disabled'} />
            <Row label="User-assigned identities" value={`${uaidCount} identit${uaidCount === 1 ? 'y' : 'ies'}`} />
            <Row label="Primary identity" value={identity.primary_user_assigned || 'Not configured'} />
            <Row label="Ledger database" value={ledger.enabled || 'Disabled'} />
            <Row label="Ledger automatic digest storage" value={ledger.digest_storage || 'Not configured'} />
            <Row label="Always encrypted with secure enclaves" value={raw.secure_enclaves || 'Disabled'} />
          </div>
        </section>
      </div>
    </div>
    </div>
  );
}

/**
 * Database tab body — tree db → schema → tables on the left, paginated
 * row-view with search (op + value on the first column) on the right.
 */
function AzureDbDataTab({
  snapshotId, databases, tableItems, selectedItems, onToggleItem,
}: {
  snapshotId: string;
  databases: string[];
  tableItems: any[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
}) {
  // Tree state — set of expanded db names and schema keys.
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  // All dbs start collapsed — user expands what they need. Keeps the
  // left rail compact on load, matching the AFI behavior.

  // Build db → schema → tables map from folder_path.
  const tree = useMemo(() => {
    const t: Record<string, Record<string, any[]>> = {};
    for (const it of tableItems) {
      const [db, schema = 'public'] = (it.folderPath || '').split('/');
      if (!db) continue;
      if (!t[db]) t[db] = {};
      if (!t[db][schema]) t[db][schema] = [];
      t[db][schema].push(it);
    }
    // Ensure every discovered db at least shows up even if it has no tables.
    for (const db of databases) if (!t[db]) t[db] = {};
    return t;
  }, [tableItems, databases]);

  // ── Selected table + its row data ──
  const selectedTable = useMemo(
    () => tableItems.find(t => t.id === selectedTableId) || null,
    [tableItems, selectedTableId],
  );

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [data, setData] = useState<{ columns: string[]; rows: any[]; total: number; hasMore: boolean; firstColumn: string | null }>({
    columns: [], rows: [], total: 0, hasMore: false, firstColumn: null,
  });
  const [loading, setLoading] = useState(false);

  // Search input state — default op to "=" so the first option shown
  // in the dropdown matches the state, otherwise `submitSearch` bails
  // out early thinking no operator was chosen.
  const [searchOp, setSearchOp] = useState<'=' | '>' | '<' | '>=' | '<=' | '[]'>('=');
  const [searchVal, setSearchVal] = useState('');
  const [appliedFilter, setAppliedFilter] = useState<{ op: string; val: string } | null>(null);

  // Column-visibility state powering the table Settings modal. Lets the
  // user hide columns from the rendered table and bring them back via
  // the "Add new column" input. Reset whenever the user switches table
  // so a fresh set of columns is shown.
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Reset page/search whenever the selected table changes.
  useEffect(() => {
    setPage(1);
    setSearchOp('=');
    setSearchVal('');
    setAppliedFilter(null);
    setVisibleColumns([]);
  }, [selectedTableId]);

  // First load of data columns → seed visibleColumns with the full set.
  // Keep the user's current selection on subsequent pagination reloads.
  useEffect(() => {
    if (data.columns.length && visibleColumns.length === 0) {
      setVisibleColumns(data.columns);
    }
  }, [data.columns, visibleColumns.length]);

  // Columns that are hidden right now = present in data but not visible.
  // Used by the Settings modal's "Add new column" input to validate.
  const hiddenColumns = useMemo(
    () => data.columns.filter(c => !visibleColumns.includes(c)),
    [data.columns, visibleColumns],
  );

  // Load data whenever page or applied filter changes.
  useEffect(() => {
    if (!selectedTableId || !snapshotId) {
      setData({ columns: [], rows: [], total: 0, hasMore: false, firstColumn: null });
      return;
    }
    setLoading(true);
    SnapshotService.getAzureDbTable(snapshotId, selectedTableId, {
      page, size: pageSize,
      op: appliedFilter?.op,
      val: appliedFilter?.val,
    })
      .then(setData)
      .catch(() => setData({ columns: [], rows: [], total: 0, hasMore: false, firstColumn: null }))
      .finally(() => setLoading(false));
  }, [snapshotId, selectedTableId, page, appliedFilter]);

  const firstCol = data.firstColumn || selectedTable?.metadata?.columns?.[0] || '';
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const breadcrumb = selectedTable
    ? `${selectedTable.metadata?.database_name || ''} > ${selectedTable.metadata?.schema || 'public'} > ${selectedTable.name}`
    : '';
  const rangeStart = data.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(data.total, page * pageSize);

  // Client-side "look in current page first" — quick visual filter of
  // the already-loaded rows matching the typed value, without a fetch.
  // "[]" now means "any of these values" — tokens split on commas and
  // whitespace.
  const clientMatches = useMemo(() => {
    if (!searchVal || !firstCol || !searchOp) return null;
    const coerce = (x: any) => { const n = Number(x); return Number.isNaN(n) ? String(x) : n; };
    const target = coerce(searchVal);
    let targetSet: any[] = [];
    if (searchOp === '[]') {
      targetSet = searchVal.split(/[\s,]+/).filter(Boolean).map(coerce);
    }
    const filtered = data.rows.filter(r => {
      const v = coerce(r?.[firstCol]);
      try {
        if (searchOp === '=') return v === target;
        if (searchOp === '>') return v > target;
        if (searchOp === '<') return v < target;
        if (searchOp === '>=') return v >= target;
        if (searchOp === '<=') return v <= target;
        if (searchOp === '[]') {
          return targetSet.includes(v) || targetSet.map(String).includes(String(v));
        }
      } catch { return false; }
      return false;
    });
    return filtered;
  }, [data.rows, searchVal, searchOp, firstCol]);

  const submitSearch = () => {
    if (!searchOp || !searchVal) { setAppliedFilter(null); return; }
    // If the current page already has matches, keep them local; otherwise
    // apply the filter server-side (separate call).
    if (clientMatches && clientMatches.length > 0) {
      setAppliedFilter(null);
      return;
    }
    setPage(1);
    setAppliedFilter({ op: searchOp, val: searchVal });
  };

  const clearSearch = () => {
    setSearchOp('=');
    setSearchVal('');
    setAppliedFilter(null);
  };

  const visibleRows = (clientMatches && clientMatches.length > 0 && !appliedFilter)
    ? clientMatches : data.rows;

  // Inline SVG carets supplied by the user — "open" (down-pointing V)
  // appears when the node is expanded; "closed" (right-pointing chevron)
  // appears when collapsed. Matches the AFI icon set exactly.
  const CaretOpen = (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 14, height: 14 }} aria-hidden>
      <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const CaretClosed = (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 14, height: 14 }} aria-hidden>
      <path d="M10 7L15 12L10 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  const toggleDb = (db: string) => setExpandedDbs(prev => {
    const n = new Set(prev); if (n.has(db)) n.delete(db); else n.add(db); return n;
  });
  const toggleSchema = (key: string) => setExpandedSchemas(prev => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n;
  });

  // Cascade selection — checking a database/schema row should tick
  // every table beneath it; unchecking should untick the same set.
  // Re-uses onToggleItem so the lifted `selectedItems` Set on the
  // parent stays the single source of truth.
  const tablesUnderDb = (db: string): any[] => {
    const out: any[] = [];
    for (const sch of Object.keys(tree[db] || {})) {
      out.push(...(tree[db][sch] || []));
    }
    return out;
  };
  const tablesUnderSchema = (db: string, schema: string): any[] =>
    (tree[db] && tree[db][schema]) || [];

  const setMany = (items: any[], on: boolean) => {
    for (const t of items) {
      const isOn = selectedItems.has(t.id);
      if (on && !isOn) onToggleItem(t.id);
      else if (!on && isOn) onToggleItem(t.id);
    }
  };

  const dbChecked = (db: string): boolean => {
    const ts = tablesUnderDb(db);
    return ts.length > 0 && ts.every(t => selectedItems.has(t.id));
  };
  const schemaChecked = (db: string, schema: string): boolean => {
    const ts = tablesUnderSchema(db, schema);
    return ts.length > 0 && ts.every(t => selectedItems.has(t.id));
  };

  return (
    <div className="three-panel-layout az-db-data-layout">
      <div className="panel-left">
        <div className="az-db-tree">
          {databases.length === 0 ? (
            <div className="folder-empty"><p>No databases</p></div>
          ) : databases.map(db => {
            const dbOpen = expandedDbs.has(db);
            const schemas = Object.keys(tree[db] || {}).sort();
            return (
              <div key={db} className="az-db-tree-db">
                {/* Entire db row is clickable — click anywhere to toggle.
                    Checkbox click is stopped so it doesn't bubble. */}
                <div
                  className="az-db-tree-row az-db-tree-dbrow"
                  onClick={() => toggleDb(db)}
                  role="button"
                  aria-expanded={dbOpen}
                >
                  <input
                    type="checkbox"
                    className="az-db-tree-check"
                    checked={dbChecked(db)}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setMany(tablesUnderDb(db), e.target.checked)}
                  />
                  <span className="az-db-tree-caret">{dbOpen ? CaretOpen : CaretClosed}</span>
                  <span className="az-db-icon az-db-icon-db" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ width: 14, height: 14 }}>
                      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v6a9 3 0 0 0 18 0V5" /><path d="M3 11v6a9 3 0 0 0 18 0v-6" />
                    </svg>
                  </span>
                  <span className="az-db-tree-label">{db}</span>
                </div>
                {dbOpen && schemas.length === 0 && (
                  <div className="az-db-noschemas">No schemas</div>
                )}
                {dbOpen && schemas.map(schema => {
                  const key = `${db}/${schema}`;
                  const schemaOpen = expandedSchemas.has(key);
                  const tablesHere = tree[db][schema] || [];
                  return (
                    <div key={key} className="az-db-tree-schema">
                      <div
                        className="az-db-tree-row az-db-tree-schemarow"
                        onClick={() => toggleSchema(key)}
                        role="button"
                        aria-expanded={schemaOpen}
                      >
                        <input
                          type="checkbox"
                          className="az-db-tree-check"
                          checked={schemaChecked(db, schema)}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setMany(tablesUnderSchema(db, schema), e.target.checked)}
                        />
                        <span className="az-db-tree-caret">{schemaOpen ? CaretOpen : CaretClosed}</span>
                        <span className="az-db-icon az-db-icon-folder" aria-hidden>
                          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 13, height: 13 }}>
                            <path d="M3 5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                          </svg>
                        </span>
                        <span className="az-db-tree-label">{schema}</span>
                      </div>
                      {schemaOpen && tablesHere.length === 0 && (
                        <div className="az-db-noschemas az-db-noschemas-deep">No tables</div>
                      )}
                      {schemaOpen && tablesHere.map(tbl => (
                        <div
                          key={tbl.id}
                          className={`az-db-tree-row az-db-tree-tablerow ${selectedTableId === tbl.id ? 'active' : ''}`}
                          onClick={() => setSelectedTableId(tbl.id)}
                        >
                          <input
                            type="checkbox"
                            className="az-db-tree-check"
                            checked={selectedItems.has(tbl.id)}
                            onClick={e => e.stopPropagation()}
                            onChange={() => onToggleItem(tbl.id)}
                          />
                          <span className="az-db-tree-label">{tbl.name}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel-middle az-db-data-main">
        {!selectedTable ? (
          <div className="empty-preview"><p>Select a table to view rows.</p></div>
        ) : (
          <>
            <div className="az-db-header-row">
              <div className="az-db-breadcrumb-new">{breadcrumb}</div>
              <div className="az-db-pager-top">
                <span className="az-db-pager-label">Rows per page:</span>
                <select
                  className="az-db-pager-size"
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span className="az-db-pager-range">
                  {rangeStart} – {rangeEnd} of {data.total.toLocaleString()} rows
                </span>
                <div className="az-db-pager-nav">
                  <button disabled={page <= 1} onClick={() => setPage(1)} aria-label="First">⏮</button>
                  <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label="Prev">‹</button>
                  <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} aria-label="Next">›</button>
                  <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} aria-label="Last">⏭</button>
                </div>
                <button
                  className="az-db-settings-btn"
                  onClick={() => setSettingsOpen(true)}
                  title="Choose columns to show"
                  aria-label="Table settings"
                  type="button"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="az-db-search-bar">
              <span className="az-db-search-label">Search</span>
              <input
                className="az-db-search-col"
                value={firstCol || '(column)'}
                disabled
                title="Search is applied to the first column"
              />
              <select
                className="az-db-search-op"
                value={searchOp}
                onChange={e => setSearchOp(e.target.value as any)}
              >
                <option value="=">=</option>
                <option value=">">&gt;</option>
                <option value="<">&lt;</option>
                <option value=">=">&gt;=</option>
                <option value="<=">&lt;=</option>
                <option value="[]">[ ]</option>
              </select>
              <div className="az-db-search-field">
                <input
                  className="az-db-search-val"
                  placeholder={searchOp === '[]' ? 'Values (e.g. 2 4 6 or 2,4,6)' : 'Type to search'}
                  value={searchVal}
                  onChange={e => setSearchVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitSearch(); }}
                />
                <button className="az-db-search-btn" onClick={submitSearch} aria-label="Search" type="button">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M15.7955 15.8111L21 21M18 10.5C18 14.6421 14.6421 18 10.5 18C6.35786 18 3 14.6421 3 10.5C3 6.35786 6.35786 3 10.5 3C14.6421 3 18 6.35786 18 10.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              {(appliedFilter || (clientMatches && clientMatches.length > 0)) && (
                <button className="az-db-search-clear" onClick={clearSearch}>Clear</button>
              )}
            </div>

            <div className="az-db-table-wrap">
              {loading ? (
                <div className="loading-container"><div className="spinner" /><p>Loading rows…</p></div>
              ) : visibleRows.length === 0 ? (
                <div className="empty-state"><p>No rows.</p></div>
              ) : (
                <table className="az-db-data-table">
                  <thead>
                    <tr>
                      {visibleColumns.map(c => {
                        // `firstCol` is the PK/primary column the backend
                        // returned; keep the key badge on it even when
                        // the user hides earlier columns via Settings.
                        const isPk = c === firstCol;
                        return (
                          <th key={c}>
                            {c}
                            {isPk && (
                              <span className="az-db-col-pk" aria-hidden title="Primary column (searchable)">
                                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden>
                                  <path d="M11.852,5.78189 C13.6093,4.02453 16.4586,4.02453 18.2159,5.78189 C19.9733,7.53925 19.9733,10.3885 18.2159,12.1459 C16.8717,13.49 14.8868,13.8075 13.2397,13.0923 C12.9957,12.9863 12.7116,12.9136 12.4028,12.9136 L11.0413,12.9136 C10.3509,12.9136 9.79129,13.4733 9.7913,14.1636 L9.7913,15.742 L8.21287,15.742 C7.52251,15.742 6.96287,16.3017 6.96287,16.992 L6.96287,18.5705 L4.72023,18.5705 L4.72023,17.1563 L10.0756,11.8009 C10.62,11.2565 10.7551,10.5046 10.6254,9.8695 C10.3325,8.43555 10.7426,6.89123 11.852,5.78189 Z M19.6301,4.36768 C17.0917,1.82927 12.9761,1.82927 10.4377,4.36768 C8.83366,5.97176 8.24428,8.20575 8.66584,10.2697 C8.67902,10.3343 8.66399,10.3813 8.66021,10.3878 L3.15957,15.8885 C2.87827,16.1698 2.72023,16.5513 2.72023,16.9492 L2.72023,19.5605 C2.72023,20.1182 3.17239,20.5705 3.7301,20.5705 L7.71287,20.5705 C8.40322,20.5705 8.96287,20.0108 8.96287,19.3205 L8.96287,17.742 L10.5413,17.742 C11.2317,17.742 11.7913,17.1824 11.7913,16.492 L11.7913,14.9136 L12.4015,14.9136 C12.4035,14.9138 12.4173,14.9156 12.4431,14.9268 C14.8181,15.958 17.6858,15.5044 19.6301,13.5601 C22.1685,11.0217 22.1685,6.90609 19.6301,4.36768 Z M14.6804,9.31743 C15.2662,9.90321 16.2159,9.90321 16.8017,9.31743 C17.3875,8.73164 17.3875,7.78189 16.8017,7.19611 C16.2159,6.61032 15.2662,6.61032 14.6804,7.19611 C14.0946,7.78189 14.0946,8.73164 14.6804,9.31743 Z" />
                                </svg>
                              </span>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, i) => (
                      <tr key={i}>
                        {visibleColumns.map(c => {
                          // Backend returns rows as arrays aligned with
                          // data.columns (`rows: [[1, "Ada", ...], ...]`).
                          // Use the original column index so hiding a
                          // column doesn't shift other cells. Fall back
                          // to an object lookup for legacy dict rows.
                          const origIdx = data.columns.indexOf(c);
                          const v = Array.isArray(r) ? r[origIdx] : (r as any)?.[c];
                          return <td key={c} title={String(v ?? '')}>{v === null || v === undefined ? '' : String(v)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      <ColumnSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        allColumns={data.columns}
        visibleColumns={visibleColumns}
        hiddenColumns={hiddenColumns}
        primaryColumn={firstCol}
        onSave={next => setVisibleColumns(next)}
      />
    </div>
  );
}

/**
 * Modal for choosing which columns are rendered on the Database tab's
 * data table. Follows the design in azure/table_setting.png:
 *   • title, × close
 *   • one row per currently-visible column with a trash icon (lid opens
 *     on hover); the PK column renders the key badge next to its name
 *   • "Add new column" input at the bottom — type a previously-removed
 *     column name + Enter (or the + button) to bring it back
 *   • Cancel / Save buttons. Clicking outside also closes (as cancel).
 *   • Clicking a trash icon does NOT close the modal.
 */
function ColumnSettingsModal({
  open, onClose, allColumns, visibleColumns, hiddenColumns, primaryColumn, onSave,
}: {
  open: boolean;
  onClose: () => void;
  allColumns: string[];
  visibleColumns: string[];
  hiddenColumns: string[];
  primaryColumn: string;
  onSave: (next: string[]) => void;
}) {
  const [pending, setPending] = useState<string[]>(visibleColumns);
  const [addText, setAddText] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Reset pending state whenever the modal (re-)opens or the source
  // columns change underneath us.
  useEffect(() => {
    if (open) {
      setPending(visibleColumns);
      setAddText('');
      setAddError(null);
    }
  }, [open, visibleColumns]);

  if (!open) return null;

  const handleDelete = (c: string) => {
    // Don't let the user remove the primary column — the backend search
    // is anchored to it, and the key icon badge still points there.
    if (c === primaryColumn) return;
    setPending(prev => prev.filter(x => x !== c));
  };

  const handleAdd = () => {
    const target = addText.trim();
    if (!target) return;
    if (pending.includes(target)) {
      setAddError(`${target} is already shown`);
      return;
    }
    if (!allColumns.includes(target)) {
      setAddError(`${target} isn't a column in this table`);
      return;
    }
    // Restore in the table's original column order so the restored
    // cell lines up with the right data position.
    const next = allColumns.filter(c => pending.includes(c) || c === target);
    setPending(next);
    setAddText('');
    setAddError(null);
  };

  const handleSave = () => {
    onSave(pending);
    onClose();
  };

  return (
    <div className="col-settings-overlay" onClick={onClose} role="presentation">
      <div className="col-settings-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="col-settings-header">
          <h3>Choose columns to show in the table</h3>
          <button className="col-settings-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="col-settings-body">
          {pending.map(c => {
            const isPk = c === primaryColumn;
            return (
              <div key={c} className="col-settings-row">
                <span className="col-settings-name">
                  {c}
                  {isPk && (
                    <span className="col-settings-key" aria-hidden title="Primary column">
                      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                        <path d="M11.852,5.78189 C13.6093,4.02453 16.4586,4.02453 18.2159,5.78189 C19.9733,7.53925 19.9733,10.3885 18.2159,12.1459 C16.8717,13.49 14.8868,13.8075 13.2397,13.0923 C12.9957,12.9863 12.7116,12.9136 12.4028,12.9136 L11.0413,12.9136 C10.3509,12.9136 9.79129,13.4733 9.7913,14.1636 L9.7913,15.742 L8.21287,15.742 C7.52251,15.742 6.96287,16.3017 6.96287,16.992 L6.96287,18.5705 L4.72023,18.5705 L4.72023,17.1563 L10.0756,11.8009 C10.62,11.2565 10.7551,10.5046 10.6254,9.8695 C10.3325,8.43555 10.7426,6.89123 11.852,5.78189 Z M19.6301,4.36768 C17.0917,1.82927 12.9761,1.82927 10.4377,4.36768 C8.83366,5.97176 8.24428,8.20575 8.66584,10.2697 C8.67902,10.3343 8.66399,10.3813 8.66021,10.3878 L3.15957,15.8885 C2.87827,16.1698 2.72023,16.5513 2.72023,16.9492 L2.72023,19.5605 C2.72023,20.1182 3.17239,20.5705 3.7301,20.5705 L7.71287,20.5705 C8.40322,20.5705 8.96287,20.0108 8.96287,19.3205 L8.96287,17.742 L10.5413,17.742 C11.2317,17.742 11.7913,17.1824 11.7913,16.492 L11.7913,14.9136 L12.4015,14.9136 C12.4035,14.9138 12.4173,14.9156 12.4431,14.9268 C14.8181,15.958 17.6858,15.5044 19.6301,13.5601 C22.1685,11.0217 22.1685,6.90609 19.6301,4.36768 Z M14.6804,9.31743 C15.2662,9.90321 16.2159,9.90321 16.8017,9.31743 C17.3875,8.73164 17.3875,7.78189 16.8017,7.19611 C16.2159,6.61032 15.2662,6.61032 14.6804,7.19611 C14.0946,7.78189 14.0946,8.73164 14.6804,9.31743 Z" />
                      </svg>
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="col-settings-del"
                  onClick={() => handleDelete(c)}
                  title={isPk ? 'Primary column cannot be hidden' : `Hide ${c}`}
                  disabled={isPk}
                  aria-label={`Hide ${c}`}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* lid + handle grouped so CSS can tilt them on :hover */}
                    <g className="col-settings-del-lid">
                      <path d="M4 7H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5V7H9V5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                    <path d="M10 12V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 12V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M6 10V18C6 19.6569 7.34315 21 9 21H15C16.6569 21 18 19.6569 18 18V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            );
          })}

          <div className="col-settings-add-wrap">
            <input
              type="text"
              className="col-settings-add"
              placeholder="Add new column"
              value={addText}
              onChange={e => { setAddText(e.target.value); setAddError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              list="col-settings-hidden"
            />
            <datalist id="col-settings-hidden">
              {hiddenColumns.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          {addError && <div className="col-settings-add-error">{addError}</div>}
        </div>

        <div className="col-settings-footer">
          <button type="button" className="col-settings-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="col-settings-save" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

function AzureDbView({
  resourceId, snapshots, selectedItems, onToggleItem, onSelectAll, overrideSnapshotId,
}: {
  resourceId: string;
  snapshots: SnapshotItem[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectAll: (ids: string[], checked: boolean) => void;
  overrideSnapshotId?: string;
}) {
  // Sync the active tab to the URL (?tab=configuration|database|schema)
  // so the main Recovery page can decide — per-tab — whether to show
  // the global search input. Also makes the URL shareable / refresh-
  // stable, matching M365's behavior.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = (searchParams.get('tab') || '') as AzureDbTab;
  const activeTab: AzureDbTab =
    urlTab === 'database' || urlTab === 'schema' || urlTab === 'configuration'
      ? urlTab
      : 'configuration';
  const setActiveTab = (tab: AzureDbTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  // If the parent-provided version picker has a value we honour it;
  // otherwise fall back to the newest COMPLETED snapshot for this resource.
  const latestSnapshot = useMemo(() => {
    const completed = snapshots
      .filter(s => s.resourceId === resourceId && s.status === 'COMPLETED')
      .sort((a, b) => {
        const ta = parseAsUtc(a.createdAt)?.getTime() ?? 0;
        const tb = parseAsUtc(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      });
    if (overrideSnapshotId) {
      const picked = completed.find(s => s.id === overrideSnapshotId);
      if (picked) return picked;
    }
    return completed[0] || null;
  }, [snapshots, resourceId, overrideSnapshotId]);

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!latestSnapshot) { setItems([]); return; }
    setLoading(true);
    SnapshotService.listSnapshotFiles(latestSnapshot.id, 1, 5000)
      .then(data => setItems(data.content || []))
      .catch(() => { setItems([]); })
      .finally(() => setLoading(false));
  }, [latestSnapshot?.id]);

  // ── Bucket items by item_type for fast access across tabs.
  const configItem = useMemo(
    () => items.find(i => {
      const t = (i.itemType || '').toUpperCase();
      return t === 'AZURE_DB_CONFIG' || t.endsWith('_CONFIG') || t.endsWith('_CONFIGURATION');
    }) || null,
    [items],
  );
  const dbItems = useMemo(
    () => items.filter(i => (i.itemType || '').toUpperCase() === 'AZURE_DB_DATABASE'),
    [items],
  );
  const schemaFiles = useMemo(
    () => items.filter(i => {
      const t = (i.itemType || '').toUpperCase();
      return t === 'AZURE_DB_SCHEMA_FILE' || t.endsWith('_SCHEMA') || t.endsWith('_DUMP') || t.endsWith('_DDL');
    }),
    [items],
  );
  const tableItems = useMemo(
    () => items.filter(i => (i.itemType || '').toUpperCase() === 'AZURE_DB_TABLE'),
    [items],
  );

  // Derive the database list used by Schema + Data left rails. Prefer
  // AZURE_DB_DATABASE rows; fall back to unique folder_path prefixes.
  const databases: string[] = useMemo(() => {
    if (dbItems.length > 0) return dbItems.map(d => d.name || '').filter(Boolean).sort();
    const names = new Set<string>();
    for (const it of [...schemaFiles, ...tableItems]) {
      const fp = (it.folderPath || '').split('/')[0];
      if (fp) names.add(fp);
    }
    return Array.from(names).sort();
  }, [dbItems, schemaFiles, tableItems]);

  // Schema tab state
  const [schemaSelectedDb, setSchemaSelectedDb] = useState<string | null>(null);
  useEffect(() => {
    if (activeTab !== 'schema') return;
    if (!schemaSelectedDb && databases.length) setSchemaSelectedDb(databases[0]);
  }, [activeTab, databases, schemaSelectedDb]);

  // Build an N-level deep tree for the selected db. folder_path values
  // like "testdb/sql/public/Tables" yield nested nodes under sql →
  // public → Tables with the file (`customers`, `orders`, …) at the
  // leaf. Matches AFI's schema layout where tables, sequences, views
  // and role grants each live in their own nested folder.
  type SchemaNode = { name: string; children: Record<string, SchemaNode>; files: any[] };
  const schemaTree: SchemaNode = useMemo(() => {
    const root: SchemaNode = { name: '', children: {}, files: [] };
    if (!schemaSelectedDb) return root;
    for (const f of schemaFiles) {
      const parts = (f.folderPath || '').split('/').filter(Boolean);
      if (parts[0] !== schemaSelectedDb) continue;
      let cur = root;
      for (const seg of parts.slice(1)) {
        if (!cur.children[seg]) cur.children[seg] = { name: seg, children: {}, files: [] };
        cur = cur.children[seg];
      }
      cur.files.push(f);
    }
    return root;
  }, [schemaFiles, schemaSelectedDb]);

  const [expandedSchemaFolders, setExpandedSchemaFolders] = useState<Set<string>>(new Set());
  // Reset folder expansion when the selected db changes so each db
  // starts collapsed (matches the AFI screenshots).
  useEffect(() => { setExpandedSchemaFolders(new Set()); }, [schemaSelectedDb]);

  const renderSchemaNode = (node: SchemaNode, path: string, depth: number): any[] => {
    const out: any[] = [];
    const folderKeys = Object.keys(node.children).sort();
    for (const key of folderKeys) {
      const child = node.children[key];
      const fullPath = path ? `${path}/${key}` : key;
      const expanded = expandedSchemaFolders.has(fullPath);
      const descendantFiles: any[] = [];
      const collect = (n: SchemaNode) => {
        descendantFiles.push(...n.files);
        Object.values(n.children).forEach(collect);
      };
      collect(child);
      out.push(
        <div
          key={`folder-${fullPath}`}
          className="od-row od-row-folder az-db-schema-row az-db-schema-folder"
          style={{ paddingLeft: 8 + depth * 20 }}
          onClick={() => setExpandedSchemaFolders(prev => {
            const next = new Set(prev);
            if (next.has(fullPath)) next.delete(fullPath); else next.add(fullPath);
            return next;
          })}
        >
          <div className="od-td od-td-check" onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={descendantFiles.length > 0 && descendantFiles.every(c => selectedItems.has(c.id))}
              onChange={() => {
                const allOn = descendantFiles.every(c => selectedItems.has(c.id));
                descendantFiles.forEach(c => {
                  if (allOn === selectedItems.has(c.id)) onToggleItem(c.id);
                });
              }}
            />
          </div>
          <div className="od-td">
            <span className="od-row-icon az-db-folder-caret" aria-hidden>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"
                   style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .12s' }}>
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </span>
            <span className="od-row-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              </svg>
            </span>
            <span className="od-row-name">{key}</span>
          </div>
        </div>
      );
      if (expanded) {
        out.push(...renderSchemaNode(child, fullPath, depth + 1));
      }
    }
    for (const f of node.files) {
      const hasBlob = !!f.blobPath;
      out.push(
        <div key={f.id} className="od-row od-row-file az-db-schema-row"
             style={{ paddingLeft: 8 + depth * 20 }}>
          <div className="od-td od-td-check" onClick={e => e.stopPropagation()}>
            <input type="checkbox" checked={selectedItems.has(f.id)} onChange={() => onToggleItem(f.id)} />
          </div>
          <div className="od-td">
            {hasBlob && latestSnapshot ? (
              <a
                className="od-row-link"
                href={API.SNAPSHOTS.ITEM_CONTENT_DOWNLOAD(latestSnapshot.id, f.id)}
                download={f.name || undefined}
                target="_blank" rel="noopener noreferrer"
              >
                <span className="od-row-icon" aria-hidden>{odFileIcon(f.name || '')}</span>
                <span className="od-row-name">{f.name}</span>
              </a>
            ) : (
              <>
                <span className="od-row-icon" aria-hidden>{odFileIcon(f.name || '')}</span>
                <span className="od-row-name">{f.name}</span>
              </>
            )}
          </div>
        </div>
      );
    }
    return out;
  };

  // Data tab state — database selection drives AzureDbDataTab below.
  const [dataSelectedDb, setDataSelectedDb] = useState<string | null>(null);
  useEffect(() => {
    if (activeTab !== 'database') return;
    if (!dataSelectedDb && databases.length) setDataSelectedDb(databases[0]);
  }, [activeTab, databases, dataSelectedDb]);

  return (
    <>
      <div className="content-type-tabs">
        {(['configuration', 'database', 'schema'] as AzureDbTab[]).map(tab => (
          <button
            key={tab}
            className={`content-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {AZURE_DB_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'configuration' ? (
        !latestSnapshot ? (
          <div className="pbi-empty"><p>No completed backup for this database yet.</p></div>
        ) : loading ? (
          <div className="loading-container"><div className="spinner" /><p>Loading configuration…</p></div>
        ) : !configItem ? (
          <div className="pbi-empty"><p>No configuration captured in this snapshot.</p></div>
        ) : (configItem.metadata?.server_type === 'AZURE_SQL' || configItem.metadata?.raw?.server_type === 'AZURE_SQL') ? (
          <AzureSqlConfiguration
            raw={configItem.metadata?.raw || configItem.metadata || {}}
            snapshotId={latestSnapshot.id}
            itemId={configItem.id}
          />
        ) : (
          <AzureDbConfiguration
            raw={configItem.metadata?.raw || configItem.metadata || {}}
            snapshotId={latestSnapshot.id}
            itemId={configItem.id}
          />
        )
      ) : activeTab === 'schema' ? (
        <div className="three-panel-layout">
          <div className="panel-left">
            <div className="folder-list">
              {databases.length === 0 ? (
                <div className="folder-empty"><p>No databases</p></div>
              ) : (
                databases.map(db => (
                  <button
                    key={db}
                    className={`folder-item az-db-row ${schemaSelectedDb === db ? 'active' : ''}`}
                    onClick={() => setSchemaSelectedDb(db)}
                  >
                    {/* No checkbox on the Schema left rail — selection
                        happens in the middle-panel folder tree. Left
                        rail is just a database picker. */}
                    <span className="az-db-icon" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 16, height: 16 }}>
                        <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v6a9 3 0 0 0 18 0V5" /><path d="M3 11v6a9 3 0 0 0 18 0v-6" />
                      </svg>
                    </span>
                    <span className="folder-name">{db}</span>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="panel-middle" style={{ flex: 1 }}>
            {!schemaSelectedDb ? (
              <div className="empty-preview"><p>Select a database</p></div>
            ) : (
              <>
                <div className="az-db-breadcrumb">{schemaSelectedDb}</div>
                <div className="od-table">
                  <div className="od-table-head"><div className="od-th az-db-th-check" /><div className="od-th">Name</div></div>
                  <div className="od-table-body">
                    {(Object.keys(schemaTree.children).length === 0 && schemaTree.files.length === 0) ? (
                      <div className="empty-state"><p>No schema files captured for this database.</p></div>
                    ) : (
                      renderSchemaNode(schemaTree, '', 0)
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* Database tab — tree left rail (db → schema → tables) +
           full-width middle data pane with search + pagination. */
        <AzureDbDataTab
          snapshotId={latestSnapshot?.id || ''}
          databases={databases}
          tableItems={tableItems}
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
        />
      )}
      {/* Suppress unused lint for onSelectAll — reserved for future
          multi-select export once Data / Schema have more actions. */}
      {(() => { void onSelectAll; return null; })()}
    </>
  );
}

function PowerBiFilesView({
  resourceId, snapshots, selectedItems, onToggleItem, onSelectAll,
}: {
  resourceId: string;
  snapshots: SnapshotItem[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectAll: (ids: string[], checked: boolean) => void;
}) {
  // Pick the newest COMPLETED snapshot for this resource. Power BI
  // resources aren't Tier 1/Tier 2 — just one resource = one lineage of
  // snapshots, so we just take the latest one that finished.
  const latestSnapshot = useMemo(() => {
    return snapshots
      .filter(s => s.resourceId === resourceId && s.status === 'COMPLETED')
      .sort((a, b) => {
        const ta = parseAsUtc(a.createdAt)?.getTime() ?? 0;
        const tb = parseAsUtc(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      })[0] || null;
  }, [snapshots, resourceId]);

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!latestSnapshot) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    SnapshotService.listSnapshotFiles(latestSnapshot.id, 1, 500)
      .then(data => setItems(data.content || []))
      .catch(err => { setError(err.message || 'Failed to load files'); setItems([]); })
      .finally(() => setLoading(false));
  }, [latestSnapshot?.id]);

  if (!latestSnapshot) {
    return (
      <div className="pbi-empty">
        <p>No completed backup for this resource yet.</p>
      </div>
    );
  }

  const allChecked = items.length > 0 && items.every(i => selectedItems.has(i.id));

  return (
    <div className="pbi-files">
      <div className="content-type-tabs">
        <button className="content-tab active">
          Files
          {items.length > 0 && <span className="content-tab-count">{items.length.toLocaleString()}</span>}
        </button>
      </div>

      <div className="pbi-files-panel">
        {loading ? (
          <div className="loading-container"><div className="spinner" /><p>Loading files...</p></div>
        ) : error ? (
          <div className="pbi-empty"><p>{error}</p></div>
        ) : items.length === 0 ? (
          <div className="pbi-empty"><p>No files captured in this snapshot.</p></div>
        ) : (
          <div className="od-table">
            <div className="od-table-head pbi-head">
              <div className="od-th od-th-check">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={e => onSelectAll(items.map(i => i.id), e.target.checked)}
                />
              </div>
              <div className="od-th od-th-name">Name</div>
              <div className="od-th">Type</div>
              <div className="od-th od-th-size">Size</div>
              <div className="od-th od-th-modified">Captured at</div>
            </div>
            <div className="od-table-body">
              {items.map((item: any) => {
                const hasBlob = !!item.blobPath;
                const size = item.contentSize || 0;
                const typeLabel = (item.itemType || '').replace(/^POWER_BI_/, '').toLowerCase();
                return (
                  <div
                    key={item.id}
                    className={`od-row od-row-file pbi-row${selectedItems.has(item.id) ? ' selected' : ''}`}
                  >
                    <div className="od-td od-td-check" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedItems.has(item.id)}
                        onChange={() => onToggleItem(item.id)}
                      />
                    </div>
                    <div className="od-td od-td-name" title={item.name}>
                      {hasBlob ? (
                        <a
                          className="od-row-link"
                          href={API.SNAPSHOTS.ITEM_CONTENT_DOWNLOAD(latestSnapshot.id, item.id)}
                          download={item.name || undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          title={`Download ${item.name}`}
                        >
                          <span className="od-row-icon" aria-hidden>{odFileIcon(item.name || '')}</span>
                          <span className="od-row-name">{item.name}</span>
                        </a>
                      ) : (
                        <>
                          <span className="od-row-icon" aria-hidden>{odFileIcon(item.name || '')}</span>
                          <span className="od-row-name">{item.name}</span>
                          <span className="od-row-tag">metadata only</span>
                        </>
                      )}
                    </div>
                    <div className="od-td pbi-type">{typeLabel || '—'}</div>
                    <div className="od-td od-td-size">{size ? bytesToSize(size) : '—'}</div>
                    <div className="od-td od-td-modified">
                      {item.createdAt ? fmtLocalDate(item.createdAt, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Teams & Groups content view — 3 tabs:
 *   - Site            (SHAREPOINT_* items captured for the group's backing site)
 *   - Mail            (GROUP_MAILBOX_* items)
 *   - Team Channels   (TEAMS_CHANNEL_* / CHANNEL_MESSAGE items)
 *
 * Filters the latest snapshot's items by item_type prefix per tab.
 */
type GroupTab = 'site' | 'mail' | 'channels';
const GROUP_TAB_LABELS: Record<GroupTab, string> = {
  site: 'Site',
  mail: 'Mail',
  channels: 'Team Channels',
};

function groupTabMatches(tab: GroupTab, itemType: string): boolean {
  const t = (itemType || '').toUpperCase();
  if (tab === 'site') return t.startsWith('SHAREPOINT_');
  if (tab === 'mail') return t.startsWith('GROUP_MAILBOX_');
  if (tab === 'channels') return t === 'TEAMS_MESSAGE' || t === 'TEAMS_MESSAGE_REPLY';
  return false;
}

function sanitizeMessageHtml(raw: any): string {
  const html = raw?.body?.content ?? '';
  // Teams system events (meeting started/ended, members joined, chat
  // renamed, role updated, …) arrive with body "<systemEventMessage/>"
  // and from = null. Browsers drop the unknown tag, which leaves the
  // preview pane blank — users see empty messages for any folder that
  // happens to be mostly lifecycle events (e.g. a meeting chat). Render
  // a labeled placeholder derived from eventDetail.@odata.type instead.
  const isSystem =
    !raw?.from ||
    String(html).includes('<systemEventMessage/>') ||
    !!raw?.eventDetail;
  if (isSystem) {
    const label = String(raw?.eventDetail?.['@odata.type'] || '')
      .replace('#microsoft.graph.', '')
      .replace(/EventMessageDetail$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, (c) => c.toUpperCase());
    return `<div class="sys-event-label">— ${label || 'System event'} —</div>`;
  }
  if (!html) return '';
  // Strip inline <img> tags (Teams embeds giant base64 images that make
  // the right pane unreadable). Replace them with a small placeholder.
  return String(html).replace(/<img[^>]*>/gi, '[image]');
}

function GroupTeamsView({
  resourceId, snapshots, selectedItems, onToggleItem, onSelectAll,
  activeTab: controlledTab, onTabChange,
}: {
  resourceId: string;
  snapshots: SnapshotItem[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectAll: (ids: string[], checked: boolean) => void;
  // Optional controlled-tab mode — parent can drive the active tab so
  // the Download / Recover modals can route by (resourceKind × tab).
  // Omitting both keeps the legacy internal-state behaviour.
  activeTab?: GroupTab;
  onTabChange?: (next: GroupTab) => void;
}) {
  const [internalTab, setInternalTab] = useState<GroupTab>('site');
  const activeTab: GroupTab = controlledTab ?? internalTab;
  const setActiveTab = (next: GroupTab) => {
    if (controlledTab === undefined) setInternalTab(next);
    onTabChange?.(next);
  };

  const latestSnapshot = useMemo(() => {
    return snapshots
      .filter(s => s.resourceId === resourceId && s.status === 'COMPLETED')
      .sort((a, b) => {
        const ta = parseAsUtc(a.createdAt)?.getTime() ?? 0;
        const tb = parseAsUtc(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      })[0] || null;
  }, [snapshots, resourceId]);

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!latestSnapshot) { setItems([]); return; }
    setLoading(true);
    SnapshotService.listSnapshotFiles(latestSnapshot.id, 1, 5000)
      .then(data => setItems(data.content || []))
      .catch(() => { setItems([]); })
      .finally(() => setLoading(false));
  }, [latestSnapshot?.id]);

  // Counts per tab for the tab header badges. For Mail we only count
  // actual posts (GROUP_MAILBOX_POST) — threads are folder containers,
  // not discrete mail items, so including them inflates the badge. For
  // Channels we count only top-level messages, not replies.
  const tabCounts = useMemo(() => ({
    site: items.filter(i => groupTabMatches('site', i.itemType)).length,
    mail: items.filter(i => (i.itemType || '').toUpperCase() === 'GROUP_MAILBOX_POST').length,
    channels: items.filter(i => (i.itemType || '').toUpperCase() === 'TEAMS_MESSAGE').length,
  }), [items]);

  const visibleItems = useMemo(
    () => items.filter(i => groupTabMatches(activeTab, i.itemType)),
    [items, activeTab],
  );

  const allChecked = visibleItems.length > 0 && visibleItems.every(i => selectedItems.has(i.id));

  // ------ Mail: same layout as users' mail view ------
  // Left: threads as "folders". Middle: posts under selected thread as
  // EmailItemRow rows. Right: EmailPreview for selected post.
  const mailThreads = useMemo(
    () => items.filter(i => (i.itemType || '').toUpperCase() === 'GROUP_MAILBOX_THREAD'),
    [items],
  );
  const mailPosts = useMemo(
    () => items.filter(i => (i.itemType || '').toUpperCase() === 'GROUP_MAILBOX_POST'),
    [items],
  );
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  useEffect(() => {
    if (activeTab !== 'mail') return;
    if (!selectedThreadId && mailThreads.length) setSelectedThreadId(mailThreads[0].externalId);
  }, [activeTab, mailThreads, selectedThreadId]);

  const postsInThread = useMemo(() => {
    if (!selectedThreadId) return [];
    return mailPosts
      .filter(p => (p.metadata?.threadId || '') === selectedThreadId)
      .sort((a, b) => {
        const ta = parseAsUtc(a.metadata?.raw?.receivedDateTime || a.metadata?.raw?.sentDateTime || a.createdAt)?.getTime() ?? 0;
        const tb = parseAsUtc(b.metadata?.raw?.receivedDateTime || b.metadata?.raw?.sentDateTime || b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      });
  }, [mailPosts, selectedThreadId]);

  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  useEffect(() => { setSelectedPostId(null); }, [selectedThreadId]);
  useEffect(() => {
    if (activeTab !== 'mail') return;
    if (!selectedPostId && postsInThread.length) setSelectedPostId(postsInThread[0].id);
  }, [activeTab, postsInThread, selectedPostId]);
  const selectedPost = useMemo(
    () => postsInThread.find(p => p.id === selectedPostId) || null,
    [postsInThread, selectedPostId],
  );
  // Inject snapshotId onto the item so EmailPreview's attachment lookup works.
  const selectedPostForPreview = useMemo(
    () => selectedPost && latestSnapshot ? { ...selectedPost, snapshotId: latestSnapshot.id } : null,
    [selectedPost, latestSnapshot],
  );

  // ------ Channels (left=channels, middle=messages, right=replies) ------
  const channelMessages = useMemo(
    () => items.filter(i => (i.itemType || '').toUpperCase() === 'TEAMS_MESSAGE'),
    [items],
  );
  const channelReplies = useMemo(
    () => items.filter(i => (i.itemType || '').toUpperCase() === 'TEAMS_MESSAGE_REPLY'),
    [items],
  );
  const channels = useMemo(() => {
    const names = new Set<string>();
    // Prefer TEAMS_CHANNEL_INFO rows (they're always persisted, even when
    // /messages is blocked by protected-API permissions).
    for (const it of items) {
      if ((it.itemType || '').toUpperCase() === 'TEAMS_CHANNEL_INFO') {
        const n = it.metadata?.channelName || it.name;
        if (n) names.add(n);
      }
    }
    // Fallback: derive from captured messages if channel-info rows are
    // missing (older snapshots).
    for (const m of channelMessages) {
      const n = m.metadata?.channelName || (m.folderPath || '').split('/').pop();
      if (n) names.add(n);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [items, channelMessages]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== 'channels') return;
    if (!selectedChannel && channels.length) setSelectedChannel(channels[0]);
  }, [activeTab, channels, selectedChannel]);

  const messagesInChannel = useMemo(() => {
    if (!selectedChannel) return [];
    return channelMessages
      .filter(m => (m.metadata?.channelName || (m.folderPath || '').split('/').pop()) === selectedChannel)
      .sort((a, b) => {
        const ta = parseAsUtc(a.metadata?.raw?.createdDateTime || a.createdAt)?.getTime() ?? 0;
        const tb = parseAsUtc(b.metadata?.raw?.createdDateTime || b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      });
  }, [channelMessages, selectedChannel]);

  useEffect(() => {
    if (activeTab !== 'channels') return;
    if (!selectedMessageId && messagesInChannel.length) setSelectedMessageId(messagesInChannel[0].id);
  }, [activeTab, messagesInChannel, selectedMessageId]);

  const selectedMessage = useMemo(
    () => messagesInChannel.find(m => m.id === selectedMessageId) || null,
    [messagesInChannel, selectedMessageId],
  );

  const repliesForSelected = useMemo(() => {
    if (!selectedMessage) return [];
    const parentId = selectedMessage.externalId || selectedMessage.metadata?.raw?.id;
    return channelReplies
      .filter(r => {
        // Graph replies carry a replyToId pointing at the parent message.
        const replyTo = r.metadata?.raw?.replyToId || r.metadata?.raw?.parentMessageId;
        return replyTo === parentId;
      })
      .sort((a, b) => {
        const ta = parseAsUtc(a.metadata?.raw?.createdDateTime || a.createdAt)?.getTime() ?? 0;
        const tb = parseAsUtc(b.metadata?.raw?.createdDateTime || b.createdAt)?.getTime() ?? 0;
        return ta - tb;
      });
  }, [channelReplies, selectedMessage]);

  return (
    <>
      <div className="content-type-tabs">
        {(['site', 'mail', 'channels'] as GroupTab[]).map(tab => {
          const count = tabCounts[tab];
          return (
            <button
              key={tab}
              className={`content-tab ${activeTab === tab ? 'active' : ''}${count ? '' : ' content-tab-empty'}`}
              onClick={() => setActiveTab(tab)}
            >
              {GROUP_TAB_LABELS[tab]}
              {count > 0 && <span className="content-tab-count">{count.toLocaleString()}</span>}
            </button>
          );
        })}
      </div>

      {activeTab === 'site' ? (
        <div className="three-panel-layout od-layout-mode">
          <SharePointView
            resourceId={resourceId}
            snapshots={snapshots}
            selectedItems={selectedItems}
            onToggleItem={onToggleItem}
            onSelectAll={onSelectAll}
          />
        </div>
      ) : activeTab === 'mail' ? (
        /* Three-panel layout — structurally identical to the users' mail
           view. Left: folder list (thread topics). Middle: header +
           EmailItemRow list. Right: EmailPreview (or empty state).
           Uses the same .folder-list / .folder-item / .item-list-header
           / .item-list / .panel-right / .empty-preview classes so the
           styling matches 1:1. */
        <div className="three-panel-layout">
          <div className="panel-left">
            <div className="folder-list">
              {mailThreads.length === 0 ? (
                <div className="folder-empty"><p>No threads found</p></div>
              ) : (
                mailThreads.map(th => {
                  const topic = th.metadata?.raw?.topic || th.name || '(no subject)';
                  const postCount = mailPosts.filter(p => (p.metadata?.threadId || '') === th.externalId).length;
                  return (
                    <button
                      key={th.externalId}
                      className={`folder-item ${selectedThreadId === th.externalId ? 'active' : ''}`}
                      onClick={() => setSelectedThreadId(th.externalId)}
                      title={topic}
                    >
                      <span className="folder-name">{topic}</span>
                      {postCount > 0 && <span className="folder-count">{postCount}</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="panel-middle">
            <div className="item-list-header">
              <label className="select-all-wrap" title="Select all">
                <input
                  type="checkbox"
                  checked={postsInThread.length > 0 && postsInThread.every(p => selectedItems.has(p.id))}
                  onChange={e => {
                    if (e.target.checked) onSelectAll(postsInThread.map(p => p.id), true);
                    else onSelectAll(postsInThread.map(p => p.id), false);
                  }}
                />
              </label>
              <span className="item-count">
                {selectedItems.size > 0
                  ? `${selectedItems.size} / ${postsInThread.length} selected`
                  : postsInThread.length === 0
                    ? 'No items'
                    : `Showing ${postsInThread.length} of ${postsInThread.length}`}
              </span>
            </div>
            <div className="item-list">
              {loading ? (
                <div className="loading-container"><div className="spinner" /><p>Loading items...</p></div>
              ) : !latestSnapshot ? (
                <div className="empty-state"><p>No completed backup for this resource yet.</p></div>
              ) : postsInThread.length === 0 ? (
                <div className="empty-state"><p>No items found</p></div>
              ) : (
                postsInThread.map((p: any) => (
                  <EmailItemRow
                    key={p.id}
                    item={p}
                    selected={selectedPostId === p.id}
                    checked={selectedItems.has(p.id)}
                    onSelect={() => setSelectedPostId(p.id)}
                    onCheck={(e) => { e.stopPropagation(); onToggleItem(p.id); }}
                  />
                ))
              )}
            </div>
          </div>

          <div className="panel-right">
            {selectedPostForPreview
              ? <EmailPreview item={selectedPostForPreview} />
              : <div className="empty-preview"><p>Select an item to preview</p></div>
            }
          </div>
        </div>
      ) : (
        /* Team Channels: 3-panel layout. */
        <div className="three-panel-layout">
          <div className="panel-left">
            <div className="folder-tree-header">Channels</div>
            {channels.length === 0 ? (
              <div className="folder-tree-empty">No channels captured.</div>
            ) : (
              <div className="folder-tree">
                {channels.map(name => (
                  <button
                    key={name}
                    className={`folder-tree-item${selectedChannel === name ? ' selected' : ''}`}
                    onClick={() => { setSelectedChannel(name); setSelectedMessageId(null); }}
                  >
                    <span className="folder-tree-name">{name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="panel-middle">
            {loading ? (
              <div className="loading-container"><div className="spinner" /><p>Loading messages...</p></div>
            ) : messagesInChannel.length === 0 ? (
              <div className="pbi-empty"><p>No messages in this channel.</p></div>
            ) : (
              <div className="items-list">
                {messagesInChannel.map((m: any) => {
                  const raw = m.metadata?.raw || {};
                  const when = raw.createdDateTime || m.createdAt;
                  // Teams system events (member added, role updated, meeting
                  // started, channel renamed, …) arrive with from: null and
                  // body "<systemEventMessage/>". Render them as labeled
                  // system rows instead of "Unknown".
                  const isSystem =
                    !raw.from ||
                    String(raw.body?.content || '').includes('<systemEventMessage/>') ||
                    !!raw.eventDetail;
                  const sysLabel = String(raw.eventDetail?.['@odata.type'] || '')
                    .replace('#microsoft.graph.', '')
                    .replace(/EventMessageDetail$/, '')
                    .replace(/([a-z])([A-Z])/g, '$1 $2')
                    .replace(/^./, (c) => c.toUpperCase());
                  const author =
                    raw.from?.user?.displayName ||
                    raw.from?.application?.displayName ||
                    (isSystem ? 'System event' : 'Unknown');
                  const preview = isSystem
                    ? (sysLabel || 'System event')
                    : String(raw.body?.content || '').replace(/<[^>]+>/g, '').slice(0, 140);
                  return (
                    <div
                      key={m.id}
                      className={`item-row${selectedMessageId === m.id ? ' selected' : ''}`}
                      onClick={() => setSelectedMessageId(m.id)}
                    >
                      <div className="item-row-check" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedItems.has(m.id)}
                          onChange={() => onToggleItem(m.id)}
                        />
                      </div>
                      <div className="item-row-body">
                        <div className="item-row-title">{author}</div>
                        <div className="item-row-meta">
                          {when ? fmtLocal(when, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                        </div>
                        <div className="item-row-preview">{preview}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="panel-right">
            {selectedMessage ? (
              <div className="chat-preview">
                {/* Parent chat on top */}
                <div className="chat-preview-parent">
                  <div className="chat-preview-header">
                    <strong>{selectedMessage.metadata?.raw?.from?.user?.displayName || selectedMessage.metadata?.raw?.from?.application?.displayName || 'Unknown'}</strong>
                    <span className="chat-preview-date">
                      {fmtLocal(selectedMessage.metadata?.raw?.createdDateTime || selectedMessage.createdAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <div
                    className="chat-preview-body"
                    dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(selectedMessage.metadata?.raw) }}
                  />
                </div>
                {/* Replies below */}
                {repliesForSelected.length > 0 ? (
                  <div className="chat-preview-replies">
                    <div className="chat-preview-replies-header">
                      {repliesForSelected.length} {repliesForSelected.length === 1 ? 'reply' : 'replies'}
                    </div>
                    {repliesForSelected.map((r: any) => (
                      <div key={r.id} className="chat-preview-reply">
                        <div className="chat-preview-header">
                          <strong>{r.metadata?.raw?.from?.user?.displayName || r.metadata?.raw?.from?.application?.displayName || 'Unknown'}</strong>
                          <span className="chat-preview-date">
                            {fmtLocal(r.metadata?.raw?.createdDateTime || r.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </div>
                        <div
                          className="chat-preview-body"
                          dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(r.metadata?.raw) }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="chat-preview-noreplies">No replies on this chat.</div>
                )}
              </div>
            ) : (
              <div className="pbi-empty"><p>Select a message to see replies.</p></div>
            )}
          </div>
        </div>
      )}
    </>
  );
  // allChecked is no longer used directly at component root — kept for
  // future per-tab "select all" wiring. Suppress the unused-var warning
  // by exporting it from a noop closure.
  void allChecked;
}

/**
 * Azure Active Directory content view — 8 tabs matching AFI's office
 * directory model. Each tab filters snapshot items by their item_type.
 */
type EntraTab = 'users' | 'groups' | 'roles' | 'security' | 'audit' | 'applications' | 'intune' | 'adminunits';
const ENTRA_TAB_LABELS: Record<EntraTab, string> = {
  users: 'Users',
  groups: 'Groups',
  roles: 'Roles',
  security: 'Security',
  audit: 'Audit',
  applications: 'Applications',
  intune: 'Intune',
  adminunits: 'Administrative Units',
};
const ENTRA_TAB_TYPES: Record<EntraTab, string> = {
  users: 'ENTRA_DIR_USER',
  groups: 'ENTRA_DIR_GROUP',
  roles: 'ENTRA_DIR_ROLE',
  security: 'ENTRA_DIR_SECURITY',
  audit: 'ENTRA_DIR_AUDIT',
  applications: 'ENTRA_DIR_APPLICATION',
  intune: 'ENTRA_DIR_INTUNE',
  adminunits: 'ENTRA_DIR_ADMIN_UNIT',
};

type UserCategory = 'user' | 'shared' | 'room' | 'equipment';
const USER_CATEGORY_LABELS: Record<UserCategory, string> = {
  user: 'User mailboxes',
  shared: 'Shared mailboxes',
  room: 'Rooms',
  equipment: 'Equipment',
};

// ────────────────────────────────────────────────────────────────
// Shared pieces for Entra Directory tabs — AFI parity.
// Every tab except Audit uses the same three-panel shape, so we
// centralise the middle-row card + right-pane detail card here.
// ────────────────────────────────────────────────────────────────

function EntraTwoLineRow({
  name, sub, selected, checked, onSelect, onToggleCheck, badge,
}: {
  name: string;
  sub?: string;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggleCheck: (e: React.MouseEvent) => void;
  badge?: string | null;
}) {
  return (
    <div className={`entra-user-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <input
        className="entra-user-check"
        type="checkbox"
        checked={checked}
        onChange={() => {}}
        onClick={onToggleCheck}
      />
      <div className="entra-user-text">
        <div className="entra-user-name">{name}</div>
        {sub && <div className="entra-user-upn">{sub}</div>}
      </div>
      {badge && <span className="entra-user-badge">{badge}</span>}
    </div>
  );
}


function EntraDetailCard({
  title, fields, copyableField,
}: {
  title: string;
  fields: Array<{ label: string; value: React.ReactNode; hidden?: boolean }>;
  copyableField?: string;
}) {
  const initials = (title || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
  return (
    <div className="entra-user-detail">
      <div className="entra-user-detail-header">
        <div className="entra-user-avatar" aria-hidden>{initials}</div>
        <div className="entra-user-detail-title">{title}</div>
      </div>
      <div className="entra-user-detail-body">
        {fields.filter(f => !f.hidden && f.value !== undefined && f.value !== null && f.value !== '').map((f, i) => (
          <div key={i} className="entra-user-field">
            <span className="entra-user-field-label">{f.label}:</span>
            <span className="entra-user-field-val">
              {f.value}
              {copyableField === f.label && typeof f.value === 'string' && (
                <button
                  className="entra-user-copy"
                  title="Copy"
                  onClick={() => navigator.clipboard?.writeText(f.value as string)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 13, height: 13 }}>
                    <rect x="4" y="4" width="9" height="9" rx="1.2" />
                    <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2h7" />
                  </svg>
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Generic left-buckets → middle-rows → right-detail panel for an
 * Entra tab. Caller supplies the per-tab bucketing, row shape,
 * and detail-card field list. Keeps the 7 AFI-parity tabs DRY.
 */
function EntraBucketView<T extends { id: string; name?: string | null; metadata?: any }>({
  buckets,
  rows,
  bucketClassifier,
  rowSub,
  rowBadge,
  detailFields,
  detailTitle,
  copyableField,
  emptyListText,
  emptyRightText,
  selectedItems,
  onToggleItem,
  onSelectAll,
}: {
  buckets: string[];
  rows: T[];
  bucketClassifier: (row: T) => string;
  rowSub: (row: T) => string | undefined;
  rowBadge?: (row: T) => string | null | undefined;
  detailFields: (row: T) => Array<{ label: string; value: React.ReactNode }>;
  detailTitle: (row: T) => string;
  copyableField?: string;
  emptyListText: string;
  emptyRightText: string;
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectAll: (ids: string[], checked: boolean) => void;
}) {
  const [bucket, setBucket] = useState<string>(buckets[0] || '');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => { setSelectedId(null); }, [bucket]);

  const bucketed = useMemo(() => {
    const out: Record<string, T[]> = Object.fromEntries(buckets.map(b => [b, []]));
    for (const r of rows) {
      const b = bucketClassifier(r);
      if (out[b]) out[b].push(r);
    }
    for (const b of buckets) out[b].sort((a, b2) => String(a.name || '').localeCompare(String(b2.name || '')));
    return out;
  }, [rows, buckets, bucketClassifier]);

  const visible = bucketed[bucket] || [];
  const selected = visible.find(r => r.id === selectedId) || null;
  const allChecked = visible.length > 0 && visible.every(r => selectedItems.has(r.id));

  return (
    <div className="three-panel-layout">
      <div className="panel-left">
        <div className="folder-list">
          {buckets.map(b => {
            const count = (bucketed[b] || []).length;
            return (
              <button
                key={b}
                className={`folder-item ${bucket === b ? 'active' : ''}`}
                onClick={() => setBucket(b)}
              >
                <span className="folder-name">{b}</span>
                {count > 0 && <span className="folder-count">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="panel-middle">
        <div className="entra-user-list-header">
          <label className="select-all-wrap" title="Select all">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={e => onSelectAll(visible.map(r => r.id), e.target.checked)}
            />
          </label>
          <span className="entra-user-count">Items: {visible.length}</span>
          <span className="entra-user-sort">Sort by: Display Name</span>
        </div>
        <div className="item-list">
          {visible.length === 0 ? (
            <div className="empty-state"><p>{emptyListText}</p></div>
          ) : (
            visible.map((r: T) => (
              <EntraTwoLineRow
                key={r.id}
                name={r.name || '(unnamed)'}
                sub={rowSub(r)}
                selected={selectedId === r.id}
                checked={selectedItems.has(r.id)}
                onSelect={() => setSelectedId(r.id)}
                onToggleCheck={(e) => { e.stopPropagation(); onToggleItem(r.id); }}
                badge={rowBadge?.(r)}
              />
            ))
          )}
        </div>
      </div>
      <div className="panel-right">
        {selected ? (
          <EntraDetailCard
            title={detailTitle(selected)}
            fields={detailFields(selected)}
            copyableField={copyableField}
          />
        ) : (
          <div className="empty-preview"><p>{emptyRightText}</p></div>
        )}
      </div>
    </div>
  );
}

function EntraDirectoryView({
  resourceId, tenantId, snapshots, selectedItems, onToggleItem, onSelectAll,
}: {
  resourceId: string;
  tenantId: string;
  snapshots: SnapshotItem[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectAll: (ids: string[], checked: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<EntraTab>('users');

  const latestSnapshot = useMemo(() => {
    return snapshots
      .filter(s => s.resourceId === resourceId && s.status === 'COMPLETED')
      .sort((a, b) => {
        const ta = parseAsUtc(a.createdAt)?.getTime() ?? 0;
        const tb = parseAsUtc(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      })[0] || null;
  }, [snapshots, resourceId]);

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!latestSnapshot) { setItems([]); return; }
    setLoading(true);
    SnapshotService.listSnapshotFiles(latestSnapshot.id, 1, 5000)
      .then(data => setItems(data.content || []))
      .catch(() => { setItems([]); })
      .finally(() => setLoading(false));
  }, [latestSnapshot?.id]);

  const tabCounts = useMemo(() => {
    const counts: Record<EntraTab, number> = {
      users: 0, groups: 0, roles: 0, security: 0,
      audit: 0, applications: 0, intune: 0, adminunits: 0,
    };
    for (const it of items) {
      for (const tab of Object.keys(ENTRA_TAB_TYPES) as EntraTab[]) {
        if (it.itemType === ENTRA_TAB_TYPES[tab]) counts[tab]++;
      }
    }
    return counts;
  }, [items]);

  const visibleItems = useMemo(
    () => items.filter(i => i.itemType === ENTRA_TAB_TYPES[activeTab]),
    [items, activeTab],
  );

  // ── Users tab: classify ENTRA_DIR_USER rows into mailbox buckets by
  //    cross-referencing live MAILBOX / SHARED_MAILBOX / ROOM_MAILBOX
  //    resources (matched on email / userPrincipalName). Users without a
  //    mailbox resource fall into "User mailboxes" by default.
  const [userCategory, setUserCategory] = useState<UserCategory>('user');
  const [mailboxTypeByEmail, setMailboxTypeByEmail] = useState<Record<string, UserCategory>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== 'users') return;
    let cancelled = false;
    (async () => {
      try {
        const [shared, rooms] = await Promise.all([
          getResourcesByType(tenantId, 'SHARED_MAILBOX', 1, 2000).catch(() => ({ items: [] })),
          getResourcesByType(tenantId, 'ROOM_MAILBOX', 1, 2000).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        const map: Record<string, UserCategory> = {};
        for (const r of (shared.items || [])) {
          const e = (r.email || r.name || '').toLowerCase();
          if (e) map[e] = 'shared';
        }
        for (const r of (rooms.items || [])) {
          const e = (r.email || r.name || '').toLowerCase();
          if (e) map[e] = 'room';
        }
        setMailboxTypeByEmail(map);
      } catch {
        setMailboxTypeByEmail({});
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, tenantId]);

  const usersByCategory = useMemo(() => {
    const out: Record<UserCategory, any[]> = { user: [], shared: [], room: [], equipment: [] };
    const userRows = items.filter(i => i.itemType === 'ENTRA_DIR_USER');
    for (const u of userRows) {
      const raw = u.metadata?.raw || {};
      const email = String(raw.mail || raw.userPrincipalName || '').toLowerCase();
      const cat = mailboxTypeByEmail[email] || 'user';
      out[cat].push(u);
    }
    for (const c of Object.keys(out) as UserCategory[]) {
      out[c].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }
    return out;
  }, [items, mailboxTypeByEmail]);

  const usersInCategory = usersByCategory[userCategory];

  // Reset the selected user when switching categories so the right pane
  // doesn't keep showing a user no longer in the list.
  useEffect(() => { setSelectedUserId(null); }, [userCategory]);

  const selectedUser = useMemo(
    () => usersInCategory.find(u => u.id === selectedUserId) || null,
    [usersInCategory, selectedUserId],
  );

  return (
    <>
      <div className="content-type-tabs">
        {(Object.keys(ENTRA_TAB_LABELS) as EntraTab[]).map(tab => {
          const count = tabCounts[tab];
          return (
            <button
              key={tab}
              className={`content-tab ${activeTab === tab ? 'active' : ''}${count ? '' : ' content-tab-empty'}`}
              onClick={() => setActiveTab(tab)}
            >
              {ENTRA_TAB_LABELS[tab]}
              {count > 0 && <span className="content-tab-count">{count.toLocaleString()}</span>}
            </button>
          );
        })}
      </div>
      {activeTab === 'users' ? (
        /* Users tab — matches AFI's 3-panel layout:
             Left  = mailbox buckets (User / Shared / Rooms / Equipment)
             Mid   = accounts in the selected bucket (2-line rows)
             Right = avatar + name header + Account: label-value card
        */
        <div className="three-panel-layout">
          <div className="panel-left">
            <div className="folder-list">
              {(Object.keys(USER_CATEGORY_LABELS) as UserCategory[]).map(c => {
                const count = usersByCategory[c].length;
                return (
                  <button
                    key={c}
                    className={`folder-item ${userCategory === c ? 'active' : ''}`}
                    onClick={() => setUserCategory(c)}
                  >
                    <span className="folder-name">{USER_CATEGORY_LABELS[c]}</span>
                    {count > 0 && <span className="folder-count">{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="panel-middle">
            <div className="entra-user-list-header">
              <label className="select-all-wrap" title="Select all">
                <input
                  type="checkbox"
                  checked={usersInCategory.length > 0 && usersInCategory.every(u => selectedItems.has(u.id))}
                  onChange={e => onSelectAll(usersInCategory.map(u => u.id), e.target.checked)}
                />
              </label>
              <span className="entra-user-count">Items: {usersInCategory.length}</span>
              <span className="entra-user-sort">Sort by: Display Name</span>
            </div>
            <div className="item-list">
              {!latestSnapshot ? (
                <div className="empty-state"><p>No completed backup for this directory yet.</p></div>
              ) : loading ? (
                <div className="loading-container"><div className="spinner" /><p>Loading accounts…</p></div>
              ) : usersInCategory.length === 0 ? (
                <div className="empty-state"><p>No accounts in this category.</p></div>
              ) : (
                usersInCategory.map((u: any) => {
                  const raw = u.metadata?.raw || {};
                  const sub = raw.userPrincipalName || raw.mail || '';
                  return (
                    <div
                      key={u.id}
                      className={`entra-user-row ${selectedUserId === u.id ? 'selected' : ''}`}
                      onClick={() => setSelectedUserId(u.id)}
                    >
                      <input
                        className="entra-user-check"
                        type="checkbox"
                        checked={selectedItems.has(u.id)}
                        onChange={() => {}}
                        onClick={(e) => { e.stopPropagation(); onToggleItem(u.id); }}
                      />
                      <div className="entra-user-text">
                        <div className="entra-user-name">{raw.displayName || u.name}</div>
                        <div className="entra-user-upn">{sub}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="panel-right">
            {selectedUser ? (() => {
              const raw = selectedUser.metadata?.raw || {};
              const displayName = raw.displayName || selectedUser.name;
              const upn = raw.userPrincipalName || '';
              const email = raw.mail || '';
              const objectId = raw.id || selectedUser.externalId || '';
              const userType = raw.userType || '';
              const isExternal = String(upn).includes('#EXT#') || userType === 'Guest';
              // Normalize proxyAddresses -> "address (type)" rows, stripping
              // the "SMTP:"/"smtp:" prefix and inferring the type.
              const proxies: Array<{ addr: string; label: string; kind: string }> = [];
              for (const p of (raw.proxyAddresses || [])) {
                const s = String(p);
                const upper = s.startsWith('SMTP:');
                const lower = s.startsWith('smtp:');
                const addr = (upper || lower) ? s.slice(5) : s;
                proxies.push({
                  addr,
                  label: addr,
                  kind: upper ? 'work' : (lower ? 'proxy' : 'other'),
                });
              }
              for (const om of (raw.otherMails || [])) {
                proxies.push({ addr: String(om), label: String(om), kind: 'other' });
              }
              return (
                <div className="entra-user-detail">
                  <div className="entra-user-detail-header">
                    <div className="entra-user-avatar" aria-hidden>
                      {(displayName || '?').trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase() || '').join('')}
                    </div>
                    <div className="entra-user-detail-title">{displayName}</div>
                  </div>
                  <div className="entra-user-detail-body">
                    <div className="entra-user-section-header">Account:</div>
                    <div className="entra-user-field">
                      <span className="entra-user-field-label">Username:</span>
                      <span className="entra-user-field-val">{upn || '—'}</span>
                    </div>
                    <div className="entra-user-field">
                      <span className="entra-user-field-label">Email:</span>
                      <span className="entra-user-field-val">{email || '—'}</span>
                    </div>
                    {objectId && (
                      <div className="entra-user-field">
                        <span className="entra-user-field-label">Object ID:</span>
                        <span className="entra-user-field-val">
                          {objectId}
                          <button
                            className="entra-user-copy"
                            title="Copy Object ID"
                            onClick={() => navigator.clipboard?.writeText(objectId)}
                          >
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 13, height: 13 }}>
                              <rect x="4" y="4" width="9" height="9" rx="1.2" />
                              <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2h7" />
                            </svg>
                          </button>
                        </span>
                      </div>
                    )}
                    {proxies.length > 0 && (
                      <div className="entra-user-field">
                        <span className="entra-user-field-label">Other emails:</span>
                        <span className="entra-user-field-val">
                          {proxies.map((p, i) => (
                            <div key={i} className="entra-user-proxy-row">
                              {p.label} <span className="entra-user-proxy-kind">({p.kind})</span>
                            </div>
                          ))}
                        </span>
                      </div>
                    )}
                    {userType && (
                      <div className="entra-user-field">
                        <span className="entra-user-field-label">Type:</span>
                        <span className="entra-user-field-val">{userType}</span>
                      </div>
                    )}
                    <div className="entra-user-field">
                      <span className="entra-user-field-label">External:</span>
                      <span className="entra-user-field-val">{isExternal ? 'Yes' : 'No'}</span>
                    </div>
                    {raw.jobTitle && (
                      <div className="entra-user-field">
                        <span className="entra-user-field-label">Job title:</span>
                        <span className="entra-user-field-val">{raw.jobTitle}</span>
                      </div>
                    )}
                    {raw.department && (
                      <div className="entra-user-field">
                        <span className="entra-user-field-label">Department:</span>
                        <span className="entra-user-field-val">{raw.department}</span>
                      </div>
                    )}
                    {raw.accountEnabled === false && (
                      <div className="entra-user-field">
                        <span className="entra-user-field-label">Account enabled:</span>
                        <span className="entra-user-field-val">No</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })() : (
              <div className="empty-preview"><p>Select an account to preview</p></div>
            )}
          </div>
        </div>
      ) : activeTab === 'groups' ? (
        /* Groups — 4 buckets by groupTypes / mailEnabled / securityEnabled.
           Right panel: Email / Object ID (copy) / Description / Created /
           Owners / Membership type / Members with "Download all members". */
        <EntraBucketView
          buckets={['Microsoft 365', 'Distribution', 'Mail-Enabled Security', 'Security']}
          rows={visibleItems}
          bucketClassifier={(r: any) => {
            const raw = r.metadata?.raw || {};
            const gt = (raw.groupTypes || []).map((t: string) => t.toLowerCase());
            if (gt.includes('unified')) return 'Microsoft 365';
            if (raw.mailEnabled && !raw.securityEnabled) return 'Distribution';
            if (raw.mailEnabled && raw.securityEnabled) return 'Mail-Enabled Security';
            return 'Security';
          }}
          rowSub={(r: any) => r.metadata?.raw?.mail || ''}
          detailTitle={(r: any) => r.metadata?.raw?.displayName || r.name || ''}
          detailFields={(r: any) => {
            const raw = r.metadata?.raw || {};
            const owners = (raw._owners || []).map((o: any) =>
              `${o.displayName}${o.userPrincipalName ? ` (${o.userPrincipalName})` : ''}`,
            ).join(', ');
            const members = (raw._members || []).map((m: any) =>
              `${m.displayName}${m.userPrincipalName ? ` (${m.userPrincipalName})` : ''}`,
            ).join(', ');
            const membership = raw.groupTypes?.includes('DynamicMembership') ? 'Dynamic' : 'Assigned';
            return [
              { label: 'Email', value: raw.mail || '' },
              { label: 'Object ID', value: raw.id || r.externalId || '' },
              { label: 'Description', value: raw.description || '' },
              { label: 'Created', value: raw.createdDateTime ? fmtLocal(raw.createdDateTime, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '' },
              { label: 'Owners', value: owners || '' },
              { label: 'Membership type', value: membership },
              { label: 'Members', value: raw._memberCount > 0 ? `${members}${raw._memberCount >= 50 ? ` (+ more, ${raw._memberCount} shown)` : ''}` : '' },
            ];
          }}
          copyableField="Object ID"
          emptyListText="No groups in this category."
          emptyRightText="Select a group to preview"
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
          onSelectAll={onSelectAll}
        />
      ) : activeTab === 'roles' ? (
        /* Roles — single bucket. Right panel: Description + Privileges. */
        <EntraBucketView
          buckets={['Roles']}
          rows={visibleItems}
          bucketClassifier={() => 'Roles'}
          rowSub={(r: any) => {
            const d = r.metadata?.raw?.description || '';
            return d.length > 80 ? d.slice(0, 80) + '…' : d;
          }}
          detailTitle={(r: any) => r.metadata?.raw?.displayName || r.name || ''}
          detailFields={(r: any) => {
            const raw = r.metadata?.raw || {};
            const privList = (raw.rolePermissions || []).flatMap((rp: any) =>
              (rp.allowedResourceActions || []),
            );
            return [
              { label: 'Description', value: raw.description || '' },
              { label: 'Privileges', value: privList.length > 0 ? (
                <div>
                  {privList.map((p: string, i: number) => <div key={i}>{p}</div>)}
                </div>
              ) : '' },
            ];
          }}
          emptyListText="No roles captured."
          emptyRightText="Select a role to preview"
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
          onSelectAll={onSelectAll}
        />
      ) : activeTab === 'security' ? (
        /* Security — 5 buckets, driven by _sec_bucket tag set at backup. */
        <EntraBucketView
          buckets={['Conditional Access', 'Authentication Contexts', 'Authentication Strengths', 'Named Locations', 'Policies']}
          rows={visibleItems}
          bucketClassifier={(r: any) => r.metadata?.raw?._sec_bucket || 'Policies'}
          rowSub={(r: any) => {
            const raw = r.metadata?.raw || {};
            return `Details: ${raw.state || raw.isBuiltIn ? 'Built-In' : (raw.policyType || 'Custom')}`;
          }}
          detailTitle={(r: any) => r.metadata?.raw?.displayName || r.name || ''}
          detailFields={(r: any) => {
            const raw = r.metadata?.raw || {};
            return [
              { label: 'Description', value: raw.description || '' },
              { label: 'Created', value: raw.createdDateTime ? fmtLocal(raw.createdDateTime, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '' },
              { label: 'Details', value: raw.isBuiltIn ? 'Built-In' : (raw.state || '') },
            ];
          }}
          emptyListText="No security items"
          emptyRightText="No security items selected"
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
          onSelectAll={onSelectAll}
        />
      ) : activeTab === 'audit' ? (
        /* Audit — full-width table (no right panel). Two buckets in the
           left rail: Audit Logs / Sign-In Logs. */
        <EntraAuditView
          rows={visibleItems}
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
          onSelectAll={onSelectAll}
        />
      ) : activeTab === 'applications' ? (
        /* Applications — App Registrations vs Enterprise Applications. */
        <EntraBucketView
          buckets={['App Registrations', 'Enterprise Applications']}
          rows={visibleItems}
          bucketClassifier={(r: any) => r.metadata?.raw?._app_bucket || 'App Registrations'}
          rowSub={(r: any) => r.metadata?.raw?.appId || ''}
          detailTitle={(r: any) => r.metadata?.raw?.displayName || r.name || ''}
          detailFields={(r: any) => {
            const raw = r.metadata?.raw || {};
            // Flatten requiredResourceAccess into repeating Permission blocks.
            const perms: React.ReactNode[] = [];
            for (const rra of (raw.requiredResourceAccess || [])) {
              const apiName = rra.resourceAppId === '00000003-0000-0000-c000-000000000000' ? 'Microsoft Graph' : rra.resourceAppId;
              for (const access of (rra.resourceAccess || [])) {
                perms.push(
                  <div key={perms.length} className="entra-user-perm-block">
                    <div className="entra-user-perm-row"><span className="entra-user-perm-label">API Name:</span><span>{apiName}</span></div>
                    <div className="entra-user-perm-row"><span className="entra-user-perm-label">Claim value:</span><span>{access.id}</span></div>
                    <div className="entra-user-perm-row"><span className="entra-user-perm-label">Type:</span><span>{access.type === 'Scope' ? 'Delegated' : 'Application'}</span></div>
                  </div>
                );
              }
            }
            for (const r2 of (raw.appRoles || [])) {
              perms.push(
                <div key={perms.length} className="entra-user-perm-block">
                  <div className="entra-user-perm-row"><span className="entra-user-perm-label">API Name:</span><span>{raw.displayName}</span></div>
                  <div className="entra-user-perm-row"><span className="entra-user-perm-label">Claim value:</span><span>{r2.value}</span></div>
                  <div className="entra-user-perm-row"><span className="entra-user-perm-label">Permission:</span><span>{r2.displayName}</span></div>
                  <div className="entra-user-perm-row"><span className="entra-user-perm-label">Type:</span><span>Application</span></div>
                </div>
              );
            }
            return [
              { label: 'App ID', value: raw.appId || '' },
              { label: 'Created', value: raw.createdDateTime ? fmtLocal(raw.createdDateTime, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '' },
              { label: 'Permissions', value: perms.length > 0 ? <div>{perms}</div> : '' },
            ];
          }}
          copyableField="App ID"
          emptyListText="No applications in this category."
          emptyRightText="Select an application to preview"
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
          onSelectAll={onSelectAll}
        />
      ) : activeTab === 'intune' ? (
        /* Intune — Devices / Compliance Policies / Configuration Profiles. */
        <EntraBucketView
          buckets={['Devices', 'Compliance Policies', 'Configuration Profiles']}
          rows={visibleItems}
          bucketClassifier={(r: any) => r.metadata?.raw?._intune_bucket || 'Devices'}
          rowSub={(r: any) => {
            const o = r.metadata?.raw?._owner_display;
            return o ? `Owner: ${o}` : '';
          }}
          detailTitle={(r: any) => r.metadata?.raw?.displayName || r.name || ''}
          detailFields={(r: any) => {
            const raw = r.metadata?.raw || {};
            const joinType = raw.trustType === 'AzureAd' ? 'Microsoft Entra joined'
                           : raw.trustType === 'Workplace' ? 'Microsoft Entra registered'
                           : raw.trustType || '';
            return [
              { label: 'Object ID', value: raw.id || r.externalId || '' },
              { label: 'Enabled', value: raw.accountEnabled === undefined ? '' : (raw.accountEnabled ? 'Yes' : 'No') },
              { label: 'OS', value: raw.operatingSystem || '' },
              { label: 'Version', value: raw.operatingSystemVersion || '' },
              { label: 'Join type', value: joinType },
              { label: 'Owner', value: raw._owner_display || '' },
              { label: 'MDM', value: raw.isManaged === undefined ? '' : (raw.isManaged ? 'Yes' : 'No') },
              { label: 'Compliant', value: raw.isCompliant === undefined ? '' : (raw.isCompliant ? 'Yes' : 'No') },
              { label: 'Registered', value: raw.registrationDateTime ? fmtLocal(raw.registrationDateTime, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '' },
            ];
          }}
          copyableField="Object ID"
          emptyListText="No items in this category."
          emptyRightText="Select an item to preview"
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
          onSelectAll={onSelectAll}
        />
      ) : (
        /* Administrative Units — single bucket. */
        <EntraBucketView
          buckets={['Administrative Units']}
          rows={visibleItems}
          bucketClassifier={() => 'Administrative Units'}
          rowSub={(r: any) => r.metadata?.raw?.description || ''}
          detailTitle={(r: any) => r.metadata?.raw?.displayName || r.name || ''}
          detailFields={(r: any) => {
            const raw = r.metadata?.raw || {};
            return [
              { label: 'Object ID', value: raw.id || r.externalId || '' },
              { label: 'Description', value: raw.description || '' },
              { label: 'Visibility', value: raw.visibility || '' },
            ];
          }}
          copyableField="Object ID"
          emptyListText="No administrative units"
          emptyRightText="No administrative unit selected"
          selectedItems={selectedItems}
          onToggleItem={onToggleItem}
          onSelectAll={onSelectAll}
        />
      )}
    </>
  );
}

/**
 * Audit tab — full-width table (Name · Time · Initiated By · Category
 * · Operation Type). Left rail still splits Audit Logs / Sign-In Logs.
 */
function EntraAuditView({
  rows, selectedItems, onToggleItem, onSelectAll,
}: {
  rows: any[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectAll: (ids: string[], checked: boolean) => void;
}) {
  const [bucket, setBucket] = useState<'Audit Logs' | 'Sign-In Logs'>('Audit Logs');
  // AFI opens a modal when a row is clicked showing full audit details.
  const [modalRow, setModalRow] = useState<any | null>(null);
  const bucketed = useMemo(() => {
    const out: Record<string, any[]> = { 'Audit Logs': [], 'Sign-In Logs': [] };
    for (const r of rows) {
      const b = r.metadata?.raw?._audit_bucket || 'Audit Logs';
      if (out[b]) out[b].push(r);
    }
    return out;
  }, [rows]);
  const visible = bucketed[bucket];
  const allChecked = visible.length > 0 && visible.every(r => selectedItems.has(r.id));
  return (
    <div className="three-panel-layout">
      <div className="panel-left">
        <div className="folder-list">
          {(['Audit Logs', 'Sign-In Logs'] as const).map(b => (
            <button
              key={b}
              className={`folder-item ${bucket === b ? 'active' : ''}`}
              onClick={() => setBucket(b)}
            >
              <span className="folder-name">{b}</span>
              {bucketed[b].length > 0 && <span className="folder-count">{bucketed[b].length}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-middle" style={{ flex: 1 }}>
        <div className="od-table">
          <div className="od-table-head entra-audit-head">
            <div className="od-th od-th-check">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={e => onSelectAll(visible.map(r => r.id), e.target.checked)}
              />
            </div>
            <div className="od-th">Name</div>
            <div className="od-th">Time</div>
            <div className="od-th">Initiated By</div>
            <div className="od-th">Category</div>
            <div className="od-th">Operation Type</div>
          </div>
          <div className="od-table-body">
            {visible.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}><p>No {bucket.toLowerCase()} captured.</p></div>
            ) : visible.map((r: any) => {
              const raw = r.metadata?.raw || {};
              const name = raw.activityDisplayName || raw.operationName || r.name || '';
              const time = raw.activityDateTime || raw.createdDateTime || r.createdAt;
              const who = raw.initiatedBy?.user?.displayName
                       || raw.initiatedBy?.user?.userPrincipalName
                       || raw.initiatedBy?.app?.displayName
                       || raw.userDisplayName
                       || '—';
              const cat = raw.category || raw.loggedByService || '—';
              const op = raw.operationType || raw.status?.errorCode === 0 ? 'Success' : (raw.result || '—');
              return (
                <div
                  key={r.id}
                  className={`od-row entra-audit-row ${selectedItems.has(r.id) ? 'selected' : ''}`}
                  onClick={() => setModalRow(r)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="od-td od-td-check" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedItems.has(r.id)}
                      onChange={() => onToggleItem(r.id)}
                    />
                  </div>
                  <div className="od-td">{name}</div>
                  <div className="od-td">{time ? fmtLocal(time, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—'}</div>
                  <div className="od-td">{who}</div>
                  <div className="od-td">{cat}</div>
                  <div className="od-td">{op}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {modalRow && <EntraAuditModal row={modalRow} onClose={() => setModalRow(null)} />}
    </div>
  );
}

/**
 * Audit modal — opens when a row is clicked. Mirrors AFI's layout:
 * Name / Time / Initiated By (with type tag) / Category / Operation Type
 * / Result / Targets (list) / Details (list of property/value pairs).
 */
function EntraAuditModal({ row, onClose }: { row: any; onClose: () => void }) {
  const raw = row.metadata?.raw || {};
  const name = raw.activityDisplayName || raw.operationName || row.name || '';
  const time = raw.activityDateTime || raw.createdDateTime || row.createdAt;
  const init = raw.initiatedBy || {};
  const initName = init.user?.displayName || init.user?.userPrincipalName || init.app?.displayName || '—';
  const initType = init.user ? 'User' : (init.app ? 'Service principal' : '');
  const cat = raw.category || raw.loggedByService || '';
  const op = raw.operationType || '';
  const result = raw.result || (raw.status?.errorCode === 0 ? 'Success' : raw.status?.failureReason) || '';
  const targets = raw.targetResources || [];
  const details = raw.additionalDetails || [];

  // Close on ESC.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="entra-audit-modal-backdrop" onClick={onClose}>
      <div className="entra-audit-modal" onClick={e => e.stopPropagation()}>
        <button className="entra-audit-modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="entra-audit-modal-title">Audit Log Entry</div>
        <div className="entra-audit-modal-body">
          <div className="entra-audit-field"><span className="entra-audit-label">Name:</span><span>{name}</span></div>
          <div className="entra-audit-field"><span className="entra-audit-label">Time:</span><span>{time ? fmtLocal(time, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—'}</span></div>
          <div className="entra-audit-field">
            <span className="entra-audit-label">Initiated By:</span>
            <span>{initName}{initType && <span className="entra-audit-initkind"> ({initType})</span>}</span>
          </div>
          {cat && <div className="entra-audit-field"><span className="entra-audit-label">Category:</span><span>{cat}</span></div>}
          {op && <div className="entra-audit-field"><span className="entra-audit-label">Operation Type:</span><span>{op}</span></div>}
          {result && <div className="entra-audit-field"><span className="entra-audit-label">Result:</span><span>{result}</span></div>}
          {targets.length > 0 && (
            <div className="entra-audit-field entra-audit-multi">
              <span className="entra-audit-label">Targets:</span>
              <div className="entra-audit-sublist">
                {targets.map((t: any, i: number) => (
                  <div key={i} className="entra-audit-subrow">
                    <span className="entra-audit-sublabel">Type:</span><span>{t.type || 'Unknown type'}</span>
                    <span className="entra-audit-sublabel">Name:</span><span>{t.displayName || 'Unknown target'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {details.length > 0 && (
            <div className="entra-audit-field entra-audit-multi">
              <span className="entra-audit-label">Details:</span>
              <div className="entra-audit-sublist">
                {details.map((d: any, i: number) => (
                  <div key={i} className="entra-audit-subrow">
                    <span className="entra-audit-sublabel">Property:</span><span>{d.key || ''}</span>
                    <span className="entra-audit-sublabel">Value:</span><span style={{ wordBreak: 'break-all' }}>{String(d.value || '')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Recovery() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // Five fixed tabs — no runtime discovery. Default to first tab (mail).
  const contentTypes: ContentTab[] = CONTENT_TABS;
  // Initial state reads from the URL so a deep-link (copy-paste of a URL
  // with ?tab=onedrive&folder=/Documents) lands on the exact same view.
  const [activeContentType, setActiveContentType] = useState<ContentType>(() => {
    const t = searchParams.get('tab');
    return (t && (CONTENT_TABS as string[]).includes(t)) ? (t as ContentType) : 'mail';
  });

  // Resource selection
  const [resources, setResources] = useState<ResourceWithBackups[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resourceSearch, setResourceSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [showKindFilter, setShowKindFilter] = useState(false);
  const [selectedResource, setSelectedResource] = useState<ResourceWithBackups | null>(null);
  // Identity grouping: a single M365 Group or user often owns several resource surfaces
  // (Teams channel + SharePoint site + Entra group + Power BI, all sharing the same
  // name/email). Group by email-or-name so the left panel shows ONE row per identity
  // and expand inline to see its surfaces. Users with a single surface render flat.
  const [expandedIdentities, setExpandedIdentities] = useState<Set<string>>(new Set());

  // Snapshot selection
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>('');
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  // Active tab inside GroupTeamsView (M365 Groups / Entra Groups /
  // Teams Channels). Lifted into the parent so the Download / Recover
  // modals can route by tab: Site → file-family UX, Channels → chat
  // UX, Mail → mailbox UX. Legacy resources that don't use this view
  // ignore the state entirely.
  const [groupTeamsTab, setGroupTeamsTab] = useState<'site' | 'mail' | 'channels'>('site');

  // Folders (real from snapshot items)
  const [folders, setFolders] = useState<SnapshotFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>(() => {
    const f = searchParams.get('folder');
    if (f !== null) return f;
    // Mirror the URL-sync effect: OneDrive + My Drive defaults to root,
    // everything else defaults to "all folders".
    const t = searchParams.get('tab');
    const v = searchParams.get('view');
    const isOneDriveMyDrive = t === 'onedrive' && (v ?? 'my-drive') === 'my-drive';
    return isOneDriveMyDrive ? '/' : 'all';
  });
  const [foldersLoading, setFoldersLoading] = useState(false);
  // Left-panel folders pagination — 50 at a time, infinite-scroll appends.
  const [foldersPage, setFoldersPage] = useState<number>(1);
  const [foldersHasMore, setFoldersHasMore] = useState<boolean>(false);
  const [foldersLoadingMore, setFoldersLoadingMore] = useState<boolean>(false);
  const folderListRef = useRef<HTMLDivElement | null>(null);
  // Serialise folder-fetches so StrictMode's dev-mode double-effect and
  // rapid tab switches don't fire the same request twice.
  const foldersInflightRef = useRef<string>('');

  // OneDrive-only: switches the tab between "My Drive" (folder tree nav)
  // and "Recent" (flat list of files sorted by createdDateTime desc). Other
  // tabs ignore this state entirely.
  const [oneDriveView, setOneDriveView] = useState<'my-drive' | 'recent'>(() => {
    const v = searchParams.get('view');
    return v === 'recent' ? 'recent' : 'my-drive';
  });

  // OneDrive-only: folder paths whose bulk-select is currently fetching ids
  // from the backend. Used to disable the folder-row checkbox in-flight so
  // rapid clicks don't fire multiple overlapping requests for the same
  // folder. Clears when the fetch resolves.
  const [oneDriveFolderBusy, setOneDriveFolderBusy] = useState<Set<string>>(new Set());

  // OneDrive-only: folder paths the user has visibly "checked". Needed for
  // checkbox UI state (the fetch is async, so we can't derive a folder's
  // selected state from selectedItems until ids come back). Also used by
  // the Download button to tell the user a selection is in-flight so they
  // don't click Download too early and hit "No items selected".
  const [oneDriveFolderSelected, setOneDriveFolderSelected] = useState<Set<string>>(new Set());

  // Mirror of oneDriveFolder* for non-OneDrive folder lists (mail /
  // contacts / calendar). Lets the user bulk-select every item under a
  // folder for Download / Recover. Kept separate from the OneDrive set
  // because the two fetch paths use different endpoints and their
  // selected state should not cross-contaminate when the user switches
  // content-type tabs.
  const [genericFolderBusy, setGenericFolderBusy] = useState<Set<string>>(new Set());
  const [genericFolderSelected, setGenericFolderSelected] = useState<Set<string>>(new Set());

  // Merge current searchParams with a partial patch and push a new history
  // entry so the browser back/forward buttons walk back/forward through state
  // transitions (folder drill, tab switch, My Drive ↔ Recent) instead of
  // leaving the Recovery page. Keys set to null are removed.
  const patchSearchParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  // Browser back/forward updates searchParams; this effect syncs those
  // changes into local state so the UI reflects the restored URL. The
  // wrapped setters below push state → URL on user actions; this effect
  // closes the loop URL → state on history navigation.
  useEffect(() => {
    const t = searchParams.get('tab');
    let currentTab = t && (CONTENT_TABS as string[]).includes(t) ? (t as ContentType) : activeContentType;
    // Shared + room mailboxes have no OneDrive — redirect deep-links to Mail.
    const kind = selectedResource?.kind;
    if (currentTab === 'onedrive' && (kind === 'shared_mailbox' || kind === 'room_mailbox')) {
      currentTab = 'mail';
    }
    if (currentTab && currentTab !== activeContentType) {
      setActiveContentType(currentTab);
    }
    const v = searchParams.get('view');
    const nextView = v === 'recent' ? 'recent' : 'my-drive';
    if (nextView !== oneDriveView) setOneDriveView(nextView);
    const f = searchParams.get('folder');
    // OneDrive + My Drive: a missing folder param means "root" (/). For
    // every other combination, a missing folder means "all folders" (no
    // filter). This keeps My Drive showing only files that live directly
    // at the drive root instead of every file across the whole drive.
    const isOneDriveMyDrive = currentTab === 'onedrive' && nextView === 'my-drive';
    const nextFolder = f !== null ? f : (isOneDriveMyDrive ? '/' : 'all');
    if (nextFolder !== selectedFolder) setSelectedFolder(nextFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Recovery items - server-side paginated
  const [recoveryItems, setRecoveryItems] = useState<RecoveryItem[]>([]);
  // Infinite-scroll state: `hasMore` gates the scroll trigger; `loadingMore`
  // prevents duplicate append fetches while one is in flight. `requestKeyRef`
  // is bumped on every fresh load so late-arriving responses for a stale
  // filter/tab can be ignored. `itemListRef` is the scrolling container.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestKeyRef = useRef(0);
  // Separate from requestKeyRef so folder + items requests can invalidate
  // independently — a late folders response should never clobber when the
  // items request has already advanced to a new snapshot, and vice versa.
  const foldersKeyRef = useRef(0);
  const itemListRef = useRef<HTMLDivElement | null>(null);
  // Flips to the "<snapshotId>|<tab>" of the current chats view after the
  // initial auto-scroll-to-bottom has run. The top-edge pagination trigger
  // stays disarmed until this matches — otherwise a scroll event firing
  // during React's initial render (scrollTop=0 before rAF) would
  // incorrectly fetch a second page the user never asked for.
  const chatsAutoScrolledRef = useRef<string>('');
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemCount, setItemCount] = useState(0);
  const [itemPage, setItemPage] = useState(1);
  // Total page count is still tracked for the hasMore gate (`itemPage <
  // totalPages` in the append effect). Value is read via the state callback
  // inside the append effect rather than via the raw state getter, but we
  // keep the setter so the fresh-load can store it.
  const [, setItemTotalPages] = useState(1);
  const [selectedItem, setSelectedItem] = useState<RecoveryItem | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  // T20: single-select thread checkbox on the chats tab's folder list.
  // `threadPath` is the folder_path of the one ticked thread (null when
  // none). Paired with selectedItems: when a thread is picked the
  // per-message selection is narrowed to that thread so the two stay
  // coherent as download scope.
  const [threadPath, setThreadPath] = useState<string | null>(null);

  // When a thread is picked, clear any per-message selection belonging
  // to other threads. Re-runs when recoveryItems changes too so a fresh
  // page load doesn't leak cross-thread selections.
  useEffect(() => {
    if (!threadPath) return;
    setSelectedItems(prev => {
      const next = new Set<string>();
      for (const id of prev) {
        const it = recoveryItems.find(r => r.id === id);
        if (it && it.folderPath === threadPath) next.add(id);
      }
      return next;
    });
  }, [threadPath, recoveryItems]);

  const [restoreModalOpen, setRestoreModalOpen] = useState(false);

  // Toolbar
  const [searchQuery, setSearchQuery] = useState('');

  // Load resources with backups
  useEffect(() => {
    if (!tenantId) return;
    setResourcesLoading(true);
    SnapshotService.listResourcesWithBackups(tenantId, 1, 200)
      .then((data) => {
        setResources(data.items || []);
        // Auto-select resource from URL param or first available
        const resourceId = searchParams.get('resourceId');
        if (resourceId) {
          const found = data.items.find(r => r.id === resourceId);
          if (found) setSelectedResource(found);
        } else if (data.items.length > 0) {
          setSelectedResource(data.items[0]);
        }
      })
      .catch(console.error)
      .finally(() => setResourcesLoading(false));
  }, [tenantId]);

  // Per-content-tab snapshot resolver. The backend returns the latest
  // COMPLETED snapshot per tab (mail / onedrive / contacts / calendar /
  // chats) — no snapshot dropdown to surface to the user. Clicking a tab
  // auto-jumps to the right snapshot ID.
  const [contentSnapshots, setContentSnapshots] = useState<ContentSnapshotsResponse | null>(null);

  useEffect(() => {
    if (!selectedResource) {
      setSnapshots([]);
      setSelectedSnapshotId('');
      setContentSnapshots(null);
      return;
    }

    // Switching resources must invalidate the previously-selected
    // snapshot — otherwise the auto-seed below (`prev || newest.id`)
    // keeps the old resource's snapshot id, and Download/Recover fire
    // with a mismatched snapshot (items belong to the new resource's
    // snapshots, not the old one → backend returns "No items found").
    setSelectedSnapshotId('');
    setSelectedItems(new Set());
    setSnapshotsLoading(true);
    Promise.all([
      // Sparkline needs the historical snapshot list (date + size). For
      // ENTRA_USER parents the real content bytes live on Tier 2 children
      // (USER_MAIL / USER_ONEDRIVE / …), not on the parent itself — so
      // we ask the backend to include child snapshots. Other resource
      // kinds (Tier 1 MAILBOX, etc.) have no children and the flag is a
      // no-op for them.
      SnapshotService.listByResource(selectedResource.id, 1, 200, true).catch(() => ({ content: [] })),
      // Content-snapshots only exists for M365 parents — for Azure DB /
      // VM / SharePoint / Power BI the endpoint can 404. Swallow the
      // error locally so the Promise.all still resolves and `snapshots`
      // gets populated (otherwise the whole effect rejected and the
      // Download toolbar never saw a snapshot to latch onto).
      SnapshotService.getContentSnapshots(selectedResource.id).catch(() => null),
    ])
      .then(([list, content]) => {
        const snapList = list.content || [];
        setSnapshots(snapList);
        setContentSnapshots(content as any);
        // Auto-seed selectedSnapshotId for kinds that don't flow through
        // the M365 content-snapshot resolver (Azure DB / VM / SharePoint
        // / Power BI). Without this the Download / Recover buttons stay
        // permanently disabled — hasSnapshot depends on it. Skip if the
        // caller already picked one.
        const newestCompleted = snapList
          .filter((s: any) => (s.status || '').toUpperCase() === 'COMPLETED')
          .sort((a: any, b: any) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return tb - ta;
          })[0];
        if (newestCompleted) {
          setSelectedSnapshotId(prev => prev || newestCompleted.id);
        }
      })
      .catch(console.error)
      .finally(() => setSnapshotsLoading(false));
  }, [selectedResource]);

  // When the resolver loads OR the active tab changes, swap selectedSnapshotId
  // to whatever snapshot the backend says backs that tab. `null` means the
  // tab has no content yet — render empty state, do NOT fall back to the
  // parent's snapshot: each Tier 2 child owns its own snapshots, and the
  // parent only holds identity items (profile/manager/group memberships),
  // so cross-using its folder_paths on another tab leaks folder rows from
  // an unrelated snapshot into the left panel.
  //
  // Skip when the resource isn't M365-shaped (Azure DB / VM / SharePoint /
  // Power BI don't use contentSnapshots at all) — otherwise this effect
  // would reset the selection to '' on every render and fight with the
  // RecoveryToolbar's auto-select of the newest COMPLETED snapshot.
  useEffect(() => {
    if (!contentSnapshots) return;
    if (!activeContentType || !(CONTENT_TABS as string[]).includes(activeContentType as string)) return;
    const entry = contentSnapshots.byContent[activeContentType as ContentTab];
    // Only propagate the resolver's choice when it actually has one —
    // otherwise leave selectedSnapshotId alone. Non-M365 resources
    // (Azure DB, VM, SharePoint, Power BI) use contentSnapshots with
    // every byContent key set to null, which used to blank the toolbar's
    // auto-select and keep Download disabled.
    if (entry?.snapshotId) {
      setSelectedSnapshotId(entry.snapshotId);
    }
  }, [contentSnapshots, activeContentType]);

  // Debounce the search box so we don't refetch on every keystroke. 300ms
  // strikes a reasonable balance between responsiveness and request volume
  // on typical typing speeds.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Fresh load: any time the underlying filter (snapshot / tab / folder /
  // search) changes, reset to page 1, kill any in-flight older fetch via
  // requestKeyRef, and scroll the list back to the top so the user doesn't
  // land mid-page on the previous filter's scroll position.
  useEffect(() => {
    if (!selectedSnapshotId || !selectedResource || !activeContentType) {
      setRecoveryItems([]);
      setItemCount(0);
      setItemTotalPages(1);
      setHasMore(false);
      setItemPage(1);
      return;
    }

    // Calendar tab has its own dedicated fetch inside CalendarMonthView
    // (which calls /snapshots/{id}/calendar directly). Don't double-fetch
    // the same events through the generic /items endpoint — saves one
    // network round trip per calendar-tab open.
    if (activeContentType === 'calendar') {
      setRecoveryItems([]);
      setItemCount(0);
      setItemTotalPages(1);
      setHasMore(false);
      setItemPage(1);
      setItemsLoading(false);
      return;
    }

    // Wait for the folders list (left panel) to land before firing the
    // items fetch. On Chats the folders response also auto-selects the
    // first chat into selectedFolder — if we fired items first we'd send
    // an all-chats query then immediately refire against the selected
    // chat, doubling the request count per tab switch.
    if (foldersLoading) return;

    const myKey = ++requestKeyRef.current;
    setItemPage(1);
    setItemsLoading(true);
    if (itemListRef.current) itemListRef.current.scrollTop = 0;
    // Calendar tab returns early above, so by this point activeContentType
    // is narrowed to non-calendar. Use a fixed page size of 50.
    const pageSize = 50;
    const isChats = activeContentType === 'chats';
    // OneDrive "Recent" mode: drop the folder filter and ask backend to
    // sort by createdDateTime DESC. "My Drive" uses default name_asc so
    // folder listings look alphabetical like a file explorer.
    const isOneDrive = activeContentType === 'onedrive';
    const oneDriveRecent = isOneDrive && oneDriveView === 'recent';
    const effectiveFolder = oneDriveRecent ? 'all' : selectedFolder;
    const sortParam = oneDriveRecent ? 'created_desc' : (isOneDrive ? 'name_asc' : undefined);
    SnapshotService.listItems(
      selectedSnapshotId, 1, pageSize,
      activeContentType as ContentTab, effectiveFolder, debouncedSearch, sortParam,
    )
      .then((data) => {
        if (myKey !== requestKeyRef.current) return;  // stale fetch — filter changed
        // Chats: backend orders newest-first. We reverse each page so the
        // displayed list reads oldest-top → newest-bottom, matching
        // Teams/WhatsApp. Initial page is visually "the most recent
        // window of the conversation".
        const content = isChats ? [...data.content].reverse() : data.content;
        setRecoveryItems(content);
        setItemCount(data.totalElements);
        setItemTotalPages(data.totalPages || 1);
        setHasMore(1 < (data.totalPages || 1));
        // For chats, auto-scroll to the bottom after render so the user
        // lands on the newest message. requestAnimationFrame waits for
        // the new children to be laid out. We mark the ref with the
        // current (snapshot|tab) identity so the top-edge paginator
        // knows the auto-scroll already ran — and won't mistake the
        // pre-autoscroll `scrollTop=0` for "user scrolled to top".
        if (isChats) {
          chatsAutoScrolledRef.current = '';  // disarm while re-loading
          requestAnimationFrame(() => {
            const el = itemListRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            chatsAutoScrolledRef.current = `${selectedSnapshotId}|${activeContentType}`;
            // If page-1 content is too short to overflow the viewport
            // (e.g. system-event rows got filtered, leaving <50 visible),
            // the user can never scroll-up to trigger page 2 — the list
            // isn't scrollable at all. Auto-bump to page 2 so older
            // messages keep loading until the viewport actually fills.
            if (el && (data.totalPages || 1) > 1 &&
                el.scrollHeight <= el.clientHeight + 200) {
              setItemPage(p => Math.max(p, 2));
            }
          });
        }
      })
      .catch((error) => {
        if (myKey !== requestKeyRef.current) return;
        console.error('Failed to load items:', error);
        setRecoveryItems([]);
      })
      .finally(() => {
        if (myKey === requestKeyRef.current) setItemsLoading(false);
      });
  }, [selectedSnapshotId, selectedResource, activeContentType, selectedFolder, debouncedSearch, oneDriveView, foldersLoading]);

  // Append next page when itemPage advances (driven by the scroll handler
  // below). Separate effect so the fresh-load above doesn't re-run on every
  // scroll-triggered page bump. For the chats tab we PREPEND instead (older
  // messages go above), and preserve the user's scroll position so the
  // view doesn't yank when new rows appear at the top.
  useEffect(() => {
    if (itemPage <= 1 || !selectedSnapshotId || !activeContentType) return;
    // Calendar tab runs its own fetch in CalendarMonthView; skip the
    // infinite-scroll page-append path here so we don't duplicate.
    if (activeContentType === 'calendar') return;
    const myKey = requestKeyRef.current;
    const isChats = activeContentType === 'chats';
    setLoadingMore(true);
    // activeContentType is narrowed away from 'calendar' by the guard
    // above, so a fixed page size of 50 is correct here.
    const pageSize = 50;
    // Snapshot the scroll height BEFORE the next page lands so we can
    // anchor the viewport to the same content after prepending.
    const el = itemListRef.current;
    const prevScrollHeight = el ? el.scrollHeight : 0;
    const prevScrollTop = el ? el.scrollTop : 0;
    const isOneDrive = activeContentType === 'onedrive';
    const oneDriveRecent = isOneDrive && oneDriveView === 'recent';
    const effectiveFolder = oneDriveRecent ? 'all' : selectedFolder;
    const sortParam = oneDriveRecent ? 'created_desc' : (isOneDrive ? 'name_asc' : undefined);
    SnapshotService.listItems(
      selectedSnapshotId, itemPage, pageSize,
      activeContentType as ContentTab, effectiveFolder, debouncedSearch, sortParam,
    )
      .then((data) => {
        if (myKey !== requestKeyRef.current) return;  // filter changed mid-fetch
        if (isChats) {
          // Older page = reverse within the page, then PREPEND so older
          // content shows up above what the user is already reading.
          const olderReversed = [...data.content].reverse();
          setRecoveryItems(prev => [...olderReversed, ...prev]);
          requestAnimationFrame(() => {
            const el2 = itemListRef.current;
            if (el2) el2.scrollTop = prevScrollTop + (el2.scrollHeight - prevScrollHeight);
            // Keep auto-bumping while the list still doesn't overflow
            // and more pages exist — otherwise scroll-up can never fire.
            if (el2 && itemPage < (data.totalPages || 1) &&
                el2.scrollHeight <= el2.clientHeight + 200) {
              setItemPage(p => p + 1);
            }
          });
        } else {
          setRecoveryItems(prev => [...prev, ...data.content]);
        }
        setHasMore(itemPage < (data.totalPages || 1));
      })
      .catch(console.error)
      .finally(() => {
        if (myKey === requestKeyRef.current) setLoadingMore(false);
      });
  }, [itemPage]);

  // Infinite-scroll trigger. For non-chat tabs it fires near the BOTTOM of
  // the list (within 200px) so pagination feels truly end-of-page. For
  // chats it fires near the TOP, because older messages live above the
  // fold in the reverse-chronological layout.
  //
  // Chats extra safety:
  //   1. Only fire after the initial auto-scroll-to-bottom has marked the
  //      ref — before that `scrollTop=0` is the RENDER default, not a user
  //      intent.
  //   2. Require the list to actually overflow (scrollHeight > clientHeight
  //      + 200) — otherwise a small page keeps `scrollTop=0` forever and
  //      we'd fire in a loop.
  const handleItemListScroll = useCallback(() => {
    const el = itemListRef.current;
    if (!el || loadingMore || !hasMore) return;
    const isChats = activeContentType === 'chats';
    if (isChats) {
      const marker = `${selectedSnapshotId}|${activeContentType}`;
      if (chatsAutoScrolledRef.current !== marker) return; // initial autoscroll hasn't run
      if (el.scrollHeight <= el.clientHeight + 200) return; // not scrollable yet
      if (el.scrollTop <= 200) setItemPage(p => p + 1);
    } else {
      const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight);
      if (remaining <= 200) setItemPage(p => p + 1);
    }
  }, [loadingMore, hasMore, activeContentType, selectedSnapshotId]);

  // Clear preview + drop EVERY form of selection (item-level checkboxes
  // AND folder-level bulk-select) when the snapshot, tab, or active
  // folder changes. Without this, ids from one scope leak into another
  // (Download/Recover would act on stale ids — e.g. Inbox ticks
  // surviving a switch to Deleted, or OneDrive bulk-folder picks
  // re-appearing when navigating back to a folder you'd left).
  // For Azure DB the "active tab" lives in `?tab=configuration|database
  // |schema` (URL-synced inside AzureDbView), not in activeContentType —
  // include that value so switching between Configuration / Database /
  // Schema also resets the checkbox state.
  useEffect(() => {
    setSelectedItem(null);
    setSelectedItems(new Set());
    setOneDriveFolderSelected(new Set());
    setOneDriveFolderBusy(new Set());
    setGenericFolderSelected(new Set());
    setGenericFolderBusy(new Set());
  }, [selectedSnapshotId, activeContentType, searchParams.get('tab'), selectedFolder]);

  // Left-panel grouping is uniform across mail / onedrive / contacts /
  // chats — all driven by the active tab's snapshot's distinct folder_paths.
  // Chats use "chats/<friendly name>" as their path. Calendar has its own
  // layout and skips this entirely.
  //
  // Important: we derive the snapshot id FROM THE RESOLVER (contentSnapshots
  // + activeContentType), not from selectedSnapshotId. selectedSnapshotId is
  // a derived cached state — the tab-click flips activeContentType one render
  // BEFORE the resolver updates selectedSnapshotId, so an effect keyed on
  // selectedSnapshotId would fire twice per tab switch: once with the
  // previous tab's id (wrong — leaks its folders into the new panel), then
  // correctly. Deriving directly fires exactly once per tab switch with the
  // right id. The requestKey is kept as a safety net for edge cases (e.g.
  // overlapping resource switches).
  useEffect(() => {
    setFolders([]);
    setFoldersPage(1);
    setFoldersHasMore(false);
    // Don't reset selectedFolder here — the URL-sync effect is the
    // single source of truth for that value now. Resetting would
    // clobber a restored folder when the user presses browser back.

    if (activeContentType === 'calendar') {
      return;
    }
    // Tier 2 (USER_MAIL / USER_ONEDRIVE / …) ships a resolver
    // byContent[tab] → snapshotId. Tier 1 direct mailboxes (MAILBOX /
    // SHARED_MAILBOX / ROOM_MAILBOX / GROUP_MAILBOX) have no resolver
    // entry but they DO have snapshots of their own — fall back to
    // selectedSnapshotId so the folders API still fires for them.
    const entry = contentSnapshots?.byContent[activeContentType as ContentTab];
    const kind = selectedResource?.kind;
    const isDirectMailbox = kind === 'mailbox' || kind === 'shared_mailbox' || kind === 'room_mailbox';
    const snapId = entry?.snapshotId || (isDirectMailbox ? selectedSnapshotId : null);
    if (!snapId) {
      return;
    }

    // StrictMode in dev intentionally mounts/unmounts each effect twice
    // — guard against the duplicate call landing on the same (snap, tab)
    // pair. In production builds this is a no-op.
    const inflightKey = `${snapId}|${activeContentType}|1`;
    if (foldersInflightRef.current === inflightKey) return;
    foldersInflightRef.current = inflightKey;

    // Pass the item_type so the backend can auto-resolve to the right
    // Tier-2 sibling snapshot if the caller's snapshotId is for a
    // different resource (e.g. the ENTRA_USER parent or the Calendar
    // sibling). Without this, opening the Chats tab against the
    // parent's snapshot id returned the parent's folders (or none) —
    // the left-panel thread list ended up empty even though the
    // user had thousands of chat messages under the USER_CHATS
    // sibling. Mirrors the auto-resolve already live on /chats,
    // /mail, /calendar and /contacts.
    const TYPE_BY_TAB: Record<string, string | undefined> = {
      mail: 'EMAIL',
      chats: 'TEAMS_CHAT_MESSAGE',
      calendar: 'CALENDAR_EVENT',
      contacts: 'USER_CONTACT',
    };
    const itemTypeForFolders = TYPE_BY_TAB[activeContentType];

    // First-load size. 500 is the server's hard cap and is still small
    // bytes-wise (just folder name + count per row). Applied across every
    // tab — chats routinely break 100, and mail with deep custom-folder
    // hierarchies can also exceed 50 on power users. With this in place
    // virtually every tenant sees their full folder list without needing
    // to scroll the left rail. Infinite-scroll stays wired up as a safety
    // net for the rare tenant with >500 folders.
    const firstPageSize = 500;

    const myKey = ++foldersKeyRef.current;
    setFoldersLoading(true);
    SnapshotService.getFolders(snapId, itemTypeForFolders, 1, firstPageSize)
      .then((resp) => {
        if (myKey !== foldersKeyRef.current) return; // stale — a newer request started
        const data = resp.content;
        const folderList = [{ path: '', count: data.reduce((sum, f) => sum + f.count, 0) }, ...data];
        setFolders(folderList);
        setFoldersHasMore(!!resp.hasMore);
        setFoldersPage(1);
        // Chats tab: no "All" — auto-pick the top chat so the message list
        // opens on real content instead of an aggregate view.
        if (activeContentType === 'chats') {
          const firstChat = data.find(f => f.path);
          if (firstChat) setSelectedFolder(firstChat.path);
        }
      })
      .catch((err) => {
        if (myKey !== foldersKeyRef.current) return;
        console.error(err);
      })
      .finally(() => {
        if (myKey === foldersKeyRef.current) {
          setFoldersLoading(false);
          foldersInflightRef.current = '';
        }
      });
  }, [contentSnapshots, activeContentType, selectedSnapshotId, selectedResource?.kind]);

  // Infinite-scroll append: when foldersPage advances (driven by the
  // scroll handler below), fetch the next page and append to the tree.
  useEffect(() => {
    if (foldersPage <= 1) return;
    const entry = contentSnapshots?.byContent[activeContentType as ContentTab];
    const kind = selectedResource?.kind;
    const isDirectMailbox = kind === 'mailbox' || kind === 'shared_mailbox' || kind === 'room_mailbox';
    const snapId = entry?.snapshotId || (isDirectMailbox ? selectedSnapshotId : null);
    if (!snapId) return;
    const inflightKey = `${snapId}|${activeContentType}|${foldersPage}`;
    if (foldersInflightRef.current === inflightKey) return;
    foldersInflightRef.current = inflightKey;
    // Same item_type routing as the first-page fetch above so
    // infinite-scroll loads append the correct Tier-2 siblings.
    const TYPE_BY_TAB_2: Record<string, string | undefined> = {
      mail: 'EMAIL',
      chats: 'TEAMS_CHAT_MESSAGE',
      calendar: 'CALENDAR_EVENT',
      contacts: 'USER_CONTACT',
    };
    const itemTypeForMore = TYPE_BY_TAB_2[activeContentType];

    // Match the first-page size on subsequent infinite-scroll fetches.
    // Mostly a safety net since 500 covers virtually every tenant.
    const nextPageSize = 500;
    setFoldersLoadingMore(true);
    SnapshotService.getFolders(snapId, itemTypeForMore, foldersPage, nextPageSize)
      .then((resp) => {
        setFolders((prev) => {
          const seen = new Set(prev.map(f => f.path));
          const appended = resp.content.filter(f => !seen.has(f.path));
          return [...prev, ...appended];
        });
        setFoldersHasMore(!!resp.hasMore);
      })
      .catch(console.error)
      .finally(() => {
        setFoldersLoadingMore(false);
        foldersInflightRef.current = '';
      });
  }, [foldersPage, contentSnapshots, activeContentType, selectedSnapshotId, selectedResource?.kind]);

  // Scroll handler — near the bottom of the folder list, advance page.
  const handleFolderListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (foldersLoading || foldersLoadingMore || !foldersHasMore) return;
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      setFoldersPage(p => p + 1);
    }
  }, [foldersLoading, foldersLoadingMore, foldersHasMore]);



  const handleResourceSelect = (resource: ResourceWithBackups) => {
    if (selectedResource?.id === resource.id) {
      // Already selected, do nothing
      return;
    }
    setSelectedResource(resource);
    setSelectedSnapshotId('');
    setSelectedItem(null);
    setSelectedItems(new Set());
    // Resource switch: new resource means a completely different data set,
    // so drop the per-tab navigation state (tab/folder/view) instead of
    // merging — keeping them would try to restore a folder that may not
    // exist in the new resource's snapshot.
    setSearchParams({ resourceId: resource.id });
  };

  const toggleSelectItem = (itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  // OneDrive: recursive folder-select. Fetches every file id whose
  // folder_path starts with this folder's path, then toggles them all in
  // selectedItems. If ANY ids under the folder are already selected we
  // interpret the click as "unselect the folder" and remove them;
  // otherwise we add them. Busy-state prevents overlapping fetches.
  const handleOneDriveFolderCheck = useCallback(async (folderPath: string) => {
    if (!selectedSnapshotId) return;
    if (oneDriveFolderBusy.has(folderPath)) return;
    const alreadySelected = oneDriveFolderSelected.has(folderPath);
    // Flip the visible checkbox state immediately so the user gets
    // feedback; the actual id fetch populates selectedItems below.
    setOneDriveFolderSelected(prev => {
      const next = new Set(prev);
      if (alreadySelected) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
    // Immediately flip every currently-visible file under this folder
    // (recursive prefix match) so the rows tick instantly — same
    // rationale as the generic handler. The async fetch below
    // augments with hidden-page ids.
    const prefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
    const visibleIds = recoveryItems
      .filter(it => {
        const fp = it.folderPath || '';
        return fp === folderPath || fp.startsWith(prefix);
      })
      .map(it => it.id);
    if (visibleIds.length > 0) {
      setSelectedItems(prev => {
        const next = new Set(prev);
        if (alreadySelected) {
          for (const id of visibleIds) next.delete(id);
        } else {
          for (const id of visibleIds) next.add(id);
        }
        return next;
      });
    }
    setOneDriveFolderBusy(prev => new Set(prev).add(folderPath));
    try {
      const ids = await SnapshotService.getOneDriveIdsByPrefix(selectedSnapshotId, folderPath);
      if (ids.length === 0) {
        // Backend returned zero files under this folder — roll back the
        // checkbox state and surface a hint so the user doesn't sit in
        // front of "Download" thinking they've selected something.
        setOneDriveFolderSelected(prev => {
          const next = new Set(prev);
          next.delete(folderPath);
          return next;
        });
        setDownloadError(`No files found under ${folderPath}.`);
        return;
      }
      setSelectedItems(prev => {
        const next = new Set(prev);
        if (alreadySelected) {
          for (const id of ids) next.delete(id);
        } else {
          for (const id of ids) next.add(id);
        }
        return next;
      });
    } catch (e) {
      console.error('Folder-select fetch failed:', e);
      setOneDriveFolderSelected(prev => {
        const next = new Set(prev);
        next.delete(folderPath);
        return next;
      });
      setDownloadError('Failed to fetch folder contents.');
    } finally {
      setOneDriveFolderBusy(prev => {
        const next = new Set(prev);
        next.delete(folderPath);
        return next;
      });
    }
  }, [selectedSnapshotId, oneDriveFolderBusy, oneDriveFolderSelected, recoveryItems]);

  // Generic folder check — used by Mail / Contacts / Calendar folder
  // rows. Toggles "every item in this folder" into/out of selectedItems
  // via SnapshotService.searchItems with folder_path=<folder> and a
  // page size large enough that a single call covers typical folders.
  // Chats + OneDrive have their own handlers (different semantics).
  const handleGenericFolderCheck = useCallback(async (folderPath: string) => {
    if (!selectedSnapshotId || !selectedResource) return;
    if (genericFolderBusy.has(folderPath)) return;
    const alreadySelected = genericFolderSelected.has(folderPath);
    setGenericFolderSelected(prev => {
      const next = new Set(prev);
      if (alreadySelected) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
    // Immediately flip every currently-visible row that matches this
    // folder. Without this, the email checkboxes only update after
    // the async searchItems walk below resolves — and that walk can
    // return zero rows (backend folderPath indexing nuances), so the
    // user would tick the folder and see no rows respond. Flipping
    // visible ids up-front gives instant feedback; the walk then
    // augments selectedItems with hidden-page ids.
    const visibleIds = recoveryItems
      .filter(it => (it.folderPath || '') === folderPath)
      .map(it => it.id);
    if (visibleIds.length > 0) {
      setSelectedItems(prev => {
        const next = new Set(prev);
        if (alreadySelected) {
          for (const id of visibleIds) next.delete(id);
        } else {
          for (const id of visibleIds) next.add(id);
        }
        return next;
      });
    }
    setGenericFolderBusy(prev => new Set(prev).add(folderPath));
    try {
      // Walk pages until we've collected every id under this folder.
      const allIds: string[] = [];
      let page = 1;
      while (true) {
        const resp = await SnapshotService.searchItems(selectedResource.id, {
          folderPath,
          snapshotId: selectedSnapshotId,
          page,
          size: 2000,
        });
        const content = (resp as any).content || (resp as any).items || [];
        if (!content.length) break;
        for (const it of content) allIds.push(it.id);
        if (content.length < 2000) break;
        page += 1;
      }
      // If the search endpoint returned 0 (pagination mismatch, case
      // sensitivity, etc.), keep the folder ticked anyway. folderPaths
      // is forwarded to the backend resolver which indexes on
      // folder_path directly and may find rows the search endpoint
      // didn't expose. Silent-deselect here used to leave the user
      // staring at an unticked box they had just ticked.
      if (allIds.length === 0) {
        return;
      }
      setSelectedItems(prev => {
        const next = new Set(prev);
        if (alreadySelected) {
          for (const id of allIds) next.delete(id);
        } else {
          for (const id of allIds) next.add(id);
        }
        return next;
      });
    } catch (e) {
      console.error('Folder-select fetch failed:', e);
      setGenericFolderSelected(prev => {
        const next = new Set(prev);
        next.delete(folderPath);
        return next;
      });
    } finally {
      setGenericFolderBusy(prev => {
        const next = new Set(prev);
        next.delete(folderPath);
        return next;
      });
    }
  }, [selectedSnapshotId, selectedResource, genericFolderBusy, genericFolderSelected, recoveryItems]);

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  // Imperative handle to the Azure VM view so the toolbar Download
  // button can dispatch to its per-tab download logic (config JSON
  // on the Virtual machine tab, file/ZIP on Volumes, etc).
  const vmViewRef = useRef<AzureVmViewHandle | null>(null);
  // Selection info reported by the VM view — the Volumes tab tracks
  // file-browser checkbox counts here since those aren't
  // SnapshotItems and can't live in `selectedItems`.
  const [vmSelectionInfo, setVmSelectionInfo] = useState<{ tab: string; count: number } | null>(null);
  // True while a non-modal download (VM content) is in flight so we
  // can gray out the toolbar Download button. Downloads that go
  // through DownloadModal don't need this — the modal itself owns
  // the click-once-per-download contract.
  const [inlineDownloadRunning, setInlineDownloadRunning] = useState(false);
  const [inlineDownloadError, setInlineDownloadError] = useState<string | null>(null);

  const handleItemSelect = async (item: RecoveryItem) => {
    setSelectedItem(item);
    const raw = item.metadata?.raw;
    if (!raw || Object.keys(raw).length === 0) {
      try {
        const result = await SnapshotService.getItemContent(selectedSnapshotId, item.id);
        if (result.content && Object.keys(result.content).length > 0) {
          setSelectedItem({ ...item, metadata: { ...item.metadata, raw: result.content } });
        }
      } catch {
        // ignore — preview will show what it has
      }
    }
  };

  const handleRecover = () => {
    if (!selectedSnapshotId) return;
    // Azure DB resources open a dedicated modal — restoring rebuilds
    // the whole database, so content-type selection (Config/Database/
    // Schema) doesn't matter and we don't require items to be ticked.
    const kind = selectedResource?.kind;
    if (kind === 'azure_sql' || kind === 'azure_postgresql' || kind === 'azure_postgresql_single') {
      setAzureDbRecoverOpen(true);
      return;
    }
    // On the Calendar tab the sidebar filter (Event Type / Calendar)
    // is a "soft" selection — nothing lands in selectedItems unless the
    // user individually ticks an event inside the hover tooltip.
    // Mirror handleDownload: when no items are explicitly ticked but the
    // filter has narrowed to a non-empty set, treat that filter set as
    // the recover scope so the button works consistently with what the
    // UI is showing.
    if (activeContentType === 'calendar' && selectedItems.size === 0 && filteredCalendarIds.length > 0) {
      setSelectedItems(new Set(filteredCalendarIds));
      setRestoreModalOpen(true);
      return;
    }
    // Folder checkbox selection (mail / contacts / etc.) — the async
    // pagination walk hydrates selectedItems, but we open the modal
    // immediately because folderPaths is forwarded to the backend
    // resolver regardless. Works even if the walk finds zero rows.
    if (selectedItems.size === 0 && genericFolderSelected.size > 0) {
      setRestoreModalOpen(true);
      return;
    }
    if (selectedItems.size === 0) return;
    setRestoreModalOpen(true);
  };
  const [azureDbRecoverOpen, setAzureDbRecoverOpen] = useState(false);

  // Calendar sidebar's currently-filtered event IDs. Empty filter =
  // every event; otherwise only the event types the user ticked.
  // Scopes Download on the calendar tab so the ZIP only contains the
  // events matching the sidebar checkboxes.
  const [filteredCalendarIds, setFilteredCalendarIds] = useState<string[]>([]);
  // Per-calendar folder paths the user ticked in the "Calendar" filter
  // section of the calendar sidebar (e.g. "Calendar/Default",
  // "Calendar/United States holidays"). Forwarded to DownloadModal as
  // ``folderPaths`` so PST export becomes available and the backend
  // produces one PST per selected source-calendar.
  const [selectedCalendarPaths, setSelectedCalendarPaths] = useState<string[]>([]);

  const handleDownload = () => {
    if (!selectedSnapshotId) return;
    setDownloadError(null);

    // Azure DB gets its own download path — the generic DownloadModal
    // can't emit per-tab formats (config → JSON, table → CSV, schema →
    // original extension, multi-select → ZIP with folder structure).
    // We route to /azure-db/export which streams exactly that.
    const kind = selectedResource?.kind;
    const isAzureDb = kind === 'azure_sql' || kind === 'azure_postgresql' || kind === 'azure_postgresql_single';
    if (isAzureDb) {
      const rawTab = searchParams.get('tab') || 'configuration';
      const activeDbTab: 'configuration' | 'database' | 'schema' =
        rawTab === 'database' || rawTab === 'schema' ? (rawTab as any) : 'configuration';

      // Nothing selected → ask the backend for "every item of this
      // tab's item_type". Something selected → send the explicit IDs.
      // The main page's `recoveryItems` doesn't carry Azure DB items
      // (those live inside AzureDbView's local state), so the item_id
      // list here would always be empty on unticked clicks — the type
      // fallback keeps the implicit download working.
      const bucket = activeDbTab === 'configuration'
        ? 'AZURE_DB_CONFIG'
        : activeDbTab === 'schema'
          ? 'AZURE_DB_SCHEMA_FILE'
          : 'AZURE_DB_TABLE';
      const url = selectedItems.size > 0
        ? API.SNAPSHOTS.AZURE_DB_EXPORT(selectedSnapshotId, Array.from(selectedItems))
        : API.SNAPSHOTS.AZURE_DB_EXPORT_BY_TYPE(selectedSnapshotId, bucket);
      // Anchor click → browser handles the stream + filename header.
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    // If we're on the calendar tab and the user hasn't ticked any
    // individual events, inherit the sidebar's filtered set as the
    // download scope so "Meeting" + "Online Meeting" (or any combo)
    // narrows what lands in the export.
    if (activeContentType === 'calendar' && selectedItems.size === 0 && filteredCalendarIds.length > 0) {
      setSelectedItems(new Set(filteredCalendarIds));
    }
    // Reset any previous inline error so the user gets a clean slate
    // for each new click.
    setInlineDownloadError(null);
    // Azure VM downloads don't go through the standard export modal
    // — the VM view has a per-tab handler that either serialises the
    // live ARM JSON or zips up Volume files via Run Command. The
    // toolbar button stays disabled via `inlineDownloadRunning`
    // while the promise is in-flight so the user can't double-click
    // and kick off the same read twice.
    if (selectedResource?.kind === 'azure_vm' && vmViewRef.current) {
      if (inlineDownloadRunning) return;
      setInlineDownloadRunning(true);
      setInlineDownloadError(null);
      vmViewRef.current.download()
        .catch(e => {
          console.error('VM download failed:', e);
          setInlineDownloadError(String(e?.message || e).slice(0, 200));
        })
        .finally(() => {
          setInlineDownloadRunning(false);
        });
      return;
    }
    setDownloadModalOpen(true);
  };

  // Filter resources by search
  const filteredResources = resources.filter(r => {
    const matchSearch = !resourceSearch ||
        r.name.toLowerCase().includes(resourceSearch.toLowerCase()) ||
      (r.email && r.email.toLowerCase().includes(resourceSearch.toLowerCase()));
    const matchKind = !kindFilter || r.kind === kindFilter;
    return matchSearch && matchKind;
  });

  // Loading state
  if (resourcesLoading) {
    return (
      <div className="recovery-page">
        <div className="loading-container">
          <div className="spinner" />
          <p>Loading recovery data...</p>
        </div>
      </div>
    );
  }

  const selectedRecoveryItems = recoveryItems.filter((item) => selectedItems.has(item.id));
  const restoreItemName = selectedRecoveryItems.length === 1
    ? selectedRecoveryItems[0].name
    : selectedRecoveryItems.length > 1
      ? `${selectedRecoveryItems.length} items`
      : undefined;
  const restoreItemType = selectedRecoveryItems.length > 0 && selectedRecoveryItems.every((item) => item.itemType === selectedRecoveryItems[0].itemType)
    ? selectedRecoveryItems[0].itemType
    : undefined;

  // No resources with backups
  if (resources.length === 0) {
    return (
      <div className="recovery-page">
        <div className="loading-container">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 48, height: 48, color: '#94a3b8' }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <line x1="2" y1="2" x2="22" y2="22" stroke="#94a3b8" strokeWidth="2" />
          </svg>
          <p style={{ marginTop: 16, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>No backups available</p>
          <p style={{ color: '#64748b', marginBottom: 24, textAlign: 'center' }}>
            No resources in this tenant have been backed up yet.<br />
            Please run a backup first from the Protection page.
          </p>
          <button className="action-button recover" onClick={() => navigate(-1)}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="recovery-page">
      {/* Two-panel layout: Resource list + Recovery content */}
      <div className="recovery-layout">
        {/* Left Panel: Resource List */}
        <div className="resource-list-panel">
          <div className="resource-list-header">
            <h3>Backed up resources</h3>
            <div className="resource-search-row">
            <input
              type="text"
              placeholder="Search resources..."
              className="resource-search-input"
              value={resourceSearch}
              onChange={(e) => setResourceSearch(e.target.value)}
            />
              <div className="kind-filter-wrap">
                <button
                  className={`kind-filter-btn${kindFilter ? ' active' : ''}`}
                  onClick={() => setShowKindFilter(v => !v)}
                  title="Filter by type"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:14,height:14}}>
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                  </svg>
                  {kindFilter ? getKindLabel(kindFilter) : 'Filter'}
                </button>
                {showKindFilter && (
                  <div className="kind-filter-dropdown">
                    <button className={`kind-filter-option${!kindFilter ? ' selected' : ''}`} onClick={() => { setKindFilter(''); setShowKindFilter(false); }}>All types</button>
                    {Array.from(new Set(resources.map(r => r.kind))).sort().map(k => (
                      <button key={k} className={`kind-filter-option${kindFilter === k ? ' selected' : ''}`} onClick={() => { setKindFilter(k); setShowKindFilter(false); }}>
                        {getKindLabel(k)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="resource-list">
            {(() => {
              // Group by identity (email preferred, fallback to name). Kind filter
              // has already been applied upstream, so identities with no matching
              // surface simply won't appear here.
              const byIdentity = new Map<string, typeof filteredResources>();
              const identityKey = (r: typeof filteredResources[number]) =>
                (r.email || r.name || r.id).toLowerCase().trim();
              for (const r of filteredResources) {
                const k = identityKey(r);
                const list = byIdentity.get(k) || [];
                list.push(r);
                byIdentity.set(k, list);
              }
              // Stable order: by primary (first) resource's display name.
              const identityGroups = Array.from(byIdentity.entries()).sort(
                (a, b) => (a[1][0].name || '').localeCompare(b[1][0].name || ''),
              );

              const toggle = (k: string) => setExpandedIdentities(prev => {
                const next = new Set(prev);
                next.has(k) ? next.delete(k) : next.add(k);
                return next;
              });

              // AFI-style identity flattening. A single user identity
              // (Amit Mishra) is materialised in the DB as one ENTRA_USER
              // parent + N Tier-2 children (USER_MAIL, USER_ONEDRIVE,
              // USER_CHATS, USER_CONTACTS, USER_CALENDAR) plus any legacy
              // Tier-1 surfaces. Previously the left panel exposed all
              // of that as a "3 surfaces · 7 snapshots" dropdown — which
              // is engineering-internal detail, not what a backup admin
              // thinks about. AFI shows ONE row per user; clicking it
              // drives the right panel via the parent resource, and the
              // /content-snapshots endpoint already resolves through
              // Tier-2 children so each content tab (Mail / OneDrive /
              // Chats / Contacts / Calendar) loads the right surface's
              // data automatically.
              //
              // Identity surfaces (treated as one logical user). When
              // an identity has only these, we collapse to a flat row
              // and auto-select the best parent on click. Non-user
              // groups (M365 Group with Site + Teams + Mail surfaces)
              // stay multi-row because each surface really is its own
              // thing.
              const USER_SURFACE_KINDS = new Set([
                'entra_user', 'user',
                'onedrive', 'mailbox', 'shared_mailbox', 'room_mailbox',
                'user_mail', 'user_onedrive', 'user_chats',
                'user_contacts', 'user_calendar',
              ]);
              const PRIMARY_PREFERENCE = [
                'entra_user', 'user', 'mailbox',
                'shared_mailbox', 'room_mailbox', 'onedrive',
              ];
              const pickPrimary = (g: typeof filteredResources) => {
                for (const k of PRIMARY_PREFERENCE) {
                  const hit = g.find(r => r.kind === k);
                  if (hit) return hit;
                }
                return g[0];
              };
              const lastBackupOf = (g: typeof filteredResources): string | undefined => {
                let max: string | undefined;
                for (const r of g) {
                  if (!r.last_backup_at) continue;
                  if (!max || r.last_backup_at > max) max = r.last_backup_at;
                }
                return max;
              };

              return identityGroups.map(([key, group]) => {
                const isUserIdentity = group.every(r => USER_SURFACE_KINDS.has(r.kind));
                const primary = isUserIdentity ? pickPrimary(group) : group[0];
                const selectedInGroup = group.some(r => selectedResource?.id === r.id);
                const isSelected = selectedInGroup;
                const lastBackup = lastBackupOf(group);

                // User identity (single click → primary surface drives
                // right panel; content tabs auto-resolve via the
                // parent's children). The number of versions / total
                // size all show in the right-panel header, NOT here —
                // mixing a per-surface count into a row that represents
                // the whole user was the source of the confusion.
                if (isUserIdentity) {
                  return (
                    <button
                      key={key}
                      className={`resource-list-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleResourceSelect(primary)}
                    >
                      <div className="resource-avatar-sm">{getInitials(primary.name)}</div>
                      <div className="resource-list-info">
                        <div className="resource-list-name">{primary.name}</div>
                        {primary.email && <div className="resource-list-email">{primary.email}</div>}
                        <div className="resource-list-meta">
                          <span className="resource-kind-pill">{getKindLabel(primary.kind)}</span>
                          {lastBackup && (
                            <span>Last backup: {fmtLocalDate(lastBackup, { month: 'short', day: 'numeric' })}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                }

                // Non-user single-surface identity: plain row.
                if (group.length === 1) {
                  return (
                    <button
                      key={key}
                      className={`resource-list-item ${selectedResource?.id === primary.id ? 'selected' : ''}`}
                      onClick={() => handleResourceSelect(primary)}
                    >
                      <div className="resource-avatar-sm">{getInitials(primary.name)}</div>
                      <div className="resource-list-info">
                        <div className="resource-list-name">{primary.name}</div>
                        {primary.email && <div className="resource-list-email">{primary.email}</div>}
                        <div className="resource-list-meta">
                          <span className="resource-kind-pill">{getKindLabel(primary.kind)}</span>
                          {lastBackup && (
                            <span>Last backup: {fmtLocalDate(lastBackup, { month: 'short', day: 'numeric' })}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                }

                // Non-user multi-surface identity (M365 Group with Site
                // + Channels + Mail, etc.). These really ARE multiple
                // distinct things, so keep the expandable layout — but
                // drop the per-surface snapshot count from the meta
                // line, which was the same source of confusion. Show
                // "X surfaces · Last backup" instead.
                const isExpanded = expandedIdentities.has(key) || selectedInGroup;
                return (
                  <div key={key} className={`identity-group${selectedInGroup ? ' has-selection' : ''}`}>
                    <button
                      className={`resource-list-item identity-header${isExpanded ? ' expanded' : ''}`}
                      onClick={() => toggle(key)}
                      aria-expanded={isExpanded}
                    >
                      <div className="resource-avatar-sm">{getInitials(primary.name)}</div>
                      <div className="resource-list-info">
                        <div className="resource-list-name">{primary.name}</div>
                        {primary.email && <div className="resource-list-email">{primary.email}</div>}
                        <div className="resource-list-meta">
                          <span>{group.length} surfaces</span>
                          {lastBackup && (
                            <>
                              <span>·</span>
                              <span>Last backup: {fmtLocalDate(lastBackup, { month: 'short', day: 'numeric' })}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                           style={{ width: 14, height: 14, flexShrink: 0,
                                    transform: isExpanded ? 'rotate(180deg)' : 'none',
                                    transition: 'transform 120ms ease' }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {isExpanded && (
                      <div className="identity-surfaces">
                        {group.map(surface => (
                          <button
                            key={surface.id}
                            className={`resource-list-item surface-item${selectedResource?.id === surface.id ? ' selected' : ''}`}
                            onClick={() => handleResourceSelect(surface)}
                          >
                            <div className="surface-indent" aria-hidden />
                            <div className="resource-list-info">
                              <div className="resource-list-meta">
                                <span className="resource-kind-pill">{getKindLabel(surface.kind)}</span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
            {filteredResources.length === 0 && (
              <div className="empty-resource-list">
                <p>No matching resources</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Recovery Content */}
        <div className="recovery-content-panel">
          {!selectedResource ? (
            <div className="empty-selection">
              <p>Select a resource to browse backups</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="recovery-header">
                <div className="header-left">
                  <div className="resource-avatar">{getInitials(selectedResource.name)}</div>
                  <div className="resource-info">
                    <div className="resource-name">{selectedResource.name}</div>
                    {selectedResource.email && <div className="resource-email">{selectedResource.email}</div>}
                  </div>
                  {selectedResource.last_backup_at && (
                    <div className="last-backup-info">
                      <span className="label">Last backup:</span>
                      <span className="value">
                        {fmtLocalDate(selectedResource.last_backup_at, { month: 'short', day: 'numeric', year: 'numeric' })}, {fmtLocalTime(selectedResource.last_backup_at, { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </span>
                    </div>
                  )}
                </div>

                <div className="header-stats">
                  {/* afi-style size panel: total + 1w/1m/1y deltas + 7-day sparkline
                      centered on today. All derived client-side from the `snapshots`
                      array already loaded for this resource. */}
                  {/* Backend computes the rollup (sum of bytes_added
                      across the resource subtree's non-failed snapshots
                      = true on-disk footprint). FE just renders. */}
                  <BackupSizeSummary
                    resourceId={selectedResource.id}
                  />

                  {/* AFI-style "versions" = distinct backup attempts
                      (job_ids) across this identity's parent + Tier-2
                      child subtree. One "Backup now" click for a user
                      is ONE version, even though the worker fans it out
                      into per-surface snapshot rows internally. Falls
                      back to snapshotCount for older API responses that
                      pre-date versionCount (defensive — backend always
                      returns it now). */}
                  <div className="snapshot-count">
                    <div className="snapshot-count-num">
                      {contentSnapshots?.versionCount
                        ?? contentSnapshots?.snapshotCount
                        ?? (snapshotsLoading ? '…' : 0)}
                    </div>
                    <div className="snapshot-count-label">
                      version{(contentSnapshots?.versionCount ?? contentSnapshots?.snapshotCount ?? 0) === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Global Recovery toolbar — sits between the content
                  header (above) and the content-type tabs (below) so
                  every resource + content-type gets the same Version /
                  Download / Recover affordances. Search is shown only
                  for content types that actually search a list (mail,
                  onedrive, contacts, calendar, chats, site, team
                  channels, the 8 Entra Directory tabs, and Azure DB
                  configuration files). Other kinds — Power BI, Azure
                  VM, plain users/groups listings — don't have a list
                  to filter, so we hide the search instead of showing
                  a no-op input. */}
              {(() => {
                const kind = selectedResource.kind;
                // M365 user content types — tied to activeContentType.
                // Gate by resource kind too, because activeContentType
                // can linger as 'mail' / 'onedrive' etc. after the user
                // switches to a non-M365 resource. Without this, the
                // search would wrongly stay on for Azure DB's Database
                // and Schema tabs.
                const M365_SEARCH_TABS = new Set([
                  'mail', 'onedrive', 'contacts', 'calendar', 'chats',
                ]);
                const isM365UserKind = [
                  'user', 'entra_user', 'mailbox', 'shared_mailbox', 'room_mailbox',
                ].includes(kind);
                const showForM365 = isM365UserKind
                  && M365_SEARCH_TABS.has(activeContentType as string);
                // Resource kinds whose entire UI supports search across
                // every inner tab (Site / Mail / Team Channels / the
                // 8 Entra Directory tabs).
                const KINDS_WITH_SEARCH = new Set([
                  'sharepoint_site',
                  'm365_group', 'entra_group', 'teams_channel',
                  'entra_directory',
                ]);
                const showForKind = KINDS_WITH_SEARCH.has(kind);
                // Azure SQL + Postgres — only the Configuration tab
                // surfaces a searchable list (configuration files in
                // the left panel). Database and Schema don't, so hide
                // the search input there. AzureDbView syncs its tab to
                // ?tab=configuration|database|schema in the URL.
                const isAzureDb = kind === 'azure_sql' || kind === 'azure_postgresql' || kind === 'azure_postgresql_single';
                const rawTab = searchParams.get('tab') || '';
                const azureDbTab = (rawTab === 'database' || rawTab === 'schema') ? rawTab : 'configuration';
                const showForAzureDb = isAzureDb && azureDbTab === 'configuration';
                // Azure VM view manages its own per-tab layouts; the
                // global search doesn't apply anywhere inside it.
                const isAzureVm = kind === 'azure_vm';
                const showSearch = !isAzureVm && (showForM365 || showForKind || showForAzureDb);
                // Azure DB Configuration has a single implicit target
                // (the config JSON) — let Download work without the
                // user ticking anything. Same rationale for the VM
                // Virtual machine tab (single config blob).
                const vmTab = isAzureVm ? (rawTab || 'virtual_machine') : '';
                // VM Virtual-machine / Disks / NICs / Public-IPs all
                // have an implicit download target (the active row's
                // ARM JSON) so the user doesn't need to tick anything
                // in the left rail. Volumes needs an explicit file /
                // folder pick IN THE RIGHT PANE — the AzureVmView
                // reports that count here via onSelectionInfoChange.
                const vmVolumesHasPick = isAzureVm && vmTab === 'volumes'
                  && (vmSelectionInfo?.count ?? 0) > 0;
                // Calendar tab: the sidebar's Event Type / Calendar
                // filters define a "soft" selection stored in
                // filteredCalendarIds. Keep the buttons enabled when a
                // filter has narrowed the view even if the user hasn't
                // ticked individual events — handleDownload /
                // handleRecover both seed selectedItems from the filter
                // set on click, so the action still targets exactly
                // what the grid is showing.
                const calendarFilterScoped =
                  activeContentType === 'calendar' && filteredCalendarIds.length > 0;
                // Chat thread scope: when the user ticks a thread in
                // the left rail but hasn't clicked into any individual
                // messages, `threadPath` is set and `selectedItems` is
                // empty. The toolbar was leaving Download greyed out
                // in that state; handleDownload then forwards
                // threadPath to the chat-export modal, so a click
                // WOULD work if we let it through. Treat a ticked
                // thread as implicit selection so Download lights up.
                const chatThreadScoped =
                  activeContentType === 'chats' && !!threadPath;
                // Generic-folder scope: mail / contacts / site tabs let
                // the user tick an entire folder (e.g. `/Inbox`, or
                // `Contacts`) in the left rail. That selection lives in
                // `genericFolderSelected` — selectedItems only fills
                // after the async pagination walk, which leaves the
                // toolbar greyed out until the walk finishes and the
                // user gets a button that never lights up when the
                // backend returns zero rows. Treat any ticked folder as
                // implicit selection and pass folderPaths to the modal,
                // which forwards them to the backend folder_resolver.
                const genericFolderScoped =
                  activeContentType !== 'chats' && genericFolderSelected.size > 0;
                const allowEmptyDownload =
                  (isAzureDb && azureDbTab === 'configuration') ||
                  (isAzureVm && vmTab !== 'volumes') ||
                  vmVolumesHasPick ||
                  calendarFilterScoped ||
                  chatThreadScoped ||
                  genericFolderScoped;
                // Azure DB + VM Recover always rebuild the full resource,
                // so no checkbox selection is needed regardless of tab.
                // Chat Recover stays blocked by toolbarIsChat below —
                // Graph has no app-only chat-post API, so enabling
                // thread scope there would just open a dead modal.
                const allowEmptyRecover =
                  isAzureDb || isAzureVm || calendarFilterScoped || genericFolderScoped;
                // Chat restore is a Microsoft platform limit — no
                // app-only API to post chat/channel messages as another
                // user. Grey out Recover so users don't submit a no-op
                // job. Affects: user Chats tab AND the Channels tab
                // inside Group / Teams Channel resources (where we
                // remap effectiveContentType='chats' for modal routing).
                const isGroupLikeForTb = !!selectedResource && [
                  'm365_group', 'entra_group', 'teams_channel',
                ].includes(selectedResource.kind);
                const toolbarIsChat =
                  activeContentType === 'chats'
                  || (isGroupLikeForTb && groupTeamsTab === 'channels');
                return (
                  <RecoveryToolbar
                    snapshots={snapshots}
                    selectedSnapshotId={selectedSnapshotId}
                    onSelectSnapshot={setSelectedSnapshotId}
                    onDownload={handleDownload}
                    onRecover={handleRecover}
                    selectedCount={selectedItems.size}
                    downloadError={inlineDownloadError || downloadError}
                    downloadDisabled={inlineDownloadRunning}
                    recoverDisabled={toolbarIsChat}
                    allowEmptyDownload={allowEmptyDownload}
                    allowEmptyRecover={allowEmptyRecover}
                    searchValue={showSearch ? searchQuery : undefined}
                    onSearchChange={showSearch ? setSearchQuery : undefined}
                    onSearchSubmit={showSearch ? () => { /* debounced via searchQuery */ } : undefined}
                    searchPlaceholder="Search"
                  />
                );
              })()}

              {selectedResource.kind === 'sharepoint_site' ? (
                /* SharePoint sites: a single "Site" content-type tab at the
                   top (parity with the Mail/OneDrive/... tab bar on other
                   kinds) plus a two-option left rail (Site content / Subsites)
                   in a full-width middle panel. Reuses OneDrive's
                   od-layout-mode so the middle panel absorbs the right-
                   preview space. */
                <>
                  <div className="content-type-tabs">
                    <button className="content-tab active" type="button">Site</button>
                  </div>
                  <div className="three-panel-layout od-layout-mode">
                    <SharePointView
                      resourceId={selectedResource.id}
                      snapshots={snapshots}
                      selectedItems={selectedItems}
                      onToggleItem={toggleSelectItem}
                      onSelectAll={(ids, checked) => {
                        if (checked) setSelectedItems(new Set(ids));
                        else setSelectedItems(new Set());
                      }}
                    />
                  </div>
                </>
              ) : selectedResource.kind === 'power_bi' ? (
                /* Power BI workspaces don't fit the five fixed tabs — swap
                   the whole content area for a single Files panel pulled
                   from the generic /snapshots/{id}/files endpoint. */
                <PowerBiFilesView
                  resourceId={selectedResource.id}
                  snapshots={snapshots}
                  selectedItems={selectedItems}
                  onToggleItem={toggleSelectItem}
                  onSelectAll={(ids, checked) => {
                    if (checked) setSelectedItems(new Set(ids));
                    else setSelectedItems(new Set());
                  }}
                />
              ) : selectedResource.kind === 'entra_directory' ? (
                /* Azure Active Directory singleton: 8-tab header (Users
                   / Groups / Roles / Security / Audit / Applications /
                   Intune / Administrative Units). Items filtered from
                   the latest snapshot by item_type. */
                <EntraDirectoryView
                  resourceId={selectedResource.id}
                  tenantId={tenantId || ''}
                  snapshots={snapshots}
                  selectedItems={selectedItems}
                  onToggleItem={toggleSelectItem}
                  onSelectAll={(ids, checked) => {
                    if (checked) setSelectedItems(new Set(ids));
                    else setSelectedItems(new Set());
                  }}
                />
              ) : selectedResource.kind === 'azure_vm' ? (
                /* Azure VM: Virtual machine / Volumes / Disks / Network
                   interfaces / Public IP addresses. Items filtered from
                   the latest snapshot by AZURE_VM_* item_type. */
                <AzureVmView
                  ref={vmViewRef}
                  resourceId={selectedResource.id}
                  snapshots={snapshots}
                  selectedItems={selectedItems}
                  onToggleItem={toggleSelectItem}
                  onSelectAll={(ids, checked) => {
                    if (checked) setSelectedItems(new Set(ids));
                    else setSelectedItems(new Set());
                  }}
                  overrideSnapshotId={selectedSnapshotId}
                  onSelectionInfoChange={setVmSelectionInfo}
                />
              ) : (selectedResource.kind === 'azure_sql' || selectedResource.kind === 'azure_postgresql' || selectedResource.kind === 'azure_postgresql_single') ? (
                /* Azure SQL + PostgreSQL: Configuration / Data / Schema
                   tabs filtered by item_type suffix. Same shape handles
                   AZURE_SQL_DB + AZURE_POSTGRESQL + AZURE_POSTGRESQL_SINGLE. */
                <AzureDbView
                  resourceId={selectedResource.id}
                  snapshots={snapshots}
                  selectedItems={selectedItems}
                  onToggleItem={toggleSelectItem}
                  onSelectAll={(ids, checked) => {
                    if (checked) setSelectedItems(new Set(ids));
                    else setSelectedItems(new Set());
                  }}
                  overrideSnapshotId={selectedSnapshotId}
                />
              ) : (selectedResource.kind === 'm365_group' || selectedResource.kind === 'teams_channel' || selectedResource.kind === 'entra_group') ? (
                /* Microsoft 365 Groups + Teams + Entra groups: three content
                   surfaces — Site (SharePoint-backing site items), Mail
                   (group mailbox threads/posts), Team Channels (channel
                   messages). Items filtered client-side from the latest
                   snapshot by item_type prefix. */
                <GroupTeamsView
                  resourceId={selectedResource.id}
                  snapshots={snapshots}
                  selectedItems={selectedItems}
                  onToggleItem={toggleSelectItem}
                  onSelectAll={(ids, checked) => {
                    if (checked) setSelectedItems(new Set(ids));
                    else setSelectedItems(new Set());
                  }}
                  activeTab={groupTeamsTab}
                  onTabChange={setGroupTeamsTab}
                />
              ) : (
                <>
              {/* Content Type Tabs — fixed five (Mail / OneDrive / Contacts / Calendar / Chats).
                  Each tab shows its backed-up item count from the content-
                  snapshots resolver; tabs with no snapshot yet stay clickable
                  but render an empty state on click. */}
              <div className="content-type-tabs">
                {contentTypes
                  .filter(type => {
                    // Shared + room mailboxes are Exchange-only — no OneDrive
                    // provisioning in M365, so hide the tab.
                    const kind = selectedResource.kind;
                    if (type === 'onedrive' && (kind === 'shared_mailbox' || kind === 'room_mailbox')) return false;
                    return true;
                  })
                  .map(type => {
                  const entry = contentSnapshots?.byContent[type] || null;
                  const count = entry?.itemCount ?? 0;
                  const hasBackup = !!entry;
                  return (
                    <button
                      key={type}
                      className={`content-tab ${activeContentType === type ? 'active' : ''}${hasBackup ? '' : ' content-tab-empty'}`}
                      onClick={() => {
                        // Tab switch — drop folder/view from URL so the
                        // new tab starts clean. patchSearchParams pushes
                        // a new history entry; the sync effect above
                        // then updates local state.
                        patchSearchParams({ tab: type, folder: null, view: null });
                      }}
                      title={hasBackup ? `${count.toLocaleString()} item${count === 1 ? '' : 's'} backed up` : 'No backup yet'}
                    >
                      {CONTENT_TAB_LABELS[type]}
                      {hasBackup && <span className="content-tab-count">{count.toLocaleString()}</span>}
                    </button>
                  );
                })}
              </div>

              {/* Search / Download / Recover all live in the global
                  <RecoveryToolbar /> above — the old inline toolbar here
                  is gone so the affordances are shown exactly once per
                  resource view. */}

              {/* Three Panel Layout */}
              <div className={`three-panel-layout${activeContentType === 'calendar' ? ' cal-layout-mode' : ''}${activeContentType === 'onedrive' ? ' od-layout-mode' : ''}${activeContentType === 'mail' ? ' mail-layout-mode' : ''}`}>
                {activeContentType === 'calendar' ? (
                  /* Calendar Month View — replaces folder tree + item list */
                  <div className="panel-calendar">
                    {itemsLoading ? (
                      <div className="loading-container"><div className="spinner" /><p>Loading events...</p></div>
                    ) : (
                      <CalendarMonthView
                        snapshotId={selectedSnapshotId}
                        selectedItems={selectedItems}
                        onItemCheck={toggleSelectItem}
                        onFilteredIdsChange={setFilteredCalendarIds}
                        onCalendarFilterChange={setSelectedCalendarPaths}
                      />
                    )}
                  </div>
                ) : activeContentType === 'onedrive' ? (
                  /* OneDrive Drive-style view — left rail (My Drive tree /
                      Recent) + full-width file table. No right preview panel. */
                  <>
                    <div className="panel-left od-panel-left">
                      <OneDriveLeftPanel
                        view={oneDriveView}
                        setView={(v) => {
                          // View toggle pushes a new history entry so
                          // back/forward walks through My Drive ↔ Recent.
                          // Recent drops the folder filter entirely;
                          // My Drive resets to root.
                          patchSearchParams(
                            v === 'recent'
                              ? { view: 'recent', folder: null }
                              : { view: 'my-drive', folder: '/' }
                          );
                        }}
                      />
                    </div>
                    <div className="panel-middle od-panel-middle">
                      <div className="od-main-header">
                        <span className="od-breadcrumb">
                          {oneDriveView === 'recent'
                            ? 'Recent'
                            : (selectedFolder === 'all' || selectedFolder === '/' ? 'My Drive' : selectedFolder)}
                        </span>
                        <span className="od-count">{itemCount ? `${itemCount.toLocaleString()} items` : ''}</span>
                      </div>
                      {itemsLoading ? (
                        <div className="loading-container"><div className="spinner" /><p>Loading files...</p></div>
                      ) : (
                        <div
                          className="item-list od-list"
                          ref={itemListRef}
                          onScroll={handleItemListScroll}
                        >
                          <OneDriveTable
                            items={recoveryItems}
                            folders={folders}
                            view={oneDriveView}
                            selectedFolder={selectedFolder}
                            onOpenFolder={(p) => { patchSearchParams({ view: 'my-drive', folder: p }); }}
                            selectedItems={selectedItems}
                            onToggleItem={toggleSelectItem}
                            onSelectAll={(checked) => {
                              // Set selectedItems to the visible page
                              // immediately so the toolbar count
                              // shows "(N)" right on click — same as
                              // the manual-select feel — without
                              // waiting on the async folder-walk
                              // (which may return 0 due to backend
                              // folderPath indexing nuances).
                              if (checked) setSelectedItems(new Set(recoveryItems.map(i => i.id)));
                              else setSelectedItems(new Set());

                              // Sync the folder bulk-select state.
                              // handleOneDriveFolderCheck flips
                              // oneDriveFolderSelected immediately
                              // (left-panel checkbox flips) AND
                              // fetches every recursive file id under
                              // the folder, merging into
                              // selectedItems. Root / Recent has no
                              // folder context, so visible-page only.
                              const isFolderContext =
                                !!selectedFolder
                                && selectedFolder !== 'all'
                                && selectedFolder !== '/';
                              if (isFolderContext) {
                                const inSet = oneDriveFolderSelected.has(selectedFolder);
                                if (checked !== inSet) handleOneDriveFolderCheck(selectedFolder);
                              }
                            }}
                            allChecked={
                              (!!selectedFolder
                                && selectedFolder !== 'all'
                                && selectedFolder !== '/'
                                && oneDriveFolderSelected.has(selectedFolder))
                              || (recoveryItems.length > 0 && recoveryItems.every(i => selectedItems.has(i.id)))
                            }
                            onFolderCheck={handleOneDriveFolderCheck}
                            folderBusy={oneDriveFolderBusy}
                            folderSelected={oneDriveFolderSelected}
                            snapshotId={selectedSnapshotId}
                          />
                          {loadingMore && (
                            <div className="item-list-loading-more">
                              <div className="spinner-sm" />
                              <span>Loading more…</span>
                            </div>
                          )}
                          {!loadingMore && !hasMore && recoveryItems.length > 0 && recoveryItems.length < itemCount && (
                            <div className="item-list-end">End of list</div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                {/* Left Panel: tab-aware groupings.
                    - Mail / OneDrive / Contacts → folder tree.
                    - Chats → list of chats (display name + message count).
                    Clicking a row filters the items list via the `group`
                    parameter. "All" resets the filter. */}
                <div className="panel-left" ref={folderListRef} onScroll={handleFolderListScroll}>
                  <div className="folder-list">
                    {/* "All" aggregates across every folder — useful on mail /
                        onedrive / contacts to see the flat stream. On the
                        chats tab we skip it: each chat is a standalone
                        conversation, so "all messages from every chat mixed
                        together" isn't useful — the top chat is auto-
                        selected in the folders-load effect instead.

                        Scroll handler note: this used to live on .folder-list,
                        but .folder-list is a non-scrolling content wrapper —
                        the actual scroll viewport is .panel-left
                        (overflow-y: auto in Recovery.css). React onScroll
                        doesn't bubble, so attaching the handler to the
                        non-scrolling child meant it never fired, and the
                        infinite-scroll page advancement was dead. Moving it
                        up to the real scroller restores the loading-more
                        indicator + page fetch at the rail bottom. With the
                        first-load size also bumped to 500, this code path is
                        now mostly a safety net for >500-folder tenants. */}
                    {activeContentType !== 'chats' && (
                      <button
                        className={`folder-item ${selectedFolder === 'all' ? 'active' : ''}`}
                        onClick={() => patchSearchParams({ folder: null })}
                      >
                        <span className="folder-name">All</span>
                      </button>
                    )}
                    {foldersLoading && (
                      <div className="folder-loading">
                        <div className="spinner-sm" />
                      </div>
                    )}
                    {(() => {
                      // Apply the toolbar search to the left-panel folder
                      // list too — chat name typed in the search box
                      // narrows the chat list alongside filtering the
                      // messages view, and mail/onedrive/contacts folders
                      // filter the same way. Match case-insensitively on
                      // the full folder_path (so "vinay" matches
                      // "chats/Vinay Chauhan" and "/Inbox/Subfolder").
                      const q = debouncedSearch.toLowerCase();
                      const visibleFolders = q
                        ? folders.filter(f => f.path && f.path.toLowerCase().includes(q))
                        : folders.filter(f => f.path);

                      // OneDrive is handled by its own dedicated branch
                      // above (OneDriveLeftPanel), so by this point the tab
                      // is mail / contacts / chats — a flat list works.

                      return (
                        <>
                          {visibleFolders.map(folder => (
                            <div
                              key={folder.path}
                              className={`folder-item has-check ${selectedFolder === folder.path ? 'active' : ''}`}
                            >
                              {activeContentType === 'chats' ? (
                                <input
                                  type="checkbox"
                                  className="folder-check"
                                  checked={threadPath === folder.path}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setThreadPath(e.target.checked ? folder.path : null)}
                                  title="Select this thread for export"
                                />
                              ) : (
                                <input
                                  type="checkbox"
                                  className="folder-check"
                                  checked={
                                    // Either: bulk-selected via this
                                    // checkbox / via the master select-
                                    // all (genericFolderSelected flips
                                    // immediately), OR every item in
                                    // this folder is currently in
                                    // selectedItems — so manually
                                    // ticking each row also lights up
                                    // the folder. We only trust the
                                    // derived check when the folder is
                                    // the active view AND fully loaded
                                    // (recoveryItems.length ===
                                    // folder.count) — otherwise an
                                    // unloaded page might hide unticked
                                    // items and we'd lie to the user.
                                    genericFolderSelected.has(folder.path)
                                    || (
                                      selectedFolder === folder.path
                                      && folder.count > 0
                                      && recoveryItems.length === folder.count
                                      && recoveryItems.every(i => selectedItems.has(i.id))
                                    )
                                  }
                                  disabled={genericFolderBusy.has(folder.path)}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={() => handleGenericFolderCheck(folder.path)}
                                  title="Select every item in this folder"
                                />
                              )}
                              <button
                                className="folder-name-btn"
                                onClick={() => {
                                  // Chats: clicking a thread from a search
                                  // result should drop the search filter so
                                  // the user sees the WHOLE conversation,
                                  // not only the messages matching the
                                  // body-search query. Matches Teams/Slack
                                  // behavior. Other tabs keep the filter so
                                  // "invoice in Inbox" -> click Inbox still
                                  // narrows to invoices.
                                  if (activeContentType === 'chats') {
                                    setSearchQuery('');
                                  }
                                  patchSearchParams({ folder: folder.path });
                                }}
                                title={folder.path}
                              >
                                <span className="folder-name">{folder.path}</span>
                                {folder.count > 0 && <span className="folder-count">{folder.count}</span>}
                              </button>
                            </div>
                          ))}
                          {!foldersLoading && visibleFolders.length === 0 && (
                            <div className="folder-empty"><p>{q ? 'No matching folders' : 'No folders found'}</p></div>
                          )}
                        </>
                      );
                    })()}
                    {foldersLoadingMore && (
                      <div className="folder-loading"><div className="spinner-sm" /></div>
                    )}
                    {!foldersLoadingMore && !foldersHasMore && folders.length > 50 && (
                      <div className="folder-empty"><p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>End of list</p></div>
                    )}
                  </div>
                </div>

                {/* Middle Panel: Item List */}
                <div className="panel-middle">
                  <div className="item-list-header">
                    <label className="select-all-wrap" title="Select all">
                      <input
                        type="checkbox"
                        checked={
                          // Folder bulk-select drives the left-panel
                          // folder checkbox; reflect it here so the
                          // master checkbox flips immediately (no
                          // flicker while the id-fetch resolves).
                          (activeContentType !== 'chats'
                            && selectedFolder
                            && selectedFolder !== 'all'
                            && genericFolderSelected.has(selectedFolder))
                          || (recoveryItems.length > 0 && recoveryItems.every(i => selectedItems.has(i.id)))
                        }
                        onChange={e => {
                          const want = e.target.checked;
                          // (a) Set selectedItems to the visible page
                          // immediately. Keeps the toolbar count
                          // showing "(N)" the moment the user clicks
                          // — same feel as manually ticking each row
                          // — and doesn't depend on the async
                          // searchItems walk, which can occasionally
                          // return zero rows due to backend folderPath
                          // indexing nuances and would otherwise leave
                          // the count stuck at 0.
                          if (want) setSelectedItems(new Set(recoveryItems.map(i => i.id)));
                          else setSelectedItems(new Set());

                          // (b) Sync the left-panel folder checkbox.
                          // handleGenericFolderCheck flips
                          // genericFolderSelected immediately AND
                          // fetches every id under the folder
                          // (paginated items not yet on screen),
                          // which then merges into selectedItems.
                          // Chats use a per-thread (threadPath) model
                          // and skip this. OneDrive has its own
                          // panel above with separate handling.
                          if (activeContentType === 'chats') return;
                          if (selectedFolder && selectedFolder !== 'all') {
                            const inSet = genericFolderSelected.has(selectedFolder);
                            if (want !== inSet) handleGenericFolderCheck(selectedFolder);
                            return;
                          }
                          // "All" view: every folder containing items
                          // should flip too, so each left-panel folder
                          // checkbox reflects the master selection.
                          for (const folder of folders) {
                            if (!folder.path) continue;
                            const inSet = genericFolderSelected.has(folder.path);
                            if (want !== inSet) handleGenericFolderCheck(folder.path);
                          }
                        }}
                      />
                    </label>
                    <span className="item-count">
                      {selectedItems.size > 0
                        ? `${selectedItems.size} / ${itemCount} selected`
                        : `Showing ${recoveryItems.length} of ${itemCount}`}
                    </span>
                    {/* Pagination replaced by infinite scroll — scroll the
                        list past 60% to auto-load the next page. */}
                  </div>

                  <div className="item-list" ref={itemListRef} onScroll={handleItemListScroll}>
                    {/* Chats load older messages ABOVE the visible list when
                        the user scrolls up. Loader is sticky-positioned at
                        the top of the scroll viewport (not flow) so the
                        scroll-anchor math in the page-append effect doesn't
                        need to compensate for the loader appearing/dis-
                        appearing — there's no layout shift. */}
                    {activeContentType === 'chats' && loadingMore && (
                      <div
                        className="item-list-loading-more item-list-loading-more--sticky"
                      >
                        <div className="spinner-sm" />
                        <span>Loading older messages…</span>
                      </div>
                    )}
                    {activeContentType === 'chats' && !loadingMore && !hasMore && recoveryItems.length > 0 && (
                      <div className="item-list-end">Start of conversation</div>
                    )}
                    {itemsLoading ? (
                      <div className="loading-container">
                        <div className="spinner" />
                        <p>Loading items...</p>
                      </div>
                    ) : recoveryItems.length === 0 ? (
                      <div className="empty-state">
                        <p>No items found</p>
                      </div>
                    ) : (
                      (() => {
                        // Item-level types still flow through (server returns
                        // EMAIL / TEAMS_CHAT_MESSAGE / etc.) — pick the right
                        // row component from the active tab.
                        const CHAT_TYPES = new Set(['TEAMS_CHAT_MESSAGE', 'TEAMS_MESSAGE', 'TEAMS_MESSAGE_REPLY']);
                        const isChatContentType = activeContentType === 'chats';
                        const isEmailType = activeContentType === 'mail';
                        const isContactsContentType = activeContentType === 'contacts';
                        return recoveryItems.map(item => {
                          const isChatItem = isChatContentType || CHAT_TYPES.has(item.itemType || '');
                          const isEmailItem = isEmailType || item.itemType === 'EMAIL';
                          const isContactItem = isContactsContentType || item.itemType === 'USER_CONTACT' || item.itemType === 'CONTACT';
                          return isChatItem ? (
                          <ChatItemRow
                            key={item.id}
                            item={item}
                            selected={selectedItem?.id === item.id}
                            checked={selectedItems.has(item.id)}
                            onSelect={() => handleItemSelect(item)}
                            onCheck={(e) => { e.stopPropagation(); toggleSelectItem(item.id); }}
                          />
                        ) : isEmailItem ? (
                          <EmailItemRow
                            key={item.id}
                            item={item}
                            selected={selectedItem?.id === item.id}
                            checked={selectedItems.has(item.id)}
                            onSelect={() => handleItemSelect(item)}
                            onCheck={(e) => { e.stopPropagation(); toggleSelectItem(item.id); }}
                          />
                        ) : isContactItem ? (
                          <ContactItemRow
                            key={item.id}
                            item={item}
                            selected={selectedItem?.id === item.id}
                            checked={selectedItems.has(item.id)}
                            onSelect={() => handleItemSelect(item)}
                            onCheck={(e) => { e.stopPropagation(); toggleSelectItem(item.id); }}
                          />
                        ) : (
                        <div
                          key={item.id}
                          className={`item-row ${selectedItem?.id === item.id ? 'selected' : ''}`}
                            onClick={() => handleItemSelect(item)}
                        >
                          <input
                            type="checkbox"
                            checked={selectedItems.has(item.id)}
                            onChange={() => toggleSelectItem(item.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="item-content">
                            <div className="item-subject">{item.subject || item.name}</div>
                            <div className="item-preview">{item.preview || ''}</div>
                          </div>
                          <div className="item-date">
                            {item.date ? fmtLocalDate(item.date, { month: 'short', day: 'numeric' }) : ''}
                          </div>
                        </div>
                        );
                        });
                      })()
                    )}
                    {/* Bottom indicator — only for non-chat tabs, where new
                        pages append below the visible list. Chats render
                        their indicator at the top (above this block). */}
                    {activeContentType !== 'chats' && loadingMore && (
                      <div className="item-list-loading-more">
                        <div className="spinner-sm" />
                        <span>Loading more…</span>
                      </div>
                    )}
                    {/* End-of-list marker when the scroll can't advance but
                        the visible count trails the total — happens when
                        the server caps page count. Lets the user know we
                        hit the end rather than looking like a stuck load. */}
                    {activeContentType !== 'chats' && !loadingMore && !hasMore && recoveryItems.length > 0 && recoveryItems.length < itemCount && (
                      <div className="item-list-end">End of list</div>
                    )}
                  </div>
                </div>
                  </>
                )}

                {/* Right Panel: Item Preview — hidden for Chats, Calendar, and
                    OneDrive. Calendar shows events in the month view; chats
                    render inline in the middle panel; OneDrive uses the full
                    width for its Drive-style table. */}
                {!['chats', 'calendar', 'onedrive'].includes(activeContentType) && (
                <div className="panel-right">
                  {selectedItem
                    ? <ItemPreview item={selectedItem} />
                    : <div className="empty-preview"><p>Select an item to preview</p></div>
                  }
                          </div>
                        )}
              </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      </div>
      {(() => {
        // Modal routing for M365 Group / Entra Group / Teams Channel:
        // the GroupTeamsView has three content surfaces (Site / Mail /
        // Channels) that each need a completely different modal UX —
        // file-family for Site, chat for Channels, mailbox for Mail.
        // We don't actually mutate the resource row; we override what
        // the modals see for `resourceKind` and `contentType` so their
        // existing type-based branches fire correctly.
        //
        // SharePoint Site tab     → resourceKind='sharepoint_site'
        //                          (kicks into the file-family branch)
        // Teams Channels tab      → contentType='chats'
        //                          (triggers the chat-export code path
        //                           identical to the users' Chats tab)
        // Group Mail tab          → resourceKind='mailbox'
        //                          (re-uses the users' mail modal UX
        //                           so the target-picker + mailbox flow
        //                           behaves identically)
        const isGroupLike = !!selectedResource && [
          'm365_group', 'entra_group', 'teams_channel',
        ].includes(selectedResource.kind);
        const effectiveResourceKind =
          isGroupLike && groupTeamsTab === 'site' ? 'sharepoint_site'
          : isGroupLike && groupTeamsTab === 'mail' ? 'mailbox'
          : selectedResource?.kind;
        const effectiveContentType: ContentTab =
          isGroupLike && groupTeamsTab === 'channels' ? 'chats'
          : isGroupLike && groupTeamsTab === 'mail' ? 'mail'
          : (activeContentType as ContentTab);
        // Chat restore is a Microsoft platform limit, not a TMvault
        // limit — neither /chats/{id}/messages nor
        // /teams/{id}/channels/{id}/messages accept an app-only
        // token. Surface that clearly in the modal AND grey out the
        // toolbar Recover button so the user can't even open the
        // modal (which would just show the unsupported screen).
        const isChatRestoreUnsupported = effectiveContentType === 'chats';
        return (
          <>
            <RestoreModal
              isOpen={restoreModalOpen}
              onClose={() => setRestoreModalOpen(false)}
              itemIds={Array.from(selectedItems)}
              snapshotIds={selectedSnapshotId ? [selectedSnapshotId] : []}
              itemName={restoreItemName}
              itemType={restoreItemType}
              resourceKind={effectiveResourceKind}
              chatRestoreUnsupported={isChatRestoreUnsupported}
              folderPaths={
                activeContentType !== 'chats' && genericFolderSelected.size > 0
                  ? Array.from(genericFolderSelected)
                  : undefined
              }
              snapshotDate={snapshots.find(s => s.id === selectedSnapshotId)?.createdAt}
            />
            <DownloadModal
              isOpen={downloadModalOpen}
              onClose={() => setDownloadModalOpen(false)}
              itemIds={Array.from(selectedItems)}
              snapshotIds={selectedSnapshotId ? [selectedSnapshotId] : []}
              selectedCount={selectedItems.size}
              contentType={effectiveContentType}
              preserveTree={oneDriveFolderSelected.size > 0 || genericFolderSelected.size > 0}
              folderPaths={
                activeContentType === 'calendar' && selectedCalendarPaths.length > 0
                  ? selectedCalendarPaths
                  : activeContentType !== 'chats' && genericFolderSelected.size > 0
                  ? Array.from(genericFolderSelected)
                  : undefined
              }
              snapshotDate={
                contentSnapshots?.byContent[activeContentType as ContentTab]?.createdAt
                || snapshots.find(s => s.id === selectedSnapshotId)?.createdAt
                || undefined
              }
              resourceId={selectedResource?.id}
              resourceKind={effectiveResourceKind}
              threadPath={threadPath}
            />
          </>
        );
      })()}
      {selectedResource && (() => {
        const snap = snapshots.find(s => s.id === selectedSnapshotId);
        if (!snap) return null;
        // PostgreSQL gets its own simpler modal (Source DB / Tenant /
        // Server / Destination DB name). SQL keeps the full cascading
        // sub→RG→loc→server flow with the secret picker.
        const isPg = selectedResource.kind === 'azure_postgresql' || selectedResource.kind === 'azure_postgresql_single';
        return isPg ? (
          <AzurePgRecoverModal
            open={azureDbRecoverOpen}
            onClose={() => setAzureDbRecoverOpen(false)}
            resource={selectedResource}
            snapshot={snap}
          />
        ) : (
          <AzureDbRecoverModal
            open={azureDbRecoverOpen}
            onClose={() => setAzureDbRecoverOpen(false)}
            resource={selectedResource}
            snapshot={snap}
          />
        );
      })()}
    </>
  );
}
