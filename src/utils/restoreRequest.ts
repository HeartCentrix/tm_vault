import type { EntraRestoreSelection } from '../components/EntraRestoreForm';
import type { RestoreRequest, RestoreType } from '../services/restore';

export interface RestoreOptions {
  scope: 'selected' | 'full';
  destination: 'original' | 'another';
  originalSub: 'separate_folder' | 'overwrite';
  resourceKind?: string;
  isPowerBiItem: boolean;
  isPowerAppItem: boolean;
  isPowerFlowItem: boolean;
  isPowerDlpItem: boolean;
  isArchive: boolean;
  workloads: ReadonlySet<string>;
  availableWorkloads: readonly string[];
  targetResourceId: string;
  targetEnvironmentId: string;
  targetUserId: string;
  folderName: string;
  snapshotIds: string[];
  itemIds: string[];
  folderPaths?: string[];
  excludedItemIds?: string[];
  entraSelection: EntraRestoreSelection | null;
}

function isPowerPlatform(options: RestoreOptions): boolean {
  return options.isPowerAppItem || options.isPowerFlowItem || options.isPowerDlpItem;
}

function usesMailboxWorkloads(options: RestoreOptions): boolean {
  return !options.isPowerBiItem && !isPowerPlatform(options) && options.resourceKind !== 'sharepoint_site';
}

function targetValidationError(options: RestoreOptions): string | undefined {
  if (options.destination !== 'another') return undefined;
  if (options.isPowerBiItem) {
    return options.targetResourceId.trim() ? undefined : 'Please select a target Power BI workspace';
  }
  if (options.isPowerAppItem || options.isPowerFlowItem) {
    return options.targetEnvironmentId.trim() ? undefined : 'Please select a target environment';
  }
  // DLP is tenant-scoped; only in-place restore is meaningful.
  if (options.isPowerDlpItem || options.targetUserId.trim()) return undefined;
  return options.resourceKind === 'sharepoint_site'
    ? 'Please select a target SharePoint site'
    : 'Please enter a target resource ID';
}

export function getRestoreValidationError(options: RestoreOptions): string | undefined {
  if (options.scope === 'full' && usesMailboxWorkloads(options) && options.workloads.size === 0) {
    return `Select at least one workload to restore (${options.availableWorkloads.join(', ')}).`;
  }
  return targetValidationError(options);
}

function restoreTarget(options: RestoreOptions): Pick<RestoreRequest,
  'restoreType' | 'targetUserId' | 'targetResourceId' | 'targetEnvironmentId'> {
  const another = options.destination === 'another';
  const sharepoint = options.resourceKind === 'sharepoint_site';
  let restoreType: RestoreType = 'IN_PLACE';
  if (!options.isPowerBiItem && !isPowerPlatform(options) && another) {
    restoreType = sharepoint ? 'CROSS_RESOURCE' : 'CROSS_USER';
  }
  let targetResourceId: string | undefined;
  if (another && options.isPowerBiItem) targetResourceId = options.targetResourceId;
  else if (another && sharepoint) targetResourceId = options.targetUserId;
  return {
    restoreType,
    targetUserId: another && usesMailboxWorkloads(options) ? options.targetUserId : undefined,
    targetResourceId,
    targetEnvironmentId: another && (options.isPowerAppItem || options.isPowerFlowItem)
      ? options.targetEnvironmentId : undefined,
  };
}

function restorePlacement(options: RestoreOptions): Pick<RestoreRequest, 'targetFolder' | 'overwrite'> {
  const supportsPlacement = !options.isPowerBiItem && !isPowerPlatform(options)
    && (options.destination === 'original'
      || (options.destination === 'another'
        && (options.resourceKind === 'onedrive' || options.resourceKind === 'sharepoint_site')));
  return {
    targetFolder: supportsPlacement && options.originalSub === 'separate_folder' ? options.folderName : undefined,
    overwrite: supportsPlacement && options.originalSub === 'overwrite',
  };
}

function restoreScope(options: RestoreOptions): Pick<RestoreRequest,
  'selectionScope' | 'itemIds' | 'folderPaths' | 'excludedItemIds' | 'workloads'> {
  const selected = options.scope === 'selected';
  const folderPaths = selected && options.folderPaths?.length ? options.folderPaths : undefined;
  let workloads: string[] | undefined;
  // Archive rows must not be filtered out by a full-scope restore.
  if (options.isArchive) workloads = ['Archive'];
  else if (!selected && usesMailboxWorkloads(options)) workloads = Array.from(options.workloads);
  return {
    // An explicit empty selection must never become a whole-snapshot restore.
    selectionScope: selected ? 'SELECTED' : 'ALL',
    itemIds: selected ? options.itemIds : [],
    folderPaths,
    // Exclusions only apply to folder expansion, not standalone item selection.
    excludedItemIds: folderPaths && options.excludedItemIds?.length ? options.excludedItemIds : undefined,
    workloads,
  };
}

export function buildRestoreRequest(options: RestoreOptions): RestoreRequest {
  const selection = options.entraSelection;
  if (options.resourceKind === 'entra_directory' && selection) {
    return {
      restoreType: 'IN_PLACE',
      snapshotIds: options.snapshotIds,
      itemIds: selection.recoverMode === 'selected' ? options.itemIds : [],
      recoverMode: selection.recoverMode,
      entraSections: selection.recoverMode === 'directory' ? selection.sections : undefined,
      includeGroupMembership: selection.includeGroupMembership,
      includeAuMembership: selection.includeAuMembership,
    };
  }
  return {
    snapshotIds: options.snapshotIds,
    ...restoreTarget(options),
    ...restoreScope(options),
    ...restorePlacement(options),
  };
}
