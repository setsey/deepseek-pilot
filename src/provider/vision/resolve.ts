import { createHash } from 'node:crypto';
import vscode from 'vscode';
import { getVisionPrompt } from '../../config';
import {
  IMAGE_DESCRIPTION_PREFIX,
  IMAGE_DESCRIPTION_SUFFIX,
  IMAGE_DESCRIPTION_UNAVAILABLE,
} from '../../consts';
import { logger } from '../../logger';

export interface VisionResolutionResult {
  resolvedMessages: vscode.LanguageModelChatRequestMessage[];
  stats: VisionDescriptionCacheStats;
  visionModelId?: string;
}

export interface VisionDescriptionCacheStats {
  enabled: boolean;
  hits: number;
  misses: number;
  deduplicatedDescriptions: number;
  entries: number;
  generatedDescriptions: number;
  failedDescriptions: number;
  droppedImageParts: number;
  /** Legacy fields retained for backwards-compatible call sites. */
  cacheHits: number;
  cacheMisses: number;
  totalDescriptions: number;
}

const MAX_VISION_DESCRIPTION_CACHE_ENTRIES = 100;

interface VisionDescriptionCacheEntry {
  description: string;
  /** SHA-256 of original image bytes, for secondary-index lookup. */
  dataHash?: string;
}

/** Primary cache keyed by (mime + dataHash + visionModel + hash(prompt)). */
const visionDescriptionCache = new Map<string, VisionDescriptionCacheEntry>();
/** Single-flight in-flight requests so concurrent same-image lookups share one proxy call. */
const pendingVisionDescriptions = new Map<string, Promise<string>>();
/** Secondary index: dataHash → description, used by provideTokenCount when only bytes are known. */
const dataHashToDescription = new Map<string, string>();

function freshStats(): VisionDescriptionCacheStats {
  return {
    enabled: true,
    hits: 0,
    misses: 0,
    deduplicatedDescriptions: 0,
    entries: visionDescriptionCache.size,
    generatedDescriptions: 0,
    failedDescriptions: 0,
    droppedImageParts: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalDescriptions: 0,
  };
}

function hashBytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function computeDataHash(data: Uint8Array): string {
  return hashBytes(data);
}

export function getCachedDescriptionByDataHash(hash: string): string | undefined {
  return dataHashToDescription.get(hash);
}

function createCacheKey(
  part: vscode.LanguageModelDataPart,
  visionModelId: string,
  visionPrompt: string,
  dataHash: string,
): string {
  return hashString(
    ['v1', part.mimeType, dataHash, visionModelId, hashString(visionPrompt)].join('\0'),
  );
}

function getCachedDescription(key: string): string | undefined {
  const entry = visionDescriptionCache.get(key);
  if (!entry) return undefined;
  // LRU refresh: delete and re-insert to move to the end of insertion order.
  visionDescriptionCache.delete(key);
  visionDescriptionCache.set(key, entry);
  return entry.description;
}

function rememberDescription(key: string, description: string, dataHash?: string): void {
  visionDescriptionCache.delete(key);
  visionDescriptionCache.set(key, { description, dataHash });
  if (dataHash) dataHashToDescription.set(dataHash, description);

  while (visionDescriptionCache.size > MAX_VISION_DESCRIPTION_CACHE_ENTRIES) {
    const oldestKey = visionDescriptionCache.keys().next().value;
    if (!oldestKey) break;
    const evicted = visionDescriptionCache.get(oldestKey);
    visionDescriptionCache.delete(oldestKey);
    if (evicted?.dataHash) {
      // Keep secondary index pointing at any other cached entry that
      // still references the same data hash (same bytes can be cached
      // under different vision model/prompt combinations).
      let remaining: VisionDescriptionCacheEntry | undefined;
      for (const entry of visionDescriptionCache.values()) {
        if (entry.dataHash === evicted.dataHash) {
          remaining = entry;
          break;
        }
      }
      if (remaining) {
        dataHashToDescription.set(evicted.dataHash, remaining.description);
      } else {
        dataHashToDescription.delete(evicted.dataHash);
      }
    }
  }
}

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
  return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}

function hasImageParts(msg: vscode.LanguageModelChatRequestMessage): boolean {
  return Array.isArray(msg.content) && msg.content.some(isImageDataPart);
}

/**
 * Resolve any image parts in user messages by forwarding them to a vision
 * model and replacing them with `[Image Description: ...]` text. This lets
 * text-only DeepSeek effectively "see" images.
 */
