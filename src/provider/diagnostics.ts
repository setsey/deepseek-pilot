import { createHash } from 'node:crypto';
import type { OpenAIChatMessage } from '../types';
import { getDebugLoggingEnabled } from '../config';
import { logger } from '../logger';

/**
 * Privacy-preserving cache-trace diagnostics.
 *
 * Goals:
 *   - Help diagnose 400s (especially the `Messages with role 'tool' must
 *     be a response to a preceding message with 'tool_calls'` error) by
 *     showing the exact role sequence and tool_call_id pairing.
 *   - Surface "what changed across turns" so users can tell when their
 *     reasoning_content cache hit/miss rate is off.
 *   - Stay debug-only — only emits when `deepseek-pilot.debug` is enabled
 *     so normal users see no noise in the output channel.
 *
 * No raw message content ever reaches the log — only role counts, lengths,
 * tool call name/id pairs (the IDs are local to the conversation and not
 * sensitive on their own), and SHA-256 hashes of normalized content.
 */

let requestSequence = 0;

interface MessageSummary {
  role: string;
  contentChars: number;
  reasoningChars: number;
  toolCalls: Array<{ name: string; id: string }>;
  toolCallIds: string[];
  toolCallId?: string;
  hash: string;
}

export interface CacheTraceSnapshot {
  requestId: number;
  fingerprint: string;
  conversationKey: string;
  roleSequence: string;
  messageCount: number;
  toolCount: number;
  toolCallPairing: { unpairedToolCalls: string[]; unpairedToolResults: string[] };
  stats: {
    userMessages: number;
    assistantMessages: number;
    toolMessages: number;
    systemMessages: number;
    assistantToolCallMessages: number;
    nonEmptyReasoningMessages: number;
    emptyReasoningMessages: number;
    missingReasoningMessages: number;
    totalContentChars: number;
    totalReasoningChars: number;
  };
}

export function snapshotCacheTrace(
  messages: readonly OpenAIChatMessage[],
  toolCount: number,
): CacheTraceSnapshot {
  const summaries: MessageSummary[] = [];
  const stats = {
    userMessages: 0,
    assistantMessages: 0,
    toolMessages: 0,
    systemMessages: 0,
    assistantToolCallMessages: 0,
    nonEmptyReasoningMessages: 0,
    emptyReasoningMessages: 0,
    missingReasoningMessages: 0,
    totalContentChars: 0,
    totalReasoningChars: 0,
  };
  const openToolCallIds: string[] = [];
  const unpairedToolResults: string[] = [];

  for (const msg of messages) {
    const contentChars = msg.content?.length ?? 0;
    const reasoningChars = msg.reasoning_content?.length ?? 0;
    stats.totalContentChars += contentChars;
    stats.totalReasoningChars += reasoningChars;

    const summary: MessageSummary = {
      role: msg.role,
      contentChars,
      reasoningChars,
      toolCalls: (msg.tool_calls ?? []).map((tc) => ({ name: tc.function.name, id: tc.id })),
      toolCallIds: (msg.tool_calls ?? []).map((tc) => tc.id),
      toolCallId: msg.tool_call_id,
      hash: hashContent(msg),
    };

    switch (msg.role) {
      case 'user':
        stats.userMessages += 1;
        break;
      case 'assistant':
        stats.assistantMessages += 1;
        if (summary.toolCalls.length > 0) {
          stats.assistantToolCallMessages += 1;
          openToolCallIds.push(...summary.toolCallIds);
        }
        if (msg.reasoning_content === undefined) {
          stats.missingReasoningMessages += 1;
        } else if (msg.reasoning_content === '') {
          stats.emptyReasoningMessages += 1;
        } else {
          stats.nonEmptyReasoningMessages += 1;
        }
        break;
      case 'tool': {
        stats.toolMessages += 1;
        const id = summary.toolCallId ?? '';
        const idx = openToolCallIds.indexOf(id);
        if (idx >= 0) {
          openToolCallIds.splice(idx, 1);
        } else {
          unpairedToolResults.push(id);
        }
        break;
      }
      case 'system':
        stats.systemMessages += 1;
        break;
      default:
        break;
    }

    summaries.push(summary);
  }

  const fingerprintInput = JSON.stringify(
    summaries.map((s) => ({
      role: s.role,
      hash: s.hash,
      tc: s.toolCalls.map((t) => `${t.name}:${t.id}`).sort(),
      trId: s.toolCallId ?? '',
    })),
  );
  const firstUserHash = summaries.find((s) => s.role === 'user')?.hash ?? '';

  requestSequence += 1;

  return {
    requestId: requestSequence,
    fingerprint: hashString(fingerprintInput),
    conversationKey: hashString(firstUserHash),
    roleSequence: summaries.map(roleTag).join(' → '),
    messageCount: summaries.length,
    toolCount,
    toolCallPairing: {
      unpairedToolCalls: [...openToolCallIds],
      unpairedToolResults,
    },
    stats,
  };
}

export function logCacheTraceSnapshot(snapshot: CacheTraceSnapshot): void {
  if (!getDebugLoggingEnabled()) return;
  const lines = [
    `[cache-trace #${snapshot.requestId}] fingerprint=${snapshot.fingerprint} conv=${snapshot.conversationKey}`,
    `[cache-trace #${snapshot.requestId}] sequence: ${snapshot.roleSequence}`,
    `[cache-trace #${snapshot.requestId}] messages=${snapshot.messageCount} tools=${snapshot.toolCount}`,
    `[cache-trace #${snapshot.requestId}] roles user=${snapshot.stats.userMessages} asst=${snapshot.stats.assistantMessages} tool=${snapshot.stats.toolMessages} sys=${snapshot.stats.systemMessages}`,
    `[cache-trace #${snapshot.requestId}] asst.tc=${snapshot.stats.assistantToolCallMessages} reasoning ne=${snapshot.stats.nonEmptyReasoningMessages} empty=${snapshot.stats.emptyReasoningMessages} missing=${snapshot.stats.missingReasoningMessages}`,
  ];
  if (snapshot.toolCallPairing.unpairedToolCalls.length > 0) {
    lines.push(
      `[cache-trace #${snapshot.requestId}] WARN unpaired tool_calls (no matching tool result): ${snapshot.toolCallPairing.unpairedToolCalls.join(', ')}`,
    );
  }
  if (snapshot.toolCallPairing.unpairedToolResults.length > 0) {
    lines.push(
      `[cache-trace #${snapshot.requestId}] WARN unpaired tool_results (no matching tool_call): ${snapshot.toolCallPairing.unpairedToolResults.join(', ')}`,
    );
  }
  for (const line of lines) logger.debug(line);
}

function roleTag(s: MessageSummary): string {
  if (s.role === 'assistant' && s.toolCalls.length > 0) {
    return `asst[tc:${s.toolCalls.map((tc) => tc.name).join(',')}]`;
  }
  if (s.role === 'tool') return `tool[id:${s.toolCallId ?? '?'}]`;
  return s.role;
}

function hashContent(msg: OpenAIChatMessage): string {
  const normalized = JSON.stringify({
    role: msg.role,
    content: msg.content ?? '',
    tool_calls: (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: tc.function.arguments,
    })),
    tool_call_id: msg.tool_call_id ?? '',
  });
  return hashString(normalized);
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
