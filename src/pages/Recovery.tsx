import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  SnapshotService, CONTENT_TABS, CONTENT_TAB_LABELS,
  type SnapshotItem, type SnapshotFolder, type ResourceWithBackups, type CalendarEvent, type ContentTab,
  type ContentSnapshotsResponse,
} from '../services/snapshot';
import { type RecoveryItem } from '../services/recovery';
import { RestoreModal } from '../components/RestoreModal';
import { DownloadModal } from '../components/DownloadModal';
import BackupSizeSummary from '../components/BackupSizeSummary';
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
    power_bi: 'Power BI workspace',
    azure_vm: 'Azure VM',
    azure_sql: 'Azure SQL',
    azure_postgresql: 'Azure PostgreSQL',
  };
  return labels[kind] || kind;
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
    id: string; name: string; size: number; contentType: string | null;
    isInline: boolean; resolved: boolean; sourceUrl: string | null;
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
          ? <iframe srcDoc={bodyContent} sandbox="allow-same-origin" className="email-iframe" title="email-body" />
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
  // Strip <img> tags pointing at Graph's hostedContents — they require
  // an auth'd request and otherwise fire 401s in the browser console.
  const bodyContent = typeof rawBody === 'string' ? rawBody.replace(/<img[^>]*>/gi, '') : rawBody;
  const isHtml = (raw.body?.contentType || (item as any).bodyContentType) === 'html';
  const sentAt = raw.createdDateTime || (item as any).date || item.date;
  const attachments: any[] = raw.attachments || [];
  const mentions: any[] = raw.mentions || [];
  const isDeleted = raw.deletedDateTime != null;
  const context = item.metadata?.chatTopic || item.metadata?.channelName
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
          {isDeleted
            ? <div className="chat-deleted">This message was deleted</div>
            : isHtml
              ? <div className="chat-body" dangerouslySetInnerHTML={{ __html: bodyContent }} />
              : <div className="chat-body">{bodyContent || <em>No content</em>}</div>
          }
          {attachments.length > 0 && (
            <div className="chat-attachments">
              {attachments.map((a: any, i: number) => (
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
                <a href={e.address ? `mailto:${e.address}` : undefined} style={{ color: '#0d9488' }}>
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
      accent="#0d9488"
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


function ChatItemRow({ item, selected, checked, onSelect, onCheck }: {
  item: any; selected: boolean; checked: boolean;
  onSelect: () => void; onCheck: (e: React.MouseEvent) => void;
}) {
  const raw = item.metadata?.raw || {};
  const sender = raw.from?.user?.displayName || raw.from?.application?.displayName || item.name || 'Unknown';
  const senderEmail = item.metadata?.senderEmail || raw.from?.user?.email || raw.from?.user?.userPrincipalName || '';
  const initials = sender.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
  const body = raw.body?.content || item.preview || item.body || '';
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
        const withBreaks = noImages
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
        <div className="chat-item-text">{displayBody || '\u00a0'}</div>
        {rawAttachments.length > 0 && (
          <div className="chat-item-attachments" onClick={(e) => e.stopPropagation()}>
            {chatAttachments.length === 0
              ? <span className="email-ol-attach-chip">Attachment{rawAttachments.length === 1 ? '' : 's'} (capturing…)</span>
              : chatAttachments.map((a) => {
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
  'Recurring':      '#0d9488',
  'Recurring Series': '#0d9488',
  'Exception':      '#d97706',
  'Meeting':        '#16a34a',
  'Appointment':    '#16a34a',
};

function CalendarMonthView({ snapshotId, selectedItems, onItemCheck, onFilteredIdsChange }: {
  snapshotId: string;
  selectedItems: Set<string>;
  onItemCheck: (itemId: string) => void;
  // Emitted whenever the sidebar filter set changes so the parent can
  // scope Download to just those event IDs.
  onFilteredIdsChange?: (ids: string[]) => void;
}) {
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [viewDate, setViewDate] = useState<Date>(new Date());
  // Mouse-following tooltip state. `day` points at the cell's day number
  // in the current month; x/y are clientX/clientY so the popover can be
  // absolutely positioned relative to the viewport.
  const [hovered, setHovered] = useState<{ day: number; x: number; y: number } | null>(null);

  // Load all events for this snapshot
  useEffect(() => {
    if (!snapshotId) return;
    setLoading(true);
    SnapshotService.listCalendarEvents(snapshotId, 1, 1000)
      .then(data => {
        setAllEvents(data.content);
        // Auto-navigate to month with most events
        if (data.content.length > 0) {
          const first = data.content.find(e => e.start);
          if (first?.start) {
            const d = parseAsUtc(first.start);
            if (d) setViewDate(d);
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [snapshotId]);

  // Collect unique event types for filter sidebar
  const eventTypes = Array.from(new Set(allEvents.map(e => e.eventType))).sort();

  // Filter events
  const visibleEvents = activeFilters.size === 0
    ? allEvents
    : allEvents.filter(e => activeFilters.has(e.eventType));

  // Notify parent of the current filtered ID set so Download can scope
  // to just these events. When activeFilters is empty this is all ids.
  useEffect(() => {
    if (!onFilteredIdsChange) return;
    onFilteredIdsChange(visibleEvents.map(e => e.id));
  }, [allEvents, activeFilters, onFilteredIdsChange]);

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
            className={`cal-filter-all${activeFilters.size === 0 ? ' active' : ''}`}
            style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',width:'100%'}}
          >
            <input
              type="checkbox"
              checked={activeFilters.size === 0}
              onChange={() => setActiveFilters(new Set())}
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
                className={`cal-day-cell${!day ? ' cal-day-empty' : ''}${day && isToday(day) ? ' cal-day-today' : ''}${hasEvents ? ' cal-day-has-events' : ''}`}
                onMouseEnter={day && hasEvents ? (e) => setHovered({ day, x: e.clientX, y: e.clientY }) : undefined}
                onMouseMove={day && hasEvents ? (e) => setHovered({ day, x: e.clientX, y: e.clientY }) : undefined}
                onMouseLeave={() => setHovered(null)}
              >
                {day && (
                  <>
                    <span className="cal-day-number">{day}</span>
                    {hasEvents && (
                      <div className="cal-day-events-list" aria-label={`${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}`}>
                        {dayEvents.map(ev => (
                          <div
                            key={ev.id}
                            className="cal-day-event-label"
                            style={{ borderLeftColor: EVENT_TYPE_COLORS[ev.eventType] || '#16a34a' }}
                            title={ev.subject || '(no subject)'}
                          >
                            {ev.subject || '(no subject)'}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Mouse-following event popover. Fixed positioning means the
            offsets are viewport-relative. We clamp to the viewport edge
            so it never clips off-screen when the user hovers a cell
            near the right/bottom border. Width is computed client-side;
            falls back to a sane default to avoid a flash on first
            hover before the ref resolves. */}
        {hovered && (eventsByDay[hovered.day]?.length ?? 0) > 0 && (
          <CalendarHoverTooltip
            day={hovered.day}
            x={hovered.x}
            y={hovered.y}
            events={eventsByDay[hovered.day] || []}
            selectedItems={selectedItems}
            onItemCheck={onItemCheck}
          />
        )}
      </div>
    </div>
  );
}

function CalendarHoverTooltip({ day, x, y, events, selectedItems, onItemCheck }: {
  day: number;
  x: number;
  y: number;
  events: CalendarEvent[];
  selectedItems: Set<string>;
  onItemCheck: (id: string) => void;
}) {
  // Offset the popover off the cursor so it doesn't flicker when the
  // mouse moves onto it. Clamp to viewport so late-month / bottom-row
  // cells don't push it off-screen.
  const GAP = 14;
  const PAD = 8;
  const maxW = 320;
  const estimatedH = Math.min(360, 56 + events.length * 22);
  let left = x + GAP;
  let top = y + GAP;
  if (typeof window !== 'undefined') {
    if (left + maxW > window.innerWidth - PAD) left = Math.max(PAD, x - GAP - maxW);
    if (top + estimatedH > window.innerHeight - PAD) top = Math.max(PAD, y - GAP - estimatedH);
  }
  return (
    <div
      className="cal-hover-tooltip"
      style={{ left, top, maxWidth: maxW }}
      onClick={e => e.stopPropagation()}
    >
      <div className="cal-hover-header">
        Day {day} · {events.length} event{events.length === 1 ? '' : 's'}
      </div>
      <div className="cal-hover-list">
        {events.map(ev => {
          const color = EVENT_TYPE_COLORS[ev.eventType] || '#16a34a';
          const isChecked = selectedItems.has(ev.id);
          const when = ev.start
            ? fmtLocalTime(ev.start, { hour: 'numeric', minute: '2-digit' })
            : '';
          return (
            <div key={ev.id} className={`cal-hover-row${isChecked ? ' checked' : ''}`}>
              <input
                type="checkbox"
                className="cal-hover-check"
                checked={isChecked}
                onChange={() => onItemCheck(ev.id)}
                onClick={e => e.stopPropagation()}
              />
              <span className="cal-hover-dot" style={{ background: color }} />
              <span className="cal-hover-subject" title={ev.subject}>{ev.subject || '(no subject)'}</span>
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
  const { displayRows, displayFolders } = useMemo(() => {
    const prefix = spPrefix + (spPath.length ? '/' + spPath.join('/') : '');
    const files: any[] = [];
    const folderSet = new Set<string>();

    for (const it of items) {
      const fp: string = it.folderPath || '';
      if (!fp.startsWith(prefix)) continue;
      const rest = fp.slice(prefix.length).replace(/^\//, '');
      if (rest === '') {
        // Item lives directly at this level.
        files.push(it);
      } else {
        // Deeper item — promote its first segment as a visible folder.
        const seg = rest.split('/')[0];
        if (seg) folderSet.add(seg);
      }
    }

    return {
      displayRows: files,
      displayFolders: Array.from(folderSet).sort((a, b) => a.localeCompare(b)),
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
                <div className="od-table">
                  <div className="od-table-head">
                    <div className="od-th od-th-check">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={e => onSelectAll(displayRows.map(i => i.id), e.target.checked)}
                      />
                    </div>
                    <div className="od-th od-th-name">Name</div>
                    <div className="od-th od-th-owner">Owner</div>
                    <div className="od-th od-th-modified">Last modified</div>
                    <div className="od-th od-th-size">File size</div>
                  </div>
                  <div className="od-table-body">
                    {displayFolders.map((seg) => (
                      <div
                        key={`folder-${seg}`}
                        className="od-row od-row-folder"
                        onClick={() => setSpPath([...spPath, seg])}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="od-td od-td-check" />
                        <div className="od-td od-td-name" title={seg}>
                          <span className="od-row-icon" aria-hidden>{FolderIcon}</span>
                          <span className="od-row-name">{seg}</span>
                        </div>
                        <div className="od-td od-td-owner">—</div>
                        <div className="od-td od-td-modified">—</div>
                        <div className="od-td od-td-size">—</div>
                      </div>
                    ))}
                    {displayRows.map((item: any) => {
                      const md = item.metadata || {};
                      const owner = md.created_by || md.modified_by || '—';
                      const modified = md.modified || md.created || item.createdAt;
                      const size = item.contentSize ?? md.file?.Length ?? 0;
                      const hasBlob = !!item.blobPath;
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
  if (!html) return '';
  // Strip inline <img> tags (Teams embeds giant base64 images that make
  // the right pane unreadable). Replace them with a small placeholder.
  return String(html).replace(/<img[^>]*>/gi, '[image]');
}

function GroupTeamsView({
  resourceId, snapshots, selectedItems, onToggleItem, onSelectAll,
}: {
  resourceId: string;
  snapshots: SnapshotItem[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectAll: (ids: string[], checked: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<GroupTab>('site');

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
    if (!latestSnapshot) { setItems([]); return; }
    setLoading(true); setError(null);
    SnapshotService.listSnapshotFiles(latestSnapshot.id, 1, 5000)
      .then(data => setItems(data.content || []))
      .catch(err => { setError(err.message || 'Failed to load items'); setItems([]); })
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
    const currentTab = t && (CONTENT_TABS as string[]).includes(t) ? (t as ContentType) : activeContentType;
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

    setSnapshotsLoading(true);
    Promise.all([
      // Sparkline needs the historical snapshot list (date + size). For
      // ENTRA_USER parents the real content bytes live on Tier 2 children
      // (USER_MAIL / USER_ONEDRIVE / …), not on the parent itself — so
      // we ask the backend to include child snapshots. Other resource
      // kinds (Tier 1 MAILBOX, etc.) have no children and the flag is a
      // no-op for them.
      SnapshotService.listByResource(selectedResource.id, 1, 200, true).catch(() => ({ content: [] })),
      SnapshotService.getContentSnapshots(selectedResource.id),
    ])
      .then(([list, content]) => {
        setSnapshots(list.content || []);
        setContentSnapshots(content);
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
  useEffect(() => {
    if (!contentSnapshots) return;
    const entry = contentSnapshots.byContent[activeContentType as ContentTab];
    setSelectedSnapshotId(entry?.snapshotId || '');
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

    const myKey = ++requestKeyRef.current;
    setItemPage(1);
    setItemsLoading(true);
    if (itemListRef.current) itemListRef.current.scrollTop = 0;
    // Calendar dumps benefit from a larger page (no pagination control on the
    // calendar layout); the other four tabs use the standard list size.
    const pageSize = activeContentType === 'calendar' ? 500 : 50;
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
  }, [selectedSnapshotId, selectedResource, activeContentType, selectedFolder, debouncedSearch, oneDriveView]);

  // Append next page when itemPage advances (driven by the scroll handler
  // below). Separate effect so the fresh-load above doesn't re-run on every
  // scroll-triggered page bump. For the chats tab we PREPEND instead (older
  // messages go above), and preserve the user's scroll position so the
  // view doesn't yank when new rows appear at the top.
  useEffect(() => {
    if (itemPage <= 1 || !selectedSnapshotId || !activeContentType) return;
    const myKey = requestKeyRef.current;
    const isChats = activeContentType === 'chats';
    setLoadingMore(true);
    const pageSize = activeContentType === 'calendar' ? 500 : 50;
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

  // Clear preview + drop any checked items when the snapshot or tab changes.
  // Without clearing selectedItems, ids from one tab leak into another
  // (Download/Recover would act on stale ids). Folder changes deliberately
  // keep the current selection — the user may be narrowing a subset.
  useEffect(() => {
    setSelectedItem(null);
    setSelectedItems(new Set());
  }, [selectedSnapshotId, activeContentType]);

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
    // Don't reset selectedFolder here — the URL-sync effect is the
    // single source of truth for that value now. Resetting would
    // clobber a restored folder when the user presses browser back.

    if (activeContentType === 'calendar' || !contentSnapshots) {
      return;
    }
    const entry = contentSnapshots.byContent[activeContentType as ContentTab];
    const snapId = entry?.snapshotId;
    if (!snapId) {
      return;
    }

    const myKey = ++foldersKeyRef.current;
    setFoldersLoading(true);
    SnapshotService.getFolders(snapId)
      .then((data) => {
        if (myKey !== foldersKeyRef.current) return; // stale — a newer request started
        const folderList = [{ path: '', count: data.reduce((sum, f) => sum + f.count, 0) }, ...data];
        setFolders(folderList);
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
        if (myKey === foldersKeyRef.current) setFoldersLoading(false);
      });
  }, [contentSnapshots, activeContentType]);



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
  }, [selectedSnapshotId, oneDriveFolderBusy, oneDriveFolderSelected]);

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);

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
    if (!selectedSnapshotId || selectedItems.size === 0) return;
    setRestoreModalOpen(true);
  };

  // Calendar sidebar's currently-filtered event IDs. Empty filter =
  // every event; otherwise only the event types the user ticked.
  // Scopes Download on the calendar tab so the ZIP only contains the
  // events matching the sidebar checkboxes.
  const [filteredCalendarIds, setFilteredCalendarIds] = useState<string[]>([]);

  const handleDownload = () => {
    if (!selectedSnapshotId) return;
    setDownloadError(null);
    // If we're on the calendar tab and the user hasn't ticked any
    // individual events, inherit the sidebar's filtered set as the
    // download scope so "Meeting" + "Online Meeting" (or any combo)
    // narrows what lands in the export.
    if (activeContentType === 'calendar' && selectedItems.size === 0 && filteredCalendarIds.length > 0) {
      setSelectedItems(new Set(filteredCalendarIds));
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

              return identityGroups.map(([key, group]) => {
                const primary = group[0];
                const totalSnapshots = group.reduce((s, r) => s + (r.snapshot_count || 0), 0);
                const isSingle = group.length === 1;
                const selectedInGroup = group.some(r => selectedResource?.id === r.id);
                // Auto-expand when a surface inside is selected (e.g. after deep-link
                // via ?resourceId=...), even if the user never clicked the chevron.
                const isExpanded = expandedIdentities.has(key) || selectedInGroup;

                // Single-surface identity: render as a plain selectable row (no expand).
                if (isSingle) {
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
                          <span>{primary.snapshot_count} snapshot{primary.snapshot_count !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </button>
                  );
                }

                // Multi-surface identity: header row + nested surface rows when expanded.
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
                          <span>·</span>
                          <span>{totalSnapshots} snapshot{totalSnapshots !== 1 ? 's' : ''}</span>
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
                                <span>{surface.snapshot_count} snapshot{surface.snapshot_count !== 1 ? 's' : ''}</span>
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
                  {/* Total bytes: parent's own storage_bytes is often tiny
                      for ENTRA_USER rows (just metadata). The real content
                      bytes are split across Tier 2 children; contentSnapshots
                      has the per-tab latest-snapshot bytesTotal. Sum those
                      plus the parent row itself so the headline "Backup
                      size" reflects what the user actually has. */}
                  <BackupSizeSummary
                    snapshots={snapshots}
                    totalBytes={(() => {
                      const parentBytes = selectedResource.storage_bytes || 0;
                      const childBytes = contentSnapshots
                        ? Object.values(contentSnapshots.byContent).reduce(
                            (sum, entry) => sum + (entry?.bytesTotal || 0),
                            0,
                          )
                        : 0;
                      // If child bytes are non-zero they're the source of
                      // truth (contentSnapshots already rolls up per tab);
                      // otherwise fall back to the parent's own size.
                      return childBytes > 0 ? childBytes : parentBytes;
                    })()}
                  />

                  {/* Snapshot picker is gone — the user no longer chooses a
                      version; clicking a content tab auto-resolves to the
                      latest snapshot for that tab. We surface the count so
                      the user can see backup activity at a glance. */}
                  <div className="snapshot-count">
                    <div className="snapshot-count-num">
                      {contentSnapshots?.snapshotCount ?? (snapshotsLoading ? '…' : 0)}
                    </div>
                    <div className="snapshot-count-label">
                      snapshot{(contentSnapshots?.snapshotCount ?? 0) === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              </div>

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
                />
              ) : (
                <>
              {/* Content Type Tabs — fixed five (Mail / OneDrive / Contacts / Calendar / Chats).
                  Each tab shows its backed-up item count from the content-
                  snapshots resolver; tabs with no snapshot yet stay clickable
                  but render an empty state on click. */}
              <div className="content-type-tabs">
                {contentTypes.map(type => {
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

              {/* Toolbar */}
              <div className="recovery-toolbar">
                <div className="toolbar-left">
                  <div className="search-wrapper">
                    <input
                      type="text"
                      placeholder="Search items..."
                      className="search-input"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <button className="search-btn">
                      <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ width: 16, height: 16 }}>
                        <path d="M8.5 8.5L10.5 10.5M7 9.5C5.61929 9.5 4.5 8.38071 4.5 7C4.5 5.61929 5.61929 4.5 7 4.5C8.38071 4.5 9.5 5.61929 9.5 7C9.5 8.38071 8.38071 9.5 7 9.5Z" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="toolbar-right">
                  {downloadError && <span style={{color:'#dc2626',fontSize:12}}>{downloadError}</span>}
                  <button
                    className="action-button download"
                    onClick={handleDownload}
                    // Modal handles scope: allow click even with 0 selected so user
                    // can pick "Download all". Still guard against tabs with no backup.
                    disabled={!selectedSnapshotId}
                  >
                    {`Download${selectedItems.size > 0 ? ` (${selectedItems.size})` : ''}`}
                  </button>
                  <button
                    className="action-button recover"
                    onClick={handleRecover}
                    disabled={selectedItems.size === 0 || !selectedSnapshotId}
                  >
                    Recover{selectedItems.size > 0 ? ` (${selectedItems.size})` : ''}
                  </button>
                </div>
              </div>

              {/* Three Panel Layout */}
              <div className={`three-panel-layout${activeContentType === 'calendar' ? ' cal-layout-mode' : ''}${activeContentType === 'onedrive' ? ' od-layout-mode' : ''}`}>
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
                              if (checked) setSelectedItems(new Set(recoveryItems.map(i => i.id)));
                              else setSelectedItems(new Set());
                            }}
                            allChecked={recoveryItems.length > 0 && recoveryItems.every(i => selectedItems.has(i.id))}
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
                <div className="panel-left">
                  <div className="folder-list">
                    {/* "All" aggregates across every folder — useful on mail /
                        onedrive / contacts to see the flat stream. On the
                        chats tab we skip it: each chat is a standalone
                        conversation, so "all messages from every chat mixed
                        together" isn't useful — the top chat is auto-
                        selected in the folders-load effect instead. */}
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
                            <button
                              key={folder.path}
                              className={`folder-item ${selectedFolder === folder.path ? 'active' : ''}`}
                              onClick={() => patchSearchParams({ folder: folder.path })}
                            >
                              <span className="folder-name">{folder.path}</span>
                              {folder.count > 0 && <span className="folder-count">{folder.count}</span>}
                            </button>
                          ))}
                          {!foldersLoading && visibleFolders.length === 0 && (
                            <div className="folder-empty"><p>{q ? 'No matching folders' : 'No folders found'}</p></div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Middle Panel: Item List */}
                <div className="panel-middle">
                  <div className="item-list-header">
                    <label className="select-all-wrap" title="Select all">
                      <input
                        type="checkbox"
                        checked={recoveryItems.length > 0 && recoveryItems.every(i => selectedItems.has(i.id))}
                        onChange={e => {
                          if (e.target.checked) setSelectedItems(new Set(recoveryItems.map(i => i.id)));
                          else setSelectedItems(new Set());
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
                    {/* Infinite-scroll bottom indicator — only while appending
                        a page. When hasMore is false we render nothing (the
                        list is fully loaded). */}
                    {loadingMore && (
                      <div className="item-list-loading-more">
                        <div className="spinner-sm" />
                        <span>Loading more…</span>
                      </div>
                    )}
                    {/* End-of-list marker when the scroll can't advance but
                        the visible count trails the total — happens when
                        the server caps page count. Lets the user know we
                        hit the end rather than looking like a stuck load. */}
                    {!loadingMore && !hasMore && recoveryItems.length > 0 && recoveryItems.length < itemCount && (
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
      <RestoreModal
        isOpen={restoreModalOpen}
        onClose={() => setRestoreModalOpen(false)}
        itemIds={Array.from(selectedItems)}
        snapshotIds={selectedSnapshotId ? [selectedSnapshotId] : []}
        itemName={restoreItemName}
        itemType={restoreItemType}
        snapshotDate={snapshots.find(s => s.id === selectedSnapshotId)?.createdAt}
      />
      <DownloadModal
        isOpen={downloadModalOpen}
        onClose={() => setDownloadModalOpen(false)}
        itemIds={Array.from(selectedItems)}
        snapshotIds={selectedSnapshotId ? [selectedSnapshotId] : []}
        selectedCount={selectedItems.size}
        contentType={activeContentType as ContentTab}
        preserveTree={oneDriveFolderSelected.size > 0}
        snapshotDate={
          // Tab-selected snapshot's date lives on contentSnapshots.byContent — the
          // top-level `snapshots` list is just the first 50 from listByResource
          // and may not contain the active tab's snapshotId, so .find() often
          // returned undefined and the modal title showed no date.
          contentSnapshots?.byContent[activeContentType as ContentTab]?.createdAt
          || snapshots.find(s => s.id === selectedSnapshotId)?.createdAt
          || undefined
        }
      />
    </>
  );
}
