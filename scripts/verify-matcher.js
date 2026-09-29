/**
 * Unit tests for the recipe matcher.
 *
 *   node scripts/verify-matcher.js
 *
 * Deliberately not part of verify:all. It needs no database, no server and no
 * fixtures, so it runs on its own in milliseconds and can be used while working
 * on matching alone.
 *
 * The cases below are the ones that actually occur at the counter: the same size
 * written several ways, a flavour buried in a sentence, a size nobody gave, a
 * custom cake that matches nothing, and a near miss that must not be forced.
 */

const { matchRecipe, readSize, significant } = require('../src/recipes/matcher');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// The book a real shop would have: flavours at the sizes it actually bakes.
const RECIPES = [
  { id: 1, ladha: 'Chocolate', ukubwa: '8 inch', active: true },
  { id: 2, ladha: 'Chocolate', ukubwa: '10 inch', active: true },
  { id: 3, ladha: 'Chocolate', ukubwa: '12 inch', active: true },
  { id: 4, ladha: 'Vanilla', ukubwa: '8 inch', active: true },
  { id: 5, ladha: 'Vanilla', ukubwa: '10 inch', active: true },
  { id: 6, ladha: 'Madaraka', ukubwa: '10 inch', active: true },
  { id: 7, ladha: 'Keke ya Harusi', ukubwa: 'safu 3', active: true },
  { id: 8, ladha: 'Fruit Cake', ukubwa: '12 inch', active: true },
  { id: 9, ladha: 'Cheesecake', ukubwa: '9 inch', active: true },
  { id: 10, ladha: 'Carrot', ukubwa: '10 inch', active: true },
  { id: 11, ladha: 'Chocolate', ukubwa: '6 inch', active: false },
];

console.log('\n  Reading a size out of messy text\n');

check('a plain size is read', readSize('10 inch')?.n === 10, JSON.stringify(readSize('10 inch')));
check('the unit is normalised', readSize('10 inchi')?.unit === 'in', JSON.stringify(readSize('10 inchi')));
check(
  'a glued size is read',
  readSize('10in')?.n === 10 && readSize('10in')?.unit === 'in',
  JSON.stringify(readSize('10in'))
);
check(
  'the unit can come first',
  readSize('inch 10')?.n === 10 && readSize('inch 10')?.unit === 'in',
  JSON.stringify(readSize('inch 10'))
);
check('a Swahili size is read', readSize('kumi na mbili inchi')?.n === 12, JSON.stringify(readSize('kumi na mbili inchi')));
check('centimetres are read', readSize('25cm')?.n === 25 && readSize('25cm')?.unit === 'cm', JSON.stringify(readSize('25cm')));
check(
  'tiers are a size, but not a length',
  readSize('safu 3')?.n === 3 && readSize('safu 3')?.unit === 'safu',
  JSON.stringify(readSize('safu 3'))
);
check('a three tier cake is not a three inch cake', readSize('safu 3')?.unit !== readSize('3 inch')?.unit);
check('text with no number has no size', readSize('kubwa maalum') === null, JSON.stringify(readSize('kubwa maalum')));
check('empty text has no size', readSize('') === null);
check('undefined has no size', readSize(undefined) === null);

check(
  'noise words are dropped but the flavour survives',
  significant('Keki ya Chocolate 10 inch').join(' ') === 'chocolate',
  significant('Keki ya Chocolate 10 inch').join(' ')
);
check(
  'a compound keeps both words',
  significant('Dark chocolate').join(' ') === 'dark chocolate',
  significant('Dark chocolate').join(' ')
);

console.log('\n  Matching a description to one recipe\n');

const m = (ladha, ukubwa, umbo) => matchRecipe({ ladha, ukubwa, umbo }, RECIPES);

check(
  'a plain flavour and size matches exactly',
  m('Chocolate', '10 inch').mapishi_id === 2,
  JSON.stringify(m('Chocolate', '10 inch'))
);
check(
  'the method is recorded as exact',
  m('Chocolate', '10 inch').method === 'exact',
  m('Chocolate', '10 inch').method
);
check(
  'the right size is chosen, not the first flavour',
  m('Chocolate', '12 inch').mapishi_id === 3,
  JSON.stringify(m('Chocolate', '12 inch'))
);
check('a different flavour at the same size is a different recipe', m('Vanilla', '10 inch').mapishi_id === 5, `got ${m('Vanilla', '10 inch').mapishi_id}`);
check('Swahili noise around the flavour is ignored', m('Keki ya chocolate', '10 inch').mapishi_id === 2, `got ${m('Keki ya chocolate', '10 inch').mapishi_id}`);
check('a size written as inches matches a recipe stored as inch', m('Chocolate', '10 inches').mapishi_id === 2, `got ${m('Chocolate', '10 inches').mapishi_id}`);
check('a glued size matches a spaced one', m('Chocolate', '10in').mapishi_id === 2, `got ${m('Chocolate', '10in').mapishi_id}`);
check('a size within an inch is treated as the same cake', m('Cheesecake', '10 inch').mapishi_id === 9, `got ${m('Cheesecake', '10 inch').mapishi_id}`);

