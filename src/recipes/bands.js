// Turning a recipe's min/max into the handful of tappable amounts a chef picks
// from during service.
//
// The reason this exists: a chef should never be asked to type 550 because the
// recipe said 500-600. That is a calculation, on a phone, with wet hands, in a
// kitchen that is already behind. So the band is what gets recorded, and the
// midpoint that used to stand in for it survives only as a provisional estimate
// that inventory replaces with a real number.
//
// Pure functions, no database, so this is as testable as the matcher.

/** Round to a step that suits the magnitude, so a chef never sees 0.3333 kg. */
function tidy(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;

  // Units small enough to be counted are rounded to whole numbers. Anything
  // larger is rounded to 2dp, which is the width the schema stores anyway.
  if (unit === 'pcs' || unit === 'vipande' || n < 1) return Math.round(n * 100) / 100;
  if (n >= 100) return Math.round(n);
  if (n >= 10) return Math.round(n * 2) / 2;
  return Math.round(n * 10) / 10;
}

/**
 * Build the tappable amounts for one recipe line.
 *
 * The recipe's own range is always offered and always marked as the on-plan
 * choice. Around it sit one band below and one above, so a bake that ran wet or
 * dry is still a tap rather than a decision about numbers.
 *
 * A single-value recipe (min === max, which is what an exact weighed amount
 * looks like) gets two neighbours at a fifth either side plus the amount itself
 * as the on-plan choice, because [100, 100] is not something anyone can choose
 * between but 100 on its own is exactly what the recipe said.
 */
function buildBands(min, max, unit) {
  // Number(null) and Number('') are both 0, which would quietly turn a recipe line
  // with no amount into one suggesting 0 grams. A missing amount is not an amount
  // of nothing, so it is refused rather than guessed at.
  if (min === null || min === undefined || min === '' ||
      max === null || max === undefined || max === '') return [];

  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];

  const low = Math.min(lo, hi);
  const high = Math.max(lo, hi);
  const width = high - low;

  // A zero-width band is allowed. It is the honest answer for an exact recipe
  // amount: the recipe says 100, so 100 is the choice. Only an inverted band is
  // dropped, because that one is a bug rather than a rounding. The old strict
  // comparison silently deleted the "on plan" band of every exact recipe, which
  // left the chef with two options and no recommendation.
  const push = (a, b, alama) => {
    const chini = tidy(a, unit);
    const juu = tidy(b, unit);
    if (juu < chini) return;
    // You cannot use a negative amount of anything. A band that reaches below
    // zero is clamped rather than offered, and clamping keeps the scale readable:
    // "0-100" is a real answer for a recipe line that says 0.
    if (juu <= 0) return;
    bands.push({ kiasi_cha_chini: chini < 0 ? 0 : chini, kiasi_cha_juu: juu, alama });
  };

  const bands = [];

  if (width === 0) {
    // Nothing to choose between, so offer the amount itself and two neighbours
    // at a fifth of it either side. A cake that needed a fifth more or less is
    // the difference between a tap and a refusal to log anything.
    const step = low > 0 ? low / 5 : 1;
    push(low - step, low, 'chini');
    push(low, high, 'hasi');
    push(high, high + step, 'juu');
    return dedupe(bands);
  }

  // Below: the same width again, so the three bands read as one scale.
  push(low - width, low, 'chini');
  push(low, high, 'hasi');
  push(high, high + width, 'juu');

  return dedupe(bands);
}

/**
 * Rounding can collapse two bands into one (500.4 and 500.6 both become 500).
 * Keeping the lower band's label would then be a lie, and keeping both with
 * identical numbers is worse, so the wider label wins.
 */
function dedupe(bands) {
  const out = [];
  for (const band of bands) {
    const clash = out.find((b) => b.kiasi_cha_chini === band.kiasi_cha_chini && b.kiasi_cha_juu === band.kiasi_cha_juu);
    if (clash) {
      if (band.alama === 'hasi') clash.alama = 'hasi';
      continue;
    }
    out.push(band);
  }
  return out;
}

module.exports = { buildBands, tidy };
