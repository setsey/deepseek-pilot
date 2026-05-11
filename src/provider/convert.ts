import vscode from 'vscode';
import type { OpenAIChatMessage } from '../types';
import { safeJsonStringify } from '../json';

export function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  reasoningContent?: string,
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];

  for (const msg of messages) {
    const role = mapRole(msg.role);

    if (msg.content && Array.isArray(msg.content)) {
      // Multi-part content — extract text parts only (images already resolved by vision proxy)
      const textParts = msg.content
        .filter((p: unknown): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
        .map((p) => p.value);
      const toolCallParts = msg.content.filter(
        (p: unknown): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart,
      );

      if (toolCallParts.length > 0) {
        result.push({
          role: 'assistant' as const,
          content: textParts.join('\n') || null,
          tool_calls: toolCallParts.map((tc) => ({
            id: tc.callId,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: safeJsonStringify(tc.input),
            },
          })),
          reasoning_content: reasoningContent,
        });
      } else {
        result.push({ role, content: textParts.join('\n') });
      }
    } else if (typeof msg.content === 'string') {
      result.push({ role, content: msg.content });
    }

    // Tool results
    if (msg.role === vscode.LanguageModelChatMessageRole.User && msg.content && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelToolResultPart) {
          result.push({
            role: 'tool',
            tool_call_id: part.callId,
            content: typeof part.content === 'string' ? part.content : safeJsonStringify(part.content),
          });
        }
      }
    }
  }

  return result;
}

function mapRole(role: vscode.LanguageModelChatMessageRole): 'system' | 'user' | 'assistant' {
  if (role === vscode.LanguageModelChatMessageRole.Assistant) return 'assistant';
  if (role === vscode.LanguageModelChatMessageRole.User) return 'user';
  return 'user';
}