export async function resolveImageMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  getVisionModel: () => Promise<vscode.LanguageModelChat | null>,
): Promise<VisionResolutionResult> {
  const stats = freshStats();
  const anyImages = messages.some(hasImageParts);
  if (!anyImages) {
    stats.enabled = false;
    stats.entries = visionDescriptionCache.size;
    return { resolvedMessages: [...messages], stats };
  }

  const visionModel = await getVisionModel();
  if (!visionModel) {
    // No proxy — drop image parts (DeepSeek can't ingest them) and warn.
    logger.warn('Vision proxy not configured — dropping image parts');
    const resolved: vscode.LanguageModelChatRequestMessage[] = [];
    for (const msg of messages) {
      if (!hasImageParts(msg)) {
        resolved.push(msg);
        continue;
      }
      const filtered = (msg.content as readonly unknown[]).filter((p) => !isImageDataPart(p));
      stats.droppedImageParts += (msg.content as readonly unknown[]).length - filtered.length;
      resolved.push({
        role: msg.role,
        content: filtered as never,
      } as unknown as vscode.LanguageModelChatRequestMessage);
    }
    stats.entries = visionDescriptionCache.size;
    return { resolvedMessages: resolved, stats };
  }

  const visionPrompt = getVisionPrompt();
  const result: vscode.LanguageModelChatRequestMessage[] = [];

  for (const message of messages) {
    if (!hasImageParts(message)) {
      result.push(message);
      continue;
    }

    const resolvedParts: unknown[] = [];
    for (const part of message.content as readonly unknown[]) {
      if (!isImageDataPart(part)) {
        resolvedParts.push(part);
        continue;
      }

      stats.totalDescriptions += 1;
      const dataHash = computeDataHash(part.data);
      const cacheKey = createCacheKey(part, visionModel.id, visionPrompt, dataHash);

      const cached = getCachedDescription(cacheKey);
      if (cached !== undefined) {
        stats.hits += 1;
        stats.cacheHits += 1;
        resolvedParts.push(
          new vscode.LanguageModelTextPart(
            `${IMAGE_DESCRIPTION_PREFIX}${cached}${IMAGE_DESCRIPTION_SUFFIX}`,
          ),
        );
        continue;
      }

      // Single-flight: if another in-flight request is already describing
      // this exact image with the same model+prompt, await its result.
      let descPromise = pendingVisionDescriptions.get(cacheKey);
      if (descPromise) {
        stats.deduplicatedDescriptions += 1;
      } else {
        stats.misses += 1;
        stats.cacheMisses += 1;
        descPromise = describeImage(part, visionModel, visionPrompt).then(
          (description) => {
            if (description.length > 0) {
              rememberDescription(cacheKey, description, dataHash);
            }
            return description;
          },
          (err: unknown) => {
            logger.warn('Vision proxy failed', err);
            return '';
          },
        );
        pendingVisionDescriptions.set(cacheKey, descPromise);
        void descPromise.finally(() => {
          if (pendingVisionDescriptions.get(cacheKey) === descPromise) {
            pendingVisionDescriptions.delete(cacheKey);
          }
        });
      }

      let description = '';
      try {
        description = await descPromise;
      } catch {
        /* handled below */
      }

      if (description.length === 0) {
        stats.failedDescriptions += 1;
        resolvedParts.push(new vscode.LanguageModelTextPart(IMAGE_DESCRIPTION_UNAVAILABLE));
        continue;
      }

      stats.generatedDescriptions += 1;
      resolvedParts.push(
        new vscode.LanguageModelTextPart(
          `${IMAGE_DESCRIPTION_PREFIX}${description}${IMAGE_DESCRIPTION_SUFFIX}`,
        ),
      );
    }

    result.push({
      role: message.role,
      content: resolvedParts as never,
    } as unknown as vscode.LanguageModelChatRequestMessage);
  }

  stats.entries = visionDescriptionCache.size;
  return { resolvedMessages: result, stats, visionModelId: visionModel.id };
}

async function describeImage(
  part: vscode.LanguageModelDataPart,
  visionModel: vscode.LanguageModelChat,
  visionPrompt: string,
): Promise<string> {
  const visionMessage = vscode.LanguageModelChatMessage.User([
    part,
    new vscode.LanguageModelTextPart(visionPrompt),
  ] as (vscode.LanguageModelDataPart | vscode.LanguageModelTextPart)[]);

  const tokenSource = new vscode.CancellationTokenSource();
  try {
    const response = await visionModel.sendRequest([visionMessage], {}, tokenSource.token);
    let text = '';
    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        text += chunk.value;
      }
    }
    return text.trim();
  } finally {
    tokenSource.dispose();
  }
}
