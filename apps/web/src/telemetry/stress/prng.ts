/**
 * Seeded PRNG — mulberry32 algorithm.
 *
 * Deterministic pseudo-random number generator for reproducible stress tests.
 * Same seed = same token sequence = reproducible perf measurements.
 *
 * mulberry32 is fast (~10ns/call), has good statistical properties,
 * and produces 32-bit outputs in [0, 1).
 *
 * Usage:
 *   const rand = mulberry32(42);
 *   rand();       // 0.6234... (deterministic)
 *   rand();       // 0.2891... (deterministic)
 *
 * Token generation:
 *   We need random words from a vocabulary.
 *   WORD_VOCAB provides 64 common English tokens.
 *   wordFrom(rand) picks a random vocab entry.
 *   tokenStream(seed, count) produces a deterministic token array.
 */

// ─── Core PRNG ────────────────────────────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function rand(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Token vocabulary ─────────────────────────────────────────────────────────
// Realistic mix: short tokens (common) + longer tokens (technical terms).

const VOCAB = [
  'The', 'AI', 'model', 'is', 'generating', 'a', 'response', 'based', 'on',
  'your', 'query', 'about', 'machine', 'learning', 'and', 'neural', 'networks',
  'which', 'are', 'fundamental', 'to', 'modern', 'language', 'models', 'like',
  'transformers', 'attention', 'mechanisms', 'embeddings', 'vectors', 'tokens',
  'context', 'window', 'inference', 'latency', 'throughput', 'streaming',
  'real-time', 'generation', 'completion', 'prompt', 'instruction', 'tuning',
  'fine-tuning', 'pre-training', 'dataset', 'distribution', 'probability',
  'softmax', 'logits', 'sampling', 'temperature', 'top-k', 'top-p',
  'beam', 'search', 'greedy', 'decoding', 'quantization', 'efficient', '.',
  ' ', '\n', 'with', 'for', 'from', 'this', 'that', 'into',
] as const;

export function pickToken(rand: () => number): string {
  return VOCAB[Math.floor(rand() * VOCAB.length)] ?? 'the';
}

/**
 * Generate a deterministic sequence of tokens.
 *
 * @param seed  — PRNG seed (same seed = same sequence)
 * @param count — number of tokens to generate
 */
export function tokenStream(seed: number, count: number): ReadonlyArray<string> {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => pickToken(rand));
}

/**
 * Generate a variable inter-token delay in ms.
 * Mimics realistic LLM token emission timing.
 *
 * @param rand     — seeded PRNG
 * @param meanMs   — mean delay (default 20ms = 50 tokens/s)
 * @param jitterMs — ±jitter (default 10ms)
 */
export function tokenDelay(rand: () => number, meanMs: number = 20, jitterMs: number = 10): number {
  return Math.max(1, meanMs + (rand() * 2 - 1) * jitterMs);
}
