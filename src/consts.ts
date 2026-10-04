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
 * `detailPrefix` is the static half of the picker's `detail` line; the live
 * per-Mtok rate is appended at display time (see `toChatInfo`), because
 * DeepSeek's peak and off-peak rates differ by 2x and a string baked in at
 * module load would go stale in a long-running window. Pricing itself lives in
 * [pricing.ts](src/pricing.ts).
 */
export const MODELS = [
  // V4.1 Flash (API id `deepseek-flash`, released 2026-09) is the flagship: it
  // absorbed the experimental `deepseek-v4-flash-vision-exp` model, so vision
  // is native here — images cost at most VISION_IMAGE_TOKEN_CAP tokens each.
  // The retired `deepseek-v4-flash` / vision-exp ids still route to it.
  {
    id: 'deepseek-flash::thinking',
    name: 'DeepSeek V4.1 Flash (thinking)',
    description:
      'DeepSeek V4.1 Flash — flagship, extended thinking, native image input, 1M context',
    detailPrefix: 'Flash · thinking',
    vendor: 'deepseek-pilot',
    family: 'deepseek-flash',
    version: 'thinking',
    maxInputTokens: 655360,
    maxOutputTokens: 393216,
    thinking: true,
    nativeVision: true,
  },
  {
    id: 'deepseek-flash',
    name: 'DeepSeek V4.1 Flash',
    description:
      'DeepSeek V4.1 Flash — flagship, native image input, no extended thinking, lowest latency',
    detailPrefix: 'Flash · fast',
    vendor: 'deepseek-pilot',
    family: 'deepseek-flash',
    version: 'default',
    maxInputTokens: 983040,
    maxOutputTokens: 65536,
    thinking: false,
    nativeVision: true,
  },
  // V4 Pro (DeepSeek-V4-Pro-0813) remains its own model at its own price:
  // DeepSeek withdrew the Pro-to-Flash routing it had announced for
  // 2026-09-14. Vision stays off — the Pro API rejects image parts, so images
  // ride the describe-and-replace proxy here.
  {
    id: 'deepseek-v4-pro::thinking',
    name: 'DeepSeek V4 Pro (thinking)',
    description: 'DeepSeek V4 Pro — extended thinking, 1M context; images via the vision proxy',
    detailPrefix: 'Pro · thinking',
    vendor: 'deepseek-pilot',
    family: 'deepseek-v4-pro',
    version: 'thinking',
    maxInputTokens: 655360,
    maxOutputTokens: 393216,
    thinking: true,
    nativeVision: false,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'DeepSeek V4 Pro — no extended thinking, 1M context; images via the vision proxy',
    detailPrefix: 'Pro · fast',
    vendor: 'deepseek-pilot',
    family: 'deepseek-v4-pro',
    version: 'default',
    maxInputTokens: 983040,
    maxOutputTokens: 65536,
    thinking: false,
    nativeVision: false,
  },
] as const;

/**
 * The API model id the built-in vision describer targets (also the Flash
 * `MODELS` family). Since V4.1 the flagship Flash model is itself multimodal,
 * so the describer — which only serves the text-only Pro variants — calls it
 * directly rather than the retired `deepseek-v4-flash-vision-exp`.
 */
export const NATIVE_VISION_MODEL_ID = 'deepseek-flash';

/**
 * DeepSeek converts an image to at most this many tokens: every image is
 * resized before inference (small ones up toward ~544x544, large ones down to
 * roughly 1300x1300 total pixels), which bounds the cost per image —
 * https://api-docs.deepseek.com/guides/vision ("Token Usage"). Used for token
 * estimation on native-vision variants and for the cost of an image in the
 * converted-request character count.
 */
export const VISION_IMAGE_TOKEN_CAP = 1024;

/**
 * Per-image raw-byte guard for native vision. DeepSeek caps base64 images at
 * 32 MiB *encoded* and the whole request body at 48 MiB; base64 inflates by
 * 4/3, so 24 MiB of raw bytes is the largest image that can't trip the
 * per-image cap. Oversized images are dropped with a warning instead of
 * letting the API 400 the whole request.
 */
export const VISION_IMAGE_MAX_RAW_BYTES = 24 * 1024 * 1024;

/** Settings (Copilot Chat 1.121) for routing utility flows through a chosen model. */
export const COPILOT_UTILITY_MODEL_SETTING = 'chat.utilityModel';
export const COPILOT_UTILITY_SMALL_MODEL_SETTING = 'chat.utilitySmallModel';
