import vscode from 'vscode';
import { IMAGE_DESCRIPTION_PREFIX, IMAGE_DESCRIPTION_SUFFIX } from '../consts';
import { computeDataHash, getCachedDescriptionByDataHash } from './vision/resolve';

/**
 * Estimate token count for a text or message.
 *
 * Uses duck typing on part shape rather than `instanceof`: Copilot Chat
 * calls `provideTokenCount` across VS Code's API proxy boundary and parts
 * arrive as plain objects without their class prototype, so `instanceof`
 * checks always fail and every part would otherwise count as 0 tokens.
 */
export function estimateTokenCount(
  text: string | vscode.LanguageModelChatRequestMessage,
  charsPerToken: number,
): number {
  if (typeof text === 'string') {
    return Math.ceil(text.length / charsPerToken);
  }

  const parts = text.content;
  if (!Array.isArray(parts)) return Math.ceil(String(text.content ?? '').length / charsPerToken);

  let chars = 0;
  for (const part of parts) {
    chars += estimatePartChars(part);
  }

  return Math.ceil(chars / charsPerToken);
}

function estimatePartChars(part: unknown): number {
  if (typeof part === 'string') return part.length;
  if (!part || typeof part !== 'object') return 0;
  const obj = part as Record<string, unknown>;

  // DataPart: { data: Uint8Array, mimeType: string }
  if (typeof obj.mimeType === 'string' && obj.data) {
    const mime = obj.mimeType;
    const data = obj.data as Uint8Array & { byteLength?: number };
    const byteLength = typeof data.byteLength === 'number' ? data.byteLength : 0;
    if (mime.startsWith('image/') && byteLength > 0 && byteLength <= 500_000) {
      try {
        const cached = getCachedDescriptionByDataHash(computeDataHash(data));
        if (cached !== undefined) {
          return IMAGE_DESCRIPTION_PREFIX.length + cached.length + IMAGE_DESCRIPTION_SUFFIX.length;
        }
      } catch {
        /* fall through to conservative estimate */
      }
    }
    return 1020;
  }

  // ToolCallPart: { callId, name, input }
  if (typeof obj.callId === 'string' && typeof obj.name === 'string' && 'input' in obj) {
    let chars = obj.callId.length + obj.name.length;
    try { chars += JSON.stringify(obj.input).length; } catch { chars += 2; }
    return chars;
  }

  // ToolResultPart: { callId, content: Array<part> }
  if (typeof obj.callId === 'string' && Array.isArray(obj.content)) {
    let chars = obj.callId.length;
    for (const item of obj.content) chars += estimatePartChars(item);
    return chars;
  }

  // TextPart / ThinkingPart: { value: string }
  if (typeof obj.value === 'string') {
    return obj.value.length;
  }

  // PromptTsxPart and unknown future part shapes — best-effort estimate
  // from JSON serialization so an unrecognized part still contributes.
  try { return JSON.stringify(obj).length; } catch { return 0; }
}
