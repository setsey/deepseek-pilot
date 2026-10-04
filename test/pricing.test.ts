import { describe, expect, it } from 'vitest';
import {
  getRateTier,
  getRates,
  priceFields,
  priceHint,
  resolveFamily,
} from '../src/pricing';

/** Fixed instants so nothing depends on "now". 2026-08-17 is a Monday. */
const OFF_PEAK = new Date('2026-08-17T12:00:00Z');
const PEAK = new Date('2026-08-17T02:00:00Z');

describe('getRateTier', () => {
  it('treats weekday 01:00-04:00 and 06:00-10:00 UTC as peak', () => {
    for (const hour of [1, 2, 3, 6, 7, 8, 9]) {
      expect(getRateTier(new Date(Date.UTC(2026, 7, 17, hour)))).toBe('peak');
    }
  });

  it('treats the 04:00-06:00 UTC gap between the two windows as off-peak', () => {
    expect(getRateTier(new Date(Date.UTC(2026, 7, 17, 4)))).toBe('off-peak');
    expect(getRateTier(new Date(Date.UTC(2026, 7, 17, 5)))).toBe('off-peak');
  });

  it('treats every weekday hour outside both windows as off-peak', () => {
    for (const hour of [0, 10, 11, 15, 20, 23]) {
      expect(getRateTier(new Date(Date.UTC(2026, 7, 17, hour)))).toBe('off-peak');
    }
  });

  it('treats weekends as off-peak even inside the peak windows', () => {
    // 2026-09-12 is a Saturday, 2026-09-13 a Sunday.
    expect(getRateTier(new Date('2026-09-12T02:00:00Z'))).toBe('off-peak');
    expect(getRateTier(new Date('2026-09-12T09:00:00Z'))).toBe('off-peak');
    expect(getRateTier(new Date('2026-09-13T07:30:00Z'))).toBe('off-peak');
  });

  it('switches on the weekday boundary: Friday peaks, Monday peaks again', () => {
    expect(getRateTier(new Date('2026-09-11T09:00:00Z'))).toBe('peak'); // Friday
    expect(getRateTier(new Date('2026-09-14T02:00:00Z'))).toBe('peak'); // Monday
  });

  // State Council 2026 schedule; the pricing page bills these days off-peak.
  it('treats Chinese public holiday weekdays as off-peak inside the peak windows', () => {
    expect(getRateTier(new Date('2026-10-05T02:00:00Z'))).toBe('off-peak'); // Mon, National Day
    expect(getRateTier(new Date('2026-10-07T09:59:59Z'))).toBe('off-peak'); // Wed, its last day
    expect(getRateTier(new Date('2026-01-01T01:00:00Z'))).toBe('off-peak'); // Thu, New Year
    expect(getRateTier(new Date('2026-02-16T07:00:00Z'))).toBe('off-peak'); // Mon, Spring Festival
    expect(getRateTier(new Date('2026-02-23T07:00:00Z'))).toBe('off-peak'); // Mon, its last day
    expect(getRateTier(new Date('2026-09-25T03:00:00Z'))).toBe('off-peak'); // Fri, Mid-Autumn
  });

  it('peaks again on the first working weekday after a holiday', () => {
    expect(getRateTier(new Date('2026-10-08T01:00:00Z'))).toBe('peak'); // Thu
    expect(getRateTier(new Date('2026-02-24T07:00:00Z'))).toBe('peak'); // Tue
    expect(getRateTier(new Date('2026-12-31T02:00:00Z'))).toBe('peak'); // Thu before New Year
  });

  it('keeps weekend make-up workdays off-peak', () => {
    // 2026-10-10 (Sat) and 2026-09-20 (Sun) are 调休 working days, but the
    // pricing page bills every weekend hour off-peak.
    expect(getRateTier(new Date('2026-10-10T02:00:00Z'))).toBe('off-peak');
    expect(getRateTier(new Date('2026-09-20T07:00:00Z'))).toBe('off-peak');
  });

  it('bills a holiday peak hour at the off-peak rate', () => {
    expect(getRates('deepseek-v4-pro', 'USD', new Date('2026-10-06T02:00:00Z'))).toEqual({
      cacheHit: 0.022,
      cacheMiss: 0.66,
      output: 1.98,
    });
  });

  it('switches exactly on the hour boundaries', () => {
    expect(getRateTier(new Date('2026-08-17T00:59:59Z'))).toBe('off-peak');
    expect(getRateTier(new Date('2026-08-17T01:00:00Z'))).toBe('peak');
    expect(getRateTier(new Date('2026-08-17T03:59:59Z'))).toBe('peak');
    expect(getRateTier(new Date('2026-08-17T04:00:00Z'))).toBe('off-peak');
    expect(getRateTier(new Date('2026-08-17T09:59:59Z'))).toBe('peak');
    expect(getRateTier(new Date('2026-08-17T10:00:00Z'))).toBe('off-peak');
  });
});

