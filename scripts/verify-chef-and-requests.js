/**
 * Unit tests for the two pure modules behind the chef sheet and the request
 * engine.
 *
 *   node scripts/verify-chef-and-requests.js
 *
 * No database, no server, no fixtures, so it runs in milliseconds. The cases are
 * the ones that decide whether the kitchen can work: a recipe that names one exact
 * amount, an amount small enough that rounding matters, a band that would reach
 * below zero, and a request that tries to approve itself.
 */

const { buildBands, tidy } = require('../src/recipes/bands');
const {
  transitionAllowed, OMBIAJIRA, HAI, INAIDHINISHIA, UNAYOGEZI,
} = require('../src/requests/stateMachine');

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

const alamaOf = (bands, i) => (bands[i] || {}).alama;
const byAlama = (bands, name) => bands.find((b) => b.alama === name);

console.log('\n  Bands the chef can tap\n');

const wide = buildBands(500, 600, 'g');
check('a range gives three bands', wide.length === 3, JSON.stringify(wide));
check('the recipe range is offered as the on-plan choice', !!byAlama(wide, 'hasi'));
check(
  'the on-plan band is the recipe\'s own range',
  byAlama(wide, 'hasi').kiasi_cha_chini === 500 && byAlama(wide, 'hasi').kiasi_cha_juu === 600,
  JSON.stringify(byAlama(wide, 'hasi'))
);
check('the lower band sits below the range', byAlama(wide, 'chini').kiasi_cha_juu === 500);
check('the upper band sits above the range', byAlama(wide, 'juu').kiasi_cha_chini === 600);
check('the three bands read as one scale', byAlama(wide, 'juu').kiasi_cha_juu - byAlama(wide, 'juu').kiasi_cha_chini === 100);
check('the order is low, on-plan, high', alamaOf(wide, 0) === 'chini' && alamaOf(wide, 1) === 'hasi' && alamaOf(wide, 2) === 'juu');

console.log('\n  A recipe that names one exact amount\n');

const exact = buildBands(100, 100, 'g');
check('an exact amount still offers the on-plan choice', !!byAlama(exact, 'hasi'), JSON.stringify(exact));
check('the on-plan choice is the amount itself', byAlama(exact, 'hasi').kiasi_cha_chini === 100 && byAlama(exact, 'hasi').kiasi_cha_juu === 100);
check('there are two neighbours to choose from instead', exact.length === 3, JSON.stringify(exact));
check('a neighbour below is offered', !!byAlama(exact, 'chini') && byAlama(exact, 'chini').kiasi_cha_chini < 100);
check('a neighbour above is offered', !!byAlama(exact, 'juu') && byAlama(exact, 'juu').kiasi_cha_juu > 100);

console.log('\n  Amounts that could be got wrong\n');

const small = buildBands(0, 0, 'kg');
check('a zero amount offers nothing below zero', small.every((b) => b.kiasi_cha_chini >= 0), JSON.stringify(small));
check('a zero amount still offers something usable', small.length > 0, JSON.stringify(small));

const partly = buildBands(0, 100, 'g');
check(
  'a band that would start below zero is clamped, not dropped',
  byAlama(partly, 'hasi').kiasi_cha_chini === 0,
  JSON.stringify(byAlama(partly, 'hasi'))
);
check('clamping does not leave a band with nothing in it', partly.every((b) => b.kiasi_cha_juu > 0));

const inverted = buildBands(600, 500, 'g');
check('a recipe with min above max still reads low to high', inverted.length === 3, JSON.stringify(inverted));
check('a reversed range is corrected rather than offered backwards', byAlama(inverted, 'hasi').kiasi_cha_chini === 500);

const narrow = buildBands(100.4, 100.6, 'g');
check('rounding never leaves a band inverted', narrow.every((b) => b.kiasi_cha_juu >= b.kiasi_cha_chini), JSON.stringify(narrow));
check('rounding never leaves two bands with identical numbers', new Set(narrow.map((b) => `${b.kiasi_cha_chini}-${b.kiasi_cha_juu}`)).size === narrow.length, JSON.stringify(narrow));
check('an on-plan band survives rounding', !!byAlama(narrow, 'hasi'), JSON.stringify(narrow));

