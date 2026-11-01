const messages: Record<string, string> = {
  AMBIGUOUS_CHAT_PATH: 'Several conversations have this name. Select a conversation and try again.',
  MULTI_THREAD_NOT_SUPPORTED_YET: 'Select messages from one conversation.',
  CHAT_NOT_IN_SNAPSHOT: 'This conversation is not present in the selected backup.',
  CHAT_ALIAS_MISMATCH: 'Refresh the backup view and select the conversation again.',
  AMBIGUOUS_CAPTURE_VERSIONS: 'These backups contain different conversation versions. Select one backup.',
  CHAT_IDENTITY_UNAVAILABLE: 'Some saved chat records cannot be linked safely. Contact support.',
  CHAT_CHILD_IDENTITY_UNAVAILABLE: 'Some saved attachments cannot be linked safely. Contact support.',
  CHAT_PRESENTATION_INTEGRITY_GAP: 'The saved conversation details need attention. Contact support.',
};

export async function chatScopeError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(messages[body?.detail?.error ?? body?.error] ?? `${fallback} (${response.status})`);
}
