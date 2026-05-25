import vscode from 'vscode';
import type { DSBalance, DSUsage } from '../types';
import { getApiUrl, getReasoningEffort } from '../config';
import { logger } from '../logger';
import type { ContextWindowTracker } from './context-window';
import { kvCachePrimerMarkdown } from './context-window';

/**
 * Per-million-token pricing baked in from
 * https://api-docs.deepseek.com/quick_start/pricing. Two DeepSeek-side
 * changes between v0.2.1 and v0.2.2 the numbers below already reflect:
 *   1. **2026-04-26 12:15 UTC** — cache-hit input price for ALL models
 *      dropped to 1/10 of cache-miss (was 1/12 historically for Pro).
 *   2. **2026-05-22** — DeepSeek announced the previously-promotional
 *      V4-Pro 75%-off pricing is now PERMANENT
 *      (https://x.com/deepseek_ai/status/... — confirmed by Bloomberg,
 *      Engadget, the-decoder, DataConomy). The pricing page still has
 *      the stale "promo ends 2026-05-31" wording but lists the post-promo
 *      rate as 1/4 of original, i.e. unchanged. The `applyProDiscount`
 *      opt-in is therefore gone.
 * So Pro = (original × 0.25) for miss/output and (original × 0.025) for
 * hit; Flash = unchanged miss/output, hit dropped to 1/10 of miss.
 */
const PRICING = {
  USD: {
    'deepseek-v4-pro': { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
    'deepseek-v4-flash': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
  },
  CNY: {
    'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3.0, output: 6.0 },
    'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1.0, output: 2.0 },
  },
} as const;

type PricingCurrency = keyof typeof PRICING;

/** Approximate USD↔CNY conversion rate, used to convert a previously
 * accumulated session total when the account currency is discovered. */
const USD_TO_CNY_RATE = 7;

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'CNY':
      return '¥';
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'JPY':
      return '¥';
    default:
      return `${currency} `;
  }
}

