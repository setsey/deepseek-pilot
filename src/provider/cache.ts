import { createHash } from 'node:crypto';

export interface CachedTurn {
  fingerprint: string;
  reasoning: string;
}

export interface AssistantTurnFingerprintInput {
  text: string;
  toolCalls: ReadonlyArray<{ id: string; name: string }>;
}

export interface ReasoningCacheStats {
  entryCount: number;
  maxEntries: number;
  totalBytes: number;
  largestEntryBytes: number;
  largestEntryFp: string;
  maxObservedEntryBytes: number;
  maxObservedEntryFp: string;
  entrySizeWarnBytes: number;
  totalBytesWarn: number;
  totalBytesMax: number;
  totalSets: number;
  totalGets: number;
  totalHits: number;
  totalMisses: number;
  totalEvictions: number;
  hitRate: number;
}

export class ReasoningCache {
  private buffer: CachedTurn[] = [];
  private onChange?: () => void;
  private totalBytes = 0;
  private maxObservedEntrySize = 0;
  private maxObservedEntryFp = '';
  private totalSets = 0;
  private totalGets = 0;
  private totalHits = 0;
  private totalMisses = 0;
  private totalEvictions = 0;

  static readonly ENTRY_SIZE_WARN_BYTES = 192 * 1024;
  static readonly TOTAL_BYTES_WARN = 5 * 1024 * 1024;
  static readonly MAX_TOTAL_BYTES = 20 * 1024 * 1024;

  constructor(private readonly maxSize = 512) {}

  setOnChange(cb: () => void): void {
    this.onChange = cb;
  }

  set(fingerprint: string, reasoning: string): void {
    if (!reasoning || !fingerprint) return;
    this.totalSets++;

    const byteLen = Buffer.byteLength(reasoning, 'utf8');
    if (byteLen > this.maxObservedEntrySize) {
      this.maxObservedEntrySize = byteLen;
      this.maxObservedEntryFp = fingerprint;
    }

    // Remove existing entry for same fingerprint
    const existingIdx = this.buffer.findIndex((e) => e.fingerprint === fingerprint);
    if (existingIdx >= 0) {
      const removed = this.buffer.splice(existingIdx, 1)[0]!;
      this.totalBytes -= Buffer.byteLength(removed.reasoning, 'utf8');
    }

    this.buffer.push({ fingerprint, reasoning });
    this.totalBytes += byteLen;

    // Evict from front (oldest) while over size limits
    while (this.buffer.length > this.maxSize || this.totalBytes > ReasoningCache.MAX_TOTAL_BYTES) {
      const evicted = this.buffer.shift();
      if (evicted) {
        this.totalBytes -= Buffer.byteLength(evicted.reasoning, 'utf8');
        this.totalEvictions++;
      } else break;
    }

    this.onChange?.();
  }

  get(fingerprint: string): string | undefined {
    if (!fingerprint) return undefined;
    this.totalGets++;
    const idx = this.buffer.findIndex((e) => e.fingerprint === fingerprint);
    if (idx >= 0) {
      this.totalHits++;
      const entry = this.buffer.splice(idx, 1)[0]!;
      this.buffer.push(entry);
      return entry.reasoning;
    }
    this.totalMisses++;
    return undefined;
  }

  stats(): ReasoningCacheStats {
    const hitRate = this.totalGets > 0 ? this.totalHits / this.totalGets : 0;
    const largestEntry = this.buffer.reduce(
      (max, e) => {
        const sz = Buffer.byteLength(e.reasoning, 'utf8');
        return sz > max.size ? { size: sz, fp: e.fingerprint } : max;
      },
      { size: 0, fp: '' },
    );

    return {
      entryCount: this.buffer.length,
      maxEntries: this.maxSize,
      totalBytes: this.totalBytes,
      largestEntryBytes: largestEntry.size,
      largestEntryFp: largestEntry.fp,
      maxObservedEntryBytes: this.maxObservedEntrySize,
      maxObservedEntryFp: this.maxObservedEntryFp,
      entrySizeWarnBytes: ReasoningCache.ENTRY_SIZE_WARN_BYTES,
      totalBytesWarn: ReasoningCache.TOTAL_BYTES_WARN,
      totalBytesMax: ReasoningCache.MAX_TOTAL_BYTES,
      totalSets: this.totalSets,
      totalGets: this.totalGets,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      totalEvictions: this.totalEvictions,
      hitRate,
    };
  }

  serialize(): CachedTurn[] {
    return this.buffer.map((entry) => ({ ...entry }));
  }

  restore(entries: CachedTurn[]): void {
    const validEntries = entries.filter(
      (entry) => entry && typeof entry.fingerprint === 'string' && typeof entry.reasoning === 'string',
    );

    this.buffer = validEntries.slice(-this.maxSize);
    this.totalBytes = 0;
    for (const entry of this.buffer) {
      this.totalBytes += Buffer.byteLength(entry.reasoning, 'utf8');
    }

    while (this.totalBytes > ReasoningCache.MAX_TOTAL_BYTES && this.buffer.length > 0) {
      const evicted = this.buffer.shift()!;
      this.totalBytes -= Buffer.byteLength(evicted.reasoning, 'utf8');
      this.totalEvictions++;
    }
  }

  clear(): void {
    this.buffer = [];
    this.totalBytes = 0;
    this.onChange?.();
  }
}

export function fingerprintAssistantTurn(
  input: AssistantTurnFingerprintInput,
): string {
  if (input.toolCalls.length > 0) {
    const toolKeys = input.toolCalls
      .map((toolCall) => `${toolCall.name}:${toolCall.id}`)
      .sort()
      .join('|');
    return `tc:${createHash('sha256').update(toolKeys).digest('hex').slice(0, 16)}`;
  }

  const normalizedText = input.text
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedText) {
    return '';
  }

  return `tx:${createHash('sha256').update(normalizedText).digest('hex').slice(0, 16)}`;
}