const pieces = buildBands(2, 3, 'pcs');
check('counted units stay whole numbers', pieces.every((b) => Number.isInteger(b.kiasi_cha_chini) && Number.isInteger(b.kiasi_cha_juu)), JSON.stringify(pieces));

check('a missing amount offers nothing at all', buildBands(null, 500, 'g').length === 0);
check('a non-numeric amount offers nothing at all', buildBands('a', 'b', 'g').length === 0);
check('a tiny weight is not rounded to nothing', tidy(0.25, 'kg') === 0.25, `got ${tidy(0.25, 'kg')}`);
check('a missing amount is refused rather than read as zero', buildBands(null, null, 'g').length === 0 && buildBands('', '', 'g').length === 0);
check('one missing bound is still refused', buildBands(500, null, 'g').length === 0);

console.log('\n  A record nobody can skip ahead on\n');

const owner = { sub: 1, jukumu: 'owner' };
const sender = { sub: 2, jukumu: 'inventory' };
const recipient = { sub: 3, jukumu: 'chef' };
const stranger = { sub: 4, jukumu: 'cashier' };
const record = { id: 1, hali: 'inasubiri', kutoka_kwa: sender.sub, kwenda_kwa: recipient.sub };

const ok = (r, to, who) => transitionAllowed({ ...record, ...r }, to, who).ok;

check('the recipient may approve', ok({}, 'imeidhinishwa', recipient));
check('the owner may approve', ok({}, 'imeidhinishwa', owner));
check('the sender may not approve their own request', !ok({}, 'imeidhinishwa', sender), JSON.stringify(transitionAllowed(record, 'imeidhinishwa', sender)));
check('an unrelated member of staff may not approve', !ok({}, 'imeidhinishwa', stranger));
check('the sender may still withdraw their own request', ok({}, 'imeghairi', sender));
check('a stranger may not withdraw somebody else\'s record', !ok({}, 'imeghairi', stranger));
check('the recipient may not send their own record', !ok({}, 'imetumwa', recipient));
check('the sender may send their own record', ok({ hali: 'imeandikwa' }, 'imetumwa', sender));
check('a composed record cannot skip being sent', !ok({}, 'imetumwa', sender), JSON.stringify(transitionAllowed(record, 'imetumwa', sender)));
check('the recipient cannot send a record to themselves', !ok({ hali: 'imeandikwa' }, 'imetumwa', recipient));

console.log('\n  Transitions that do not exist\n');

check('nothing skips straight from waiting to done', !ok({}, 'imekamilika', owner), JSON.stringify(transitionAllowed(record, 'imekamilika', owner)));
check('nothing skips straight from waiting to acknowledged', !ok({}, 'limekubaliwa', owner));
check('approval is followed by work in progress', ok({}, 'imeidhinishwa', owner) && ok({ hali: 'imeidhinishwa' }, 'inaendelea', recipient));
check('work in progress can be finished', ok({ hali: 'inaendelea' }, 'imekamilika', recipient));
check('a refusal needs a reason state, not a decision', ok({}, 'imekataa', recipient));
check('the sender cannot reopen a closed record', !ok({ hali: 'imekamilika' }, 'inaendelea', owner));
check('a closed record cannot be closed again', !ok({ hali: 'imekataa' }, 'imekamilika', owner));
check('a withdrawn record is finished with it', !ok({ hali: 'imeghairi' }, 'imeidhinishwa', owner));

console.log('\n  The old two-state records still have to be refused, not misread\n');

