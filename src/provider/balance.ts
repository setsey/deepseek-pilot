import vscode from 'vscode';
import type { DSBalance, DSUsage } from '../types';
import { getApiUrl, getApplyProDiscount, getReasoningEffort } from '../config';
import { logger } from '../logger';

/**
 * DeepSeek-V4-Pro is on a 75% promotional discount until this date.
 * Source: https://api-docs.deepseek.com/quick_start/pricing — confirmed
 * via the docs as "extended until 2026/05/31 15:59 UTC".
 * After this timestamp the regular pricing automatically applies.
 */
const PRO_DISCOUNT_END_UTC = Date.UTC(2026, 4, 31, 15, 59, 0); // months are 0-indexed
const PRO_DISCOUNT_FACTOR = 0.25; // 75% off = 25% of regular price

/**
 * Per-million-token regular pricing (snapshot 2026-04 from
 * https://api-docs.deepseek.com/quick_start/pricing). DeepSeek-v4-pro
 * carries a limited-time 75% discount during certain windows; we report
 * REGULAR price so the displayed figure is an upper bound on actual cost.
 */
const PRICING = {
  USD: {
    'deepseek-v4-pro': { cacheHit: 0.145, cacheMiss: 1.74, output: 3.48 },
    'deepseek-v4-flash': { cacheHit: 0.028, cacheMiss: 0.14, output: 0.28 },
  },
  CNY: {
    'deepseek-v4-pro': { cacheHit: 1.0, cacheMiss: 12.0, output: 24.0 },
    'deepseek-v4-flash': { cacheHit: 0.2, cacheMiss: 1.0, output: 2.0 },
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

  constructor(
    private readonly statusBar: vscode.StatusBarItem,
    getApiKey: () => Promise<string | undefined>,
    userAgent: string,
  ) {
    this.getApiKey = getApiKey;
    this.userAgent = userAgent;
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
    const base = tier[model as keyof typeof tier] ?? tier['deepseek-v4-pro'];

    // Apply the 75% Pro discount when the user has opted in AND the
    // promotional window is still active. Flash isn't discounted.
    if (
      model === 'deepseek-v4-pro' &&
      getApplyProDiscount() &&
      Date.now() < PRO_DISCOUNT_END_UTC
    ) {
      return {
        cacheHit: base.cacheHit * PRO_DISCOUNT_FACTOR,
        cacheMiss: base.cacheMiss * PRO_DISCOUNT_FACTOR,
        output: base.output * PRO_DISCOUNT_FACTOR,
      };
    }

    return base;
  }

  async refreshBalance(silent = false): Promise<void> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      if (!silent) {
        vscode.window.showWarningMessage(
          'Set your DeepSeek API key first (Command Palette → DeepSeek QA: Set API Key).',
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
    this.updateStatusBar();
    vscode.window.showInformationMessage('DeepSeek QA session counter cleared.');
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
    this.statusBar.text = `$(sparkle) DeepSeek QA · ${sym}${costStr}${balanceStr}`;
    this.statusBar.tooltip = this.buildTooltip();
    this.statusBar.show();
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportThemeIcons = true;

    md.appendMarkdown('### DeepSeek V4 QA\n\n');

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

    // Flag whether the Pro 75% discount is actively applied to the cost.
    if (Date.now() < PRO_DISCOUNT_END_UTC) {
      const endDate = new Date(PRO_DISCOUNT_END_UTC).toISOString().slice(0, 10);
      if (getApplyProDiscount()) {
        md.appendMarkdown(`_$(tag) Pro 75% discount applied until ${endDate}_\n\n`);
      } else {
        md.appendMarkdown(
          `_$(info) Pro 75% discount available until ${endDate} — ` +
            '[enable](command:workbench.action.openSettings?%22deepseek-qa.applyProDiscount%22) to apply to cost estimates_\n\n',
        );
      }
    }

    md.appendMarkdown(`[$(refresh) Clear session](command:deepseek-qa.clearSession)\n\n`);

    md.appendMarkdown('---\n\n');

    md.appendMarkdown(
      this.balance
        ? '**Balance** &nbsp; [$(refresh) refresh](command:deepseek-qa.refreshBalance)\n\n'
        : '**Balance** &nbsp; [$(refresh) click to fetch](command:deepseek-qa.refreshBalance)\n\n',
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
        '[$(gear) configure](command:workbench.action.openSettings?%22deepseek-qa.reasoningEffort%22)\n\n',
    );
    md.appendMarkdown('[View full log](command:deepseek-qa.showLogs)');

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
