import vscode from 'vscode';
import type { PreparedRequest } from './request';
import type { ReasoningCache } from './cache';
import { fingerprintAssistantTurn } from './cache';
import { tryParseJson } from '../json';
import { logger } from '../logger';
import type { DSUsage } from '../types';

export async function streamChatCompletion(params: {
  prepared: PreparedRequest;
  progress: vscode.Progress<vscode.LanguageModelResponsePart>;
  token: vscode.CancellationToken;
  reasoningCache: ReasoningCache;
  onUsage?: (model: string, usage: DSUsage) => void;
  onCharsPerToken?: (ratio: number) => void;
}): Promise<void> {
  const { prepared, progress, token, reasoningCache, onUsage, onCharsPerToken } = params;

  const controller = new AbortController();
  token.onCancellationRequested(() => controller.abort());

  let fullReasoning = '';
  let fullContent = '';
  let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
  let lastPromptTokens = 0;
  let lastCompletionTokens = 0;

  try {
    const response = await fetch(prepared.url, {
      method: 'POST',
      headers: prepared.headers,
      body: prepared.body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      logger.error(`API error ${response.status}: ${errorText}`);
      progress.report(new vscode.LanguageModelTextPart(`[DeepSeek API error ${response.status}: ${errorText.slice(0, 200)}]`));
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      progress.report(new vscode.LanguageModelTextPart('[No response body]'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (token.isCancellationRequested) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        const chunk = tryParseJson(data) as Record<string, unknown> | null;
        if (!chunk) continue;

        const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
        if (!choices?.[0]) continue;

        const delta = choices[0].delta as Record<string, unknown> | undefined;
        if (!delta) continue;

        // Reasoning content
        const reasoningChunk = delta.reasoning_content as string | undefined;
        if (reasoningChunk) {
          fullReasoning += reasoningChunk;
        }

        // Regular content
        const contentChunk = delta.content as string | undefined;
        if (contentChunk) {
          fullContent += contentChunk;
          progress.report(new vscode.LanguageModelTextPart(contentChunk));
        }

        // Tool calls
        const tcChunks = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        if (tcChunks) {
          for (const tc of tcChunks) {
            const idx = (tc.index as number) ?? 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = {
                id: (tc.id as string) ?? '',
                name: (tc.function as Record<string, string>)?.name ?? '',
                arguments: '',
              };
            }
            const args = (tc.function as Record<string, string>)?.arguments;
            if (args) toolCalls[idx]!.arguments += args;
          }
        }

        // Usage (usually in last chunk)
        const usage = chunk.usage as DSUsage | undefined;
        if (usage) {
          lastPromptTokens = usage.prompt_tokens ?? 0;
          lastCompletionTokens = usage.completion_tokens ?? 0;

          if (onUsage) {
            onUsage(prepared.model, usage);
          }

          // Update chars-per-token ratio
          if (onCharsPerToken && lastPromptTokens > 0) {
            const totalChars = fullContent.length + fullReasoning.length;
            const newRatio = totalChars / lastPromptTokens;
            if (newRatio > 0.5 && newRatio < 20) {
              onCharsPerToken(newRatio);
            }
          }
        }
      }
    }

    // Emit tool calls after streaming completes
    for (const tc of toolCalls) {
      if (tc && tc.id) {
        try {
          const input = JSON.parse(tc.arguments);
          progress.report(
            new vscode.LanguageModelToolCallPart(tc.id, tc.name, input),
          );
        } catch {
          progress.report(
            new vscode.LanguageModelToolCallPart(tc.id, tc.name, {}),
          );
        }
      }
    }

    // Cache reasoning_content for next turn (if this turn had tool calls)
    if (fullReasoning && toolCalls.length > 0) {
      const userMessages: Array<{ role: string; content?: string | null }> = [];
      // We need the messages passed in — stored via the closure in the provider
      // (handled in provider index.ts)
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      progress.report(new vscode.LanguageModelTextPart('\n[Cancelled]'));
      return;
    }
    logger.error('Stream error', e);
    progress.report(
      new vscode.LanguageModelTextPart(
        `\n[DeepSeek API error: ${e instanceof Error ? e.message : String(e)}]`,
      ),
    );
  }
}
