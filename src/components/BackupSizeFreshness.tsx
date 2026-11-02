import './BackupSizeFreshness.css';

export interface ProtectedSizeStats {
  total?: string | null;
  totalBytes?: number | null;
  oneDayChange?: string | null;
  sevenDayChange?: string | null;
  oneMonthChange?: string | null;
  allTimeTotal?: string | null;
  dailyData?: { date: string; bytes: number }[];
  dailyGrowthBytes?: number | null;
  projectedBytes1y?: number | null;
  projectedBytes3y?: number | null;
  partial?: boolean;
  stale?: boolean;
  freshness?: string;
  asOf?: string | null;
  freshCount?: number;
  staleCount?: number;
  missingCount?: number;
  eligibleCount?: number;
  initializingScope?: boolean;
  historyPartial?: boolean;
}

export function sizeNeedsRefresh(stats: ProtectedSizeStats): boolean {
  return Boolean(stats.partial || stats.stale || stats.initializingScope ||
    (stats.freshness && stats.freshness !== 'fresh') || stats.historyPartial);
}

export function sizeHeadline(stats: ProtectedSizeStats): string {
  return stats.total && stats.total !== 'Calculating' ? stats.total : 'Calculating…';
}

export function sizeProjectionAllowed(stats: ProtectedSizeStats): boolean {
  return typeof stats.totalBytes === 'number' && Number.isFinite(stats.totalBytes) && !sizeNeedsRefresh(stats);
}

export function BackupSizeFreshness({ stats }: { stats: ProtectedSizeStats }) {
  const pending = sizeNeedsRefresh(stats);
  const hasValue = Boolean(stats.total && stats.total !== 'Calculating');
  const incomplete = Boolean(stats.partial || stats.initializingScope || stats.missingCount);
  const stamp = stats.asOf ? new Date(stats.asOf) : null;
  const validStamp = stamp && Number.isFinite(stamp.getTime());
  const label = !hasValue ? 'Calculating backup size'
    : incomplete ? 'Partial last-known total'
    : pending ? 'Updating backup size' : 'Up to date';
  // Older deployments do not supply freshness fields; keep their complete display compatible.
  if (!stats.freshness && !stats.partial && !stats.stale && !stats.historyPartial) return null;
  return <div className={`backup-size-freshness${pending ? ' updating' : ''}`} role="status" aria-live="polite">
    <span>{label}</span>
    {stats.eligibleCount != null && stats.freshCount != null && pending &&
      <span>{stats.freshCount} of {stats.eligibleCount} resources up to date</span>}
    {hasValue && validStamp && <span>Includes results calculated <time dateTime={stats.asOf!}>{stamp.toLocaleString()}</time></span>}
    {stats.historyPartial && <span>Recent captured volume is temporarily unavailable.</span>}
  </div>;
}
