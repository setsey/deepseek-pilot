import vscode from 'vscode';
import { getReasoningEffort, type ReasoningEffort } from '../config';
import { MODELS } from '../consts';

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
  configurationSchema?: ThinkingEffortConfigurationSchema;
  capabilities: RuntimeLanguageModelChatCapabilities;
};

const API_KEY_REQUIRED_DETAIL =
  'No API key configured. Use "DeepSeek QA: Manage Provider" or "DeepSeek QA: Set API Key".';

export function toChatInfo(
  model: (typeof MODELS)[number],
  hasKey: boolean,
): vscode.LanguageModelChatInformation {
  const info: RuntimeLanguageModelChatInformation = {
    id: model.id,
    name: model.name,
    family: model.family,
    version: model.version,
    detail: hasKey ? model.description : API_KEY_REQUIRED_DETAIL,
    tooltip: hasKey ? model.description : API_KEY_REQUIRED_DETAIL,
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    isUserSelectable: true,
    statusIcon: hasKey ? undefined : new vscode.ThemeIcon('warning'),
    capabilities: {
      imageInput: true,
      toolCalling: true,
    },
    ...(model.version === 'thinking'
      ? { configurationSchema: buildThinkingEffortSchema() }
      : {}),
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
