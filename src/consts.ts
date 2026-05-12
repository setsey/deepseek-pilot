export const WALKTHROUGH_ID = 'konstantyn-ganenkov.deepseek-v4-qa#deepseekQaGettingStarted';
export const WELCOME_SHOWN_KEY = 'deepseek-qa.welcomeShown';

/** Prefix/suffix wrapping image descriptions so the model knows they are proxy text. */
export const IMAGE_DESCRIPTION_PREFIX = '[Image Description: ';
export const IMAGE_DESCRIPTION_SUFFIX = ']';
export const IMAGE_DESCRIPTION_UNAVAILABLE = '[Image Description unavailable]';

/**
 * MIME type for reporting actual API usage via LanguageModelDataPart.
 * Emitted so that Copilot Chat can populate its context window widget once
 * it ships the fix for microsoft/vscode#309207 / #314722 (third-party
 * providers currently get hardcoded zero usage).
 */
export const USAGE_MIME_TYPE = 'application/vnd.llm.usage+json';

export const MODELS = [
  {
    id: 'deepseek-v4-pro::thinking',
    name: 'DeepSeek V4 Pro (thinking)',
    description: 'DeepSeek V4 Pro — strongest, extended thinking, 1M context',
    vendor: 'deepseek-qa',
    family: 'deepseek-v4-pro',
    version: 'thinking',
    maxInputTokens: 720896,
    maxOutputTokens: 262144,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek V4 Pro — strong, no extended thinking, lower latency',
    vendor: 'deepseek-qa',
    family: 'deepseek-v4-pro',
    version: 'default',
    maxInputTokens: 917504,
    maxOutputTokens: 65536,
  },
  {
    id: 'deepseek-v4-flash::thinking',
    name: 'DeepSeek V4 Flash (thinking)',
    description: 'DeepSeek V4 Flash — cheapest with extended thinking',
    vendor: 'deepseek-qa',
    family: 'deepseek-v4-flash',
    version: 'thinking',
    maxInputTokens: 720896,
    maxOutputTokens: 262144,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek V4 Flash — cheapest, no extended thinking',
    vendor: 'deepseek-qa',
    family: 'deepseek-v4-flash',
    version: 'default',
    maxInputTokens: 917504,
    maxOutputTokens: 65536,
  },
] as const;
