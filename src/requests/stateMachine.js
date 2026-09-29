/**
 * The request/directive state machine.
 *
 * Both directions live in one table and one table of transitions, because a
 * request and a directive are the same record pointing opposite ways. Building
 * them separately is how an inventory screen ends up able to approve something
 * it should only be able to acknowledge.
 *
 * The transitions are declared once and enforced in one place. The frontend gets
 * to show which buttons to draw; it does not get to decide what they mean.
 */
const OMBIAJIRA = {
  imeandikwa: ['imetumwa', 'imeghairi'],
  // Sent, then picked up. Kept apart from imasubiri so a request nobody has
  // looked at is distinguishable from one that is being actively considered.
  imetumwa: ['inasubiri', 'imeghairi'],
  inasubiri: ['imeidhinishwa', 'imekataa', 'inahitaji', 'imeghairi'],
  // The sender answers a clarification and it goes back out.
  inahitaji: ['imeandikwa', 'imekataa', 'imeghairi'],
  imeidhinishwa: ['inaendelea', 'imekamilika', 'imeghairi'],
  // Directive: issued, acknowledged, under way, done.
  imeanzishwa: ['limekubaliwa', 'imeghairi'],
  limekubaliwa: ['inaendelea', 'imekamilika', 'imeghairi'],
  inaendelea: ['imekamilika', 'imeghairi'],
  imekamilika: [],
  imekataa: [],
  imeghairi: [],
};

/**
 * Steps that only exist for a directive.
 *
 * A request and a directive share most of their life, but they are issued
 * differently. A request is sent and waits to be considered; a directive is
 * issued and waits to be acknowledged. "Sent" and "issued" are different acts by
 * different people, so the step that leaves imetumwa depends on what the record
 * actually is. Keyed by the record kind and merged in at the point of use, so
 * the table above stays readable as the shape of a request.
 */
const KIFACHA = {
  direktive: {
    imetumwa: ['imeanzishwa'],
  },
};

/** States that mean "nobody has finished this yet". */
const HAI = new Set([
  'imeandikwa', 'imetumwa', 'inasubiri', 'inahitaji', 'imeidhinishwa',
  'imeanzishwa', 'limekubaliwa', 'inaendelea',
]);

/**
 * States that mean "I have dealt with this". The person who raised a record
 * cannot put it into one of them, whoever they are, because a request approved by
 * the person who wanted it approved is not a decision, and a directive
 * acknowledged by the person who issued it never reached anybody.
 */
const INAIDHINISHIA = new Set(['imeidhinishwa', 'imekataa', 'inahitaji', 'limekubaliwa']);

/** Who may reach each state. The owner may reach any of them. */
const UNAYOGEZI = {
  // Sending, and answering a question put to the sender, are the sender's to do.
  imeandikwa: ['sender', 'owner'],
  imetumwa: ['sender', 'owner'],
  inasubiri: ['recipient', 'owner'],
  imeidhinishwa: ['recipient', 'owner'],
  imekataa: ['recipient', 'owner'],
  inahitaji: ['recipient', 'owner'],
  inaendelea: ['recipient', 'owner'],
  limekubaliwa: ['recipient', 'owner'],
  imeanzishwa: ['sender', 'owner'],
  imekamilika: ['recipient', 'owner'],
  imeghairi: ['sender', 'recipient', 'owner'],
};

/** States the backend will not produce. Kept for reading old rows. */
const LEFU = new Set(['fungua', 'imefanyika']);

/**
 * Check a proposed move and say why not, in one place, so every entry point
 * (the mutation, the UI, the tests) agrees on what is allowed.
 */
function transitionAllowed(record, to, actor) {
  const from = record.hali;

  if (LEFU.has(from)) {
    return { ok: false, code: 'FORBIDDEN', reason: 'Rekodi hii ni ya mfano wa awali na haijasasishwa.' };
  }
  if (LEFU.has(to)) {
    return { ok: false, code: 'BAD_REQUEST', reason: 'Hali hiyo si ya matumizi mapya.' };
  }
  if (!HAI.has(from)) {
    return { ok: false, code: 'ALREADY_CLOSED', reason: 'Rekodi hii imefungwa tayari.' };
  }
  const allowed =
    (OMBIAJIRA[from] || []).concat((KIFACHA[record.aina] || {})[from] || []);

  if (!allowed.includes(to)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      reason: `Hali "${from}" haipaswi kwenda moja kwa moja kwenye "${to}".`,
    };
  }

  const roles = UNAYOGEZI[to] || [];
  const isOwner = actor.jukumu === 'owner';
  const isSender = String(record.kutoka_kwa) === String(actor.sub);
  const isRecipient = String(record.kwenda_kwa) === String(actor.sub);

  // Checked before the owner exemption on purpose. The owner can do anything else
  // to anybody's record, because a shop of this size has no second owner to ask,
  // but the owner is still the person who raised the record: letting them approve
  // their own request is the exact hole this guard exists to close.
  if (INAIDHINISHIA.has(to) && isSender && !isRecipient) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      reason: 'Huwezi kujidhibiti ombi uliotuma mwenyewe.',
    };
  }
  if (isOwner) return { ok: true };

  // Each role is asked directly rather than "is owner in the list, so skip the
  // check", which is how an earlier version of this ended up letting any
  // signed-in member of staff approve anybody's request.
  const permitted = roles.some((r) => {
    if (r === 'sender') return isSender;
    if (r === 'recipient') return isRecipient;
    if (r === 'owner') return isOwner;
    return false;
  });
  if (!permitted) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      reason: 'Mtu huyu hana ruhusa ya kubadilisha rekodi hii.',
    };
  }
  return { ok: true };
}

module.exports = {
  OMBIAJIRA, KIFACHA, HAI, INAIDHINISHIA, LEFU, UNAYOGEZI, transitionAllowed,
};