console.log('\n  Refusing to guess\n');

const custom = m('Keki ya mboga na viungo vya mchungwa', 'ukubwa wa kipekee', 'mchanganyiko');
check('a custom cake matches nothing', custom.mapishi_id === null, `got ${custom.mapishi_id}`);
check('a custom cake is still explained', typeof custom.reason.maelezo === 'string' && custom.reason.maelezo.length > 0, JSON.stringify(custom.reason));
check('a custom cake records the closest near miss', custom.reason.karibu_zaidi !== null);
check('the near miss is not presented as a match', custom.reason.karibu_zaidi.ladha !== custom.mapishi_id);

const retired = m('Chocolate', '6 inch');
check('a retired recipe is never matched', retired.mapishi_id !== 11, `got ${retired.mapishi_id}`);

const noSize = m('Chocolate', '');
check('an unknown size is not guessed at', noSize.mapishi_id === null, JSON.stringify(noSize.reason));
check('the ambiguity is explained', noSize.reason.ulio === 'siyo wazi', JSON.stringify(noSize.reason.ulio));
check('the tied options are recorded for the owner', Array.isArray(noSize.reason.vyeo) && noSize.reason.vyeo.length === 3, JSON.stringify(noSize.reason.vyeo));
check('a flavour baked at one size only is not ambiguous', m('Cheesecake', '').mapishi_id === 9, JSON.stringify(m('Cheesecake', '').mapishi_id));
check('matching is deterministic', m('Chocolate', '10 inch').mapishi_id === m('Chocolate', '10 inch').mapishi_id);
check('a wedding cake matches by its tier count', m('Keki ya Harusi', 'safu 3').mapishi_id === 7, JSON.stringify(m('Keki ya Harusi', 'safu 3')));

console.log('\n  A size on its own is not a cake\n');

// The bug this covers: "Unknown Cake, 24" was being matched to a recipe stored at
// 24, purely because the number agreed. The kitchen then got a specific
// ingredient list for a custom order nobody had looked up.
const SIZE_ONLY = [{ id: 500, ladha: 'Slow Sponge', ukubwa: '24', active: true }];
const sizeMiss = matchRecipe({ ladha: 'Unknown Cake', ukubwa: '24' }, SIZE_ONLY);
check('a size that coincides with a recipe is not a match', sizeMiss.mapishi_id === null, JSON.stringify(sizeMiss.reason));
check(
  'the reason says the flavour was missing, not the size',
  String(sizeMiss.reason.maelezo).includes('ladha'),
  sizeMiss.reason.maelezo
);
check('a shared flavour still matches at a coinciding size', matchRecipe({ ladha: 'Slow Sponge', ukubwa: '24' }, SIZE_ONLY).mapishi_id === 500);
check(
  'a shared flavour still matches when the size is different',
  matchRecipe({ ladha: 'Slow Sponge', ukubwa: '12' }, SIZE_ONLY).mapishi_id === 500,
  JSON.stringify(matchRecipe({ ladha: 'Slow Sponge', ukubwa: '12' }, SIZE_ONLY).reason)
);

const TWO_SIZES = [
  { id: 501, ladha: 'Chocolate Cake', ukubwa: '10 inch', active: true },
  { id: 502, ladha: 'Chocolate Cake', ukubwa: '14 inch', active: true },
];
check(
  'the size chooses between two recipes that share the flavour',
  matchRecipe({ ladha: 'Chocolate Cake', ukubwa: '10 inch' }, TWO_SIZES).mapishi_id === 501 &&
    matchRecipe({ ladha: 'Chocolate Cake', ukubwa: '14 inch' }, TWO_SIZES).mapishi_id === 502,
  JSON.stringify([
    matchRecipe({ ladha: 'Chocolate Cake', ukubwa: '10 inch' }, TWO_SIZES).mapishi_id,
    matchRecipe({ ladha: 'Chocolate Cake', ukubwa: '14 inch' }, TWO_SIZES).mapishi_id,
  ])
);

console.log('\n  Empty and hostile input\n');

check('no recipes matches nothing', matchRecipe({ ladha: 'Chocolate', ukubwa: '10 inch' }, []).mapishi_id === null);
check('an empty description matches nothing', m('', '').mapishi_id === null, `got ${m('', '').mapishi_id}`);
check('undefined description fields are safe', matchRecipe({}, RECIPES).mapishi_id === null);
check('null recipe fields are safe', matchRecipe({ ladha: null, ukubwa: null }, [{ id: 1, ladha: null, ukubwa: null, active: true }]).mapishi_id === null);
check('a missing active flag is not treated as usable', matchRecipe({ ladha: 'Chocolate', ukubwa: '10 inch' }, [{ id: 1, ladha: 'Chocolate', ukubwa: '10 inch' }]).mapishi_id === null);
check('a recipe is only used when the caller says it is active', matchRecipe({ ladha: 'Chocolate', ukubwa: '10 inch' }, RECIPES).mapishi_id !== 11);

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) {
  console.log('  failing: ' + failures.join('; ') + '\n');
  process.exit(1);
}
