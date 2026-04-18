import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  SnapshotService, CONTENT_TABS, CONTENT_TAB_LABELS,
  type SnapshotItem, type SnapshotFolder, type ResourceWithBackups, type CalendarEvent, type ContentTab,
  type ContentSnapshotsResponse,
} from '../services/snapshot';
import { RecoveryService, type RecoveryItem } from '../services/recovery';
import { RestoreModal } from '../components/RestoreModal';
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

// Folder-tree builder for OneDrive. Takes flat paths like "/A/B" and "/A/C"
// and produces a nested {name, fullPath, count, children[]} structure so the
// left panel can render a real file-explorer-style tree.
type FolderNode = { name: string; fullPath: string; count: number; children: FolderNode[] };

function buildFolderTree(folders: Array<{ path: string; count: number }>): FolderNode {
  const root: FolderNode = { name: '/', fullPath: '/', count: 0, children: [] };
  for (const f of folders) {
    const path = f.path || '/';
    const parts = path.split('/').filter(Boolean);
    let cursor = root;
    cursor.count += f.count;
    let acc = '';
    for (const part of parts) {
      acc += '/' + part;
      let child = cursor.children.find(c => c.name === part);
      if (!child) {
        child = { name: part, fullPath: acc, count: 0, children: [] };
        cursor.children.push(child);
      }
      child.count += f.count;
      cursor = child;
    }
  }
  // Sort children alphabetically at every level for stable display.
  const sortRec = (n: FolderNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

function FolderTreeNode({
  node, depth, selected, onSelect,
}: { node: FolderNode; depth: number; selected: string; onSelect: (path: string) => void }) {
  const [open, setOpen] = useState(depth < 1);  // expand the top level by default
  const hasKids = node.children.length > 0;
  return (
    <div className="folder-tree-node">
      <button
        type="button"
        className={`folder-item folder-tree-item ${selected === node.fullPath ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node.fullPath)}
      >
        {hasKids ? (
          <span
            className={`folder-tree-toggle ${open ? 'open' : ''}`}
            onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
            aria-label={open ? 'Collapse' : 'Expand'}
          >▸</span>
        ) : <span className="folder-tree-spacer" />}
        <span className="folder-tree-icon" aria-hidden>
          {hasKids ? (open ? '📂' : '📁') : '📄'}
        </span>
        <span className="folder-name">{node.name}</span>
        {node.count > 0 && <span className="folder-count">{node.count}</span>}
      </button>
      {open && hasKids && (
        <div className="folder-tree-children">
          {node.children.map(child => (
            <FolderTreeNode key={child.fullPath} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

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

function CalendarMonthView({ snapshotId, selectedItems, onItemCheck }: {
  snapshotId: string;
  selectedItems: Set<string>;
  onItemCheck: (itemId: string) => void;
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
          <button
            className={`cal-filter-all${activeFilters.size === 0 ? ' active' : ''}`}
            onClick={() => setActiveFilters(new Set())}
          >
            <span className="cal-filter-dot" style={{background:'#16a34a'}} />
            All events
            <span className="cal-filter-count">{allEvents.length}</span>
          </button>
        </div>

        <div className="cal-filter-divider" />

        <div className="cal-filter-section-label">Event Type</div>
        <div className="cal-filter-section">
          {eventTypes.map(type => {
            const color = EVENT_TYPE_COLORS[type] || '#64748b';
            const count = allEvents.filter(e => e.eventType === type).length;
            const isActive = activeFilters.has(type);
            return (
              <button
                key={type}
                className={`cal-filter-item${isActive ? ' active' : ''}`}
                onClick={() => toggleFilter(type)}
              >
                <span className="cal-filter-dot" style={{background: color}} />
                <span className="cal-filter-label">{type}</span>
                <span className="cal-filter-count">{count}</span>
              </button>
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
            <div className="cal-view-toggle">
              <button className="cal-view-btn active">Month</button>
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="cal-month-grid">
          {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(d => (
            <div key={d} className="cal-dow-header">{d}</div>
          ))}
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
                      <div className="cal-day-dots" aria-label={`${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}`}>
                        {dayEvents.slice(0, 5).map(ev => (
                          <span
                            key={ev.id}
                            className="cal-day-dot"
                            style={{ background: EVENT_TYPE_COLORS[ev.eventType] || '#16a34a' }}
                          />
                        ))}
                        {dayEvents.length > 5 && (
                          <span className="cal-day-dot-count">+{dayEvents.length - 5}</span>
                        )}
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

export default function Recovery() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // Five fixed tabs — no runtime discovery. Default to first tab (mail).
  const contentTypes: ContentTab[] = CONTENT_TABS;
  const [activeContentType, setActiveContentType] = useState<ContentType>('mail');

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
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [foldersLoading, setFoldersLoading] = useState(false);

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
      // Sparkline still needs the historical snapshot list (date + size).
      SnapshotService.listByResource(selectedResource.id, 1, 50).catch(() => ({ content: [] })),
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
    SnapshotService.listItems(
      selectedSnapshotId, 1, pageSize,
      activeContentType as ContentTab, selectedFolder, debouncedSearch,
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
  }, [selectedSnapshotId, selectedResource, activeContentType, selectedFolder, debouncedSearch]);

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
    SnapshotService.listItems(
      selectedSnapshotId, itemPage, pageSize,
      activeContentType as ContentTab, selectedFolder, debouncedSearch,
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
    setSelectedFolder('all');

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

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

  const handleDownload = async () => {
    if (!selectedSnapshotId || selectedItems.size === 0) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const response = await RecoveryService.triggerExport({
      restoreType: 'EXPORT_ZIP',
      snapshotIds: [selectedSnapshotId],
      itemIds: Array.from(selectedItems),
      });
      const jobId = response.jobId;
      // Poll until complete (max 60s)
      const token = localStorage.getItem('access_token');
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`${API.BASE_URL}/jobs/${jobId}`, { headers });
        if (statusRes.ok) {
          const job = await statusRes.json();
          if (job.status === 'COMPLETED') {
            // Use the API constant — the hardcoded `/exports/{id}/download`
            // path 404s because job-service only implements the canonical
            // `/jobs/export/{id}/download` route (gateway proxies both).
            const dlRes = await fetch(API.EXPORT.DOWNLOAD(jobId), { headers });
            if (!dlRes.ok) throw new Error('Download failed');
            const blob = await dlRes.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Export is now a ZIP (built by restore-worker.export_as_zip);
            // the JSON-only download path was retired. Filename matches the
            // backend-set Content-Disposition for clarity.
            a.download = `export-${jobId.slice(0, 8)}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return;
          }
          if (job.status === 'FAILED') {
            setDownloadError('Export failed. Please try again.');
            return;
          }
        }
      }
      setDownloadError('Export timed out. Try again later.');
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
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
                  <BackupSizeSummary
                    snapshots={snapshots}
                    totalBytes={selectedResource.storage_bytes}
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
                      onClick={() => setActiveContentType(type)}
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
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="toolbar-right">
                  {downloadError && <span style={{color:'#dc2626',fontSize:12}}>{downloadError}</span>}
                  <button
                    className="action-button download"
                    onClick={handleDownload}
                    // Also guard against tabs with no backup (selectedSnapshotId='')
                    // — otherwise we POST an export job with no snapshot context.
                    disabled={selectedItems.size === 0 || downloading || !selectedSnapshotId}
                  >
                    {downloading ? 'Preparing...' : `Download${selectedItems.size > 0 ? ` (${selectedItems.size})` : ''}`}
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
              <div className={`three-panel-layout${activeContentType === 'calendar' ? ' cal-layout-mode' : ''}`}>
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
                      />
                    )}
                  </div>
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
                        onClick={() => setSelectedFolder('all')}
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

                      if (activeContentType === 'onedrive') {
                        // OneDrive uses a hierarchical tree built from
                        // /drive/root: paths so the user can drill into
                        // folders like a file explorer.
                        const tree = buildFolderTree(visibleFolders);
                        if (tree.children.length === 0 && !foldersLoading) {
                          return <div className="folder-empty"><p>{q ? 'No matching folders' : 'No folders found'}</p></div>;
                        }
                        return (
                          <div className="folder-tree">
                            {tree.children.map(child => (
                              <FolderTreeNode
                                key={child.fullPath}
                                node={child}
                                depth={0}
                                selected={selectedFolder}
                                onSelect={setSelectedFolder}
                              />
                            ))}
                          </div>
                        );
                      }

                      return (
                        <>
                          {visibleFolders.map(folder => (
                            <button
                              key={folder.path}
                              className={`folder-item ${selectedFolder === folder.path ? 'active' : ''}`}
                              onClick={() => setSelectedFolder(folder.path)}
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

                {/* Right Panel: Item Preview — hidden for Chats and Calendar (shown inline / in month view) */}
                {!['chats', 'calendar'].includes(activeContentType) && (
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
    </>
  );
}
