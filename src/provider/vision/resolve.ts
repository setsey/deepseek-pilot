import vscode from 'vscode';
import { getVisionModelSetting, getVisionPrompt } from '../../config';
import {
  IMAGE_DESCRIPTION_PREFIX,
  IMAGE_DESCRIPTION_SUFFIX,
  IMAGE_DESCRIPTION_UNAVAILABLE,
} from '../../consts';
import { logger } from '../../logger';

export interface VisionResolutionResult {
  resolvedMessages: vscode.LanguageModelChatRequestMessage[];
  stats: VisionDescriptionCacheStats;
}

export interface VisionDescriptionCacheStats {
  cacheHits: number;
  cacheMisses: number;
  totalDescriptions: number;
}

/** In-memory cache: data hash → description text. */
const descriptionCache = new Map<string, string>();

export function computeDataHash(data: Uint8Array): string {
  // Simple fast hash — good enough for image dedup in a session
  let hash = 0;
  for (let i = 0; i < Math.min(data.length, 8192); i++) {
    hash = ((hash << 5) - hash + data[i]!) | 0;
  }
  return String(hash) + ':' + data.length;
}

export function getCachedDescriptionByDataHash(hash: string): string | undefined {
  return descriptionCache.get(hash);
}

function setCachedDescription(hash: string, description: string): void {
  // Cap cache at 500 entries
  if (descriptionCache.size >= 500) {
    const first = descriptionCache.keys().next().value;
    if (first) descriptionCache.delete(first);
  }
  descriptionCache.set(hash, description);
}

/**
 * Resolve image attachments in messages by proxying them through a
 * vision-capable Copilot model. Returns new messages with images
 * replaced by text descriptions.
 */
export async function resolveImageMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  getVisionModel: () => Promise<vscode.LanguageModelChat | null>,
): Promise<VisionResolutionResult> {
  const stats: VisionDescriptionCacheStats = { cacheHits: 0, cacheMisses: 0, totalDescriptions: 0 };
  const resolved: vscode.LanguageModelChatRequestMessage[] = [];

  for (const msg of messages) {
    if (!hasImageParts(msg)) {
      resolved.push(msg);
      continue;
    }

    const parts = msg.content as (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[];
    const resolvedParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];

    for (const part of parts) {
      if (part instanceof vscode.LanguageModelTextPart) {
        resolvedParts.push(part);
        continue;
      }

      if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
        stats.totalDescriptions++;
        const hash = computeDataHash(part.data);
        const cached = getCachedDescriptionByDataHash(hash);

        if (cached !== undefined) {
          stats.cacheHits++;
          resolvedParts.push(new vscode.LanguageModelTextPart(cached));
          continue;
        }

        stats.cacheMisses++;
        const description = await describeImage(part, getVisionModel);
        if (description !== IMAGE_DESCRIPTION_UNAVAILABLE) {
          setCachedDescription(hash, description);
        }
        resolvedParts.push(new vscode.LanguageModelTextPart(description));
      } else {
        resolvedParts.push(part);
      }
    }

    resolved.push({ role: msg.role, content: resolvedParts, name: msg.name });
  }

  return { resolvedMessages: resolved, stats };
}

function hasImageParts(msg: vscode.LanguageModelChatRequestMessage): boolean {
  const parts = msg.content;
  if (!Array.isArray(parts)) return false;
  return parts.some(
    (p) => p instanceof vscode.LanguageModelDataPart && p.mimeType.startsWith('image/'),
  );
}

async function describeImage(
  part: vscode.LanguageModelDataPart,
  getVisionModel: () => Promise<vscode.LanguageModelChat | null>,
): Promise<string> {
  try {
    const visionModel = await getVisionModel();
    if (!visionModel) {
      logger.warn('No vision proxy model available — using placeholder description');
      return IMAGE_DESCRIPTION_UNAVAILABLE;
    }

    const prompt = getVisionPrompt();
    const visionMessage = vscode.LanguageModelChatMessage.User([
      part,
      new vscode.LanguageModelTextPart(prompt),
    ]);
    const tokenSource = new vscode.CancellationTokenSource();

    const response = await visionModel.sendRequest([visionMessage], {}, tokenSource.token);

    let text = '';
    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        text += chunk.value;
      }
    }

    tokenSource.dispose();
    return text ? `${IMAGE_DESCRIPTION_PREFIX}${text}${IMAGE_DESCRIPTION_SUFFIX}` : IMAGE_DESCRIPTION_UNAVAILABLE;
  } catch (e) {
    logger.warn('Vision proxy failed', e);
    return IMAGE_DESCRIPTION_UNAVAILABLE;
  }
}
