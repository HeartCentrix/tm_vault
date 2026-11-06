import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapshotService } from './snapshot';

afterEach(() => vi.unstubAllGlobals());

describe('captured chat selection', () => {
  it('loads a conversation by ID with exact captured presentation', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [] })));
    vi.stubGlobal('fetch', fetcher);
    await SnapshotService.listItems('snapshot', 1, 50, 'chats', undefined, undefined, undefined, 'chat/#?A');
    const url = new URL(fetcher.mock.calls[0][0], 'https://vault.invalid');
    expect(url.searchParams.get('chatId')).toBe('chat/#?A');
    expect(url.searchParams.get('folder')).toBeNull();
    expect(url.searchParams.get('presentation')).toBe('true');
  });

  it('keeps equal conversation labels distinct through paginated groups', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: ['chat-a', 'chat-b'].map(chatId => ({ chatId, displayName: 'Planning',
        folderPath: 'chats/Planning', count: 2 })), total: 6, page: 2, size: 2, hasMore: true,
    })));
    vi.stubGlobal('fetch', fetcher);
    const result = await SnapshotService.getFolders('snapshot', 'TEAMS_CHAT_MESSAGE', 2, 2);
    expect(String(fetcher.mock.calls[0][0])).toContain('/chats/groups');
    expect(result.content.map(row => row.chatId)).toEqual(['chat-a', 'chat-b']);
    expect(result.content.map(row => row.path)).toEqual(['chats/Planning', 'chats/Planning']);
    expect(result.hasMore).toBe(true);
  });

  it('explains an ambiguous old folder link instead of showing an empty backup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: { error: 'AMBIGUOUS_CHAT_PATH' },
    }), { status: 400 })));
    await expect(SnapshotService.listItems('snapshot', 1, 50, 'chats', 'chats/Same'))
      .rejects.toThrow('Several conversations have this name');
  });
});
