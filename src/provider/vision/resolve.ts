import vscode from 'vscode';
import { getVisionModelSetting, getVisionPrompt } from '../../config';
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
  getVisionModel: () => Promise<vscode.LanguageModelChatInformation | null>,
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
        if (description) {
          setCachedDescription(hash, description);
          resolvedParts.push(new vscode.LanguageModelTextPart(description));
        }
        // If description is null, drop the image part silently
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
  getVisionModel: () => Promise<vscode.LanguageModelChatInformation | null>,
): Promise<string | null> {
  try {
    const visionModel = await getVisionModel();
    if (!visionModel) {
      logger.warn('No vision proxy model available — image will be dropped');
      return null;
    }

    const prompt = getVisionPrompt();
    const messages: vscode.LanguageModelChatRequestMessage[] = [
      { role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart(prompt), part], name: 'vision-proxy' },
    ];

    // Use the VS Code LM API to send the vision request.
    // The sendChatRequest API is available at runtime in VS Code 1.116+
    // but may not be in @types/vscode. Use a type assertion.
    const lm = vscode.lm as unknown as {
      sendChatRequest: (
        model: vscode.LanguageModelChatInformation,
        messages: vscode.LanguageModelChatRequestMessage[],
        options: Record<string, unknown>,
        token: vscode.CancellationToken,
      ) => Promise<{ stream: AsyncIterable<vscode.LanguageModelTextPart> }>;
    };

    const response = await lm.sendChatRequest(
      visionModel,
      messages,
      {},
      new vscode.CancellationTokenSource().token,
    );

    let text = '';
    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        text += chunk.value;
      }
    }

    return text ? `[Image Description: ${text}]` : null;
  } catch (e) {
    logger.warn('Vision proxy failed', e);
    return null;
  }
}
