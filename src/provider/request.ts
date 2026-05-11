import vscode from 'vscode';
import type { OpenAIChatMessage, OpenAIFunctionToolDef } from '../types';
import type { AuthManager } from '../auth';
import type { ReasoningCache } from './cache';
import { convertMessages } from './convert';
import { resolveImageMessages, type VisionDescriptionCacheStats } from './vision/index';
import { logger } from '../logger';
import { safeJsonStringify } from '../json';
import { MODELS } from '../consts';
import { getApiModelId, getApiUrl, getMaxTokens } from '../config';
import { getConfiguredThinkingEffort, type ModelConfigurationOptions } from './models';

export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  model: string;
  thinking: boolean;
  stream: boolean;
  inputCharCount: number;
  cacheDiagnostics: VisionDescriptionCacheStats;
}

export async function prepareChatRequest(params: {
  authManager: AuthManager;
  modelInfo: vscode.LanguageModelChatInformation;
  messages: readonly vscode.LanguageModelChatRequestMessage[];
  options: vscode.ProvideLanguageModelChatResponseOptions;
  token: vscode.CancellationToken;
  reasoningCache: ReasoningCache;
  getVisionModel: () => Promise<vscode.LanguageModelChat | null>;
}): Promise<PreparedRequest> {
  const { authManager, modelInfo, messages, options, token, reasoningCache, getVisionModel } = params;

  const apiKey = await authManager.getApiKey();
  if (!apiKey) throw new Error('DeepSeek API key not configured');

  if (token.isCancellationRequested) throw new vscode.CancellationError();

  // Resolve images via vision proxy
  const { resolvedMessages, stats: cacheDiagnostics } =
    await resolveImageMessages(messages, getVisionModel);

  if (token.isCancellationRequested) throw new vscode.CancellationError();

  // Find model variant
  const variant = MODELS.find((m) => m.id === modelInfo.id);
  if (!variant) throw new Error(`Unknown model: ${modelInfo.id}`);

  const thinking = variant.version === 'thinking';

  // Convert to OpenAI format
  const openaiMessages = convertMessages(resolvedMessages, thinking, reasoningCache);

  // Convert tool definitions
  const tools: OpenAIFunctionToolDef[] | undefined = options.tools
    ? options.tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
        },
      }))
    : undefined;

  const body: Record<string, unknown> = {
    model: getApiModelId(variant.family),
    messages: openaiMessages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  if (thinking) {
    const reasoningEffort = getConfiguredThinkingEffort(options as ModelConfigurationOptions);
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = reasoningEffort;
    logger.info(`[req] reasoning_effort=${reasoningEffort} (variant=${variant.id})`);
  }

  const requestedMaxTokens =
    typeof options.modelOptions?.max_tokens === 'number' && options.modelOptions.max_tokens > 0
      ? Math.min(options.modelOptions.max_tokens, variant.maxOutputTokens)
      : undefined;
  const configuredMaxTokens = getMaxTokens();
  const maxTokens = requestedMaxTokens ??
    (configuredMaxTokens > 0 ? Math.min(configuredMaxTokens, variant.maxOutputTokens) : undefined);
  if (maxTokens) {
    body.max_tokens = maxTokens;
  }

  const inputCharCount = countRequestChars(openaiMessages, tools);

  return {
    url: getApiUrl('chat/completions'),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: safeJsonStringify(body),
    model: variant.family,
    thinking,
    stream: true,
    inputCharCount,
    cacheDiagnostics,
  };
}

function countRequestChars(
  messages: readonly OpenAIChatMessage[],
  tools: readonly OpenAIFunctionToolDef[] | undefined,
): number {
  let totalChars = 0;

  for (const message of messages) {
    totalChars += message.content?.length ?? 0;
    totalChars += message.reasoning_content?.length ?? 0;

    for (const toolCall of message.tool_calls ?? []) {
      totalChars += toolCall.function.name.length;
      totalChars += toolCall.function.arguments.length;
    }
  }

  if (tools && tools.length > 0) {
    totalChars += safeJsonStringify(tools).length;
  }

  return totalChars;
}
