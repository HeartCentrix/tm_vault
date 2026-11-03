import type { ActivityItem } from '../services/activity';

const PHASE_LABELS: Record<string, string> = {
  CAPTURING: 'Capturing backup data',
  QUEUED: 'Waiting for backup processing capacity',
  RUNNING: 'Preparing backup records',
  WAITING_RESUME: 'Finalizing backup',
};

export function copyWorkProgress(item: ActivityItem) {
  const copy = item.operation === 'BACKUP' ? item.copy_work : null;
  let status = item.status;
  let message: string | undefined;
  let pending = false;
  if (copy && !['Canceled', 'Expired', 'Failed'].includes(status)) {
    message = PHASE_LABELS[copy.state];
    if (message) {
      pending = true;
      status = 'In Progress';
    } else if (copy.state === 'FAILED') {
      const captured = status === 'Partial' || (copy.committed_rows || 0) > 0 || (copy.committed_bytes || 0) > 0
        || (item.bytesDone || item.data_backed_up || 0) > 0
        || (item.counts?.done || 0) + (item.counts?.partial || 0) > 0;
      status = captured ? 'Partial' : 'Failed';
      message = captured ? 'Backup records are incomplete' : 'Backup records could not be prepared';
    }
  }
  const provider = item.operation === 'BACKUP' ? item.provider_work : null;
  if (provider && !['Canceled', 'Expired', 'Failed'].includes(item.status)) {
    const providerLabels: Record<string, string> = {
      WAITING: 'Waiting for Microsoft; backup will resume automatically',
      RUNNING: 'Capturing backup data',
      SETTLING: 'Finalizing backup',
    };
    const providerLabel = providerLabels[provider.state];
    if (providerLabel) {
      pending = true;
      status = 'In Progress';
      message = providerLabel;
    } else if (provider.state === 'INCOMPLETE' && !pending) {
      const captured = status === 'Partial' || (item.bytesDone || item.data_backed_up || 0) > 0
        || (item.counts?.done || 0) + (item.counts?.partial || 0) > 0;
      status = captured ? 'Partial' : 'Failed';
      message = 'Some backup content could not be captured';
    }
  }
  const rows = copy?.committed_rows;
  const recordLabel = rows === 1 ? 'record' : 'records';
  const records = message && rows != null && Number.isFinite(rows) && rows > 0
    ? `${rows.toLocaleString()} ${recordLabel} prepared` : undefined;
  return { status, message, pending, records };
}
