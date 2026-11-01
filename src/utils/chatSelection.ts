import type { SnapshotFolder } from '../services/snapshot';

export function initialChatSelection(folders: SnapshotFolder[], chatId: string | null, legacyFolder: string | null) {
  if (chatId) return { chatId, folder: 'all' };
  // Old links select their original stored-path subset, including ambiguity.
  if (legacyFolder && legacyFolder !== 'all') return { chatId: null, folder: legacyFolder };
  return { chatId: folders.find(folder => folder.chatId)?.chatId ?? null, folder: 'all' };
}

export function chatExportSelection(chatId: string | null | undefined, threadPath: string | null | undefined, itemIds: string[]) {
  if (chatId) return { chatId, itemIds: [] as string[] };
  if (threadPath) return { threadPath, itemIds: [] as string[] };
  return { itemIds };
}
