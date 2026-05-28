import vscode from 'vscode';
import { getReasoningEffort, type ReasoningEffort } from '../config';
import { MAX_TOOLS_PER_REQUEST, MODELS } from '../consts';

export type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
  readonly modelConfiguration?: Record<string, unknown>;
  readonly configuration?: Record<string, unknown>;
};

type ThinkingEffortConfigurationSchema = ReturnType<typeof buildThinkingEffortSchema>;

type RuntimeLanguageModelChatCapabilities = vscode.LanguageModelChatCapabilities & {
  editTools?: readonly string[];
};

type RuntimeLanguageModelChatInformation = vscode.LanguageModelChatInformation & {
  isUserSelectable: boolean;
  statusIcon?: vscode.ThemeIcon;
  detail?: string;
  category?: { label: string; order: number };
  configurationSchema?: ThinkingEffortConfigurationSchema;
  capabilities: RuntimeLanguageModelChatCapabilities;
};

const API_KEY_REQUIRED_DETAIL = vscode.l10n.t('deepseek-pilot.models.noApiKey');

export function toChatInfo(
  model: (typeof MODELS)[number],
  hasKey: boolean,
): vscode.LanguageModelChatInformation {
  const tooltip = hasKey
    ? `${model.description}\n\nContext: ${formatTokens(model.maxInputTokens)} in / ${formatTokens(model.maxOutputTokens)} out`
    : API_KEY_REQUIRED_DETAIL;

  const statusIcon = !hasKey
    ? new vscode.ThemeIcon('warning')
    : model.thinking
      ? new vscode.ThemeIcon('lightbulb-sparkle')
      : new vscode.ThemeIcon('rocket');

  const info: RuntimeLanguageModelChatInformation = {
    id: model.id,
    name: model.name,
    family: model.family,
    version: model.version,
    detail: hasKey ? model.detail : API_KEY_REQUIRED_DETAIL,
    tooltip,
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    isUserSelectable: true,
    statusIcon,
    // Group the four variants under one collapsible row in the model picker.
    category: { label: 'DeepSeek V4', order: 50 },
    capabilities: {
      imageInput: true,
      // Tell the host the explicit per-request tool cap so it can truncate
      // long tool lists upstream instead of letting our request.ts throw.
      toolCalling: MAX_TOOLS_PER_REQUEST,
    },
    ...(model.thinking ? { configurationSchema: buildThinkingEffortSchema() } : {}),
  };

  return info;
}

export function getConfiguredThinkingEffort(options: ModelConfigurationOptions): ReasoningEffort {
  const configuredEffort =
    options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort;

  // Per DeepSeek thinking_mode docs: `low` and `medium` are mapped to `high`,
  // and `xhigh` is mapped to `max` for forward/backward compatibility with
  // other vendors' effort taxonomies (OpenAI, Anthropic, etc).
  if (configuredEffort === 'max' || configuredEffort === 'xhigh') return 'max';
  if (
    configuredEffort === 'high' ||
    configuredEffort === 'medium' ||
    configuredEffort === 'low'
  ) {
    return 'high';
  }
  return getReasoningEffort();
}

function buildThinkingEffortSchema() {
  return {
    properties: {
      reasoningEffort: {
        type: 'string',
        title: 'Thinking Effort',
        enum: ['high', 'max'],
        enumItemLabels: ['High', 'Max'],
        enumDescriptions: [
          'Faster responses with shorter reasoning chains.',
          'Maximum reasoning depth; slower and uses more tokens.',
        ],
        default: 'max',
        group: 'navigation',
      },
    },
  } as const;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}
