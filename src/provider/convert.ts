import vscode from 'vscode';
import type { OpenAIChatMessage } from '../types';
import { safeJsonStringify } from '../json';
import { fingerprintAssistantTurn, type ReasoningCache } from './cache';

export function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  isThinkingModel: boolean,
  reasoningCache: ReasoningCache,
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];

  for (const msg of messages) {
    const role = mapRole(msg.role);
    let content = typeof msg.content === 'string' ? msg.content : '';
    const toolCalls: NonNullable<OpenAIChatMessage['tool_calls']> = [];
    const toolResults: Array<{ callId: string; content: string }> = [];

    if (msg.content && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          content = content ? `${content}\n${part.value}` : part.value;
          continue;
        }

        if (part instanceof vscode.LanguageModelToolCallPart) {
          toolCalls.push({
            id: part.callId,
            type: 'function',
            function: {
              name: part.name,
              arguments: safeJsonStringify(part.input),
            },
          });
          continue;
        }

        if (part instanceof vscode.LanguageModelToolResultPart) {
          const toolContent = part.content
            .filter((item): item is vscode.LanguageModelTextPart => item instanceof vscode.LanguageModelTextPart)
            .map((item) => item.value)
            .join('\n');

          toolResults.push({
            callId: part.callId,
            content: toolContent || safeJsonStringify(part.content),
          });
        }
      }
    }

    if (role === 'assistant') {
      if (content || toolCalls.length > 0) {
        const assistantMessage: OpenAIChatMessage = {
          role: 'assistant',
          content: content || '',
        };

        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }

        if (isThinkingModel) {
          const fingerprint = fingerprintAssistantTurn({
            text: content,
            toolCalls: toolCalls.map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.function.name,
            })),
          });

          if (fingerprint) {
            assistantMessage.reasoning_content = reasoningCache.get(fingerprint) ?? '';
          }
        }

        result.push(assistantMessage);
      }
    } else if (content) {
      result.push({ role, content });
    }

    for (const toolResult of toolResults) {
      result.push({
        role: 'tool',
        tool_call_id: toolResult.callId,
        content: toolResult.content,
      });
    }
  }

  return result;
}

function mapRole(role: vscode.LanguageModelChatMessageRole): 'system' | 'user' | 'assistant' {
  const normalizedRole = String(role).toLowerCase();
  if (normalizedRole === 'assistant') return 'assistant';
  if (normalizedRole === 'system') return 'system';
  if (normalizedRole === 'user') return 'user';
  return 'user';
}
