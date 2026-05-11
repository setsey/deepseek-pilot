import vscode from 'vscode';
import type { DSBalance, DSUsage } from '../types';
import { logger } from '../logger';

const PRICING = {
  USD: {
    'deepseek-v4-pro':   { cacheHit: 0.145, cacheMiss: 1.74, output: 3.48 },
    'deepseek-v4-flash': { cacheHit: 0.028, cacheMiss: 0.14, output: 0.28 },
  },
  CNY: {
    'deepseek-v4-pro':   { cacheHit: 1.0,   cacheMiss: 12.0, output: 24.0 },
    'deepseek-v4-flash': { cacheHit: 0.2,   cacheMiss: 1.0,  output: 2.0  },
  },
} as const;

export interface SessionSpend {
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  estimatedCost: number;
  currency: 'USD' | 'CNY';
}

export class BalanceTracker {
  private balance: DSBalance | null = null;
  private session: SessionSpend = {
    promptTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, completionTokens: 0,
    estimatedCost: 0, currency: 'USD',
  };
  private statusBar: vscode.StatusBarItem;

  constructor(statusBar: vscode.StatusBarItem) {
    this.statusBar = statusBar;
    this.updateStatusBar();
  }

  recordUsage(model: string, usage: DSUsage): void {
    const promptTokens = usage.prompt_tokens ?? 0;
    const cacheHit = usage.prompt_cache_hit_tokens ?? 0;
    const cacheMiss = usage.prompt_cache_miss_tokens ?? (promptTokens - cacheHit);
    const completion = usage.completion_tokens ?? 0;

    this.session.promptTokens += promptTokens;
    this.session.cacheHitTokens += cacheHit;
    this.session.cacheMissTokens += cacheMiss;
    this.session.completionTokens += completion;

    const pricing = this.getPricing(model);
    const cost =
      (cacheMiss / 1_000_000) * pricing.cacheMiss +
      (cacheHit / 1_000_000) * pricing.cacheHit +
      (completion / 1_000_000) * pricing.output;

    this.session.estimatedCost += cost;
    this.updateStatusBar();
  }

  private getPricing(model: string) {
    const currency = this.balance?.currency ?? 'USD';
    const tier = PRICING[currency];
    return tier[model as keyof typeof tier] ?? tier['deepseek-v4-pro'];
  }

  async refreshBalance(apiKey: string): Promise<void> {
    try {
      const res = await fetch('https://api.deepseek.com/user/balance', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        logger.warn(`Balance fetch failed: ${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        is_available?: boolean;
        balance_infos?: Array<{
          currency: string;
          total_granted: string;
          total_topped_up: string;
          total_used: string;
          total_balance: string;
        }>;
      };

      if (!data.is_available || !data.balance_infos?.[0]) {
        logger.warn('Balance not available from API');
        return;
      }

      const info = data.balance_infos[0]!;
      this.balance = {
        currency: info.currency as 'USD' | 'CNY',
        totalGranted: Number.parseFloat(info.total_granted),
        totalToppedUp: Number.parseFloat(info.total_topped_up),
        totalUsed: Number.parseFloat(info.total_used),
        totalBalance: Number.parseFloat(info.total_balance),
        fetchedAt: Date.now(),
      };

      // Recalculate session cost in the correct currency
      this.session.currency = this.balance.currency;
      this.updateStatusBar();

      const symbol = this.balance.currency === 'CNY' ? '¥' : '$';
      vscode.window.showInformationMessage(
        `DeepSeek balance: ${symbol}${this.balance.totalBalance.toFixed(2)} (used ${symbol}${this.balance.totalUsed.toFixed(2)})`,
      );
    } catch (e) {
      logger.warn('Balance fetch error', e);
    }
  }

  clearSession(): void {
    this.session = {
      promptTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, completionTokens: 0,
      estimatedCost: 0, currency: this.balance?.currency ?? 'USD',
    };
    this.updateStatusBar();
    vscode.window.showInformationMessage('Session counter cleared.');
  }

  getSessionSpend(): SessionSpend {
    return { ...this.session };
  }

  getBalance(): DSBalance | null {
    return this.balance;
  }

  private updateStatusBar(): void {
    const symbol = this.session.currency === 'CNY' ? '¥' : '$';
    const cost = this.session.estimatedCost;
    const costStr = cost < 0.01 ? '<0.01' : cost.toFixed(2);
    const tokens = this.session.promptTokens + this.session.completionTokens;
    const tokensStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(0)}k` : String(tokens);

    this.statusBar.text = `$(deepseek) ${tokensStr} tokens · ${symbol}${costStr}`;
    this.statusBar.tooltip = this.buildTooltip();
    this.statusBar.show();
  }

  private buildTooltip(): string {
    const s = this.session;
    const b = this.balance;
    const symbol = s.currency === 'CNY' ? '¥' : '$';

    let tip = `Session: ${s.promptTokens.toLocaleString()} prompt · ${s.completionTokens.toLocaleString()} completion`;
    tip += `\nCache: ${s.cacheHitTokens.toLocaleString()} hit · ${s.cacheMissTokens.toLocaleString()} miss`;
    tip += `\nEstimated cost: ${symbol}${s.estimatedCost.toFixed(4)}`;

    if (b) {
      tip += `\n\nPlatform balance: ${symbol}${b.totalBalance.toFixed(2)}`;
      tip += `\nUsed: ${symbol}${b.totalUsed.toFixed(2)}`;
      tip += `\nFetched: ${new Date(b.fetchedAt).toLocaleTimeString()}`;
    }

    return tip;
  }
}
