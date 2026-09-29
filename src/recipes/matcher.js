// Recipe matching.
//
// The cashier describes the customer's cake. The kitchen's internal recipe book
// is not the cashier's problem, so this module turns free text into one recipe
// reference and nothing else.
//
// The important constraint is what this module does NOT return: a list of
// candidates. A ranked shortlist handed to the client is a recipe picker with
// extra steps, and the moment one renders, the decision is back in the cashier's
// hands. One recipe or nothing, and the reasoning is kept server-side for audit.
//
// Inputs are free text because that is what the cashier actually knows. "10 inch"
// is written a dozen ways across this shop, so matching is tolerant by design:
// normalise first, then score, and accept only a match that is clearly better
// than the field it is competing in.

/** Common noise words in cake descriptions, in Swahili and English. */
const NOISE = new Set([
  'keki', 'cake', 'ya', 'wa', 'the', 'a', 'an', 'na', 'kwa', 'za', 'la',
  'moja', 'kubwa', 'size', 'inch', 'inchi', 'in', 'cm', 'centimeter',
  'vipande', 'pande', 'layer', 'safu', 'tier',
]);

/**
 * Shortest word that counts as evidence of a flavour.
 *
 * Two letters is a fragment, not a name. It shows up as a leftover from
 * punctuation ("mk-3" -> "mk"), from an initial, or from a two letter word that
 * is not in the noise list. A single shared fragment is enough to put a recipe
 * over the score floor when the size agrees, and then the kitchen is handed a
 * specific ingredient list for a custom order that shares no flavour with it.
 * Real flavour words are longer than this, so the cost of dropping fragments is
 * nil and the cost of keeping them is a wrong sheet on a real order.
 */
const MIN_FLAVOUR = 3;

/**
 * Size units collapsed to one spelling, so "10 inchi" and "10 inch" meet.
 *
 * "safu" and "layer" are here as units rather than noise on purpose. A three
 * tier wedding cake and a three inch cupcake are both "3", and treating them as
 * the same size would match a customer who asked for a small cake to a recipe
 * for a large one. Reading them as different units stops that.
 */
const SIZE_UNITS = new Map([
  ['inch', 'in'], ['inchi', 'in'], ['in', 'in'], ['"', 'in'], ['”', 'in'],
  ['cm', 'cm'], ['sentimita', 'cm'], ['centimeter', 'cm'], ['centimetre', 'cm'],
  ['mm', 'mm'], ['milimita', 'mm'],
  ['safu', 'safu'], ['layer', 'layer'], ['tier', 'layer'],
]);

/** Swahili and English size words, so "kumi na mbili" can still be read. */
const NUMBER_WORDS = new Map([
  ['moja', 1], ['mbili', 2], ['tatu', 3], ['nne', 4], ['tano', 5],
  ['siti', 6], ['sabuni', 7], ['nane', 8], ['tisa', 9], ['kumi', 10],
  ['moja', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5],
  ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10],
]);

/**
 * Fold text down to lowercase letters and digits.
 * Anything else becomes a space so "chocolate-cake" and "chocolate cake" match.
 */
function fold(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The words in a description that mean something, with noise removed. */
function significant(text) {
  return fold(text)
    .split(' ')
    .filter((t) => t && !NOISE.has(t) && !/^\d+$/.test(t) && t.length >= MIN_FLAVOUR);
}

/**
 * Read a size as a number and a unit where possible.
 * "10 inch" and "10in" and "inchi 10" and "kumi na mbili inchi" all resolve.
 * Returns null when there is no number at all, which is a real case: a cashier
 * describing a custom cake often cannot say what size it will be yet.
 */
function readSize(text) {
  const tokens = fold(text).split(' ').filter(Boolean);
  let number = null;
  let unit = null;

  const addNumber = (value) => {
    number = number === null ? value : number + value;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];

    // "10in" and "10cm" arrive as one token.
    const glued = t.match(/^(\d+(?:\.\d+)?)(in|cm|mm)$/);
    if (glued) {
      addNumber(Number(glued[1]));
      unit = SIZE_UNITS.get(glued[2]) || glued[2];
      continue;
    }
    if (/^\d+(?:\.\d+)?$/.test(t)) {
      addNumber(Number(t));
      continue;
    }
    if (unit === null) {
      const asUnit = SIZE_UNITS.get(t);
      if (asUnit) {
        unit = asUnit;
        continue;
      }
    }
    // "kumi na mbili" is twelve, not ten. The connector is what makes the second
    // word add to the first rather than replace it.
    const word = NUMBER_WORDS.get(t);
    if (word != null) {
      const joined = i > 0 && (tokens[i - 1] === 'na' || tokens[i - 1] === 'and');
      if (joined) addNumber(word);
      else number = word;
    }
  }

  if (number === null) return null;
  return { n: number, unit: unit || null };
}

