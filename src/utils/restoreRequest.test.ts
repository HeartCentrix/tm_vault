import { describe, expect, it } from 'vitest';
import { buildRestoreRequest, getRestoreValidationError, type RestoreOptions } from './restoreRequest';

const defaults: RestoreOptions = {
  scope: 'selected', destination: 'original', originalSub: 'separate_folder',
  resourceKind: 'mailbox', isPowerBiItem: false, isPowerAppItem: false,
  isPowerFlowItem: false, isPowerDlpItem: false, isArchive: false,
  workloads: new Set(['Mail', 'Contacts']), availableWorkloads: ['Mail', 'Contacts'],
  targetResourceId: '', targetEnvironmentId: '', targetUserId: '', folderName: 'Restored by/test',
  snapshotIds: ['snapshot'], itemIds: ['item'], entraSelection: null,
};
const request = (overrides: Partial<RestoreOptions> = {}) => buildRestoreRequest({ ...defaults, ...overrides });
const validation = (overrides: Partial<RestoreOptions> = {}) => getRestoreValidationError({ ...defaults, ...overrides });

describe('restore request scope and destination', () => {
  it('keeps an empty selection explicit rather than restoring the whole snapshot', () => {
    expect(request({ itemIds: [] })).toMatchObject({ selectionScope: 'SELECTED', itemIds: [], snapshotIds: ['snapshot'] });
    expect(request()).toMatchObject({ restoreType: 'IN_PLACE', targetFolder: 'Restored by/test', overwrite: false });
  });

  it('includes exclusions only when selected folder expansion is present', () => {
    expect(request({ folderPaths: ['/Inbox'], excludedItemIds: ['excluded'] })).toMatchObject({
      folderPaths: ['/Inbox'], excludedItemIds: ['excluded'],
    });
    expect(request({ folderPaths: [], excludedItemIds: ['excluded'] }).excludedItemIds).toBeUndefined();
    expect(request({ scope: 'full', folderPaths: ['/Inbox'], excludedItemIds: ['excluded'] })).toMatchObject({
      selectionScope: 'ALL', itemIds: [], workloads: ['Mail', 'Contacts'], folderPaths: undefined, excludedItemIds: undefined,
    });
  });

  it('uses Archive for selected and whole-snapshot archive restores', () => {
    expect(request({ isArchive: true }).workloads).toEqual(['Archive']);
    expect(request({ isArchive: true, scope: 'full' }).workloads).toEqual(['Archive']);
  });

  it('routes another mailbox through CROSS_USER without applying folder or overwrite options', () => {
    expect(request({ destination: 'another', targetUserId: 'target', originalSub: 'overwrite' })).toMatchObject({
      restoreType: 'CROSS_USER', targetUserId: 'target', targetResourceId: undefined, targetFolder: undefined, overwrite: false,
    });
  });

  it('routes another SharePoint site through CROSS_RESOURCE and retains placement options', () => {
    expect(request({ resourceKind: 'sharepoint_site', destination: 'another', targetUserId: 'site' })).toMatchObject({
      restoreType: 'CROSS_RESOURCE', targetResourceId: 'site', targetUserId: undefined, targetFolder: 'Restored by/test',
    });
    expect(request({ resourceKind: 'sharepoint_site', scope: 'full', originalSub: 'overwrite' })).toMatchObject({
      workloads: undefined, targetFolder: undefined, overwrite: true,
    });
  });

  it('retains destination folder and overwrite choices for cross-user OneDrive restores', () => {
    expect(request({ resourceKind: 'onedrive', destination: 'another', targetUserId: 'drive' }).targetFolder).toBe('Restored by/test');
    expect(request({ resourceKind: 'onedrive', destination: 'another', targetUserId: 'drive', originalSub: 'overwrite' }).overwrite).toBe(true);
  });

  it('keeps Power BI workspace and Power Platform environment routing distinct', () => {
    expect(request({ isPowerBiItem: true, destination: 'another', targetResourceId: 'workspace' })).toMatchObject({
      restoreType: 'IN_PLACE', targetResourceId: 'workspace', targetUserId: undefined, targetFolder: undefined, overwrite: false,
    });
    for (const kind of ['isPowerAppItem', 'isPowerFlowItem'] as const) {
      expect(request({ [kind]: true, destination: 'another', targetEnvironmentId: 'environment' })).toMatchObject({
        restoreType: 'IN_PLACE', targetEnvironmentId: 'environment', targetUserId: undefined, targetFolder: undefined, overwrite: false,
      });
    }
    expect(request({ isPowerDlpItem: true, destination: 'another' })).toMatchObject({
      restoreType: 'IN_PLACE', targetEnvironmentId: undefined, targetUserId: undefined, workloads: undefined,
    });
  });

  it('preserves Entra selected and directory modes without ordinary workload scope', () => {
    const entraSelection = { recoverMode: 'directory' as const, sections: ['users'], includeGroupMembership: true, includeAuMembership: false };
    expect(request({ resourceKind: 'entra_directory', entraSelection })).toEqual({
      restoreType: 'IN_PLACE', snapshotIds: ['snapshot'], itemIds: [], recoverMode: 'directory', entraSections: ['users'],
      includeGroupMembership: true, includeAuMembership: false,
    });
    expect(request({ resourceKind: 'entra_directory', entraSelection: { ...entraSelection, recoverMode: 'selected' } })).toMatchObject({
      itemIds: ['item'], recoverMode: 'selected', entraSections: undefined,
    });
  });
});

describe('restore validation', () => {
  it('checks workload selection before target selection', () => {
    expect(validation({ scope: 'full', workloads: new Set(), destination: 'another' })).toBe('Select at least one workload to restore (Mail, Contacts).');
    expect(validation({ scope: 'selected', workloads: new Set() })).toBeUndefined();
    for (const override of [{ resourceKind: 'sharepoint_site' }, { isPowerBiItem: true }, { isPowerAppItem: true }, { isPowerFlowItem: true }, { isPowerDlpItem: true }]) {
      expect(validation({ scope: 'full', workloads: new Set(), ...override })).toBeUndefined();
    }
  });

  it.each([
    [{ isPowerBiItem: true }, 'Please select a target Power BI workspace'],
    [{ isPowerAppItem: true }, 'Please select a target environment'],
    [{ isPowerFlowItem: true }, 'Please select a target environment'],
    [{ resourceKind: 'sharepoint_site' }, 'Please select a target SharePoint site'],
    [{ resourceKind: 'mailbox' }, 'Please enter a target resource ID'],
  ])('requires the correct target for %o', (override, message) => {
    expect(validation({ destination: 'another', targetUserId: ' ', targetResourceId: ' ', targetEnvironmentId: ' ', ...override })).toBe(message);
    expect(validation({ destination: 'another', targetUserId: 'user', targetResourceId: 'site', targetEnvironmentId: 'env', ...override })).toBeUndefined();
  });

  it('does not require another destination for in-place or tenant-scoped DLP restore', () => {
    expect(validation()).toBeUndefined();
    expect(validation({ isPowerDlpItem: true, destination: 'another' })).toBeUndefined();
  });
});
