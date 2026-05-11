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
  let hasShownThinkingHint = false;
  let sawInsufficientSystemResource = false;
  const emittedToolCalls: Array<{ id: string; name: string }> = [];
  const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

  const persistReasoning = () => {
    if (!fullReasoning) {
      return;
    }

    const fingerprint = fingerprintAssistantTurn({
      text: fullContent,
      toolCalls: emittedToolCalls,
    });

    if (!fingerprint) {
      return;
    }

    reasoningCache.set(fingerprint, fullReasoning);
  };

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
      progress.report(
        new vscode.LanguageModelTextPart(
          `[DeepSeek API error ${response.status}: ${errorText.slice(0, 200)}]`,
        ),
      );
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

        const finishReason = choices[0].finish_reason as string | undefined;
        if (finishReason === 'insufficient_system_resource') {
          sawInsufficientSystemResource = true;
        }

        const reasoningChunk = delta.reasoning_content as string | undefined;
        if (reasoningChunk) {
          fullReasoning += reasoningChunk;
          const ThinkingCtor = (vscode as unknown as Record<string, unknown>)
            .LanguageModelThinkingPart as
            | (new (value: string, id?: string, metadata?: unknown) => unknown)
            | undefined;

          if (ThinkingCtor) {
            progress.report(new ThinkingCtor(reasoningChunk) as vscode.LanguageModelResponsePart);
          } else if (!hasShownThinkingHint) {
            progress.report(new vscode.LanguageModelTextPart('Thinking...\n\n'));
            hasShownThinkingHint = true;
          }
        }

        const contentChunk = delta.content as string | undefined;
        if (contentChunk) {
          fullContent += contentChunk;
          progress.report(new vscode.LanguageModelTextPart(contentChunk));
        }

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
            if (args) {
              toolCalls[idx]!.arguments += args;
            }
          }
        }

        const usage = chunk.usage as DSUsage | undefined;
        if (usage) {
          onUsage?.(prepared.model, usage);

          const promptTokens = usage.prompt_tokens ?? 0;
          if (onCharsPerToken && promptTokens > 0 && prepared.inputCharCount > 0) {
            const newRatio = prepared.inputCharCount / promptTokens;
            if (newRatio > 0.5 && newRatio < 20) {
              onCharsPerToken(newRatio);
            }
          }
        }
      }
    }

    for (const tc of toolCalls) {
      if (!tc || !tc.id) {
        continue;
      }

      emittedToolCalls.push({ id: tc.id, name: tc.name });

      try {
        progress.report(
          new vscode.LanguageModelToolCallPart(tc.id, tc.name, JSON.parse(tc.arguments)),
        );
      } catch {
        progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, {}));
      }
    }

    persistReasoning();

    if (sawInsufficientSystemResource) {
      void vscode.window
        .showErrorMessage(
          'DeepSeek backend ran out of capacity mid-stream. The response is incomplete.',
          'Show Logs',
        )
        .then((choice) => {
          if (choice === 'Show Logs') {
            void vscode.commands.executeCommand('deepseek-qa.showLogs');
          }
        });
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      persistReasoning();
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
