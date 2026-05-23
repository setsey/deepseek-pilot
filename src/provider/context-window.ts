import vscode from 'vscode';
import type { DSUsage } from '../types';

/**
 * Tracks the **most recent turn's** prompt size against the active model's
 * context window. This is our workaround for Copilot Chat's built-in
 * "Context Window" widget, which is hardcoded to zero for third-party
 * providers (microsoft/vscode#313458).
 *
 * Why it matters specifically for DeepSeek:
 *
 *   DeepSeek's API caches by **prefix**. A request that shares its leading
 *   tokens with a previous request gets those tokens billed at the cache
 *   hit rate (~90% cheaper) AND served from cache (~10x faster first-token
 *   latency). Long, stable conversations naturally accumulate high cache
 *   hit rates — letting them grow is usually correct.
 *
 *   Compacting (summarising the history into a shorter system message)
 *   rewrites the prefix, which **invalidates the KV cache**. The next 1-3
 *   turns then have to rebuild it: every prompt token is a miss, first-
 *   token latency spikes, and cost-per-turn jumps by an order of
 *   magnitude. So compaction is not a free "speed-up" the way it is with
 *   uncached providers — it should only happen when you're close enough
 *   to the hard context limit that truncation is imminent.
 *
 * This class deliberately owns no status bar — display is folded into the
 * single combined widget in BalanceTracker. We just provide the data and
 * the classification, and a detail modal for the click-through.
 */

export interface ContextTurn {
  modelName: string;
  modelId: string;
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  timestamp: number;
}

export type ContextLevel = 'idle' | 'healthy' | 'warn' | 'critical' | 'lowCache';

export interface ContextSnapshot {
  level: ContextLevel;
  turn: ContextTurn | null;
  pctUsed: number;
  cacheHitPct: number;
  headline: string;
  advice: string;
}

const WARN_THRESHOLD_KEY = 'deepseek-pilot.contextWarnThreshold';
const CRIT_THRESHOLD_KEY = 'deepseek-pilot.contextCriticalThreshold';
const DEFAULT_WARN = 60;
const DEFAULT_CRIT = 80;

export class ContextWindowTracker {
  private lastTurn: ContextTurn | null = null;
  private onChange: (() => void) | undefined;

  /** Subscribe to updates so the owning status bar can re-render on each turn. */
  setOnChange(cb: () => void): void {
    this.onChange = cb;
  }

  recordTurn(modelInfo: vscode.LanguageModelChatInformation, usage: DSUsage): void {
    const promptTokens = usage.prompt_tokens ?? 0;
    const cacheHit = usage.prompt_cache_hit_tokens ?? 0;
    const cacheMiss =
      usage.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHit);
    const completion = usage.completion_tokens ?? 0;

    this.lastTurn = {
      modelName: modelInfo.name,
      modelId: modelInfo.id,
      promptTokens,
      cacheHitTokens: cacheHit,
      cacheMissTokens: cacheMiss,
      completionTokens: completion,
      maxInputTokens: modelInfo.maxInputTokens,
      maxOutputTokens: modelInfo.maxOutputTokens,
      timestamp: Date.now(),
    };

