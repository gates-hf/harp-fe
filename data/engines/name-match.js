// Engine — name matching. Pure: no DOM, no writes, no repository. It is the
// one place two names are compared, so the duplicate check on registration and
// any later pre-registration screen agree on what "the same person" looks like.
//
// Two readings of a name, and the kinder one wins: tokens compared as a set
// (word order and a dropped middle name do not matter) and edit distance over
// the sorted tokens (a spelling variant does not matter). Both return 0–1.

/** Lower case, accents dropped, punctuation to spaces. Arabic is left alone. */
export function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\u0600-\u06ff\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Digits only — "+961 3 214 587" and "03 214 587" are the same line. */
export const normalizePhone = (value) => String(value ?? '').replace(/\D/g, '').replace(/^961/, '');

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** 0–1 over two names. 1 is the same string once normalised. */
export function similarity(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = left.split(' ');
  const rightTokens = right.split(' ');
  const shared = leftTokens.filter((t) => rightTokens.includes(t)).length;
  const tokenScore = (2 * shared) / (leftTokens.length + rightTokens.length);

  const sortedLeft = [...leftTokens].sort().join(' ');
  const sortedRight = [...rightTokens].sort().join(' ');
  const editScore = 1 - levenshtein(sortedLeft, sortedRight) / Math.max(sortedLeft.length, sortedRight.length);

  return Math.max(tokenScore, editScore);
}

/** The threshold the duplicate check runs at, named once. */
export const FUZZY_THRESHOLD = 0.8;

export const isFuzzyName = (a, b) => similarity(a, b) >= FUZZY_THRESHOLD;
