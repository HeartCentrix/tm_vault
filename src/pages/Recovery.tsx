import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { SnapshotService, type SnapshotItem, type SnapshotFolder, type ResourceWithBackups, type CalendarEvent } from '../services/snapshot';
import { RecoveryService, type RecoveryItem } from '../services/recovery';
import { RestoreModal } from '../components/RestoreModal';
import { API } from '../config/api';
import './Recovery.css';

type ContentType = string;

function formatContentTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    'USER_PROFILE': 'User Profile',
    'ONEDRIVE': 'OneDrive',
    'POWER_BI_WORKSPACE': 'Workspace Metadata',
    'POWER_BI_REPORT': 'Reports',
    'POWER_BI_PAGINATED_REPORT': 'Paginated Reports',
    'POWER_BI_SEMANTIC_MODEL': 'Semantic Models',
    'POWER_BI_DATAFLOW': 'Dataflows',
    'POWER_BI_DASHBOARD': 'Dashboards',
    'POWER_BI_TILE': 'Dashboard Tiles',
    'POWER_BI_DATASOURCE': 'Datasource Metadata',
    'POWER_BI_REFRESH_SCHEDULE': 'Refresh Schedules',
    'POWER_BI_PERMISSIONS': 'Permissions',
    'POWER_BI_LINEAGE': 'Lineage',
  };
  
  if (labels[type]) return labels[type];
  
  // Convert to title case: replace underscores with spaces, capitalize first letter, lowercase rest
  return type
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

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
  const attachments: any[] = raw.attachments || [];
  const subject = raw.subject || item.subject || item.name || '(No subject)';
  const bodyContent = raw.body?.content || item.body || item.preview || '';
  const isHtml = raw.body?.contentType === 'html';
  const sentAt = raw.sentDateTime || raw.receivedDateTime || item.date;
  const fromStr = [from.name, from.address ? `<${from.address}>` : ''].filter(Boolean).join(' ') || item.from || '—';
  const toStr = toList.map((r: any) => { const e = r.emailAddress || {}; return e.name ? `${e.name} <${e.address}>` : (e.address || ''); }).join('; ');

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
          {(attachments.length > 0 || raw.hasAttachments) && (
            <div className="email-ol-attachments">
              <svg viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" style={{width:13,height:13,flexShrink:0}}>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
              {attachments.length > 0
                ? attachments.map((a: any, i: number) => <span key={i} className="email-ol-attach-chip">{a.name || 'Attachment'}</span>)
                : <span className="email-ol-attach-chip">Has attachments</span>
              }
            </div>
          )}
        </div>
        {sentAt && (
          <div className="email-ol-date">
            {new Date(sentAt).toLocaleString('en-US', {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true})}
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
  const bodyContent = raw.body?.content || (item as any).body || item.body || item.preview || '';
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
            {sentAt && <span className="chat-time">{new Date(sentAt).toLocaleString()}</span>}
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

  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;

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

function ChatItemRow({ item, selected, onSelect, onCheck }: {
  item: any; selected: boolean;
  onSelect: () => void; onCheck: (e: React.MouseEvent) => void;
}) {
  const raw = item.metadata?.raw || {};
  const sender = raw.from?.user?.displayName || raw.from?.application?.displayName || item.name || 'Unknown';
  const senderEmail = item.metadata?.senderEmail || raw.from?.user?.email || raw.from?.user?.userPrincipalName || '';
  const initials = sender.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
  const body = raw.body?.content || item.preview || item.body || '';
  const isHtml = raw.body?.contentType === 'html';
  const sentAt = raw.createdDateTime || item.date;
  const displayBody = isHtml ? body.replace(/<[^>]+>/g, ' ').trim() : body;

  return (
    <div className={`chat-item-row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <input type="checkbox" checked={false} onChange={() => {}} onClick={onCheck} />
      <div className="chat-item-avatar">{initials}</div>
      <div className="chat-item-body">
        <div className="chat-item-header">
          <span className="chat-item-sender">{sender}{senderEmail && senderEmail !== sender ? ` <${senderEmail}>` : ''}</span>
          {sentAt && (
            <span className="chat-item-time">
              {new Date(sentAt).toLocaleString('en-US', {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true})}
            </span>
          )}
        </div>
        <div className="chat-item-text">{displayBody || '\u00a0'}</div>
      </div>
    </div>
  );
}

function EmailItemRow({ item, selected, onSelect, onCheck }: {
  item: any; selected: boolean;
  onSelect: () => void; onCheck: (e: React.MouseEvent) => void;
}) {
  const raw = item.metadata?.raw || {};
  const from = raw.from?.emailAddress || {};
  const sender = from.name || from.address || item.from || item.name || '(Unknown)';
  const subject = raw.subject || item.subject || item.name || '(No subject)';
  const preview = raw.bodyPreview || item.preview || '';
  const sentAt = raw.sentDateTime || raw.receivedDateTime || item.date;
  const dateStr = sentAt
    ? new Date(sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className={`email-item-row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <input type="checkbox" checked={false} onChange={() => {}} onClick={onCheck} />
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
  if (type === 'EMAIL') return <EmailPreview item={item} />;
  if (type === 'TEAMS_CHAT_MESSAGE' || type === 'TEAMS_MESSAGE' || type === 'TEAMS_MESSAGE_REPLY')
    return <ChatPreview item={item} />;
  if (type === 'CALENDAR_EVENT') return <CalendarPreview item={item} />;

  // Generic fallback
  return (
    <div className="item-preview">
      <div className="preview-header">
        {item.from && <div className="preview-from"><span className="label">From:</span><span className="value">{item.from}</span></div>}
        {item.to && <div className="preview-to"><span className="label">To:</span><span className="value">{item.to}</span></div>}
        <div className="preview-status">{item.subject || item.name}</div>
        {item.date && <div className="preview-date">{new Date(item.date).toLocaleString()}</div>}
      </div>
      <div className="preview-body"><p>{item.body || item.preview || 'No content available'}</p></div>
    </div>
  );
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
          if (first?.start) setViewDate(new Date(first.start));
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

  // Group visible events by day
  const eventsByDay: Record<number, CalendarEvent[]> = {};
  visibleEvents.forEach(ev => {
    if (!ev.start) return;
    const d = new Date(ev.start);
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
    const d = new Date(e.start);
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
          {cells.map((day, i) => (
            <div key={i} className={`cal-day-cell${!day ? ' cal-day-empty' : ''}${day && isToday(day) ? ' cal-day-today' : ''}`}>
              {day && (
                <>
                  <span className="cal-day-number">{day}</span>
                  <div className="cal-day-events">
                    {(eventsByDay[day] || []).slice(0, 4).map(ev => {
                      const color = EVENT_TYPE_COLORS[ev.eventType] || '#16a34a';
                      const isChecked = selectedItems.has(ev.id);
                      return (
                        <div
                          key={ev.id}
                          className={`cal-event-chip${isChecked ? ' checked' : ''}`}
                          style={{'--chip-color': color} as React.CSSProperties}
                          title={ev.subject}
                        >
                          <input
                            type="checkbox"
                            className="cal-event-check"
                            checked={isChecked}
                            onChange={() => onItemCheck(ev.id)}
                            onClick={e => e.stopPropagation()}
                          />
                          <span className="cal-event-name">{ev.subject}</span>
                        </div>
                      );
                    })}
                    {(eventsByDay[day]?.length ?? 0) > 4 && (
                      <div className="cal-event-overflow">+{eventsByDay[day].length - 4} more</div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Recovery() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // Dynamic content types from snapshot items
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [contentTypesLoading, setContentTypesLoading] = useState(false);
  const [activeContentType, setActiveContentType] = useState<ContentType>('');

  // Resource selection
  const [resources, setResources] = useState<ResourceWithBackups[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resourceSearch, setResourceSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [showKindFilter, setShowKindFilter] = useState(false);
  const [selectedResource, setSelectedResource] = useState<ResourceWithBackups | null>(null);

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
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemCount, setItemCount] = useState(0);
  const [itemPage, setItemPage] = useState(1);
  const [itemTotalPages, setItemTotalPages] = useState(1);
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

  // Load snapshots for selected resource
  useEffect(() => {
    if (!selectedResource) {
      setSnapshots([]);
      setSelectedSnapshotId('');
      return;
    }

    setSnapshotsLoading(true);
    SnapshotService.listByResource(selectedResource.id, 1, 50)
      .then((data) => {
        setSnapshots(data.content);
        if (data.content.length > 0) {
          const snapshotParam = searchParams.get('snapshotId');
          const initial = snapshotParam && data.content.find(s => s.id === snapshotParam)
            ? snapshotParam
            : data.content[0].id;
          setSelectedSnapshotId(initial);
        } else {
          setSelectedSnapshotId('');
        }
      })
      .catch(console.error)
      .finally(() => setSnapshotsLoading(false));
  }, [selectedResource]);

  // Load content types for selected snapshot
  useEffect(() => {
    if (!selectedSnapshotId) {
      setContentTypes([]);
      setActiveContentType('');
      return;
    }

    setContentTypesLoading(true);
    SnapshotService.getContentTypes(selectedSnapshotId)
      .then((types) => {
        setContentTypes(types);
        if (types.length > 0) {
          setActiveContentType(types[0]);
        }
      })
      .catch(console.error)
      .finally(() => setContentTypesLoading(false));
  }, [selectedSnapshotId]);

  // Load recovery items with server-side pagination
  useEffect(() => {
    if (!selectedSnapshotId || !selectedResource || !activeContentType) {
      setRecoveryItems([]);
      setItemCount(0);
      setItemTotalPages(1);
      return;
    }

    const pageSize = activeContentType === 'CALENDAR_EVENT' ? 500 : 50;
    setItemsLoading(true);
    SnapshotService.listItems(selectedSnapshotId, itemPage, pageSize, activeContentType)
      .then((data) => {
        setRecoveryItems(data.content);
        setItemCount(data.totalElements);
        setItemTotalPages(data.totalPages || 1);
      })
      .catch((error) => {
        console.error('Failed to load items:', error);
        setRecoveryItems([]);
      })
      .finally(() => setItemsLoading(false));
  }, [selectedSnapshotId, selectedResource, activeContentType, itemPage]);

  // Reset item page when content type or snapshot changes
  useEffect(() => { setItemPage(1); setSelectedItem(null); }, [selectedSnapshotId, activeContentType]);

  // Load folders for selected snapshot (all folders, not filtered by content type)
  useEffect(() => {
    if (!selectedSnapshotId) {
      setFolders([]);
      setSelectedFolder('all');
      return;
    }

    setFoldersLoading(true);
    // Load folders without contentType filter to show all available folders
    SnapshotService.getFolders(selectedSnapshotId)
      .then((data) => {
        const folderList = [{ path: '', count: data.reduce((sum, f) => sum + f.count, 0) }, ...data];
        setFolders(folderList);
        setSelectedFolder('all');
      })
      .catch(console.error)
      .finally(() => setFoldersLoading(false));
  }, [selectedSnapshotId]);



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

  const handleSnapshotChange = (snapshotId: string) => {
    setSelectedSnapshotId(snapshotId);
    setSelectedItem(null);
    setSelectedItems(new Set());
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
            // Fetch with auth header and trigger download via blob URL
            const dlRes = await fetch(`${API.BASE_URL}/exports/${jobId}/download`, { headers });
            if (!dlRes.ok) throw new Error('Download failed');
            const blob = await dlRes.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `export-${jobId.slice(0, 8)}.json`;
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
              // Group resources by kind
              const groups: Record<string, typeof filteredResources> = {};
              filteredResources.forEach(r => {
                const k = getKindLabel(r.kind);
                if (!groups[k]) groups[k] = [];
                groups[k].push(r);
              });
              return Object.entries(groups).map(([kindLabel, items]) => (
                <div key={kindLabel}>
                  <div className="resource-group-header">{kindLabel}</div>
                  {items.map(resource => (
              <button
                key={resource.id}
                className={`resource-list-item ${selectedResource?.id === resource.id ? 'selected' : ''}`}
                onClick={() => handleResourceSelect(resource)}
              >
                <div className="resource-avatar-sm">{getInitials(resource.name)}</div>
                <div className="resource-list-info">
                  <div className="resource-list-name">{resource.name}</div>
                  {resource.email && <div className="resource-list-email">{resource.email}</div>}
                  <div className="resource-list-meta">
                    <span>{resource.snapshot_count} snapshot{resource.snapshot_count !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </button>
            ))}
                </div>
              ));
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
                        {new Date(selectedResource.last_backup_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, {new Date(selectedResource.last_backup_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </span>
                    </div>
                  )}
                </div>

                <div className="header-stats">
                  <div className="stats-box">
                    <div className="stats-label">Backup size</div>
                    <div className="stats-value">{formatSize(selectedResource.storage_bytes)}</div>
                    <div className="stats-legend">
                      <span>{selectedResource.snapshot_count} snapshot{selectedResource.snapshot_count !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>{selectedResource.total_items.toLocaleString()} total items</span>
                    </div>
                  </div>

                  <div className="backup-version-selector">
                    <label>Backup version</label>
                    <select
                      value={selectedSnapshotId}
                      onChange={(e) => handleSnapshotChange(e.target.value)}
                      disabled={snapshotsLoading}
                    >
                      {snapshotsLoading && <option>Loading...</option>}
                      {snapshots.map(snapshot => (
                        <option key={snapshot.id} value={snapshot.id}>
                          {new Date(snapshot.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {snapshot.label ? ` — ${snapshot.label}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Content Type Tabs */}
              <div className="content-type-tabs">
                {contentTypesLoading ? (
                  <div className="tabs-loading">
                    <div className="spinner-sm" />
                    Loading content types...
                  </div>
                ) : contentTypes.length === 0 ? (
                  <div className="tabs-empty">No content types found</div>
                ) : (
                  contentTypes.map(type => (
                    <button
                      key={type}
                      className={`content-tab ${activeContentType === type ? 'active' : ''}`}
                      onClick={() => setActiveContentType(type)}
                    >
                      {formatContentTypeLabel(type)}
                    </button>
                  ))
                )}
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
                    disabled={selectedItems.size === 0 || downloading}
                  >
                    {downloading ? 'Preparing...' : `Download${selectedItems.size > 0 ? ` (${selectedItems.size})` : ''}`}
                  </button>
                  <button
                    className="action-button recover"
                    onClick={handleRecover}
                    disabled={selectedItems.size === 0}
                  >
                    Recover{selectedItems.size > 0 ? ` (${selectedItems.size})` : ''}
                  </button>
                </div>
              </div>

              {/* Three Panel Layout */}
              <div className={`three-panel-layout${activeContentType === 'CALENDAR_EVENT' ? ' cal-layout-mode' : ''}`}>
                {activeContentType === 'CALENDAR_EVENT' ? (
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
                {/* Left Panel: Folder Tree */}
                <div className="panel-left">
                  <div className="folder-list">
                    <button
                      className={`folder-item ${selectedFolder === 'all' ? 'active' : ''}`}
                      onClick={() => setSelectedFolder('all')}
                    >
                      <span className="folder-name">All</span>
                    </button>
                    {foldersLoading && (
                      <div className="folder-loading">
                        <div className="spinner-sm" />
                      </div>
                    )}
                    {folders.filter(f => f.path).map(folder => (
                      <button
                        key={folder.path}
                        className={`folder-item ${selectedFolder === folder.path ? 'active' : ''}`}
                        onClick={() => setSelectedFolder(folder.path)}
                      >
                        <span className="folder-name">{folder.path}</span>
                        {folder.count > 0 && <span className="folder-count">{folder.count}</span>}
                      </button>
                    ))}
                    {!foldersLoading && folders.filter(f => f.path).length === 0 && (
                      <div className="folder-empty">
                        <p>No folders found</p>
                      </div>
                    )}
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
                      {selectedItems.size > 0 ? `${selectedItems.size} / ${itemCount} selected` : `Items: ${itemCount}`}
                    </span>
                    <div className="item-pagination">
                      <button className="pagination-btn" disabled={itemPage <= 1} onClick={() => setItemPage(p => p - 1)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><polyline points="15 18 9 12 15 6" /></svg>
                      </button>
                      <span className="pagination-page">{itemPage} / {itemTotalPages}</span>
                      <button className="pagination-btn" disabled={itemPage >= itemTotalPages} onClick={() => setItemPage(p => p + 1)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><polyline points="9 18 15 12 9 6" /></svg>
                      </button>
                    </div>
                  </div>

                  <div className="item-list">
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
                        const CHAT_TYPES = new Set(['TEAMS_CHAT_MESSAGE', 'TEAMS_MESSAGE', 'TEAMS_MESSAGE_REPLY']);
                        const isChatContentType = CHAT_TYPES.has(activeContentType);
                        const isEmailType = activeContentType === 'EMAIL';
                        return recoveryItems.map(item => {
                          const isChatItem = isChatContentType || CHAT_TYPES.has(item.itemType || '');
                          const isEmailItem = isEmailType || item.itemType === 'EMAIL';
                          return isChatItem ? (
                          <ChatItemRow
                            key={item.id}
                            item={item}
                            selected={selectedItem?.id === item.id}
                            onSelect={() => handleItemSelect(item)}
                            onCheck={(e) => { e.stopPropagation(); toggleSelectItem(item.id); }}
                          />
                        ) : isEmailItem ? (
                          <EmailItemRow
                            key={item.id}
                            item={item}
                            selected={selectedItem?.id === item.id}
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
                            {item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                          </div>
                        </div>
                        );
                        });
                      })()
                    )}
                  </div>
                </div>
                  </>
                )}

                {/* Right Panel: Item Preview — hidden for Teams chat and Calendar (shown inline / in month view) */}
                {!['TEAMS_CHAT_MESSAGE', 'TEAMS_MESSAGE', 'TEAMS_MESSAGE_REPLY', 'CALENDAR_EVENT'].includes(activeContentType) && (
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