check('an old open record is not treated as a new one', !ok({ hali: 'fungua' }, 'imeidhinishwa', owner), JSON.stringify(transitionAllowed({ ...record, hali: 'fungua' }, 'imeidhinishwa', owner)));
check('an old closed record is not treated as a new one', !ok({ hali: 'imefanyika' }, 'inaendelea', owner));
check('the old states cannot be moved to', !ok({}, 'fungua', owner) && !ok({}, 'imefanyika', owner));
check('every state the machine moves to is one the schema declares', [...Object.keys(OMBIAJIRA), ...HAI, 'imekamilika', 'imekataa', 'imeghairi'].every((s) => typeof s === 'string' && s.length > 0));

console.log('\n  A directive points the other way\n');

const directive = { hali: 'imeanzishwa', kutoka_kwa: owner.sub, kwenda_kwa: recipient.sub };
check('the recipient of a directive acknowledges it', transitionAllowed(directive, 'limekubaliwa', recipient).ok);
check('the owner who issued it cannot acknowledge it for them', !transitionAllowed(directive, 'limekubaliwa', owner).ok, JSON.stringify(transitionAllowed(directive, 'limekubaliwa', owner)));
check('an unacknowledged directive cannot be worked on', !transitionAllowed(directive, 'inaendelea', recipient).ok);
check('an unacknowledged directive cannot be finished', !transitionAllowed(directive, 'imekamilika', owner).ok);
check('an acknowledged directive can be worked on', transitionAllowed({ ...directive, hali: 'limekubaliwa' }, 'inaendelea', recipient).ok);
check('a directive issued out of nowhere is refused', !ok({ hali: 'ineendelea' }, 'imekamilika', recipient));

console.log('\n  Who may decide, in one place\n');

// Every state has to be reachable, and every state that is only ever an answer
// has to belong to the recipient rather than to the sender. A state that nothing
// leads to is dead code; a state the sender may reach is a hole.
const dests = new Set(Object.values(OMBIAJIRA).flat());
const terminals = ['imekamilika', 'imekataa', 'imeghairi'];

check('every declared transition leaves from a known state', Object.keys(OMBIAJIRA).every((s) => HAI.has(s) || terminals.includes(s)), Object.keys(OMBIAJIRA).filter((s) => !HAI.has(s) && !terminals.includes(s)).join(','));
check('every terminal state is a real state', terminals.every((s) => dests.has(s) || s === 'imeghairi'));
check('nothing leads out of a terminal state', terminals.every((s) => (OMBIAJIRA[s] || []).length === 0), terminals.filter((s) => (OMBIAJIRA[s] || []).length > 0).join(','));
check('every destination is a real state', [...dests].every((s) => HAI.has(s) || terminals.includes(s)), [...dests].join(','));
check('every state has a named set of people who may reach it', [...dests].every((s) => Array.isArray(UNAYOGEZI[s])), [...dests].filter((s) => !UNAYOGEZI[s]).join(','));
check('no state is only the sender\'s to reach', [...dests].every((s) => !UNAYOGEZI[s].includes('sender') || s === 'imeandikwa' || s === 'imetumwa' || s === 'imeanzishwa' || s === 'imeghairi'), [...dests].filter((s) => UNAYOGEZI[s].includes('sender')).join(','));
check('the start state is the only state with no way in from elsewhere', ![...dests].includes('imeandikwa') || Object.values(OMBIAJIRA).flat().includes('imeandikwa'));
check(
  'the states a sender may not reach are the answers, plus acknowledging a directive',
  [...INAIDHINISHIA].sort().join(',') === 'imeidhinishwa,imekataa,inahitaji,limekubaliwa',
  [...INAIDHINISHIA].sort().join(',')
);
check('a decision cannot be reached from a state that has not been decided', !ok({ hali: 'inaendelea' }, 'imeidhinishwa', recipient));
check('a clarification can be asked and then answered', ok({}, 'inahitaji', recipient) && ok({ hali: 'inahitaji' }, 'imeandikwa', sender));
check('a clarification can be turned down instead', ok({ hali: 'inahitaji' }, 'imekataa', recipient));

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) {
  console.log('  failing: ' + failures.join('; ') + '\n');
  process.exit(1);
}
