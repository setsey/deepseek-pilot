import vscode from 'vscode';

/**
 * DeepSeek per-million-token pricing — the single source of truth for both
 * the model-picker hints and the status-bar cost estimate.
 *
 * Sources: https://api-docs.deepseek.com/quick_start/pricing (USD) and its
 * zh-cn counterpart (CNY), both re-read 2026-10-04 (the V4.1 Flash card).
 *
 * DeepSeek bills on a peak/off-peak schedule. Peak is 01:00-04:00 and
 * 06:00-10:00 UTC **Monday-Friday, excluding Chinese public holidays**; the
 * zh-cn page states the same window as 周一至周五（不含中国法定节假日）
 * 09:00-12:00 / 14:00-18:00 Beijing time (UTC+8), so the two agree. Weekends,
 * those holidays, and every other weekday hour are off-peak at exactly half the
 * peak rate. Both peak windows sit inside 01:00-10:00 UTC, where the UTC and
 * Beijing calendar days coincide, so plain UTC day-of-week and date tests are
 * exact.
 *
 * V4.1 Flash (2026-09) cut Flash rates below the V4 card (peak cache-miss
 * $0.44 -> $0.30, output $1.32 -> $1.20). V4 Pro keeps its own model
 * (DeepSeek-V4-Pro-0813) and its own rates: the Pro-to-Flash routing announced
 * for 2026-09-14 was withdrawn ("we have decided to continue providing API
 * services for DeepSeek V4 Pro after September 14, 2026, with the billing
 * method remaining unchanged" — https://api-docs.deepseek.com/updates).
 */

export type ModelFamily = 'deepseek-v4-pro' | 'deepseek-flash';

/** Any model identifier accepted by the rate lookups; resolved via `resolveFamily`. */
export type PriceableModel = ModelFamily | (string & {});
export type PricingCurrency = 'USD' | 'CNY';
export type RateTier = 'peak' | 'off-peak';

export interface Rates {
  readonly cacheHit: number;
  readonly cacheMiss: number;
  readonly output: number;
}

/**
 * Peak-hour rates per 1M tokens, quoted cell-for-cell from the pricing page.
 * Off-peak is derived rather than listed a second time: the published off-peak
 * column is an exact half of every cell here, and halving a double only
 * decrements the exponent, so the derived values equal the printed ones.
 */
const PEAK_RATES: Record<PricingCurrency, Record<ModelFamily, Rates>> = {
  USD: {
    'deepseek-v4-pro': { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
    'deepseek-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
  },
  CNY: {
    'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    'deepseek-flash': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  },
};

/** "Off-peak rates are half of the peak rates" — the pricing page. */
const OFF_PEAK_FACTOR = 0.5;

/** Peak windows as UTC hour ranges, `[startInclusive, endExclusive)`. */
const PEAK_WINDOWS_UTC: readonly (readonly [number, number])[] = [
  [1, 4],
  [6, 10],
];

/**
 * Chinese public holidays as inclusive Beijing-calendar date ranges, copied
 * from the State Council's annual schedule (国务院办公厅关于2026年部分节假日安排的通知,
 * 2025-11-04). DeepSeek bills every hour of these days off-peak. Weekend
 * make-up workdays (调休) need no entry: the pricing page keeps all weekend
 * hours off-peak. A year without ranges here falls back to the plain weekday
 * rule, which over-reports peak on that year's holidays — add the next year's
 * ranges when the State Council publishes them (usually November).
 */
const CN_PUBLIC_HOLIDAYS: readonly (readonly [string, string])[] = [
  ['2026-01-01', '2026-01-03'], // New Year's Day
  ['2026-02-15', '2026-02-23'], // Spring Festival
  ['2026-04-04', '2026-04-06'], // Qingming
  ['2026-05-01', '2026-05-05'], // Labour Day
  ['2026-06-19', '2026-06-21'], // Dragon Boat Festival
  ['2026-09-25', '2026-09-27'], // Mid-Autumn Festival
  ['2026-10-01', '2026-10-07'], // National Day
];

/** Peak schedule in prose, for tooltips and settings copy. */
export const PEAK_WINDOW_DESCRIPTION = vscode.l10n.t(
  '01:00-04:00 and 06:00-10:00 UTC Mon-Fri, excl. Chinese public holidays',
);

/** Display name for a rate tier in tooltips and picker hints. */
export function rateTierLabel(tier: RateTier): string {
  return tier === 'peak' ? vscode.l10n.t('peak') : vscode.l10n.t('off-peak');
}

export function getRateTier(at: Date = new Date()): RateTier {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return 'off-peak'; // weekends are entirely off-peak
  const hour = at.getUTCHours();
  // Note 04:00-06:00 UTC falls BETWEEN the two peak windows and is off-peak.
  if (!PEAK_WINDOWS_UTC.some(([from, to]) => hour >= from && hour < to)) return 'off-peak';
  // Inside a peak window the UTC date is the Beijing date, so it can be
  // compared against the holiday ranges directly.
  const date = at.toISOString().slice(0, 10);
  return CN_PUBLIC_HOLIDAYS.some(([from, to]) => date >= from && date <= to) ? 'off-peak' : 'peak';
}

export function getRates(
  model: PriceableModel,
  currency: PricingCurrency = 'USD',
  at: Date = new Date(),
): Rates {
  const peak = PEAK_RATES[currency][resolveFamily(model)];
  if (getRateTier(at) === 'peak') return peak;
  return {
    cacheHit: peak.cacheHit * OFF_PEAK_FACTOR,
    cacheMiss: peak.cacheMiss * OFF_PEAK_FACTOR,
    output: peak.output * OFF_PEAK_FACTOR,
  };
}

/**
 * An unrecognised model id prices as Pro — the dearer tier — so a request we
 * failed to tag over-reports rather than under-reports spend. The substring
 * match covers the live `deepseek-flash` id plus the retired-but-still-routed
 * `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` legacy ids, all of
 * which DeepSeek bills at the Flash price.
 */
export function resolveFamily(model: string): ModelFamily {
  return model.includes('flash') ? 'deepseek-flash' : 'deepseek-v4-pro';
}

/** Trims to the pricing page's precision and drops trailing zeros: `0.007`, `1.32`, `27`. */
function formatRate(n: number): string {
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * The model-picker `detail` hint. Quotes the rate in force *right now* plus its
 * tier: peak and off-peak differ by 2x, so a single static number would be
 * wrong for much of the day. `toChatInfo` runs per picker query, so passing the
 * call time through re-evaluates this naturally.
 */
export function priceHint(model: PriceableModel, at: Date = new Date()): string {
  const rates = getRates(model, 'USD', at);
  return vscode.l10n.t(
    '{0}/{1} per Mtok in/out · {2}',
    `$${formatRate(rates.cacheMiss)}`,
    `$${formatRate(rates.output)}`,
    rateTierLabel(getRateTier(at)),
  );
}

/**
 * Per-Mtok cost strings for the (non-public) native cost fields Copilot Chat
 * renders in the model picker. Best-effort: hosts that don't recognise the
 * fields ignore them, and `priceHint` carries the same numbers in the visible
 * `detail` string. `cacheCost` is the cache-hit input rate.
 */
export function priceFields(
  model: PriceableModel,
  at: Date = new Date(),
): { inputCost: string; outputCost: string; cacheCost: string } {
  const rates = getRates(model, 'USD', at);
  return {
    inputCost: `$${formatRate(rates.cacheMiss)}`,
    outputCost: `$${formatRate(rates.output)}`,
    cacheCost: `$${formatRate(rates.cacheHit)}`,
  };
}
