/**
 * Randomness for anything game-relevant (roles, tasks, desks, ids).
 * Uses crypto.getRandomValues, which exists in Workers, browsers and Node 19+.
 */

export function randomInt(maxExclusive) {
  // Rejection sampling to avoid modulo bias.
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % maxExclusive;
}

export function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function randomId(bytes = 8) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomCode(length, alphabet) {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/**
 * Pick one item at random, weighted by `weightOf(item)` (any non-negative number).
 * Returns null if every weight is zero.
 */
export function pickWeighted(items, weightOf) {
  // Scale to integers so the crypto RNG can be used without float bias.
  const weights = items.map((it) => Math.max(0, Math.round((Number(weightOf(it)) || 0) * 100)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let roll = randomInt(total);
  for (let i = 0; i < items.length; i++) {
    if (roll < weights[i]) return items[i];
    roll -= weights[i];
  }
  return items[items.length - 1];
}
