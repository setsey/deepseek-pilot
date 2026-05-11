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
import { sanitizeFunctionName, sanitizeSchema } from './sanitize';
import { validateRequest } from './validate';
import { logCacheTraceSnapshot, snapshotCacheTrace } from './diagnostics';

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

const MAX_TOOLS_PER_REQUEST = 128;

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

  // Sanity check the host-provided history. We do NOT throw on validation
  // failure — convertMessages drops orphans defensively — but a warning
  // surfaces the underlying issue when the user reports a 400.
  const validation = validateRequest(messages);
  if (validation) {
    logger.warn(`Request validation: ${validation}`);
  }

  // Resolve images via vision proxy (drops images if no vision model).
  const { resolvedMessages, stats: cacheDiagnostics } = await resolveImageMessages(
    messages,
    getVisionModel,
  );

  if (token.isCancellationRequested) throw new vscode.CancellationError();

  const variant = MODELS.find((m) => m.id === modelInfo.id);
  if (!variant) throw new Error(`Unknown model: ${modelInfo.id}`);

  const thinking = variant.version === 'thinking';

  // Convert to OpenAI format. The convert step:
  //   - enforces tool_call → tool_result ordering
  //   - drops orphan tool_result parts (no matching open tool_call)
  //   - attaches reasoning_content from cache (or "" fallback) on thinking-mode
  const openaiMessages = convertMessages(resolvedMessages, thinking, reasoningCache);

  if (openaiMessages.length === 0) {
    throw new Error('No messages to send after conversion');
  }

  // Convert tool definitions through the sanitization pipeline.
  let tools: OpenAIFunctionToolDef[] | undefined;
  let toolChoice: 'auto' | { type: 'function'; function: { name: string } } | undefined;
  if (options.tools && options.tools.length > 0) {
    if (options.tools.length > MAX_TOOLS_PER_REQUEST) {
      throw new Error(`Cannot have more than ${MAX_TOOLS_PER_REQUEST} tools per request.`);
    }
    tools = options.tools
      .filter((t) => t && typeof t === 'object')
      .map((t) => {
        const name = sanitizeFunctionName(t.name);
        const description = typeof t.description === 'string' ? t.description : '';
        const parameters = sanitizeSchema(t.inputSchema ?? { type: 'object', properties: {} });
        return {
          type: 'function' as const,
          function: { name, description, parameters },
        };
      });

    toolChoice = 'auto';
    if (options.toolMode === vscode.LanguageModelChatToolMode.Required) {
      if (tools.length !== 1) {
        throw new Error(
          'LanguageModelChatToolMode.Required is not supported with more than one tool',
        );
      }
      toolChoice = { type: 'function', function: { name: tools[0]!.function.name } };
    }
  }

  const body: Record<string, unknown> = {
    model: getApiModelId(variant.family),
    messages: openaiMessages,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
  }

  if (thinking) {
    const reasoningEffort = getConfiguredThinkingEffort(options as ModelConfigurationOptions);
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = reasoningEffort;
    logger.info(`[req] reasoning_effort=${reasoningEffort} (variant=${variant.id})`);
    // Per DeepSeek docs: temperature/top_p/penalty params are silently ignored
    // in thinking mode. We omit them so the request body matches what the API
    // actually consumes.
  } else {
    // CRITICAL: thinking.type defaults to "enabled" on the API side. For our
    // non-thinking variants we MUST explicitly disable it, otherwise the
    // non-thinking and thinking variants behave identically over the wire.
    body.thinking = { type: 'disabled' };

    const requestedTemp = options.modelOptions?.temperature;
    if (typeof requestedTemp === 'number') {
      body.temperature = requestedTemp;
    } else {
      body.temperature = 0.7;
    }
    // Allow-list non-thinking tuning options from the host.
    const mo = options.modelOptions as Record<string, unknown> | undefined;
    if (mo) {
      if (typeof mo.stop === 'string' || Array.isArray(mo.stop)) body.stop = mo.stop;
      // frequency_penalty / presence_penalty are documented as deprecated for
      // v4 but the API still accepts them. Pass through if the host asks.
      if (typeof mo.frequency_penalty === 'number') body.frequency_penalty = mo.frequency_penalty;
      if (typeof mo.presence_penalty === 'number') body.presence_penalty = mo.presence_penalty;
      if (typeof mo.top_p === 'number') body.top_p = mo.top_p;
      if (typeof mo.logprobs === 'boolean') body.logprobs = mo.logprobs;
      if (typeof mo.top_logprobs === 'number') body.top_logprobs = Math.min(20, mo.top_logprobs);
    }
  }

  // Cross-mode passthroughs (apply equally to thinking & non-thinking).
  const mo = options.modelOptions as Record<string, unknown> | undefined;
  if (mo) {
    // response_format — `{"type": "json_object"}` enables JSON-mode output.
    // Stable: thinking + JSON mode is supported; the model must be prompted
    // to actually emit JSON (the API doesn't enforce schema beyond well-formed
    // JSON output).
    if (
      mo.response_format &&
      typeof mo.response_format === 'object' &&
      (mo.response_format as { type?: unknown }).type === 'json_object'
    ) {
      body.response_format = { type: 'json_object' };
    }

    // user_id — DeepSeek's tracking identifier (max 512 chars, [a-zA-Z0-9_-]).
    // Accept either OpenAI-style `user` or native `user_id`; sanitize to the
    // documented charset before forwarding.
    const rawUserId = mo.user_id ?? mo.user;
    if (typeof rawUserId === 'string' && rawUserId.length > 0) {
      const sanitized = rawUserId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 512);
      if (sanitized) body.user_id = sanitized;
    }
  }

  const requestedMaxTokens =
    typeof options.modelOptions?.max_tokens === 'number' && options.modelOptions.max_tokens > 0
      ? Math.min(options.modelOptions.max_tokens, variant.maxOutputTokens)
      : undefined;
  const configuredMaxTokens = getMaxTokens();
  const maxTokens =
    requestedMaxTokens ??
    (configuredMaxTokens > 0
      ? Math.min(configuredMaxTokens, variant.maxOutputTokens)
      : variant.maxOutputTokens);
  if (maxTokens) body.max_tokens = maxTokens;

  const inputCharCount = countRequestChars(openaiMessages, tools);

  // Debug-only: snapshot the converted message sequence so 400 errors are
  // easy to diagnose from the output channel. No raw content is logged.
  logCacheTraceSnapshot(snapshotCacheTrace(openaiMessages, tools?.length ?? 0));

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
