import vscode from 'vscode';
import type { DSUsage } from '../types';

/**
 * Tracks the **most recent turn's** prompt size against the active model's
 * context window, and surfaces it as a status bar item. This is our
 * workaround for Copilot Chat's built-in "Context Window" widget, which
 * does not populate for third-party providers (microsoft/vscode#313458).
 *
 * Why a separate widget — and why it matters for DeepSeek specifically:
 *
 *   DeepSeek's API caches by **prefix**. A request that shares its leading
 *   tokens with a previous request gets those tokens billed at the cache
 *   hit rate (~90% cheaper) AND served from cache (~10x faster first-token
 *   latency). Long, stable conversations naturally have high cache hit
 *   rates — letting them grow is usually correct.
 *
 *   Compacting (summarising the history into a shorter system message)
 *   rewrites the prefix, which **invalidates the KV cache**. The next 1-3
 *   turns then have to rebuild the cache: every prompt token is a miss,
 *   first-token latency spikes, and cost-per-turn jumps by an order of
 *   magnitude. So compaction is not a free "speed-up" the way it is with
 *   uncached providers — it should only happen when you're close enough
 *   to the hard context limit that truncation is imminent.
 *
 *   This widget shows both signals (% of window used + recent cache hit
 *   rate) and gives advice tuned to that trade-off.
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

const WARN_THRESHOLD_KEY = 'deepseek-qa.contextWarnThreshold';
const CRIT_THRESHOLD_KEY = 'deepseek-qa.contextCriticalThreshold';
const DEFAULT_WARN = 60;
const DEFAULT_CRIT = 80;

export class ContextWindowTracker {
  private lastTurn: ContextTurn | null = null;

  constructor(private readonly statusBar: vscode.StatusBarItem) {
    this.statusBar.command = 'deepseek-qa.showContextWindow';
    this.statusBar.name = 'DeepSeek Context Window';
    this.updateDisplay();
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

    this.updateDisplay();
  }

  reset(): void {
    this.lastTurn = null;
    this.updateDisplay();
  }

  getLastTurn(): ContextTurn | null {
    return this.lastTurn;
  }

  refreshDisplay(): void {
    this.updateDisplay();
  }

  dispose(): void {
    this.statusBar.dispose();
  }

  /** Show the detailed context-window quick pick / info dialog. */
  async showDetails(): Promise<void> {
    const turn = this.lastTurn;
    if (!turn) {
      void vscode.window.showInformationMessage(
        'DeepSeek context window: no turns recorded yet. Send a message first.',
      );
      return;
    }

    const pctUsed = turn.maxInputTokens > 0 ? (turn.promptTokens / turn.maxInputTokens) * 100 : 0;
    const cacheHitPct =
      turn.promptTokens > 0 ? (turn.cacheHitTokens / turn.promptTokens) * 100 : 0;
    const { headline, advice } = this.classify(pctUsed, cacheHitPct);

    const md = [
      `**DeepSeek Context Window** — ${turn.modelName}`,
      '',
      `**Last turn:** ${turn.promptTokens.toLocaleString()} / ${turn.maxInputTokens.toLocaleString()} prompt tokens (**${pctUsed.toFixed(1)}%** of window)`,
      `**Cache hit:** ${turn.cacheHitTokens.toLocaleString()} hit + ${turn.cacheMissTokens.toLocaleString()} miss = **${cacheHitPct.toFixed(0)}%** hit rate`,
      `**Output:** ${turn.completionTokens.toLocaleString()} completion tokens (max ${turn.maxOutputTokens.toLocaleString()})`,
      '',
      `**Status:** ${headline}`,
      '',
      advice,
    ].join('\n');

    void vscode.window.showInformationMessage(headline, { modal: false, detail: md });
  }

  private updateDisplay(): void {
    if (!this.lastTurn) {
      this.statusBar.text = '$(history) Ctx —';
      this.statusBar.tooltip = this.buildTooltip();
      this.statusBar.backgroundColor = undefined;
      this.statusBar.show();
      return;
    }

    const turn = this.lastTurn;
    const pctUsed = turn.maxInputTokens > 0 ? (turn.promptTokens / turn.maxInputTokens) * 100 : 0;
    const cacheHitPct =
      turn.promptTokens > 0 ? (turn.cacheHitTokens / turn.promptTokens) * 100 : 0;
    const { warn, crit } = this.getThresholds();

    const promptStr = formatK(turn.promptTokens);
    const maxStr = formatK(turn.maxInputTokens);

    let icon = '$(history)';
    let bgColor: vscode.ThemeColor | undefined;
    if (pctUsed >= crit) {
      icon = '$(warning)';
      bgColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (pctUsed >= warn) {
      icon = '$(history)';
      bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    this.statusBar.text =
      `${icon} Ctx ${promptStr}/${maxStr} (${pctUsed.toFixed(0)}%) · ${cacheHitPct.toFixed(0)}% cached`;
    this.statusBar.tooltip = this.buildTooltip();
    this.statusBar.backgroundColor = bgColor;
    this.statusBar.show();
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportThemeIcons = true;

    md.appendMarkdown('### DeepSeek Context Window\n\n');

    if (!this.lastTurn) {
      md.appendMarkdown(
        '_No turn recorded yet. Send a message and the indicator will populate from DeepSeek\'s `usage` field._\n\n',
      );
      md.appendMarkdown('---\n\n');
      md.appendMarkdown(this.kvCachePrimer());
      return md;
    }

    const turn = this.lastTurn;
    const pctUsed = turn.maxInputTokens > 0 ? (turn.promptTokens / turn.maxInputTokens) * 100 : 0;
    const cacheHitPct =
      turn.promptTokens > 0 ? (turn.cacheHitTokens / turn.promptTokens) * 100 : 0;
    const { headline, advice } = this.classify(pctUsed, cacheHitPct);

    md.appendMarkdown(`**Model** &nbsp; \`${turn.modelName}\`\n\n`);
    md.appendMarkdown(
      `**Last turn** &nbsp; ${turn.promptTokens.toLocaleString()} / ${turn.maxInputTokens.toLocaleString()} prompt tokens (**${pctUsed.toFixed(1)}%**)\n\n`,
    );
    md.appendMarkdown(
      `- Cache hit: ${turn.cacheHitTokens.toLocaleString()} (${cacheHitPct.toFixed(0)}%)\n`,
    );
    md.appendMarkdown(`- Cache miss: ${turn.cacheMissTokens.toLocaleString()}\n`);
    md.appendMarkdown(
      `- Completion: ${turn.completionTokens.toLocaleString()} / ${turn.maxOutputTokens.toLocaleString()} max output\n\n`,
    );

    md.appendMarkdown(`**${headline}**\n\n`);
    md.appendMarkdown(`${advice}\n\n`);

    md.appendMarkdown('---\n\n');
    md.appendMarkdown(this.kvCachePrimer());

    md.appendMarkdown('\n---\n\n');
    md.appendMarkdown(
      '[$(gear) Configure thresholds](command:workbench.action.openSettings?%22deepseek-qa.contextWarnThreshold%22) &nbsp; ' +
        '[$(info) Details](command:deepseek-qa.showContextWindow)\n',
    );
    return md;
  }

  private kvCachePrimer(): string {
    return [
      '_DeepSeek caches by **prefix**. A long, stable conversation gets cheaper and faster as turns accumulate — cache hits cost ~90% less and skip the prefill stage._',
      '',
      '_Compacting rewrites the prefix and **invalidates the cache**. Use it only when you\'re close to the hard context limit. Below ~60% of window, compacting will cost you more than it saves._',
    ].join('\n');
  }

  private classify(pctUsed: number, cacheHitPct: number): {
    headline: string;
    advice: string;
  } {
    const { warn, crit } = this.getThresholds();

    if (pctUsed >= crit) {
      return {
        headline: `Critical — ${pctUsed.toFixed(0)}% of context window used`,
        advice:
          'Compact or start a new chat **now**. You\'re close to the hard limit; the next long turn risks truncation. The KV-cache penalty from compacting is worth it at this saturation.',
      };
    }
    if (pctUsed >= warn) {
      return {
        headline: `Heads up — ${pctUsed.toFixed(0)}% used`,
        advice:
          'Plan to wrap up or compact soon. If the conversation will keep going for many more turns, compacting now is reasonable; otherwise the cache savings probably still win.',
      };
    }
    if (cacheHitPct < 30 && pctUsed > 10) {
      return {
        headline: `Low cache hit rate (${cacheHitPct.toFixed(0)}%)`,
        advice:
          'Recent turns are invalidating the prefix — usually caused by editing earlier messages, switching models, or large randomised system context. If you didn\'t do any of that on purpose, the cache may simply be cold (first turn after idle). It should recover over the next few turns.',
      };
    }
    return {
      headline: `Healthy — ${pctUsed.toFixed(0)}% used, ${cacheHitPct.toFixed(0)}% cached`,
      advice:
        'Plenty of room. **Don\'t compact yet** — the KV cache is doing its job and a compaction here would force the next 1-3 turns into full cache-miss prefill (slower + more expensive).',
    };
  }

  private getThresholds(): { warn: number; crit: number } {
    const cfg = vscode.workspace.getConfiguration();
    const warn = clampPct(cfg.get<number>(WARN_THRESHOLD_KEY, DEFAULT_WARN), 10, 95);
    const crit = clampPct(cfg.get<number>(CRIT_THRESHOLD_KEY, DEFAULT_CRIT), warn + 1, 99);
    return { warn, crit };
  }
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

function clampPct(raw: number | undefined, min: number, max: number): number {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return Math.min(max, Math.max(min, 0));
  return Math.min(max, Math.max(min, raw));
}
