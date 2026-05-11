import vscode from 'vscode';
import { logger } from '../logger';

/**
 * Validate that the message sequence is sound BEFORE sending to DeepSeek.
 *
 * The host SHOULD always pair assistant tool_calls with a following user
 * message containing matching ToolResultParts, but in practice multi-panel
 * Copilot sessions and history truncation can break that invariant. The
 * primary purpose of this check is to surface a clear error in our logs
 * (and an actionable popup to the user) instead of a cryptic DeepSeek 400.
 *
 * Returns `null` on success, or a human-readable failure reason. Callers
 * decide whether to throw or to repair (the convert step also drops orphan
 * tool_result parts as a second line of defence).
 */
export function validateRequest(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): string | null {
  if (messages.length === 0) return 'no messages';

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]!;
    if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) continue;

    const toolCallIds = new Set<string>();
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part instanceof vscode.LanguageModelToolCallPart) {
          toolCallIds.add(part.callId);
        }
      }
    }
    if (toolCallIds.size === 0) continue;

    let nextIdx = i + 1;
    while (toolCallIds.size > 0) {
      const next = messages[nextIdx++];
      if (!next || next.role !== vscode.LanguageModelChatMessageRole.User) {
        const remaining = [...toolCallIds].join(', ');
        logger.warn(
          `validateRequest: assistant#${i} has unmatched tool_call_id(s) [${remaining}]`,
        );
        return `assistant tool_call(s) without matching user tool_result: ${remaining}`;
      }

      if (Array.isArray(next.content)) {
        for (const part of next.content) {
          if (part instanceof vscode.LanguageModelToolResultPart) {
            toolCallIds.delete(part.callId);
          }
        }
      }
    }
  }

  return null;
}