describe('getRates', () => {
  // Cell-for-cell against https://api-docs.deepseek.com/quick_start/pricing
  // (the V4.1 Flash card, re-read 2026-10-04).
  it('matches the published USD peak column', () => {
    expect(getRates('deepseek-v4-pro', 'USD', PEAK)).toEqual({
      cacheHit: 0.044,
      cacheMiss: 1.32,
      output: 3.96,
    });
    expect(getRates('deepseek-flash', 'USD', PEAK)).toEqual({
      cacheHit: 0.006,
      cacheMiss: 0.3,
      output: 1.2,
    });
  });

  it('matches the published USD off-peak column', () => {
    expect(getRates('deepseek-v4-pro', 'USD', OFF_PEAK)).toEqual({
      cacheHit: 0.022,
      cacheMiss: 0.66,
      output: 1.98,
    });
    expect(getRates('deepseek-flash', 'USD', OFF_PEAK)).toEqual({
      cacheHit: 0.003,
      cacheMiss: 0.15,
      output: 0.6,
    });
  });

  // The zh-cn pricing page; peak stated as 周一至周五 09:00-12:00 / 14:00-18:00
  // Beijing time, the same window (and weekdays) as the UTC one used above.
  it('matches the published CNY peak column', () => {
    expect(getRates('deepseek-v4-pro', 'CNY', PEAK)).toEqual({
      cacheHit: 0.3,
      cacheMiss: 9,
      output: 27,
    });
    expect(getRates('deepseek-flash', 'CNY', PEAK)).toEqual({
      cacheHit: 0.04,
      cacheMiss: 2,
      output: 8,
    });
  });

  it('matches the published CNY off-peak column', () => {
    expect(getRates('deepseek-v4-pro', 'CNY', OFF_PEAK)).toEqual({
      cacheHit: 0.15,
      cacheMiss: 4.5,
      output: 13.5,
    });
    expect(getRates('deepseek-flash', 'CNY', OFF_PEAK)).toEqual({
      cacheHit: 0.02,
      cacheMiss: 1,
      output: 4,
    });
  });

  it('prices Pro above Flash in every column', () => {
    for (const at of [PEAK, OFF_PEAK]) {
      const pro = getRates('deepseek-v4-pro', 'USD', at);
      const flash = getRates('deepseek-flash', 'USD', at);
      expect(pro.cacheHit).toBeGreaterThan(flash.cacheHit);
      expect(pro.cacheMiss).toBeGreaterThan(flash.cacheMiss);
      expect(pro.output).toBeGreaterThan(flash.output);
    }
  });

  it('keeps billing Pro at Pro rates after 2026-09-14 (the announced Flash routing was withdrawn)', () => {
    // DeepSeek kept V4 Pro "with the billing method remaining unchanged"
    // (api-docs.deepseek.com/updates), so the old 04:00 UTC cutover instant and
    // every later peak hour still bill Pro's own row.
    const formerCutover = new Date('2026-09-14T04:00:00Z');
    expect(getRates('deepseek-v4-pro', 'USD', formerCutover)).toEqual({
      cacheHit: 0.022,
      cacheMiss: 0.66,
      output: 1.98,
    });
    const laterPeak = new Date('2026-09-15T07:00:00Z');
    expect(getRates('deepseek-v4-pro', 'USD', laterPeak)).toEqual({
      cacheHit: 0.044,
      cacheMiss: 1.32,
      output: 3.96,
    });
    expect(getRates('deepseek-v4-pro', 'CNY', laterPeak)).toEqual({
      cacheHit: 0.3,
      cacheMiss: 9,
      output: 27,
    });
  });
});

describe('resolveFamily', () => {
  it('resolves the two billed families', () => {
    expect(resolveFamily('deepseek-flash')).toBe('deepseek-flash');
    expect(resolveFamily('deepseek-v4-pro')).toBe('deepseek-v4-pro');
  });

  it('bills the retired-but-routed legacy Flash ids at Flash rates', () => {
    expect(resolveFamily('deepseek-v4-flash')).toBe('deepseek-flash');
    expect(resolveFamily('deepseek-v4-flash-vision-exp')).toBe('deepseek-flash');
    expect(getRates('deepseek-v4-flash-vision-exp', 'USD', PEAK)).toEqual(
      getRates('deepseek-flash', 'USD', PEAK),
    );
  });

  it('falls back to the dearer tier so an untagged request cannot under-report', () => {
    expect(resolveFamily('some-proxy-model')).toBe('deepseek-v4-pro');
  });
});

describe('priceHint', () => {
  it('quotes the cache-miss and output rate for the tier in force, and names it', () => {
    expect(priceHint('deepseek-v4-pro', OFF_PEAK)).toBe(
      '$0.66/$1.98 per Mtok in/out · off-peak',
    );
    expect(priceHint('deepseek-v4-pro', PEAK)).toBe(
      '$1.32/$3.96 per Mtok in/out · peak',
    );
    expect(priceHint('deepseek-flash', OFF_PEAK)).toBe(
      '$0.15/$0.6 per Mtok in/out · off-peak',
    );
  });
});

describe('priceFields', () => {
  it('reports the current Pro rates while they still apply', () => {
    expect(priceFields('deepseek-v4-pro', OFF_PEAK)).toEqual({
      inputCost: '$0.66',
      outputCost: '$1.98',
      cacheCost: '$0.022',
    });
    expect(priceFields('deepseek-v4-pro', PEAK)).toEqual({
      inputCost: '$1.32',
      outputCost: '$3.96',
      cacheCost: '$0.044',
    });
  });

  it('reports V4.1 Flash pricing, including the three-decimal cache-hit rate', () => {
    expect(priceFields('deepseek-flash', OFF_PEAK)).toEqual({
      inputCost: '$0.15',
      outputCost: '$0.6',
      cacheCost: '$0.003',
    });
    expect(priceFields('deepseek-flash', PEAK)).toEqual({
      inputCost: '$0.3',
      outputCost: '$1.2',
      cacheCost: '$0.006',
    });
  });

  it('formats without floating-point dust', () => {
    for (const at of [PEAK, OFF_PEAK]) {
      for (const family of ['deepseek-v4-pro', 'deepseek-flash'] as const) {
        for (const value of Object.values(priceFields(family, at))) {
          expect(value).toMatch(/^\$\d+(\.\d{1,4})?$/);
        }
      }
    }
  });
});
