export const WALKTHROUGH_ID = 'konstantyn-ganenkov.deepseek-pilot#deepseekPilotGettingStarted';
export const WELCOME_SHOWN_KEY = 'deepseek-pilot.welcomeShown';

/** Prefix/suffix wrapping image descriptions so the model knows they are proxy text. */
export const IMAGE_DESCRIPTION_PREFIX = '[Image Description: ';
export const IMAGE_DESCRIPTION_SUFFIX = ']';
export const IMAGE_DESCRIPTION_UNAVAILABLE = '[Image Description unavailable]';

/**
 * MIME type for reporting actual API usage via LanguageModelDataPart.
 * Copilot Chat's BYOK consumer (bundled with VS Code 1.120+) checks
 * `mimeType === "usage"` literally, then parses the JSON and requires
 * `prompt_tokens`, `completion_tokens`, and `total_tokens` to be numbers
 * (OpenAI shape — DeepSeek matches). Older hosts that don't recognise this
 * MIME simply ignore the data part.
 */
export const USAGE_MIME_TYPE = 'usage';

/** Max tools per request DeepSeek will accept (used as the toolCalling cap). */
export const MAX_TOOLS_PER_REQUEST = 128;

/**
 * Per-million-token regular pricing (USD) — published 2026-04 by
 * https://api-docs.deepseek.com/quick_start/pricing. Pricing.ts is the
 * source of truth for cost computation; this snapshot is only for surfacing
 * a short "$/Mtok in:out" hint inside the model picker's `detail` field.
 */
const PRICE_USD = {
  pro: { input: 1.74, output: 3.48 },
  flash: { input: 0.14, output: 0.28 },
} as const;

function priceHint(family: 'pro' | 'flash'): string {
  const p = PRICE_USD[family];
  return `$${p.input}/$${p.output} per Mtok in/out`;
}

export const MODELS = [
  {
    id: 'deepseek-v4-pro::thinking',
    name: 'DeepSeek V4 Pro (thinking)',
    description: 'DeepSeek V4 Pro — strongest, extended thinking, 1M context',
    detail: `Pro · thinking · ${priceHint('pro')}`,
    vendor: 'deepseek-pilot',
    family: 'deepseek-v4-pro',
    version: 'thinking',
    maxInputTokens: 720896,
    maxOutputTokens: 262144,
    thinking: true,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek V4 Pro — strong, no extended thinking, lower latency',
    detail: `Pro · fast · ${priceHint('pro')}`,
    vendor: 'deepseek-pilot',
    family: 'deepseek-v4-pro',
    version: 'default',
    maxInputTokens: 917504,
    maxOutputTokens: 65536,
    thinking: false,
  },
  {
    id: 'deepseek-v4-flash::thinking',
    name: 'DeepSeek V4 Flash (thinking)',
    description: 'DeepSeek V4 Flash — cheapest with extended thinking',
    detail: `Flash · thinking · ${priceHint('flash')}`,
    vendor: 'deepseek-pilot',
    family: 'deepseek-v4-flash',
    version: 'thinking',
    maxInputTokens: 720896,
    maxOutputTokens: 262144,
    thinking: true,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'DeepSeek V4 Flash — cheapest, no extended thinking',
    detail: `Flash · fast · ${priceHint('flash')}`,
    vendor: 'deepseek-pilot',
    family: 'deepseek-v4-flash',
    version: 'default',
    maxInputTokens: 917504,
    maxOutputTokens: 65536,
    thinking: false,
  },
] as const;

/** Settings (Copilot Chat 1.121) for routing utility flows through a chosen model. */
export const COPILOT_UTILITY_MODEL_SETTING = 'chat.utilityModel';
export const COPILOT_UTILITY_SMALL_MODEL_SETTING = 'chat.utilitySmallModel';
