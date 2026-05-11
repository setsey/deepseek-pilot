import vscode from 'vscode';
import type { OpenAIChatMessage, OpenAIFunctionToolDef } from '../types';
import type { AuthManager } from '../auth';
import type { ReasoningCache } from './cache';
import { fingerprintAssistantTurn } from './cache';
import { convertMessages } from './convert';
import { resolveImageMessages, type VisionDescriptionCacheStats } from './vision/index';
import { logger } from '../logger';
import { safeJsonStringify } from '../json';
import { MODELS } from '../consts';

export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  model: string;
  thinking: boolean;
  stream: boolean;
  cacheDiagnostics: VisionDescriptionCacheStats;
}

export async function prepareChatRequest(params: {
  authManager: AuthManager;
  modelInfo: vscode.LanguageModelChatInformation;
  messages: readonly vscode.LanguageModelChatRequestMessage[];
  options: vscode.ProvideLanguageModelChatResponseOptions;
  token: vscode.CancellationToken;
  reasoningCache: ReasoningCache;
  getVisionModel: () => Promise<vscode.LanguageModelChatInformation | null>;
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

  // Restore reasoning_content from cache for tool-call turns
  let reasoningContent: string | undefined;
  if (thinking) {
    const fp = fingerprintAssistantTurn(
      resolvedMessages
        .filter((m) => m.role === vscode.LanguageModelChatMessageRole.User)
        .map((m) => ({ role: 'user', content: typeof m.content === 'string' ? m.content : null })),
    );
    reasoningContent = reasoningCache.get(fp);
  }

  // Convert to OpenAI format
  const openaiMessages = convertMessages(resolvedMessages, reasoningContent);

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
    model: variant.family,
    messages: openaiMessages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  if (thinking) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = 'max';
  }

  const maxTokens = vscode.workspace.getConfiguration('deepseek-qa').get<number>('maxTokens', 0);
  if (maxTokens > 0) {
    body.max_tokens = maxTokens;
  }

  const baseUrl = vscode.workspace.getConfiguration('deepseek-qa').get<string>('baseUrl', 'https://api.deepseek.com');

  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: safeJsonStringify(body),
    model: variant.family,
    thinking,
    stream: true,
    cacheDiagnostics,
  };
}
