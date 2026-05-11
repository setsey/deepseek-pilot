import { createHash } from 'node:crypto';

export interface CachedTurn {
  fingerprint: string;
  reasoning: string;
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
  }

  get(fingerprint: string): string | undefined {
    this.totalGets++;
    const entry = this.buffer.find((e) => e.fingerprint === fingerprint);
    if (entry) {
      this.totalHits++;
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

  clear(): void {
    this.buffer = [];
    this.totalBytes = 0;
  }
}

export function fingerprintAssistantTurn(
  messages: readonly { role: string; content?: string | null }[],
): string {
  const hash = createHash('sha256');
  for (const msg of messages) {
    hash.update(msg.role);
    hash.update(msg.content ?? '');
  }
  return hash.digest('hex').slice(0, 32);
}
