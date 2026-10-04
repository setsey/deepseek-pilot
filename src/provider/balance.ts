import vscode from 'vscode';
import type { DSBalance, DSUsage } from '../types';
import { getApiUrl, getReasoningEffort } from '../config';
import {
  PEAK_WINDOW_DESCRIPTION,
  getRateTier,
  getRates,
  rateTierLabel,
  resolveFamily,
  type PricingCurrency,
} from '../pricing';
import { logger } from '../logger';
import type { ContextWindowTracker } from './context-window';
import { kvCachePrimerMarkdown } from './context-window';

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
    const cacheMiss = usage.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHit);
    const completion = usage.completion_tokens ?? 0;
    const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0;

    this.session.promptTokens += promptTokens;
    this.session.cacheHitTokens += cacheHit;
    this.session.cacheMissTokens += cacheMiss;
    this.session.completionTokens += completion;
    this.session.reasoningTokens += reasoning;
    this.session.requestCount += 1;

    // Priced at the moment the usage chunk lands, which is when DeepSeek billed
    // it. A request straddling a peak boundary is settled by DeepSeek's own
    // accounting — we can't see which side it fell on, so this stays an estimate.
    const tier = getRateTier();
    const rates = getRates(resolveFamily(model), this.session.currency);
    const cost =
      (cacheMiss / 1_000_000) * rates.cacheMiss +
      (cacheHit / 1_000_000) * rates.cacheHit +
      (completion / 1_000_000) * rates.output;

    this.session.estimatedCost += cost;

    logger.info(
      `usage prompt=${promptTokens} hit=${cacheHit} miss=${cacheMiss} out=${completion} reasoning=${reasoning} rate=${tier} cost=${cost.toFixed(6)} ${this.session.currency} total=${this.session.estimatedCost.toFixed(4)}`,
    );

    this.updateStatusBar();
    this.scheduleSilentBalanceRefresh();
  }

  async refreshBalance(silent = false): Promise<void> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      if (!silent) {
        vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Set your DeepSeek API key first (Command Palette → DeepSeek Pilot: Set API Key).',
          ),
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
          vscode.window.showWarningMessage(
            vscode.l10n.t('Failed to fetch balance: HTTP {0}', String(res.status)),
          );
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
          vscode.window.showWarningMessage(
            vscode.l10n.t('DeepSeek returned an empty balance response.'),
          );
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
          vscode.l10n.t(
            'Failed to refresh DeepSeek balance: {0}',
            e instanceof Error ? e.message : String(e),
          ),
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
    vscode.window.showInformationMessage(vscode.l10n.t('DeepSeek Pilot session counter cleared.'));
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
      md.appendMarkdown(vscode.l10n.t('**Model** &nbsp; `{0}`', turn.modelName) + '\n\n');
      md.appendMarkdown(
        vscode.l10n.t(
          '**Last turn** &nbsp; {0} / {1} prompt tokens (**{2}%**) · {3}% cached',
          turn.promptTokens.toLocaleString(),
          turn.maxInputTokens.toLocaleString(),
          ctxSnap.pctUsed.toFixed(1),
          ctxSnap.cacheHitPct.toFixed(0),
        ) + '\n\n',
      );
      md.appendMarkdown(`**${ctxSnap.headline}** — ${ctxSnap.advice}\n\n`);
      md.appendMarkdown(
        `${kvCachePrimerMarkdown()}\n\n` +
          `[$(info) ${vscode.l10n.t('Compaction details')}](command:deepseek-pilot.showContextWindow) &nbsp; ` +
          `[$(gear) ${vscode.l10n.t('Thresholds')}](command:workbench.action.openSettings?%22deepseek-pilot.contextWarnThreshold%22)\n\n`,
      );
      md.appendMarkdown('---\n\n');
    }

    const sym = currencySymbol(this.session.currency);
    const cacheHitPct =
      this.session.promptTokens > 0
        ? (this.session.cacheHitTokens / this.session.promptTokens) * 100
        : 0;
    md.appendMarkdown(
      vscode.l10n.t(
        '**Rate** &nbsp; `{0}` &nbsp; _(peak {1}; off-peak is half price)_',
        rateTierLabel(getRateTier()),
        PEAK_WINDOW_DESCRIPTION,
      ) + '\n\n',
    );
    md.appendMarkdown(
      vscode.l10n.t('**Session** &nbsp; `{0} requests`', this.session.requestCount) + '\n\n',
    );
    md.appendMarkdown(
      vscode.l10n.t(
        '- Prompt tokens: {0} ({1} cache hit, {2} miss · {3}% hit)',
        this.session.promptTokens.toLocaleString(),
        this.session.cacheHitTokens.toLocaleString(),
        this.session.cacheMissTokens.toLocaleString(),
        cacheHitPct.toFixed(0),
      ) + '\n',
    );
    md.appendMarkdown(
      vscode.l10n.t(
        '- Completion tokens: {0} ({1} reasoning)',
        this.session.completionTokens.toLocaleString(),
        this.session.reasoningTokens.toLocaleString(),
      ) + '\n',
    );
    md.appendMarkdown(
      vscode.l10n.t('- Estimated cost: {0}{1}', sym, this.session.estimatedCost.toFixed(4)) +
        '\n\n',
    );

    md.appendMarkdown(
      `[$(refresh) ${vscode.l10n.t('Clear session')}](command:deepseek-pilot.clearSession)\n\n`,
    );

    md.appendMarkdown('---\n\n');

    md.appendMarkdown(
      this.balance
        ? vscode.l10n.t(
            '**Balance** &nbsp; [$(refresh) refresh](command:deepseek-pilot.refreshBalance)',
          ) + '\n\n'
        : vscode.l10n.t(
            '**Balance** &nbsp; [$(refresh) click to fetch](command:deepseek-pilot.refreshBalance)',
          ) + '\n\n',
    );
    if (this.balance) {
      const bsym = currencySymbol(this.balance.currency);
      md.appendMarkdown(
        `${bsym}${this.balance.totalBalance.toFixed(2)} &nbsp;·&nbsp; ${formatTime24(this.balance.fetchedAt)}\n\n`,
      );
      if (this.balance.totalGranted > 0 || this.balance.totalToppedUp > 0) {
        md.appendMarkdown(
          vscode.l10n.t(
            '_{0}{1} granted + {2}{3} topped up_',
            bsym,
            this.balance.totalGranted.toFixed(2),
            bsym,
            this.balance.totalToppedUp.toFixed(2),
          ) + '\n\n',
        );
      }
      const accountCcy = this.balance.currency;
      if (accountCcy !== 'USD' && accountCcy !== 'CNY') {
        md.appendMarkdown(
          vscode.l10n.t(
            '_$(warning) Cost estimation uses USD pricing — actual billing is in {0}_',
            accountCcy,
          ) + '\n\n',
        );
      }
    }

    md.appendMarkdown('---\n\n');
    md.appendMarkdown(
      vscode.l10n.t('**Reasoning effort** &nbsp; `{0}`', getReasoningEffort()) +
        ` &nbsp; [$(gear) ${vscode.l10n.t('configure')}](command:workbench.action.openSettings?%22deepseek-pilot.reasoningEffort%22)\n\n`,
    );
    md.appendMarkdown(`[${vscode.l10n.t('View full log')}](command:deepseek-pilot.showLogs)`);

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
