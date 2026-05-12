import vscode from 'vscode';
import type { PreparedRequest } from './request';
import type { ReasoningCache } from './cache';
import { fingerprintAssistantTurn } from './cache';
import { tryParseJson } from '../json';
import { logger } from '../logger';
import { USAGE_MIME_TYPE } from '../consts';
import type { DSUsage } from '../types';
import { fetchWithRetry, formatApiError, notifyApiError } from './errors';
import { tryParseJSONObject } from './sanitize';

interface ToolCallBuffer {
  id?: string;
  name?: string;
  args: string;
}

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
  const cancelSub = token.onCancellationRequested(() => controller.abort());

  let fullReasoning = '';
  let fullContent = '';
  let hasShownThinkingHint = false;
  let sawInsufficientSystemResource = false;
  let sawLengthTruncation = false;
  const emittedToolCalls: Array<{ id: string; name: string }> = [];
  // Tool call deltas accumulate by `index`, then flush on finish/[DONE].
  const toolCallBuffers = new Map<number, ToolCallBuffer>();
  const completedToolCallIndices = new Set<number>();

  const persistReasoning = () => {
    if (!prepared.thinking || !fullReasoning) return;
    const fingerprint = fingerprintAssistantTurn({
      text: fullContent,
      toolCalls: emittedToolCalls,
    });
    if (!fingerprint) return;
    reasoningCache.set(fingerprint, fullReasoning);
  };

  const tryEmitBufferedToolCall = (idx: number): void => {
    const buf = toolCallBuffers.get(idx);
    if (!buf || !buf.name) return;
    const parsed = tryParseJSONObject(buf.args);
    if (!parsed.ok) return;
    const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
    emittedToolCalls.push({ id, name: buf.name });
    progress.report(new vscode.LanguageModelToolCallPart(id, buf.name, parsed.value));
    toolCallBuffers.delete(idx);
    completedToolCallIndices.add(idx);
  };

  const flushToolCallBuffers = (throwOnInvalid: boolean): void => {
    if (toolCallBuffers.size === 0) return;
    for (const [idx, buf] of Array.from(toolCallBuffers.entries())) {
      const parsed = tryParseJSONObject(buf.args);
      if (!parsed.ok) {
        if (throwOnInvalid) {
          logger.error(`Invalid JSON in tool call idx=${idx} snippet=${(buf.args || '').slice(0, 200)}`);
          throw new Error('Invalid JSON for tool call');
        }
        continue;
      }
      const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
      const name = buf.name ?? 'unknown_tool';
      emittedToolCalls.push({ id, name });
      progress.report(new vscode.LanguageModelToolCallPart(id, name, parsed.value));
      toolCallBuffers.delete(idx);
      completedToolCallIndices.add(idx);
    }
  };

  try {
    const response = await fetchWithRetry(
      prepared.url,
      {
        method: 'POST',
        headers: prepared.headers,
        body: prepared.body,
      },
      controller.signal,
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const formatted = formatApiError(response.status, response.statusText, errorText);
      logger.error(formatted);
      void notifyApiError(response.status, formatted);
      throw new Error(formatted);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body from DeepSeek API');
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
        if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          // Defensive: emit any leftover tool calls best-effort.
          try {
            flushToolCallBuffers(false);
          } catch {
            /* swallow on [DONE] */
          }
          persistReasoning();
          continue;
        }

        const chunk = tryParseJson(data) as Record<string, unknown> | null;
        if (!chunk) continue;

        // Usage is in a separate final chunk when include_usage=true.
        const usage = chunk.usage as DSUsage | undefined;
        if (usage) {
          onUsage?.(prepared.model, usage);
          const promptTokens = usage.prompt_tokens ?? 0;
          if (onCharsPerToken && promptTokens > 0 && prepared.inputCharCount > 0) {
            const newRatio = prepared.inputCharCount / promptTokens;
            if (newRatio > 0.5 && newRatio < 20) onCharsPerToken(newRatio);
          }

          // Forward-compatible usage reporting for Copilot Chat's context
          // window widget. Copilot Chat currently hardcodes zero usage for
          // all third-party providers (microsoft/vscode#309207, #314722).
          // The proposed fix is to recognize LanguageModelDataPart with
          // MIME type "application/vnd.llm.usage+json". Emitting this now
          // is harmless (ignored by current Copilot Chat) and will light up
          // the context window widget automatically when Copilot Chat ships
          // the fix.
          try {
            progress.report(
              vscode.LanguageModelDataPart.json(usage, USAGE_MIME_TYPE),
            );
          } catch {
            /* best-effort — must not break the stream for a display hint */
          }
        }

        const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
        const choice = choices?.[0];
        if (!choice) continue;

        const delta = choice.delta as Record<string, unknown> | undefined;
        const finishReason = choice.finish_reason as string | undefined;

        if (delta) {
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
              progress.report(new vscode.LanguageModelTextPart('💭 Thinking...\n\n'));
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
              if (completedToolCallIndices.has(idx)) continue;
              const buf = toolCallBuffers.get(idx) ?? { args: '' };
              if (typeof tc.id === 'string' && tc.id) buf.id = tc.id;
              const fn = tc.function as Record<string, unknown> | undefined;
              if (typeof fn?.name === 'string' && fn.name) buf.name = fn.name;
              if (typeof fn?.arguments === 'string') buf.args += fn.arguments;
              toolCallBuffers.set(idx, buf);
              tryEmitBufferedToolCall(idx);
            }
          }
        }

        if (finishReason) {
          if (finishReason === 'insufficient_system_resource') {
            sawInsufficientSystemResource = true;
            logger.warn(
              `mid-stream truncation finish=${finishReason} reasoningLen=${fullReasoning.length} contentLen=${fullContent.length}`,
            );
          } else if (finishReason === 'length') {
            sawLengthTruncation = true;
            logger.warn(`length truncation finish=${finishReason}`);
          } else if (finishReason === 'content_filter') {
            logger.warn(`content filter finish=${finishReason}`);
          }

          const isClean = finishReason === 'tool_calls' || finishReason === 'stop';
          flushToolCallBuffers(isClean);
          persistReasoning();
        }
      }
    }

    // Final defensive flush in case the stream ended without explicit finish.
    flushToolCallBuffers(false);
    persistReasoning();

    if (sawInsufficientSystemResource) {
      void vscode.window
        .showErrorMessage(
          'DeepSeek backend ran out of capacity mid-stream. The response is incomplete — please resend.',
          'Show Logs',
        )
        .then((choice) => {
          if (choice === 'Show Logs') {
            void vscode.commands.executeCommand('deepseek-qa.showLogs');
          }
        });
    } else if (sawLengthTruncation) {
      void vscode.window.showWarningMessage(
        'DeepSeek response was truncated (max_tokens limit). Consider increasing `deepseek-qa.maxTokens`.',
      );
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      // User cancellation — persist reasoning so the next turn can still
      // continue from the partial chain, then bail out cleanly.
      persistReasoning();
      return;
    }
    logger.error('Stream error', e);
    throw e;
  } finally {
    cancelSub.dispose();
  }
}