    this.onChange?.();
  }

  reset(): void {
    this.lastTurn = null;
    this.onChange?.();
  }

  getLastTurn(): ContextTurn | null {
    return this.lastTurn;
  }

  /** One-stop classification: level, headline, advice, and the raw % values. */
  snapshot(): ContextSnapshot {
    const turn = this.lastTurn;
    if (!turn) {
      return {
        level: 'idle',
        turn: null,
        pctUsed: 0,
        cacheHitPct: 0,
        headline: 'No turns recorded yet',
        advice:
          'Send a message and the indicator will populate from DeepSeek\'s `usage` field.',
      };
    }

    const pctUsed =
      turn.maxInputTokens > 0 ? (turn.promptTokens / turn.maxInputTokens) * 100 : 0;
    const cacheHitPct =
      turn.promptTokens > 0 ? (turn.cacheHitTokens / turn.promptTokens) * 100 : 0;
    const { warn, crit } = this.getThresholds();

    if (pctUsed >= crit) {
      return {
        level: 'critical',
        turn,
        pctUsed,
        cacheHitPct,
        headline: `Critical — ${pctUsed.toFixed(0)}% of context window used`,
        advice:
          'Compact or start a new chat **now**. You\'re close to the hard limit; the next long turn risks truncation. The KV-cache penalty from compacting is worth it at this saturation.',
      };
    }
    if (pctUsed >= warn) {
      return {
        level: 'warn',
        turn,
        pctUsed,
        cacheHitPct,
        headline: `Heads up — ${pctUsed.toFixed(0)}% used`,
        advice:
          'Plan to wrap up or compact soon. If the conversation will keep going for many more turns, compacting now is reasonable; otherwise the cache savings probably still win.',
      };
    }
    if (cacheHitPct < 30 && pctUsed > 10) {
      return {
        level: 'lowCache',
        turn,
        pctUsed,
        cacheHitPct,
        headline: `Low cache hit rate (${cacheHitPct.toFixed(0)}%)`,
        advice:
          'Recent turns are invalidating the prefix — usually caused by editing earlier messages, switching models, or large randomised system context. If you didn\'t do any of that on purpose, the cache may simply be cold (first turn after idle). It should recover over the next few turns.',
      };
    }
    return {
      level: 'healthy',
      turn,
      pctUsed,
      cacheHitPct,
      headline: `Healthy — ${pctUsed.toFixed(0)}% used, ${cacheHitPct.toFixed(0)}% cached`,
      advice:
        'Plenty of room. **Don\'t compact yet** — the KV cache is doing its job and a compaction here would force the next 1-3 turns into full cache-miss prefill (slower + more expensive).',
    };
  }

  /** Show the detailed context-window info dialog (invoked by the showContextWindow command). */
  async showDetails(): Promise<void> {
    const snap = this.snapshot();
    if (!snap.turn) {
      void vscode.window.showInformationMessage(
        'DeepSeek context window: no turns recorded yet. Send a message first.',
      );
      return;
    }

    const turn = snap.turn;
    const md = [
      `**DeepSeek Context Window** — ${turn.modelName}`,
      '',
      `**Last turn:** ${turn.promptTokens.toLocaleString()} / ${turn.maxInputTokens.toLocaleString()} prompt tokens (**${snap.pctUsed.toFixed(1)}%** of window)`,
      `**Cache hit:** ${turn.cacheHitTokens.toLocaleString()} hit + ${turn.cacheMissTokens.toLocaleString()} miss = **${snap.cacheHitPct.toFixed(0)}%** hit rate`,
      `**Output:** ${turn.completionTokens.toLocaleString()} completion tokens (max ${turn.maxOutputTokens.toLocaleString()})`,
      '',
      `**Status:** ${snap.headline}`,
      '',
      snap.advice,
      '',
      kvCachePrimerPlain(),
    ].join('\n');

    void vscode.window.showInformationMessage(snap.headline, { modal: false, detail: md });
  }

  private getThresholds(): { warn: number; crit: number } {
    const cfg = vscode.workspace.getConfiguration();
    const warn = clampPct(cfg.get<number>(WARN_THRESHOLD_KEY, DEFAULT_WARN), 10, 95);
    const crit = clampPct(cfg.get<number>(CRIT_THRESHOLD_KEY, DEFAULT_CRIT), warn + 1, 99);
    return { warn, crit };
  }
}

export function kvCachePrimerMarkdown(): string {
  return [
    '_DeepSeek caches by **prefix**. A long, stable conversation gets cheaper and faster as turns accumulate — cache hits cost ~90% less and skip the prefill stage._',
    '',
    '_Compacting rewrites the prefix and **invalidates the cache**. Use it only when you\'re close to the hard context limit. Below ~60% of window, compacting will cost you more than it saves._',
  ].join('\n');
}

function kvCachePrimerPlain(): string {
  return [
    'DeepSeek caches by prefix. Long stable conversations get cheaper and faster as turns accumulate — cache hits cost ~90% less and skip prefill.',
    'Compacting rewrites the prefix and invalidates the cache; use it only near the hard limit.',
  ].join('\n');
}

function clampPct(raw: number | undefined, min: number, max: number): number {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return Math.min(max, Math.max(min, 0));
  return Math.min(max, Math.max(min, raw));
}