function formatTime24(timestamp: number): string {
  const d = new Date(timestamp);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export interface SessionSpend {
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  estimatedCost: number;
  currency: PricingCurrency;
  requestCount: number;
}

export class BalanceTracker {
  private balance: DSBalance | null = null;
  private session: SessionSpend = freshSession();
  private autoRefreshTimer: NodeJS.Timeout | undefined;
  private getApiKey: () => Promise<string | undefined>;
  private userAgent: string;
  private contextTracker: ContextWindowTracker | undefined;

  constructor(
    private readonly statusBar: vscode.StatusBarItem,
    getApiKey: () => Promise<string | undefined>,
    userAgent: string,
  ) {
    this.getApiKey = getApiKey;
    this.userAgent = userAgent;
    this.updateStatusBar();
  }

  /**
   * Attach a context-window tracker. The status bar then folds the
   * "% of context window used · cache hit %" glance into the single
   * widget and re-renders when the context tracker fires.
   */
  attachContextTracker(tracker: ContextWindowTracker): void {
    this.contextTracker = tracker;
    tracker.setOnChange(() => this.updateStatusBar());
    this.updateStatusBar();
  }

  recordUsage(model: string, usage: DSUsage): void {
    const promptTokens = usage.prompt_tokens ?? 0;
    const cacheHit = usage.prompt_cache_hit_tokens ?? 0;
    const cacheMiss =
      usage.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHit);
    const completion = usage.completion_tokens ?? 0;
    const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0;

    this.session.promptTokens += promptTokens;
    this.session.cacheHitTokens += cacheHit;
    this.session.cacheMissTokens += cacheMiss;
    this.session.completionTokens += completion;
    this.session.reasoningTokens += reasoning;
    this.session.requestCount += 1;

    const pricing = this.getPricing(model);
    const cost =
      (cacheMiss / 1_000_000) * pricing.cacheMiss +
      (cacheHit / 1_000_000) * pricing.cacheHit +
      (completion / 1_000_000) * pricing.output;

    this.session.estimatedCost += cost;

    logger.info(
      `usage prompt=${promptTokens} hit=${cacheHit} miss=${cacheMiss} out=${completion} reasoning=${reasoning} cost=${cost.toFixed(6)} ${this.session.currency} total=${this.session.estimatedCost.toFixed(4)}`,
    );

    this.updateStatusBar();
    this.scheduleSilentBalanceRefresh();
  }

  private getPricing(model: string) {
    const tier = PRICING[this.session.currency];
    return tier[model as keyof typeof tier] ?? tier['deepseek-v4-pro'];
  }

  async refreshBalance(silent = false): Promise<void> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      if (!silent) {
        vscode.window.showWarningMessage(
          'Set your DeepSeek API key first (Command Palette → DeepSeek Pilot: Set API Key).',
        );
      }
      return;
    }

    try {
      const res = await fetch(getApiUrl('user/balance'), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': this.userAgent,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.warn(`Balance fetch failed: ${res.status} ${text.slice(0, 200)}`);
        if (!silent) {
          vscode.window.showWarningMessage(`Failed to fetch balance: HTTP ${res.status}`);
        }
        return;
      }

      const data = (await res.json()) as {
        is_available?: boolean;
        balance_infos?: Array<{
          currency: string;
          total_balance: string;
          granted_balance?: string;
          topped_up_balance?: string;
          total_granted?: string;
          total_topped_up?: string;
          total_used?: string;
        }>;
      };

      const info = data.balance_infos?.[0];
      if (!info) {
        if (!silent) {
          vscode.window.showWarningMessage('DeepSeek returned an empty balance response.');
        }
        return;
      }

      this.balance = {
        currency: info.currency.toUpperCase() as 'USD' | 'CNY',
        totalGranted: Number.parseFloat(info.total_granted ?? info.granted_balance ?? '0'),
        totalToppedUp: Number.parseFloat(info.total_topped_up ?? info.topped_up_balance ?? '0'),
        totalUsed: Number.parseFloat(info.total_used ?? '0'),
        totalBalance: Number.parseFloat(info.total_balance),
        fetchedAt: Date.now(),
      };

      // Switch session currency to match the account's currency. Convert
      // previously accumulated session cost so the running total stays
      // consistent across the same session.
      const accountCurrency = this.balance.currency;
      if (
        (accountCurrency === 'USD' || accountCurrency === 'CNY') &&
        accountCurrency !== this.session.currency
      ) {
        if (this.session.currency === 'USD' && accountCurrency === 'CNY') {
          this.session.estimatedCost *= USD_TO_CNY_RATE;
        } else if (this.session.currency === 'CNY' && accountCurrency === 'USD') {
          this.session.estimatedCost /= USD_TO_CNY_RATE;
        }
        this.session.currency = accountCurrency;
      }

      this.updateStatusBar();

      if (!silent) {
        const sym = currencySymbol(this.balance.currency);
        void vscode.window.setStatusBarMessage(
          `$(check) DeepSeek balance: ${sym}${this.balance.totalBalance.toFixed(2)}`,
          4000,
        );
      }
    } catch (e) {
      logger.warn('Balance fetch error', e);
      if (!silent) {
        vscode.window.showErrorMessage(
          `Failed to refresh DeepSeek balance: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /**
   * Debounced silent refresh ~1.5s after the most recent recordUsage().
   * Multiple back-to-back chats only trigger a single fetch. No-op until
   * the user has fetched balance at least once manually — we don't push
   * background work on their behalf without consent.
   */
  private scheduleSilentBalanceRefresh(): void {
    if (!this.balance) return;
    if (this.autoRefreshTimer) clearTimeout(this.autoRefreshTimer);
    this.autoRefreshTimer = setTimeout(() => {
      this.autoRefreshTimer = undefined;
      void this.refreshBalance(true);
    }, 1500);
  }

  clearSession(): void {
    this.session = freshSession(this.session.currency);
    this.contextTracker?.reset();
    this.updateStatusBar();
    vscode.window.showInformationMessage('DeepSeek Pilot session counter cleared.');
  }

  getSessionSpend(): SessionSpend {
    return { ...this.session };
  }

  getBalance(): DSBalance | null {
    return this.balance;
  }

  refreshDisplay(): void {
    this.updateStatusBar();
  }

  dispose(): void {
    if (this.autoRefreshTimer) {
      clearTimeout(this.autoRefreshTimer);
      this.autoRefreshTimer = undefined;
    }
  }

  private updateStatusBar(): void {
    const sym = currencySymbol(this.session.currency);
    const cost = this.session.estimatedCost;
    const costStr = cost === 0 ? '0' : cost < 0.01 ? '<0.01' : cost.toFixed(2);
    const balanceStr = this.balance ? `  ${sym}${this.balance.totalBalance.toFixed(2)}` : '';

    // Fold context-window state into the glance text and the background
    // color. Order: [icon] DeepSeek Pilot · [N% ctx] · [cost]  [balance].
    // The icon (and bg colour) come from the context level so saturation
    // is the dominant signal.
    const ctxSnap = this.contextTracker?.snapshot();
    let icon = '$(sparkle)';
    let bgColor: vscode.ThemeColor | undefined;
    let ctxFragment = '';

    if (ctxSnap && ctxSnap.turn) {
      const ctxPct = `${ctxSnap.pctUsed.toFixed(0)}%`;
      ctxFragment = ` · ${ctxPct} ctx`;
      if (ctxSnap.level === 'critical') {
        icon = '$(warning)';
        bgColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      } else if (ctxSnap.level === 'warn') {
        icon = '$(history)';
        bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      }
    }

    this.statusBar.text = `${icon} DeepSeek Pilot${ctxFragment} · ${sym}${costStr}${balanceStr}`;
    this.statusBar.tooltip = this.buildTooltip();
    this.statusBar.backgroundColor = bgColor;
    this.statusBar.show();
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportThemeIcons = true;

    md.appendMarkdown('### DeepSeek Pilot\n\n');

    // ── Context window (leads with the most actionable signal) ──
    const ctxSnap = this.contextTracker?.snapshot();
    if (ctxSnap && ctxSnap.turn) {
      const turn = ctxSnap.turn;
      md.appendMarkdown(`**Model** &nbsp; \`${turn.modelName}\`\n\n`);
      md.appendMarkdown(
        `**Last turn** &nbsp; ${turn.promptTokens.toLocaleString()} / ${turn.maxInputTokens.toLocaleString()} prompt tokens (**${ctxSnap.pctUsed.toFixed(1)}%**) · ${ctxSnap.cacheHitPct.toFixed(0)}% cached\n\n`,
      );
      md.appendMarkdown(`**${ctxSnap.headline}** — ${ctxSnap.advice}\n\n`);
      md.appendMarkdown(
        `${kvCachePrimerMarkdown()}\n\n` +
          '[$(info) Compaction details](command:deepseek-pilot.showContextWindow) &nbsp; ' +
          '[$(gear) Thresholds](command:workbench.action.openSettings?%22deepseek-pilot.contextWarnThreshold%22)\n\n',
      );
      md.appendMarkdown('---\n\n');
    }

    const sym = currencySymbol(this.session.currency);
    const cacheHitPct =
      this.session.promptTokens > 0
        ? (this.session.cacheHitTokens / this.session.promptTokens) * 100
        : 0;
    md.appendMarkdown(`**Session** &nbsp; \`${this.session.requestCount} requests\`\n\n`);
    md.appendMarkdown(
      `- Prompt tokens: ${this.session.promptTokens.toLocaleString()} ` +
        `(${this.session.cacheHitTokens.toLocaleString()} cache hit, ${this.session.cacheMissTokens.toLocaleString()} miss · ${cacheHitPct.toFixed(0)}% hit)\n`,
    );
    md.appendMarkdown(
      `- Completion tokens: ${this.session.completionTokens.toLocaleString()} ` +
        `(${this.session.reasoningTokens.toLocaleString()} reasoning)\n`,
    );
    md.appendMarkdown(`- Estimated cost: ${sym}${this.session.estimatedCost.toFixed(4)}\n\n`);

    md.appendMarkdown(`[$(refresh) Clear session](command:deepseek-pilot.clearSession)\n\n`);

    md.appendMarkdown('---\n\n');

    md.appendMarkdown(
      this.balance
        ? '**Balance** &nbsp; [$(refresh) refresh](command:deepseek-pilot.refreshBalance)\n\n'
        : '**Balance** &nbsp; [$(refresh) click to fetch](command:deepseek-pilot.refreshBalance)\n\n',
    );
    if (this.balance) {
      const bsym = currencySymbol(this.balance.currency);
      md.appendMarkdown(
        `${bsym}${this.balance.totalBalance.toFixed(2)} &nbsp;·&nbsp; ${formatTime24(this.balance.fetchedAt)}\n\n`,
      );
      if (this.balance.totalGranted > 0 || this.balance.totalToppedUp > 0) {
        md.appendMarkdown(
          `_${bsym}${this.balance.totalGranted.toFixed(2)} granted + ${bsym}${this.balance.totalToppedUp.toFixed(2)} topped up_\n\n`,
        );
      }
      const accountCcy = this.balance.currency;
      if (accountCcy !== 'USD' && accountCcy !== 'CNY') {
        md.appendMarkdown(
          `_$(warning) Cost estimation uses USD pricing — actual billing is in ${accountCcy}_\n\n`,
        );
      }
    }

    md.appendMarkdown('---\n\n');
    md.appendMarkdown(
      `**Reasoning effort** &nbsp; \`${getReasoningEffort()}\` &nbsp; ` +
        '[$(gear) configure](command:workbench.action.openSettings?%22deepseek-pilot.reasoningEffort%22)\n\n',
    );
    md.appendMarkdown('[View full log](command:deepseek-pilot.showLogs)');

    return md;
  }
}

function freshSession(currency: PricingCurrency = 'USD'): SessionSpend {
  return {
    promptTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    estimatedCost: 0,
    currency,
    requestCount: 0,
  };
}