/** How many of the shorter token set appear in the longer one. */
function overlap(a, b) {
  if (!a.length || !b.length) return 0;
  const small = a.length <= b.length ? a : b;
  const large = a.length <= b.length ? b : a;
  const have = new Set(large);
  return small.filter((t) => have.has(t)).length / small.length;
}

/**
 * Score one candidate recipe against the order description.
 * Exported so the tests can show why a recipe won, not just that one did.
 */
function scoreRecipe(candidate, want) {
  const notes = [];
  let score = 0;

  const wantFlavour = significant(want.ladha);
  const gotFlavour = significant(candidate.ladha);
  let shared = 0;

  if (wantFlavour.length && wantFlavour.join(' ') === gotFlavour.join(' ')) {
    score += 50;
    shared = 1;
    notes.push('flavour exact');
  } else {
    shared = overlap(wantFlavour, gotFlavour);
    if (shared > 0) {
      score += Math.round(35 * shared);
      notes.push(`flavour partial ${Math.round(shared * 100)}%`);
    }
  }

  const wantSize = readSize(want.ukubwa);
  const gotSize = readSize(candidate.ukubwa);

  if (wantSize && gotSize) {
    if (wantSize.n === gotSize.n && (!wantSize.unit || !gotSize.unit || wantSize.unit === gotSize.unit)) {
      score += 30;
      notes.push('size exact');
    } else if (Math.abs(wantSize.n - gotSize.n) <= 1) {
      // Within an inch is almost always the same cake, since sizes are rounded
      // by hand at the counter and rarely land exactly.
      score += 18;
      notes.push('size near');
    }
  } else if (!wantSize && !gotSize) {
    // Both sides are vague. Saying nothing about size must not be a signal,
    // but the order's flavour still has to stand on its own.
    score += 5;
  } else {
    notes.push('size unknown on one side');
  }

  if (candidate.active) score += 5;
  else notes.push('retired recipe');

  return {
    score,
    notes,
    // Kept for the reason text, so "no match" can name what it actually missed.
    // Without this every non-match reads as "nothing was close", which is not
    // the same problem as "three things were equally close".
    matched: shared > 0 || (wantSize && gotSize),
    // Whether the order and the recipe are the same *cake*, as opposed to the
    // same size. A size on its own narrows a shortlist; it never makes one.
    // "Unknown Cake, 24" and a recipe called "Slow, 24" share a number and
    // nothing else, and matching them would silently put the wrong ingredient
    // sheet in front of the kitchen on a custom order.
    sameCake: shared > 0,
    wantSize,
    gotSize,
  };
}

/**
 * Pick one recipe for an order description.
 *
 * `recipes` is the list of { id, ladha, ukubwa, active } already loaded by the
 * caller, so this stays a pure function and can be tested without a database.
 *
 * Returns { mapishi_id, method, score, reason } on a confident match, and
 * { mapishi_id: null, ... } when nothing clears the bar. An unmatched order is a
 * legitimate outcome: a custom cake nobody wrote down is a real thing that
 * happens, and it is better recorded as such than forced onto a near miss.
 */
