/**
 * Pure decisions behind the Activity tab's Retry button.
 *
 * Kept free of React and of `fetch` so both rules can be tested directly —
 * they are the kind of logic that regresses silently, because a wrong
 * answer here is invisible (a button that quietly stops appearing) rather
 * than loud (a crash).
 */

/** The row-level status the Activity feed renders. */
export type ActivityStatus =
  | 'Done' | 'In Progress' | 'Failed' | 'Canceled' | 'Warning' | 'Partial' | 'Expired';

export interface RetryEligibleItem {
  status: ActivityStatus;
  batchId?: string;
  /** Single-resource rows (auto-retries, manual triggers) have job ids
   *  but no batch — they retry via POST /jobs/{id}/retry instead. */
  jobIds?: string[];
  counts?: {
    total: number;
    done: number;
    partial: number;
    failed: number;
    in_progress: number;
    queued: number;
  };
}

/** Snapshot statuses that mean "this resource is terminal but incomplete". */
const INCOMPLETE_CHILD_STATUSES = new Set(['PARTIAL', 'FAILED']);

/** Row statuses that mean the run finished without capturing everything. */
const INCOMPLETE_ROW_STATUSES = new Set<ActivityStatus>([
  'Failed',
  'Partial',
  'Warning',   // Done-with-warnings: some children degraded
  'Canceled',  // stopped early — also "did not fully complete"
]);

/**
 * Should the Retry button render for this row?
 *
 * Two conditions, both required:
 *
 *  1. The run is TERMINAL. `In Progress` is excluded deliberately — that
 *     slot already carries the Cancel button, and offering "retry" for
 *     something still running invites a duplicate dispatch of work that
 *     has not finished failing yet.
 *  2. Something in it did not complete — either the rolled-up row status
 *     says so, or the per-child counters do. The counters are checked as
 *     well as the status because a row can roll up to `Done` while still
 *     carrying degraded children.
 *
 * A row with no `batchId` is never eligible: without a batch there are no
 * children to enumerate, so there is nothing specific to retry and we
 * would be guessing at the target.
 */
export function shouldShowRetry(item: RetryEligibleItem): boolean {
  // A single-resource row (no batch) is retryable through its job id —
  // hiding the button here was why auto-retry/manual failure rows had a
  // Retry that "did not work" (2026-08-18).
  if (!item.batchId && !(item.jobIds && item.jobIds.length)) return false;
  if (item.status === 'In Progress') return false;

  const c = item.counts;
  const countsSayIncomplete = !!c && (c.partial > 0 || c.failed > 0);

  return INCOMPLETE_ROW_STATUSES.has(item.status) || countsSayIncomplete;
}

/**
 * How many resources a single Retry click may dispatch.
 *
 * Two is deliberate and learned the hard way. On 2026-08-17 a click on a
 * degraded Gold run dispatched all six incomplete resources at once —
 * four large chat mailboxes, a mail mailbox and a SharePoint site. Every
 * one of them started walking simultaneously, backend connections hit
 * 262, and the activity query itself then died on the 120s pgbouncer
 * wait: the Activity page went blank because of a button whose entire
 * purpose is recovering from failures.
 *
 * The dispatch loop is already sequential, but that only paces the
 * *trigger* calls — once queued, the scheduler runs them concurrently.
 * Bounding the number queued per click is the only thing that bounds the
 * concurrent load.
 *
 * The remainder is not dropped: the caller reports how many are left and
 * the operator clicks again. Slower, and it cannot take the UI down.
 */
export const RETRY_DISPATCH_LIMIT = 2;

export interface RetryTargetNode {
  resourceId: string;
  displayName?: string;
  status?: string;
  children?: RetryTargetNode[];
}

/**
 * Collect the resource ids worth re-running from a batch's child tree.
 *
 * Only `PARTIAL` and `FAILED` are targeted. `IN_PROGRESS` is excluded on
 * purpose: dispatching a resource that already holds a live lease makes
 * the scheduler's cross-job concurrency guard write a
 * `skipped_concurrent` placeholder — a snapshot that settles COMPLETED
 * with zero items. Retrying into that produces a row that reports
 * success while capturing nothing, which is worse than not retrying.
 *
 * The tree is walked to any depth (Tier-1 users carry Tier-2 workload
 * children) and ids are de-duplicated, since the same resource can be
 * reached twice in a malformed payload. Order is preserved so the caller
 * dispatches in the order the operator sees on screen.
 */
export function collectIncompleteResourceIds(
  nodes: RetryTargetNode[] | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const walk = (list: RetryTargetNode[] | undefined) => {
    if (!list) return;
    for (const n of list) {
      const status = (n.status || '').toUpperCase();
      if (
        n.resourceId &&
        INCOMPLETE_CHILD_STATUSES.has(status) &&
        !seen.has(n.resourceId)
      ) {
        seen.add(n.resourceId);
        out.push(n.resourceId);
      }
      walk(n.children);
    }
  };

  walk(nodes);
  return out;
}
