import './HealthDot.css';

export type HealthStatusValue = 'healthy' | 'degraded' | 'unhealthy';

interface Props {
  status?: HealthStatusValue | string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

const KNOWN = new Set(['healthy', 'degraded', 'unhealthy']);

/** Colored status dot (green / amber / red) for app-health surfaces.
 *  Reuses the status palette established in Settings.css. */
export default function HealthDot({ status, label, size = 'md' }: Props) {
  const s = KNOWN.has(String(status)) ? (status as HealthStatusValue) : 'unknown';
  return (
    <span className={`health-dot health-dot-${size} health-dot-${s}`}>
      <span className="health-dot-mark" aria-hidden="true" />
      {label ?? String(status ?? 'unknown')}
    </span>
  );
}