function matchRecipe(description, recipes, options = {}) {
  // 50 is "the flavour matched outright". A size on top of that is what makes a
  // match confident, but a flavour alone is allowed through on the condition
  // that it is unambiguous, because a shop that bakes one cheesecake recipe can
  // answer "cheesecake" with a straight yes while a shop with three chocolate
  // sizes cannot.
  const { minScore = 50 } = options;
  const want = {
    ladha: description.ladha,
    ukubwa: description.ukubwa,
    umbo: description.umbo,
  };

  const ranked = recipes
    .filter((r) => r.active)
    .map((r) => {
      const s = scoreRecipe(r, want);
      return { id: r.id, ladha: r.ladha, ukubwa: r.ukubwa, ...s };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        // More specific name wins a tie, so "Chocolate" never beats
        // "Dark Chocolate 70%" on equal evidence.
        b.ladha.length - a.ladha.length ||
        // Lowest id last, purely so the same input always yields the same recipe.
        a.id - b.id
    );

  const best = ranked[0];
  if (!best) {
    return {
      mapishi_id: null,
      method: null,
      score: 0,
      reason: {
        ulio: 'hakuna',
        maelezo: 'Kitabu cha mapishi hakina mapishi yoyote inayotumika.',
        karibu_zaidi: null,
        maombi: { ladha: want.ladha, ukubwa: want.ukubwa, umbo: want.umbo },
      },
    };
  }

  // Two recipes can score identically, and the usual reason is that the size was
  // never given: a shop that bakes chocolate at 8, 10 and 12 inches has three
  // equally good matches for the word "chocolate" alone. Picking the lowest id
  // would hand the chef a specific ingredient list for a cake of an unknown
  // size, which is worse than handing over no list, because the chef has no way
  // to tell it was a guess.
  //
  // This is checked before the score floor on purpose. "You did not tell me the
  // size" is a question the cashier can answer, so it is worth saying out loud
  // even when the bare score would not have cleared the bar on its own.
  const tied = ranked.filter((r) => r.score === best.score);
  const hasSignal = best.matched;

  // A tie alone is not an ambiguity. Every recipe scores at least the "nothing
  // matched but both are active" points, so an order that shares no flavour and
  // no size with anything would otherwise be reported as several equally good
  // matches. It is a non-match, and it has to read like one.
  if (tied.length > 1 && hasSignal) {
    return {
      mapishi_id: null,
      method: null,
      score: best.score,
      reason: {
        ulio: 'siyo wazi',
        maelezo:
          `Kuna mapishi ${tied.length} yanayofanana vyote kwa usawa, kwa hivyo hakuna moja ` +
          'linalotumika bila kujua ukubwa.',
        vyeo: tied.map((r) => ({ id: r.id, ladha: r.ladha, ukubwa: r.ukubwa })),
        maombi: { ladha: want.ladha, ukubwa: want.ukubwa, umbo: want.umbo },
      },
    };
  }

  // The size is not enough on its own. A customer who says "24" and a recipe
  // stored at 24 is a coincidence the moment the flavour differs, and acting on
  // it hands the kitchen a specific ingredient list for somebody's custom cake.
  // A shared flavour is what makes a match a match; the size only chooses between
  // the recipes that already share it.
  if (!best.sameCake) {
    return {
      mapishi_id: null,
      method: null,
      score: best.score,
      reason: {
        ulio: 'hakuna',
        maelezo:
          'Hakuna mapishi aliyofanana vya kutosha. Hakuna mwingine aliyotumia ladha ' +
          `hii, kwa hivyo ukubwa "${want.ukubwa}" peke yake si sababu ya kuchagua. ` +
          `Karibu zaidi: ${best.ladha} — ${best.ukubwa}`,
        karibu_zaidi: { ladha: best.ladha, ukubwa: best.ukubwa, alama: best.score },
        maombi: { ladha: want.ladha, ukubwa: want.ukubwa, umbo: want.umbo },
      },
    };
  }

  if (best.score < minScore) {
    return {
      mapishi_id: null,
      method: null,
      score: best.score,
      reason: {
        ulio: 'hakuna',
        maelezo:
          'Hakuna mapishi aliyofanana vya kutosha. Niliyokuwa karibu zaidi: ' +
          `${best.ladha} — ${best.ukubwa}`,
        karibu_zaidi: { ladha: best.ladha, ukubwa: best.ukubwa, alama: best.score },
        maombi: { ladha: want.ladha, ukubwa: want.ukubwa, umbo: want.umbo },
      },
    };
  }

  const exact = best.notes.includes('flavour exact') && best.notes.includes('size exact');
  const method = exact ? 'exact' : best.notes.some((n) => n.startsWith('flavour')) ? 'sehemu' : 'ukubwa';

  return {
    mapishi_id: best.id,
    method,
    score: best.score,
    reason: {
      ulio: method,
      maelezo: `Imelingana na "${best.ladha} — ${best.ukubwa}" kwa sababu: ${best.notes.join(', ')}.`,
      alama: best.score,
      maombi: { ladha: want.ladha, ukubwa: want.ukubwa, umbo: want.umbo },
    },
  };
}

module.exports = { matchRecipe, scoreRecipe, readSize, significant, fold };
