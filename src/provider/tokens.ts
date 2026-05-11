import vscode from 'vscode';
import { IMAGE_DESCRIPTION_PREFIX, IMAGE_DESCRIPTION_SUFFIX } from '../consts';
import { computeDataHash, getCachedDescriptionByDataHash } from './vision/resolve';

/**
 * Estimate token count for a text or message.
 * Uses an adaptive chars-per-token ratio calibrated from real API usage data.
 */
export function estimateTokenCount(
  text: string | vscode.LanguageModelChatRequestMessage,
  charsPerToken: number,
): number {
  if (typeof text === 'string') {
    return Math.ceil(text.length / charsPerToken);
  }

  let chars = 0;
  const parts = text.content;
  if (!Array.isArray(parts)) return Math.ceil(String(text.content ?? '').length / charsPerToken);

  for (const part of parts) {
    chars += estimatePartChars(part);
  }

  return Math.ceil(chars / charsPerToken);
}

function estimatePartChars(part: unknown): number {
  if (part instanceof vscode.LanguageModelTextPart) {
    return part.value.length;
  }

  if (part instanceof vscode.LanguageModelToolCallPart) {
    let chars = part.callId.length + part.name.length;
    try { chars += JSON.stringify(part.input).length; } catch { chars += 2; }
    return chars;
  }

  if (part instanceof vscode.LanguageModelToolResultPart) {
    let chars = part.callId.length;
    if (Array.isArray(part.content)) {
      for (const item of part.content) chars += estimatePartChars(item);
    }
    return chars;
  }

  if (part instanceof vscode.LanguageModelDataPart) {
    const mime = part.mimeType;
    if (mime.startsWith('image/') && part.data.byteLength <= 500_000) {
      const cached = getCachedDescriptionByDataHash(computeDataHash(part.data));
      if (cached !== undefined) {
        return IMAGE_DESCRIPTION_PREFIX.length + cached.length + IMAGE_DESCRIPTION_SUFFIX.length;
      }
    }
    // Conservative estimate for unresolved images
    return 1020;
  }

  return 0;
}
