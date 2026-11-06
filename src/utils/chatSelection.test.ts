import { describe, expect, it } from 'vitest';

describe('conversation scope', () => {
  it('restores a requested identity even when another chat has the same label', async () => {
    const { initialChatSelection } = await import('./chatSelection');
    const folders = ['a', 'b'].map(chatId => ({ chatId, path: 'chats/Same', count: 1 }));
    expect(initialChatSelection(folders, 'b', null)).toEqual({ chatId: 'b', folder: 'all' });
    expect(initialChatSelection(folders, null, null)).toEqual({ chatId: 'a', folder: 'all' });
  });

  it('keeps an old folder link as an exact subset and never picks one of its chats', async () => {
    const { initialChatSelection } = await import('./chatSelection');
    const folders = ['a', 'b'].map(chatId => ({ chatId, path: 'chats/Same', count: 1 }));
    expect(initialChatSelection(folders, null, 'chats/Same')).toEqual({ chatId: null, folder: 'chats/Same' });
  });

  it('exports a whole conversation by identity and retains explicit message subsets', async () => {
    const { chatExportSelection } = await import('./chatSelection');
    expect(chatExportSelection('b', 'chats/Same', ['visible-message'])).toEqual({ chatId: 'b', itemIds: [] });
    expect(chatExportSelection(null, null, ['chosen-message'])).toEqual({ itemIds: ['chosen-message'] });
    expect(chatExportSelection(null, 'legacy/path', [])).toEqual({ threadPath: 'legacy/path', itemIds: [] });
  });
});
