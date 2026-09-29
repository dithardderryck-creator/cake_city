const { GraphQLScalarType, Kind, GraphQLError } = require('graphql');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { signToken } = require('../auth/jwt');
const { isLocked, recordFailure, clear } = require('../auth/loginAttempts');
   const { predictStockFor, generateUkumbusho, getPrepTime } = require('../reminders/engine');
   const { eatDateKey } = require('../lib/dates');
   const { matchRecipe } = require('../recipes/matcher');
   const { buildBands } = require('../recipes/bands');
   const { transitionAllowed, HAI: HALI_HAI } = require('../requests/stateMachine');
const { nextTicketNumber, tikitishaAgizo } = require('../tickets/engine');
const {
  ROLE_OWNER,
  ROLE_CASHIER,
  ROLE_CHEF,
  ROLE_INVENTORY,
  requireCan,
  requireAuthenticated,
  can,
} = require('../auth/permissions');

const DateScalar = new GraphQLScalarType({
  name: 'Date',
  description: 'Date (YYYY-MM-DD, Tanzania time)',
  // Rendered in EAT so a date column never shifts a day because the host
  // process runs in a different timezone.
  serialize: (v) => (v instanceof Date ? eatDateKey(v) : v),
  parseValue: (v) => v,
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? ast.value : null),
});

const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  serialize: (v) => (v instanceof Date ? v.toISOString() : v),
  parseValue: (v) => v,
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? ast.value : null),
});

  const pad2 = (n) => String(n).padStart(2, '0');

  /**
   * Derive a product's family from its name.
   *
   * "Keki ya Chokoleti (dira 20)" -> "keki ya chokoleti"
   *
   * 'la' is rewritten to 'ya' because both are valid Swahili for "of", and
   * leaving both spellings in place is precisely how the catalogue ended up
   * with Cupcake la Chokoleti and Cupcake ya Chokoleti as two products. The
   * family+size uniqueness rule cannot catch that split on its own, because
   * the two names produce two different family strings and so never collide.
   * Matched on surrounding spaces rather than \b, which PostgreSQL regex does
   * not support as a word boundary.
   *
   * Every parenthetical group is dropped, not just a trailing one, so the
   * result stays consistent with deriveUkubwa which finds the size wherever it
   * appears. Stripping only a trailing "(...)" would leave the family as
   * "keki ya ndau (dira 12)" for a name like "Keki ya Ndau (dira 12) fres".
   */
  const deriveFamilia = (name) =>
    String(name)
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+la\s+/gi, ' ya ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .toLowerCase();

  /** Derive the size: the parenthesised part of the name, else "nzuri". */
  const deriveUkubwa = (explicit, name) => {
    if (explicit && String(explicit).trim()) return String(explicit).trim().toLowerCase();
    const m = String(name || '').match(/\(([^)]*)\)/);
    return (m && m[1].trim() ? m[1] : 'nzuri').toLowerCase();
  };


const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: (ast) => {
    if (ast.kind === Kind.STRING) try { return JSON.parse(ast.value); } catch { return null; }
    return null;
  },
});

/**
 * Shared insert path for BOTH the single-ingredient legacy mutation and the
 * new batch one, so there is exactly one place that writes usage rows.
 *
 * Two things it deliberately does NOT do, because they are the whole point
 * of the redesign:
 *   1. It never checks current stock. The chef's number is an estimate made
 *      mid-bake, and refusing to log "used 4kg" because 3kg showed on the
 *      shelf would hide a real stock problem instead of surfacing it.
 *   2. It never moves stock. Rows land as 'inakadiriwa' and sit in the
 *      verification queue until inventory confirms the real number.
 */
const insertUsageBatch = async (
  _,
  { agizo_id, kumbukumbu, vitu, malighafi_id, kiasi, badilisha },
  ctx
) => {
     const u = ctx.user;
     requireCan(u, 'usage.create');
   
     // Work out what each line actually says before touching the database, so a
     // bad tap is rejected with a message about the tap rather than a constraint
     // error from halfway through the insert.
     const raw = (vitu || [{ malighafi_id, kiasi }]).map((l) => ({
       malighafi_id: Number(l.malighafi_id),
       kiasi: l.kiasi === undefined || l.kiasi === null ? null : Number(l.kiasi),
       kiasi_cha_chini:
         l.kiasi_cha_chini === undefined || l.kiasi_cha_chini === null
           ? null
           : Number(l.kiasi_cha_chini),
       kiasi_cha_juu:
         l.kiasi_cha_juu === undefined || l.kiasi_cha_juu === null ? null : Number(l.kiasi_cha_juu),
       hali_sheeti: l.hali_sheeti || null,
       mapishi_kipengele_id: l.mapishi_kipengele_id ? Number(l.mapishi_kipengele_id) : null,
       sehemu: l.sehemu || null,
     }));
   
     if (!raw.length) {
       throw new GraphQLError('Hakuna kitu chochote kilichorekodiwa.', {
         extensions: { code: 'BAD_REQUEST' },
       });
     }
   
     const prepared = raw.map((l) => {
       if (!Number.isInteger(l.malighafi_id) || l.malighafi_id <= 0) {
         throw new GraphQLError('Chagua malighafi.', { extensions: { code: 'BAD_REQUEST' } });
       }
   
       // "Not used" is a real answer and the only one that legitimately carries
       // no amount. It stores 0, which the verification step confirms at 0, which
       // moves no stock. Anything else has to say how much.
       if (l.hali_sheeti === 'haikutumika') {
         return { ...l, kiasi: 0, kiasi_cha_chini: null, kiasi_cha_juu: null };
       }
       if (l.hali_sheeti === 'nyingine' && !l.mapishi_kipengele_id && l.kiasi == null) {
         throw new GraphQLError('Weka kiasi au chagua kipengele kimoja.', {
           extensions: { code: 'BAD_REQUEST' },
         });
       }
   
       if (l.kiasi_cha_chini !== null && l.kiasi_cha_juu !== null) {
         if (
           !Number.isFinite(l.kiasi_cha_chini) ||
           !Number.isFinite(l.kiasi_cha_juu) ||
           l.kiasi_cha_juu < l.kiasi_cha_chini
         ) {
           throw new GraphQLError('Kipengele cha kiasi si sahihi.', { extensions: { code: 'BAD_REQUEST' } });
         }
         // The stored midpoint has to be the band the chef tapped, and the
         // midpoint is only ever a provisional estimate. Deriving it here rather
         // than trusting the client means the ledger cannot end up claiming a
         // number the chef never tapped.
         const kiasi = Math.round(((l.kiasi_cha_chini + l.kiasi_cha_juu) / 2) * 100) / 100;
         return { ...l, kiasi, hali_sheeti: l.hali_sheeti || 'imechaguliwa' };
       }
   
       if (l.kiasi == null || !Number.isFinite(l.kiasi) || l.kiasi < 0) {
         throw new GraphQLError('Kiasi kinachotumika lazima kiwe sahihi.', {
           extensions: { code: 'BAD_REQUEST' },
         });
       }
       return { ...l, kiasi: l.kiasi, hali_sheeti: l.hali_sheeti || 'imechaguliwa' };
     });
   
     // An entry with no order to explain it needs a note saying what it was
     // for, otherwise "flour 2kg" is unattributable forever.
     const note = kumbukumbu ? String(kumbukumbu).trim() : null;
     if (!agizo_id && !note) {
       throw new GraphQLError('Andika maelezo ya kile kundi (kwa mfano: "20 mandazi").', {
         extensions: { code: 'BAD_REQUEST' },
       });
     }
   
     const client = await pool.connect();
     try {
       await client.query('BEGIN');
   
       let sheet = null;
       if (agizo_id) {
         const order = (await client.query('SELECT id FROM agizo_maalum WHERE id = $1', [agizo_id])).rows[0];
         if (!order) throw new GraphQLError('Agizo halipo.', { extensions: { code: 'NOT_FOUND' } });
   
         // One open sheet per order. The partial unique index in migration 008 is
         // the real guarantee; this reads it first so a double tap gets told why
         // rather than surfacing as a raw unique violation.
         sheet = (
           await client.query(
             `SELECT id FROM zingumiaji_matumizi
               WHERE agizo_id = $1 AND hali = 'inakadiriwa' FOR UPDATE`,
             [agizo_id]
           )
         ).rows[0];
   
         if (sheet) {
           if (!badilisha) {
             throw new GraphQLError('Umesharekodi matumizi ya agizo hili. Hakuna rekodi nyingine mpya.', {
               extensions: { code: 'ALREADY_LOGGED', zingumiaji_id: sheet.id },
             });
           }
            // An amend supersedes the previous sheet rather than deleting it, so
            // the first submission stays on the record with the amounts the chef
            // actually tapped, and the reason it was wrong is not erased by the
            // correction. The lines are left exactly as they were and the sheet is
            // moved out of the pending state, which is what the replacement and
            // the verification queue key on.
            await client.query(
              `UPDATE zingumiaji_matumizi
                 SET hali = 'imebadilishwa',
                     kumbukumbu = COALESCE(NULLIF(kumbukumbu, ''),
                       'Imebadilishwa kabla ya kuthibitishwa.')
               WHERE id = $1`,
              [sheet.id]
            );
            sheet = null;
         }
       }
   
       // Reject retired ingredients: migration 004 kept the collapsed
       // duplicates as inactive rows, and logging against those would move
       // stock nobody is counting.
       const ids = prepared.map((l) => l.malighafi_id);
       const found = (
         await client.query('SELECT id FROM malighafi WHERE id = ANY($1::int[]) AND active', [ids])
       ).rows.map((r) => r.id);
       const missing = ids.filter((id) => !found.includes(id));
       if (missing.length) {
         throw new GraphQLError('Baadhi ya malighafi hayapatikani au yameondolewa.', {
           extensions: { code: 'BAD_REQUEST', malighafi_ids: missing },
         });
       }
   
       // A recipe line reference has to belong to a line that really mentions
       // this ingredient, otherwise the sheet would claim a link the recipe book
       // contradicts. Checked here rather than trusted, because it is the chef
       // who is filling this in.
        const lineIds = prepared.map((l) => l.mapishi_kipengele_id).filter(Boolean);
        let lineMap = new Map();
        if (lineIds.length) {
          const lines = (
            await client.query(
              `SELECT l.id, l.malighafi_id, l.sehemu, l.mapishi_id
                 FROM mapishi_kipengele l
                WHERE l.id = ANY($1::int[])`,
              [lineIds]
            )
          ).rows;
          lineMap = new Map(lines.map((l) => [l.id, l]));
          for (const id of lineIds) {
            if (!lineMap.has(id)) {
              throw new GraphQLError('Kipengele cha mapishi hakipo.', { extensions: { code: 'BAD_REQUEST' } });
            }
          }
          for (const l of prepared) {
            if (l.mapishi_kipengele_id && lineMap.get(l.mapishi_kipengele_id).malighafi_id !== l.malighafi_id) {
              throw new GraphQLError('Kipengele cha mapishi hakihusiani na malighafi uliochaguliwa.', {
                extensions: { code: 'BAD_REQUEST' },
              });
            }
          }

          // A sheet for an order has to be built from that order's recipe. Without
          // this, a line from any other recipe in the book passes every other
          // check, and the order's production record ends up describing a
          // different cake than the one being baked.
          //
          // An order with no recipe (an unmatched custom order) is the exception
          // that proves the rule: there is nothing to belong to, so a reference is
          // only allowed when the order has no recipe at all.
          if (agizo_id) {
            const order = (
              await client.query('SELECT mapishi_id FROM agizo_maalum WHERE id = $1', [agizo_id])
            ).rows[0];
            const orderRecipe = order ? order.mapishi_id : null;
            const stray = prepared.filter(
              (l) => l.mapishi_kipengele_id && lineMap.get(l.mapishi_kipengele_id).mapishi_id !== orderRecipe
            );
            if (stray.length) {
              throw new GraphQLError(
                orderRecipe
                  ? 'Baadhi ya viambato ni vya mapishi mwingine, si mapishi ya agizo hili.'
                  : 'Agizo hili hana mapishi, kwa hivyo haiwezi kurejelea kipengele chochote cha mapishi.',
                { extensions: { code: 'BAD_REQUEST' } }
              );
            }
          }
        }
   
       // The same ingredient can appear twice in a recipe (base and frosting), so
       // folding repeats by ingredient would silently drop one of them. Fold by
       // recipe line instead, which is what actually distinguishes the two.
       const folded = new Map();
       for (const l of prepared) {
         const key = l.mapishi_kipengele_id ? `line-${l.mapishi_kipengele_id}` : `ing-${l.malighafi_id}`;
         const prev = folded.get(key);
         if (prev) {
           // Two taps on the same line fold into one, keeping the band the chef
           // widened most recently. An unused line wins outright: tapping
           // "not used" after an amount is a correction, not an addition.
           if (l.hali_sheeti === 'haikutumika') {
             folded.set(key, { ...prev, hali_sheeti: 'haikutumika', kiasi: 0, kiasi_cha_chini: null, kiasi_cha_juu: null });
           } else if (prev.hali_sheeti === 'haikutumika') {
             // keep unused
           } else {
             folded.set(key, {
               ...l,
               kiasi: Math.round((prev.kiasi + l.kiasi) * 100) / 100,
               kiasi_cha_chini: null,
               kiasi_cha_juu: null,
             });
           }
         } else {
           folded.set(key, l);
         }
       }
       const merged = [...folded.values()];
   
       if (agizo_id) {
         const { rows: srows } = await client.query(
           `INSERT INTO zingumiaji_matumizi (agizo_id, mpishi_id, kumbukumbu)
            VALUES ($1, $2, $3) RETURNING *`,
           [agizo_id, u.sub, note]
         );
         sheet = srows[0];
       }
   
       const out = [];
       for (const l of merged) {
         const line = l.mapishi_kipengele_id ? lineMap.get(l.mapishi_kipengele_id) : null;
         const { rows } = await client.query(
           `INSERT INTO kumbukumbu_matumizi
              (agizo_id, zingumiaji_id, hali_sheeti, malighafi_id, kiasi, kiasi_cha_chini, kiasi_cha_juu,
               mapishi_kipengele_id, sehemu, mpishi_id, hali, kumbukumbu)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'inakadiriwa', $11)
            RETURNING *`,
           [
              agizo_id || null,
              sheet ? sheet.id : null,
              // Only a line that belongs to a sheet carries a sheet state. The
              // kumbukumbu_matumizi_sheeti_coherent constraint in migration 008
              // ties these two together on purpose, because hali_sheeti answers
              // "what did the chef say about this line" and a standalone note has
              // no sheet to answer about. A "not used" line still stores 0, so the
              // answer survives as the quantity.
              sheet ? l.hali_sheeti : null,
             l.malighafi_id,
             l.kiasi,
             l.kiasi_cha_chini,
             l.kiasi_cha_juu,
             l.mapishi_kipengele_id,
             l.sehemu || (line ? line.sehemu : null),
             u.sub,
             note,
           ]
         );
         out.push(rows[0]);
       }

       // BR-13: a submitted report raises a request to Inventory, and resolving
       // that request is the confirmation. Without it the sheet only ever sits
       // in a queue nobody was asked to act on, and the confirmation has no
       // request thread on the audit trail.
       if (sheet) {
         await raiseUsageConfirmation(client, sheet.id, u.sub, agizo_id, merged.length);
       }

       await client.query('COMMIT');
       return out;
     } catch (err) {
       await client.query('ROLLBACK');
       throw err;
     } finally {
       client.release();
     }
   };

/**
 * BR-13: raise the confirmation request that a submitted usage report creates.
 *
 * Runs inside the submitter's transaction, so the request and the sheet it
 * describes are committed together or not at all. A report with no matching
 * request would put a queue entry nobody was asked to act on.
 *
 * The recipient is the Inventory role, resolved to an active staff member. The
 * blueprint routes to a role rather than a person, and the schema already keeps
 * jukumu_anayehudumiwa so the record still reads correctly if that person later
 * leaves. Where more than one person holds the role, the oldest active one is
 * used deterministically; the request is a role's to answer, not one person's.
 *
 * Starts at inasubiri, not imeandikwa. A human request has a draft window
 * because a person writes it; this one is already delivered, so inventing a
 * draft state for it would only add a step nobody can act on.
 */
const raiseUsageConfirmation = async (client, sheetId, raisedBy, agizoId, lineCount) => {
  const to = (
    await client.query(
      `SELECT id FROM mtumiaji
        WHERE jukumu = 'inventory' AND active
        ORDER BY id
        LIMIT 1`
    )
  ).rows[0];
  if (!to) {
    // No one holds the Inventory role, so there is nobody to route to. The
    // sheet still exists and can still be confirmed line by line; this is a
    // staffing gap, not a reason to fail the chef's submission.
    return null;
  }
  if (Number(to.id) === Number(raisedBy)) {
    // ombi has CHECK (kutoka_kwa <> kwenda_kwa): a person cannot be the
    // recipient of their own request. If the only Inventory member is the one
    // reporting, there is no separate recipient and the request is skipped
    // rather than fabricated.
    return null;
  }
  const n = Number(lineCount) || 0;
  const { rows } = await client.query(
    `INSERT INTO ombi
       (kutoka_kwa, kwenda_kwa, ujumbe, mada, aina, kipendeleo,
        agizo_id, zingumiaji_id, jukumu_anayehudumiwa, hali)
     VALUES ($1, $2, $3, $4, 'ombi', 'kawaida', $5, $6, 'inventory', 'inasubiri')
     RETURNING *`,
    [
      raisedBy,
      to.id,
      `Msaidie akadiria matumizi ya malighafi: mistari ${n} imeandikwa. Thibitisha kiasi halisi ili hisa iongeze.`,
      `Thibitisha matumizi (mistari ${n})`,
      agizoId || null,
      sheetId,
    ]
  );
  return rows[0];
};

/**
 * Validate + normalise a recipe's ingredient lines. Shared by create and
 * edit so both reject the same mistakes the same way.
 */
const normaliseIngredients = async (client, viambato, allowEmpty = false) => {
  if (!Array.isArray(viambato) || !viambato.length) {
    // A fraction_of recipe is meant to have no lines of its own — it inherits
    // the parent's amounts, scaled. Requiring a line here made the whole
    // fraction_of concept impossible to author, which is the bug this flag fixes.
    if (allowEmpty) return [];
    throw new GraphQLError('Mapishi lazima iwe na angalau kifungu kimoja.', {
      extensions: { code: 'BAD_REQUEST' },
    });
  }
  const out = [];
  const seen = new Set();
  for (const v of viambato) {
    const mid = Number(v.malighafi_id);
    const chini = Number(v.kiasi_cha_chini);
    const juu = Number(v.kiasi_cha_juu);
    if (!Number.isInteger(mid) || mid <= 0) {
      throw new GraphQLError('Chagua malighafi.', { extensions: { code: 'BAD_REQUEST' } });
    }
    if (!Number.isFinite(chini) || !Number.isFinite(juu) || chini <= 0 || juu < chini) {
      throw new GraphQLError('Kiasi cha chini na cha juu hazilingani.', {
        extensions: { code: 'BAD_REQUEST' },
      });
    }
    // A CHECK covers the min<=max case, but the unique key on
    // (mapishi, material, sehemu) would raise a raw constraint error, so
    // catch repeated ingredient+part here.
    const sehemu = (v.sehemu && String(v.sehemu).trim()) || 'mfuatano';
    const key = `${mid}|${sehemu}`;
    if (seen.has(key)) {
      throw new GraphQLError('Malighafi imewekwa mara mbili kwa sehemu hiyo.', {
        extensions: { code: 'BAD_REQUEST', malighafi_id: mid, sehemu },
      });
    }
    seen.add(key);
    out.push({ malighafi_id: mid, kiasi_cha_chini: chini, kiasi_cha_juu: juu, sehemu });
  }
  const ids = [...new Set(out.map((o) => o.malighafi_id))];
  const found = (await client.query('SELECT id FROM malighafi WHERE id = ANY($1::int[]) AND active', [ids]))
    .rows.map((r) => r.id);
  const missing = ids.filter((id) => !found.includes(id));
  if (missing.length) {
    throw new GraphQLError('Baadhi ya malighafi hayapatikani au yameondolewa.', {
      extensions: { code: 'BAD_REQUEST', malighafi_ids: missing },
    });
  }
  return out;
};

/**
 * Validates the own_recipe / fraction_of decision and returns the normalised
 * values to persist. Shared by unda_mapishi and hariri_mapishi so the two
 * paths cannot drift apart.
 *
 * `selfId` is the recipe being edited, used to stop a recipe being pointed at
 * itself — the only cycle that is directly reachable from the form.
 */
const normaliseVariant = async (client, input, selfId = null) => {
  const variant = (input.mapamba_variant || 'own_recipe').trim();
  if (!['own_recipe', 'fraction_of'].includes(variant)) {
    throw new GraphQLError('Aina ya mapishi si sahihi.', {
      extensions: { code: 'BAD_REQUEST' },
    });
  }

  if (variant !== 'fraction_of') {
    // An own_recipe carries its own amounts, so a dangling parent or a stray
    // ratio would be meaningless data. Clear both rather than storing them.
    return { variant, mapishi_ibaba: null, sehemu_ya_uzito: null };
  }

  const parentId = Number(input.mapishi_ibaba);
  if (!Number.isInteger(parentId) || parentId <= 0) {
    throw new GraphQLError('Mapishi ya "sehemu ya" lazima ielekeze kwenye mapishi mzazi.', {
      extensions: { code: 'BAD_REQUEST' },
    });
  }
  if (selfId && parentId === Number(selfId)) {
    throw new GraphQLError('Mapishi haiwezi kuwa mzazi yake mwenyewe.', {
      extensions: { code: 'BAD_REQUEST' },
    });
  }

  const ratio = Number(input.sehemu_ya_uzito);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    throw new GraphQLError('Sehemu ya uzito lazima uwe kati ya 0 na 1.', {
      extensions: { code: 'BAD_REQUEST' },
    });
  }

  const parent = (await client.query('SELECT id, mapamba_variant, active FROM mapishi WHERE id = $1', [parentId]))
    .rows[0];
  if (!parent) {
    throw new GraphQLError('Mapishi mzazi halipo.', { extensions: { code: 'NOT_FOUND' } });
  }
  // No chains. A fraction of a fraction is still computable arithmetically, but
  // allowing it lets a cycle be authored, and the parent-scaling read would then
  // recurse with no base case.
  if (parent.mapamba_variant !== 'own_recipe') {
    throw new GraphQLError('Mapishi mzazi lazima iwe na mapishi yake yenyewe.', {
      extensions: { code: 'BAD_REQUEST' },
    });
  }

  return { variant, mapishi_ibaba: parentId, sehemu_ya_uzito: ratio };
};

  /**
   * The single place a request or directive changes state. Every mutation below
   * funnels through this, so there is one permission check, one transition check
   * and one audit trail rather than one per button.
   */
  const moveOmbi = async (ctx, { id, hali, jibu }) => {
    requireAuthenticated(ctx.user);
    const to = String(hali || '');
    // The permission is tied to the *destination* state, not to the mutation name,
    // so "approve" and "complete" cannot end up sharing the same gate by accident.
    const perm = to === 'imekamilika' ? 'ombi.kamilisha' : to === 'imeanzishwa' ? 'ombi.anzisha' : 'ombi.amua';
    requireCan(ctx.user, perm);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Names the actor on the audit rows this transaction is about to write.
      // Transaction-local, because a pooled connection must not carry one
      // requester's id into the next one's audit trail.
      await client.query("SELECT set_config('app.fanya_kwa', $1, true)", [String(ctx.user.sub)]);

      const cur = (await client.query('SELECT * FROM ombi WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) throw new GraphQLError('Ombi halipo.', { extensions: { code: 'NOT_FOUND' } });

      const verdict = transitionAllowed(cur, to, ctx.user);
      if (!verdict.ok) {
        throw new GraphQLError(verdict.reason, { extensions: { code: verdict.code } });
      }

      const note = jibu ? String(jibu).trim() : null;
      // A terminal state records who closed it and when. A finished record with
      // nobody's name on it is a record nobody did.
      const closing = ['imekamilika', 'imekataa', 'imeghairi'].includes(to);
      const { rows } = await client.query(
        `UPDATE ombi
            SET hali = $2::hali_ombi,
                jibu = COALESCE($3, jibu),
                alizokamilisha_na = CASE WHEN $4 THEN $5::int ELSE alizokamilisha_na END,
                alizokamilisha_at = CASE WHEN $4 THEN now() ELSE alizokamilisha_at END,
                tarehe_ya_kufunguliwa = CASE WHEN $4 THEN now() ELSE tarehe_ya_kufunguliwa END
          WHERE id = $1
        RETURNING *`,
        [id, to, note, closing, ctx.user.sub]
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

  /**
   * Raise a request, or issue a directive. One mutation for both because the
   * records are the same shape; `aina` records which way the intent points, and
   * the state machine treats the two differently from then on.
   *
   * Starts at imeandikwa rather than imetumwa so a record can be corrected
   * before anybody is told about it.
   */
  const raiseOmbi = async (ctx, input) => {
    const u = ctx.user;
    requireCan(u, 'ombi.tuma');
    const msg = String(input.ujumbe || '').trim();
    if (!msg) throw new GraphQLError('Andika ujumbe.', { extensions: { code: 'BAD_REQUEST' } });
    if (String(input.kwenda_kwa) === String(u.sub)) {
      throw new GraphQLError('Huwezi kujiombia mwenyewe.', { extensions: { code: 'BAD_REQUEST' } });
    }
    const to = (
      await pool.query('SELECT id, jukumu FROM mtumiaji WHERE id = $1 AND active', [input.kwenda_kwa])
    ).rows[0];
    if (!to) throw new GraphQLError('Mfanyakaji hakupatikani.', { extensions: { code: 'NOT_FOUND' } });

    const kiasi = input.kiasi === undefined || input.kiasi === null ? null : Number(input.kiasi);
    // An amount with nothing to measure is a mistake, and the mistake would
    // otherwise sit in the record until somebody tried to act on it.
    if (kiasi !== null && (!Number.isFinite(kiasi) || kiasi <= 0)) {
      throw new GraphQLError('Kiasi lazima kiwe zaidi ya sifuri.', { extensions: { code: 'BAD_REQUEST' } });
    }
    if (kiasi !== null && !input.malighafi_id) {
      throw new GraphQLError('Chagua malighafi ili kiasi kionelewe.', { extensions: { code: 'BAD_REQUEST' } });
    }
    let ing = null;
    if (input.malighafi_id) {
      ing = (await pool.query('SELECT id FROM malighafi WHERE id = $1 AND active', [input.malighafi_id])).rows[0];
      if (!ing) throw new GraphQLError('Malighafi hakipatikani.', { extensions: { code: 'NOT_FOUND' } });
    }
    if (input.agizo_id) {
      const ord = (await pool.query('SELECT id FROM agizo_maalum WHERE id = $1', [input.agizo_id])).rows[0];
      if (!ord) throw new GraphQLError('Agizo halipo.', { extensions: { code: 'NOT_FOUND' } });
    }

    // A one-line title so a list of twenty is readable without opening each one.
    // Falls back to the start of the body rather than being mandatory.
    const mada = input.mada ? String(input.mada).trim() : msg.slice(0, 60);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.fanya_kwa', $1, true)", [String(u.sub)]);
      const { rows } = await client.query(
        `INSERT INTO ombi
           (kutoka_kwa, kwenda_kwa, ujumbe, mada, aina, kipendeleo, malighafi_id, kiasi,
            agizo_id, mwisho, jukumu_anayehudumiwa, hali)
         VALUES ($1, $2, $3, $4, $5::aina_ukumbusho_kazi, $6::kipendeleo_ukumbusho_kazi,
                 $7, $8, $9, $10, $11, 'imeandikwa')
         RETURNING *`,
        [
          u.sub,
          input.kwenda_kwa,
          msg,
          mada,
          input.aina || 'ombi',
          input.kipendeleo || 'kawaida',
          ing ? ing.id : null,
          kiasi,
          input.agizo_id || null,
          input.mwisho || null,
          to.jukumu,
        ]
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

const resolvers = {
  Date: DateScalar,
  DateTime: DateTimeScalar,
  JSON: JSONScalar,

  AgizoMaalum: {
    mapishi: async (order) => {
      // A NULL mapishi_id IS the custom/off-book flag, so this stays nullable
      // rather than throwing — the kitchen needs to see "no recipe, start empty".
      if (!order.mapishi_id) return null;
      const { rows } = await pool.query('SELECT * FROM mapishi WHERE id = $1', [
        order.mapishi_id,
      ]);
      return rows[0] || null;
    },
    mteja: async (order, _, ctx) => {
      if (!can(ctx.user, 'order.read_all')) return null;
      if (!order.mteja_id) return null;
      const { rows } = await pool.query('SELECT * FROM mteja WHERE id = $1', [
        order.mteja_id,
      ]);
      return rows[0] || null;
    },
    // The kitchen's view of the customer. Gated on order.read_kitchen, not
    // order.read_all, because the chef must see the allergy info but has no
    // business seeing the rest of the customer record. Only the three columns
    // the kitchen actually needs are selected.
    mteja_kupika: async (order, _, ctx) => {
      if (!can(ctx.user, 'order.read_kitchen')) return null;
      if (!order.mteja_id) return null;
      const { rows } = await pool.query(
        'SELECT jina, simu, mzio FROM mteja WHERE id = $1',
        [order.mteja_id]
      );
      return rows[0] || null;
    },
    bei_jumla: (order, _, ctx) =>
      can(ctx.user, 'order.read_all') ? order.bei_jumla : null,
    malipo_ya_awali: (order, _, ctx) =>
      can(ctx.user, 'order.read_all') ? order.malipo_ya_awali : null,
    salio: (order, _, ctx) =>
      can(ctx.user, 'order.read_all') ? order.salio : null,
    created_by: (order, _, ctx) =>
      can(ctx.user, 'order.read_all') ? order.created_by : null,
    muda_hitajika: async (order) => {
      // A recipe-book order already carries a weighed prep time on the recipe
      // itself, which is the kitchen-tested number. The free-text lookup below
      // only knows the size ("24"), so it would hand back a generic default and
      // quietly ignore the recipe the chef actually baked.
      if (order.mapishi_id) {
        const rec = (
          await pool.query('SELECT dakika_kadirio FROM mapishi WHERE id = $1', [order.mapishi_id])
        ).rows[0];
        if (rec && Number.isFinite(Number(rec.dakika_kadirio))) {
          return rec.dakika_kadirio;
        }
      }
      const prep = await getPrepTime(order.ladha, order.ukubwa);
      return prep;
    },
  },

  Mauzo: {
    mfanyakazi: async (sale) => {
      if (!sale.mfanyakazi_id) return null;
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu FROM mtumiaji WHERE id = $1',
        [sale.mfanyakazi_id]
      );
      return rows[0] || null;
    },
    bidhaa: async (sale) => {
      const { rows } = await pool.query(
        `SELECT mb.id, mb.kiasi, mb.bei, b.*
         FROM mauzo_bidhaa mb
         JOIN bidhaa b ON b.id = mb.bidhaa_id
         WHERE mb.mauzo_id = $1`,
        [sale.id]
      );
      return rows.map((r) => ({
        id: r.id,
        kiasi: r.kiasi,
        bei: r.bei,
        bidhaa: r,
      }));
    },
  },

  KumbukumbuMatumizi: {
    agizo: async (log) => {
      if (!log.agizo_id) return null;
      const { rows } = await pool.query(
        'SELECT * FROM agizo_maalum WHERE id = $1',
        [log.agizo_id]
      );
      return rows[0] || null;
    },
    malighafi: async (log) => {
      const { rows } = await pool.query('SELECT * FROM malighafi WHERE id = $1', [
        log.malighafi_id,
      ]);
      return rows[0] || null;
    },
    mpishi: async (log) => {
      if (!log.mpishi_id) return null;
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu FROM mtumiaji WHERE id = $1',
        [log.mpishi_id]
      );
      return rows[0] || null;
    },
    imethibitishwa_na: async (log) => {
      if (!log.imethibitishwa_na) return null;
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu FROM mtumiaji WHERE id = $1',
        [log.imethibitishwa_na]
      );
      return rows[0] || null;
    },
    /**
     * The production sheet this line belongs to, or null on a row written before
     * sheets existed. Such a line keeps working as a plain estimate; what it
     * cannot do is pretend to be part of a submission nobody made.
     */
    zingumiaji: async (log) => {
      if (!log.zingumiaji_id) return null;
      const { rows } = await pool.query('SELECT * FROM zingumiaji_matumizi WHERE id = $1', [
        log.zingumiaji_id,
      ]);
      return rows[0] || null;
    },
  },

  Bidhaa: {
    kategoria: async (p) => {
      if (!p.kategoria_id) return null;
      const { rows } = await pool.query('SELECT * FROM kategoria WHERE id = $1', [
        p.kategoria_id,
      ]);
      return rows[0] || null;
    },
  },

  Kategoria: {
    bidhaa: async (k) => {
      const { rows } = await pool.query(
        'SELECT * FROM bidhaa WHERE kategoria_id = $1 AND active = true ORDER BY jina',
        [k.id]
      );
      return rows;
    },
  },

  Mapishi: {
    viambato: async (m) => {
      const own = await pool.query(
        'SELECT * FROM mapishi_kipengele WHERE mapishi_id = $1 ORDER BY id',
        [m.id]
      );
      if (own.rows.length > 0) return own.rows;

      // A fraction_of recipe (a slice) has no lines of its own by design — it is
      // a portion of the parent cake, not a separate recipe. Derive the amounts
      // from the parent so the slice reports the real quantities the chef needs,
      // rather than looking like an empty, broken recipe.
      if (m.mapamba_variant === 'fraction_of' && m.mapishi_ibaba) {
        const ratio = Number(m.sehemu_ya_uzito);
        if (Number.isFinite(ratio) && ratio > 0) {
          const parent = await pool.query(
            'SELECT * FROM mapishi_kipengele WHERE mapishi_id = $1 ORDER BY id',
            [m.mapishi_ibaba]
          );
          return parent.rows.map((r) => ({
            ...r,
            id: null,
            mapishi_id: m.id,
            inayotokwa: true,
            kiasi_cha_chini: Number(r.kiasi_cha_chini) * ratio,
            kiasi_cha_juu: Number(r.kiasi_cha_juu) * ratio,
          }));
        }
      }
      // An own_recipe that simply has nothing entered yet — an honest empty list,
      // which the recipe form shows as "this recipe has no ingredients yet".
      return own.rows;
    },
    mapishi_ibaba: async (m) => {
      if (!m.mapishi_ibaba) return null;
      const { rows } = await pool.query('SELECT * FROM mapishi WHERE id = $1', [
        m.mapishi_ibaba,
      ]);
      return rows[0] || null;
    },
  },

  MapishiKipengele: {
    malighafi: async (line) => {
      const { rows } = await pool.query('SELECT * FROM malighafi WHERE id = $1', [
        line.malighafi_id,
      ]);
      return rows[0] || null;
    },
    // Stored lines are the recipe's own; a null id already signals "derived",
    // but this makes the distinction explicit for the UI instead of requiring
    // it to infer intent from a null.
       inayotokwa: (line) => line.inayotokwa === true || line.id == null,
       // The tappable amounts, derived on read from the range already stored.
       // Deriving them rather than storing them means a recipe edit changes what
       // the chef is offered with no second write, and there is no way for the
       // buttons and the recipe to disagree.
       vipendeleo: async (line) => {
         const { rows } = await pool.query('SELECT unit FROM malighafi WHERE id = $1', [
           line.malighafi_id,
         ]);
         return buildBands(line.kiasi_cha_chini, line.kiasi_cha_juu, rows[0]?.unit);
       },
     },

  Ombi: {
    kutoka_kwa: async (o) => {
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu FROM mtumiaji WHERE id = $1',
        [o.kutoka_kwa]
      );
      return rows[0] || null;
    },
    kwenda_kwa: async (o) => {
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu FROM mtumiaji WHERE id = $1',
        [o.kwenda_kwa]
      );
      return rows[0] || null;
    },
    malighafi: async (o) => {
      if (!o.malighafi_id) return null;
      const { rows } = await pool.query('SELECT * FROM malighafi WHERE id = $1', [o.malighafi_id]);
      return rows[0] || null;
    },
    agizo: async (o) => {
      if (!o.agizo_id) return null;
      const { rows } = await pool.query('SELECT * FROM agizo_maalum WHERE id = $1', [o.agizo_id]);
      return rows[0] || null;
    },
    // BR-13: the confirmation request points at the sheet it was raised for, so
    // the queue can show what is actually waiting and a resolve can find it.
    zingumiaji: async (o) => {
      if (!o.zingumiaji_id) return null;
      const { rows } = await pool.query(
        'SELECT * FROM zingumiaji_matumizi WHERE id = $1',
        [o.zingumiaji_id]
      );
      return rows[0] || null;
    },
    alizokamilisha_na: async (o) => {
      if (!o.alizokamilisha_na) return null;
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu FROM mtumiaji WHERE id = $1',
        [o.alizokamilisha_na]
      );
      return rows[0] || null;
    },

    // Whether anybody still owes an answer. Computed rather than stored so a
    // record cannot be left sitting in a closed state while the list that drives
    // the owner's morning still calls it open.
    hai: (o) => HALI_HAI.has(o.hali),

    // Overdue means past its own deadline and still open. A directive with no
    // deadline is never overdue, which is why mwisho being null is not enough to
    // say yes here.
    // Compared as local calendar days, not timestamps. A deadline of today is not
    // an overdue deadline until tomorrow, and letting the clock decide that would
    // make a record overdue at 00:01 for a whole day the owner never intended.
    imeishia_muda: (o) =>
      !!o.mwisho && HALI_HAI.has(o.hali) && eatDateKey(o.mwisho) < eatDateKey(),

    /**
     * The record's own history, read back out of the audit log rather than kept
     * in a second table. A parallel timeline is a timeline that can disagree with
     * what happened, and the whole point of asking "who approved this and when"
     * is that the answer cannot be edited independently of the decision.
     */
    historia: async (o) => {
      const { rows } = await pool.query(
        `SELECT data_ya_baada->>'hali' AS hali,
                COALESCE(data_ya_baada->>'jibu', data_ya_kabla->>'jibu') AS ujumbe,
                fanya_kwa, tarehe
           FROM kumbukumbu_kitendo
          WHERE meza = 'ombi' AND node_id = $1
          ORDER BY id ASC`,
        [o.id]
      );
      return rows
        .filter((r) => r.hali)
        .map((r) => ({
          hali: r.hali,
          ujumbe: r.ujumbe,
          tarehe: r.tarehe,
          aliyefanya: r.fanya_kwa,
        }));
    },
  },

  IsharaOmbi: {
    aliyefanya: async (i) => {
      if (!i.aliyefanya) return null;
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu FROM mtumiaji WHERE id = $1',
        [i.aliyefanya]
      );
      return rows[0] || null;
    },
  },

  /**
   * A sheet, with its lines attached. Resolving them here rather than in the
   * insert means a sheet read after a correction shows the correction, and there
   * is no stored copy to forget to update.
   */
  ZingumiajiMatumizi: {
    mistari: async (s) => {
      const { rows } = await pool.query(
        `SELECT * FROM kumbukumbu_matumizi
          WHERE zingumiaji_id = $1
          ORDER BY (hali_sheeti = 'haikutumika'), malighafi_id, id`,
        [s.id]
      );
      return rows;
    },
    mpishi: async (s) => {
      if (!s.mpishi_id) return null;
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu FROM mtumiaji WHERE id = $1',
        [s.mpishi_id]
      );
      return rows[0] || null;
    },
    imethibitishwa_na: async (s) => {
      if (!s.imethibitishwa_na) return null;
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu FROM mtumiaji WHERE id = $1',
        [s.imethibitishwa_na]
      );
      return rows[0] || null;
    },
    agizo: async (s) => {
      const { rows } = await pool.query('SELECT * FROM agizo_maalum WHERE id = $1', [s.agizo_id]);
      return rows[0] || null;
    },
  },

  MarekebishoHisa: {
    malighafi: async (adj) => {
      const { rows } = await pool.query(
        'SELECT * FROM malighafi WHERE id = $1',
        [adj.malighafi_id]
      );
      return rows[0] || null;
    },
    created_by: async (adj) => {
      if (!adj.created_by) return null;
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu FROM mtumiaji WHERE id = $1',
        [adj.created_by]
      );
      return rows[0] || null;
    },
  },

  Ukumbusho: {
    agizo: async (uk) => {
      if (!uk.agizo_id) return null;
      const { rows } = await pool.query(
        'SELECT * FROM agizo_maalum WHERE id = $1',
        [uk.agizo_id]
      );
      return rows[0] || null;
    },
    malighafi: async (uk) => {
      if (!uk.malighafi_id) return null;
      const { rows } = await pool.query(
        'SELECT * FROM malighafi WHERE id = $1',
        [uk.malighafi_id]
      );
      return rows[0] || null;
    },
  },

  Tikiti: {
    mauzo: async (t) => {
      if (!t.mauzo_id) return null;
      const { rows } = await pool.query('SELECT * FROM mauzo WHERE id = $1', [t.mauzo_id]);
      return rows[0] || null;
    },
    agizo: async (t) => {
      if (!t.agizo_id) return null;
      const { rows } = await pool.query('SELECT * FROM agizo_maalum WHERE id = $1', [t.agizo_id]);
      return rows[0] || null;
    },
  },

  Query: {
    me: async (_, __, ctx) => {
      if (!ctx.user) throw new GraphQLError('Lazima uingie.', { extensions: { code: 'UNAUTHENTICATED' } });
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu, active FROM mtumiaji WHERE id = $1',
        [ctx.user.sub]
      );
      if (!rows[0]) throw new GraphQLError('Mtumiaji hapatikani.', { extensions: { code: 'NOT_FOUND' } });
      return {
        id: rows[0].id,
        jina: rows[0].jina,
        jukumu: rows[0].jukumu,
        active: rows[0].active,
      };
    },

    wafanyakazi: async () => {
      // Public list for the login screen: names + roles only, no sensitive data.
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu FROM mtumiaji WHERE active = true ORDER BY jina'
      );
      return rows;
    },

    staff: async (_, __, ctx) => {
      requireCan(ctx.user, 'staff.manage');
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu, active, created_at FROM mtumiaji'
      );
      return rows;
    },

    // Who a request can be addressed to. Deliberately not gated on staff.manage:
    // that permission belongs to the owner alone, and an inventory clerk who
    // cannot see a list of colleagues cannot raise a purchase request at all.
    // It returns active staff only, with no join date and no inactive accounts.
    watumishi: async (_, __, ctx) => {
      requireAuthenticated(ctx.user);
      const { rows } = await pool.query(
        'SELECT id, jina, jukumu, active FROM mtumiaji WHERE active ORDER BY jina'
      );
      return rows;
    },

    bidhaa: async (_, { active }, ctx) => {
      requireCan(ctx.user, 'stock.read');
      // Reuse stock.read as the least-privilege read gate; all four roles read products for their workflows.
      const activeCond = active === false ? '' : 'WHERE active = true';
      const { rows } = await pool.query(`SELECT * FROM bidhaa ${activeCond} ORDER BY aina, jina`);
      return rows;
    },

    wateja: async (_, { search }, ctx) => {
      requireCan(ctx.user, 'customer.manage');
      const params = [];
      let where = '';
      if (search) {
        params.push(`%${search}%`);
        where = `WHERE jina ILIKE $1 OR simu ILIKE $1`;
      }
      const { rows } = await pool.query(`SELECT * FROM mteja ${where} ORDER BY jina`, params);
      return rows;
    },

    agizo_maalum: async (_, { hali, tarehe_ya_kuchukua }, ctx) => {
      requireCan(ctx.user, 'order.read_all');
      const where = [];
      const params = [];
      if (hali) { params.push(hali); where.push(`hali = $${params.length}`); }
      if (tarehe_ya_kuchukua) { params.push(tarehe_ya_kuchukua); where.push(`tarehe_ya_kuchukua = $${params.length}`); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM agizo_maalum ${whereSql} ORDER BY tarehe_ya_kuchukua`,
        params
      );
      return rows;
    },

    order_kwajikoni: async (_, __, ctx) => {
      requireCan(ctx.user, 'order.read_kitchen');
      // Chef's queue: active orders (not yet collected) sorted by urgency.
      const { rows } = await pool.query(
        `SELECT * FROM agizo_maalum
         WHERE hali IN ('ordered', 'in_progress')
         ORDER BY tarehe_ya_kuchukua ASC, created_at ASC`
      );
      return rows;
    },

    mauzo: async (_, { tarehe, njia_ya_malipo }, ctx) => {
      // Owner: all sales. Cashier: own shift only.
      const where = ['1=1'];
      const params = [];
      if (ctx.user.jukumu === ROLE_CASHIER) {
        params.push(ctx.user.sub);
        where.push(`mfanyakazi_id = $${params.length}`);
      } else {
        requireCan(ctx.user, 'sale.read_all');
      }
      if (tarehe) { params.push(tarehe); where.push(`tarehe = $${params.length}`); }
      if (njia_ya_malipo) { params.push(njia_ya_malipo); where.push(`njia_ya_malipo = $${params.length}`); }
      const { rows } = await pool.query(
        `SELECT * FROM mauzo WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
        params
      );
      return rows;
    },

    mauzo_ya_leo: async (_, __, ctx) => {
      // "Today" is decided by Postgres, not the Node process clock, so sales
      // made at 00:00-03:00 EAT still land on the correct business day.
      if (ctx.user.jukumu === ROLE_CASHIER) {
        const { rows } = await pool.query(
          `SELECT * FROM mauzo WHERE tarehe = CURRENT_DATE AND mfanyakazi_id = $1 ORDER BY created_at DESC`,
          [ctx.user.sub]
        );
        return rows;
      }
      requireCan(ctx.user, 'sale.read_all');
      const { rows } = await pool.query(
        `SELECT * FROM mauzo WHERE tarehe = CURRENT_DATE ORDER BY created_at DESC`
      );
      return rows;
    },

      kumbukumbu_matumizi: async (_, { agizo_id, tarehe_kutoka, tarehe_kutia }, ctx) => {
        requireCan(ctx.user, 'usage.read_all');
        const where = [];
        const params = [];
        if (agizo_id) { params.push(agizo_id); where.push(`agizo_id = $${params.length}`); }
        // Both bounds compare against the local date, so "the last 7 days" means
        // the same seven days the shop is trading in rather than UTC days.
        if (tarehe_kutoka) { params.push(tarehe_kutoka); where.push(`tarehe >= $${params.length}::date`); }
        if (tarehe_kutia) { params.push(tarehe_kutia); where.push(`tarehe < $${params.length}::date + INTERVAL '1 day'`); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { rows } = await pool.query(`SELECT * FROM kumbukumbu_matumizi ${whereSql} ORDER BY tarehe DESC`, params);
        return rows;
      },

      hisa: async (_, __, ctx) => {
        requireCan(ctx.user, 'stock.read');
        // `active` hides the duplicate ingredients collapsed in migration 004, so
        // the chef's tap list and the low-stock panel show six real ingredients
        // instead of twelve.
        const { rows } = await pool.query(`SELECT * FROM malighafi WHERE active ORDER BY jina`);
        // Current quantity is source of truth; % used is derived once
        // accumulated totals exist. Low-stock is flagged per threshold.
        const items = rows.map((r) => ({
          ...r,
          asilimia_iliyotumika: null,
        }));
        const lowStock = rows.filter((r) => r.kiasi_kilichopo <= r.kiwango_cha_chini);
        return { items, lowStock };
      },

      /**
     * One ingredient, in depth: the live balance, every movement that explains
     * it, and the recipes the kitchen spends it on.
     *
     * The history is read out of the real ledger rather than extrapolated. An
     * earlier version of the stock screen drew a 14-day "actual" line by walking
     * backwards from the current quantity at the current usage rate, which
     * produced a smooth and entirely invented history — a shop with three days
     * of trading looked like it had a fortnight of data. Here the daily closing
     * balances are anchored to the quantity the database actually holds today and
     * stepped back through recorded movements, so every point is defensible. Days
     * with no movement are omitted rather than filled in with an invented flat
     * line; today is always included because it is the anchor.
     */
    maelezo_malighafi: async (_, { id }, ctx) => {
      requireCan(ctx.user, 'stock.read');
      const ing = (await pool.query('SELECT * FROM malighafi WHERE id = $1', [id])).rows[0];
      if (!ing) throw new GraphQLError('Malighafi hayapatikani.', { extensions: { code: 'NOT_FOUND' } });

        const [usage, adjustments, recipes] = await Promise.all([
          pool.query(
            `SELECT k.id, k.kiasi_halisi, k.tarehe, k.tarehe_ya_uthibitisho, k.agizo_id, k.kumbukumbu,
                    k.imethibitishwa_na,
                    COALESCE(k.tarehe_ya_uthibitisho, k.tarehe)::date::text AS tarehe_ya_kutoka,
                    a.ladha AS agizo_ladha, m.ladha AS mapishi_ladha
               FROM kumbukumbu_matumizi k
               LEFT JOIN agizo_maalum a ON a.id = k.agizo_id
               LEFT JOIN mapishi m       ON m.id = a.mapishi_id
              WHERE k.malighafi_id = $1
                AND k.hali = 'imethibitishwa'
                AND k.kiasi_halisi IS NOT NULL
              ORDER BY k.id`,
            [id]
          ),
          pool.query(
            `SELECT r.id, r.kiasi, r.aina, r.tarehe, r.sababu, r.created_by,
                    r.tarehe::date::text AS tarehe_ya_kutoka
               FROM marekebisho_hisa r WHERE r.malighafi_id = $1
              ORDER BY r.id`,
            [id]
          ),
          pool.query(
            `SELECT m.id AS mapishi_id, m.ladha, m.ukubwa, v.kiasi_cha_chini, v.kiasi_cha_juu
               FROM mapishi_kipengele v
               JOIN mapishi m ON m.id = v.mapishi_id
              WHERE v.malighafi_id = $1 AND m.active = true
              ORDER BY m.ladha, m.ukubwa`,
            [id]
          ),
        ]);

        // The two sources have separate id sequences, so a raw id would collide
        // across them and React would reuse one row's markup for another. The
        // prefix keeps every line uniquely addressable.
        const vipengele = [
          ...usage.rows.map((r) => ({
            id: `matumizi-${r.id}`,
            aina: 'matumizi',
            kiasi: Number(r.kiasi_halisi),
            // The verification time is when stock actually moved, so it is the
            // honest date for this line. The chef may have logged it hours earlier.
            tarehe: r.tarehe_ya_uthibitisho || r.tarehe,
            tarehe_ya_kutoka: r.tarehe_ya_kutoka,
            sababu: r.kumbukumbu || r.mapishi_ladha || r.agizo_ladha || null,
            agizo_id: r.agizo_id,
            mwingilieji_id: r.imethibitishwa_na,
          })),
          ...adjustments.rows.map((r) => ({
            id: `${r.aina}-${r.id}`,
            aina: r.aina === 'restock' ? 'kujaza' : 'upotevu',
            kiasi: Number(r.kiasi),
            tarehe: r.tarehe,
            tarehe_ya_kutoka: r.tarehe_ya_kutoka,
            sababu: r.sababu,
            agizo_id: null,
            mwingilieji_id: r.created_by,
          })),
        ].sort((a, b) => new Date(b.tarehe) - new Date(a.tarehe));

      for (const v of vipengele) {
        v.mabadiliko = v.aina === 'kujaza' ? v.kiasi : -v.kiasi;
      }

      // One entry per day that moved, plus today as the anchor. Bucketing uses
      // the date Postgres returned, never a JS Date stringified — that yields
      // locale text like "Sun Sep 27" and silently splits one day in two.
      const perDay = new Map();
      for (const v of vipengele) {
        perDay.set(v.tarehe_ya_kutoka, (perDay.get(v.tarehe_ya_kutoka) || 0) + v.mabadiliko);
      }
      const today = (await pool.query('SELECT CURRENT_DATE::text AS d')).rows[0].d;
      if (!perDay.has(today)) perDay.set(today, 0);
      const days = [...perDay.keys()].sort();

      const mwenendo = [];
      let running = Number(ing.kiasi_kilichopo);
      for (let i = days.length - 1; i >= 0; i -= 1) {
        mwenendo.push({ tarehe: days[i], mabadiliko: perDay.get(days[i]), kiasi: running });
        running -= perDay.get(days[i]);
      }

        // Who moved the stock, for the ledger's "by" column. Resolved in one
        // query rather than per line: the earlier version handed the raw id back
        // where the schema promises an Mtumiaji, so any client selecting the name
        // got a type error instead of a name.
        const who = vipengele.map((v) => v.mwingilieji_id).filter(Boolean);
        const staff = who.length
          ? (
              await pool.query(
                `SELECT id, jina, jukumu FROM mtumiaji WHERE id = ANY($1::int[])`,
                [[...new Set(who)]]
              )
            ).rows
          : [];
        const byId = Object.fromEntries(staff.map((s) => [String(s.id), s]));

        return {
          malighafi: ing,
          vipengele: vipengele.map((v) => ({
            ...v,
            mwingilieji: v.mwingilieji_id ? byId[String(v.mwingilieji_id)] || null : null,
          })),
          mapishi: recipes.rows,
          mwenendo: mwenendo.reverse(),
        };
    },

    malighafi: async (_, __, ctx) => {
        requireCan(ctx.user, 'stock.read');
        const { rows } = await pool.query(`SELECT * FROM malighafi WHERE active ORDER BY jina`);
        return rows;
      },

      // Recipes, for custom cake orders. Defaults to active-only, matching the
      // bidhaa query: pass active:false to include retired recipes.
      mapishi: async (_, { active }, ctx) => {
        requireCan(ctx.user, 'stock.read');
        const activeCond = active === false ? '' : 'WHERE active = true';
        const { rows } = await pool.query(`SELECT * FROM mapishi ${activeCond} ORDER BY ladha, ukubwa`);
        return rows;
      },

      // Estimated usage still waiting on inventory. Joined to the order and its
      // recipe because a bare "flour 4-5" tells the clerk nothing — they need
      // to see which cake and how many to judge whether the number is sane.
      kumbukumbu_matumizi_kusubiri: async (_, __, ctx) => {
        requireCan(ctx.user, 'usage.verify');
        const { rows } = await pool.query(
          `SELECT k.*, a.ladha AS agizo_ladha, a.ukubwa AS agizo_ukubwa,
                  m.ladha AS mapishi_ladha, m.ukubwa AS mapishi_ukubwa
             FROM kumbukumbu_matumizi k
             LEFT JOIN agizo_maalum a ON a.id = k.agizo_id
             LEFT JOIN mapishi m       ON m.id = a.mapishi_id
             LEFT JOIN zingumiaji_matumizi z ON z.id = k.zingumiaji_id
            WHERE k.hali = 'inakadiriwa'
              AND (k.zingumiaji_id IS NULL OR z.hali = 'inakadiriwa')
            ORDER BY k.tarehe DESC`
        );
        return rows;
      },

      /**
       * The chef's own sheets.
       *
       * Scoped to the sheets this person submitted, and it includes superseded
       * ones. A chef who has to correct a submission still needs to see that the
       * first one is there, and hiding it would be the same hole the amend path
       * used to have: the correction would be visible and the thing it corrected
       * would not be.
       */
      zingumiaji_zangu: async (_, __, ctx) => {
        requireAuthenticated(ctx.user);
        const { rows } = await pool.query(
          `SELECT * FROM zingumiaji_matumizi
            WHERE mpishi_id = $1
            ORDER BY tarehe DESC, id DESC`,
          [ctx.user.sub]
        );
        return rows;
      },

      kategoria: async (_, { active }, ctx) => {
        requireCan(ctx.user, 'stock.read');
        const activeCond = active === false ? '' : 'WHERE active = true';
        const { rows } = await pool.query(`SELECT * FROM kategoria ${activeCond} ORDER BY jina`);
        return rows;
      },

      /**
       * What you can see. Staff see what they sent and what was sent to them;
       * the owner sees everything. A general staff member has no way to read
       * someone else's request, which is the behaviour a shop actually wants.
       */
      ombi: async (_, { fungua, aina }, ctx) => {
        requireAuthenticated(ctx.user);
        const u = ctx.user;
        const params = [];
        const where = [];
        const add = (v) => {
          params.push(v);
          return `$${params.length}`;
        };

        if (u.jukumu !== ROLE_OWNER) {
          where.push(`(kutoka_kwa = ${add(u.sub)} OR kwenda_kwa = ${add(u.sub)})`);
        }
        // Spread the Set into an array. node-postgres does not understand a Set;
        // it JSON-encodes one as "{}", and "{}" is not a list of enum values, so
        // the filter would fail on the database rather than return the wrong rows.
        if (fungua === true) {
          // "Open" is any state still waiting on somebody. Listing by the old
          // two-state pair would hide a directive the recipient has accepted but
          // not finished, which is exactly the thing an owner needs to see.
          where.push(`hali = ANY(${add([...HALI_HAI])}::hali_ombi[])`);
        } else if (fungua === false) {
          where.push(`hali <> ALL(${add([...HALI_HAI])}::hali_ombi[])`);
        }
        if (aina) {
          where.push(`aina = ${add(aina)}::aina_ukumbusho_kazi`);
        }

        const sql =
          'SELECT * FROM ombi' +
          (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
          ` ORDER BY created_at DESC`;
        const { rows } = await pool.query(sql, params);
        return rows;
      },

    marekebisho_hisa: async (_, { tarehe_kutoka, tarehe_kutia }, ctx) => {
      requireAuthenticated(ctx.user);
      if (!can(ctx.user, 'usage.read_all') && !can(ctx.user, 'stock.adjust_restock') && !can(ctx.user, 'stock.adjust_waste')) {
        throw new GraphQLError('Hamna ruhusa ya kuona marekebisho.', { extensions: { code: 'FORBIDDEN' } });
      }
      const where = [];
      const params = [];
      if (tarehe_kutoka) { params.push(tarehe_kutoka); where.push(`tarehe >= $${params.length}::date`); }
      if (tarehe_kutia) { params.push(tarehe_kutia); where.push(`tarehe < $${params.length}::date + INTERVAL '1 day'`); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM marekebisho_hisa ${whereSql} ORDER BY tarehe DESC`,
        params
      );
      return rows;
    },

    ukumbusho: async (_, __, ctx) => {
      requireCan(ctx.user, 'stock.read'); // any authenticated role; owner sees all below
      const role = ctx.user.jukumu;
      const params = [];
      const { rows } = await pool.query(
        `SELECT * FROM ukumbusho
         WHERE imesomwa = false
           AND (lengo = $1 OR $2)
         ORDER BY
           CASE WHEN aina = 'anza_kutengeneza' THEN 0 ELSE 1 END,
           tarehe_ya_utekelezaji ASC NULLS LAST,
           created_at DESC`,
        [role, role === ROLE_OWNER]
      );
      return rows;
    },

    utabiri_hisa: async (_, { kiasi_chini_ya_siku }, ctx) => {
      requireAuthenticated(ctx.user);
      if (!can(ctx.user, 'usage.read_all') && !can(ctx.user, 'stock.read')) {
        throw new GraphQLError('Hamna ruhusa ya kuona utabiri.', { extensions: { code: 'FORBIDDEN' } });
      }
      const maxDays = kiasi_chini_ya_siku || 7;
      const ingredients = (await pool.query('SELECT * FROM malighafi')).rows;
      const forecast = [];
      for (const ing of ingredients) {
        const { perDay, daysLeft, depletionDate } = await predictStockFor(ing.id);
        if (daysLeft <= maxDays) {
          const hali = daysLeft <= 0 ? 'imeisha' : (daysLeft <= 2 ? 'muhimu' : 'mpotevu');
          forecast.push({
            malighafi: ing,
            kiwango_cha_matumizi_kwa_siku: perDay,
            siku_zilizobaki: daysLeft,
            tarehe_kutabiriwa: depletionDate,
            hali,
          });
        }
      }
      return forecast.sort((a, b) => a.siku_zilizobaki - b.siku_zilizobaki);
    },

    tikiti: async (_, { tarehe, hali }, ctx) => {
      const hasBoard = can(ctx.user, 'sale.read_own') || can(ctx.user, 'order.read_all') || can(ctx.user, 'order.read_kitchen');
      if (!hasBoard) {
        throw new GraphQLError('Hamna ruhusa ya kuona tikiti.', { extensions: { code: 'FORBIDDEN' } });
      }
      const params = [];
      let where = '';
      if (tarehe) { params.push(tarehe); where += ` WHERE tarehe = $${params.length}`; }
      if (hali) { params.push(hali); where += (where ? ' AND' : ' WHERE') + ` hali = $${params.length}`; }
      const { rows } = await pool.query(
        `SELECT * FROM tikiti${where} ORDER BY tarehe DESC, namba DESC`,
        params
      );
      return rows;
    },

    kumbukumbu_kitendo: async (_, { meza, node_id, kikomo }, ctx) => {
      if (ctx.user.jukumu !== 'owner') {
        throw new GraphQLError('Habari za ukaguzi zinapatikana kwa mmiliki pekee.', { extensions: { code: 'FORBIDDEN' } });
      }
      const limit = Math.min(Math.max(kikomo || 50, 1), 500);
      const params = [];
      let where = '';
      if (meza) { params.push(meza); where += ` WHERE meza = $${params.length}`; }
      if (node_id) { params.push(node_id); where += (where ? ' AND' : ' WHERE') + ` node_id = $${params.length}`; }
      const { rows } = await pool.query(
        `SELECT * FROM kumbukumbu_kitendo${where} ORDER BY id DESC LIMIT ${limit}`,
        params
      );
      return rows;
    },

    riport_dashboard: async (_, __, ctx) => {
      requireCan(ctx.user, 'report.access_dashboard');

      const [mauzoRes, totalRes, perMethodRes, balancesRes, lowRes, kitchenRes, weekRes] = await Promise.all([
        pool.query('SELECT * FROM mauzo WHERE tarehe = CURRENT_DATE ORDER BY created_at DESC'),
        pool.query('SELECT COALESCE(SUM(jumla), 0)::float AS total FROM mauzo WHERE tarehe = CURRENT_DATE'),
        pool.query(
          'SELECT njia_ya_malipo, COALESCE(SUM(jumla), 0)::float AS jumla FROM mauzo WHERE tarehe = CURRENT_DATE GROUP BY njia_ya_malipo'
        ),
        pool.query(
          // Outstanding money is owed whether or not the cake has been handed
          // over. Filtering on hali here would drop a collected order that was
          // still unpaid, hiding the debt from the owner entirely. Only fully
          // settled orders and cancelled ones drop out.
          `SELECT * FROM agizo_maalum
           WHERE salio > 0 AND hali <> 'cancelled'
           ORDER BY tarehe_ya_kuchukua`
        ),
        pool.query(
          `SELECT id, jina, kiasi_kilichopo, kiwango_cha_chini, unit FROM malighafi WHERE kiasi_kilichopo <= kiwango_cha_chini ORDER BY jina`
        ),
        pool.query(
          `SELECT * FROM agizo_maalum WHERE hali IN ('in_progress', 'ready') ORDER BY tarehe_ya_kuchukua`
        ),
        // The 7-day axis is built by Postgres so the day boundaries match the
        // same CURRENT_DATE used above, and days with no sales still appear.
        pool.query(
          `SELECT d::date AS tarehe,
                  COALESCE(SUM(m.jumla), 0)::float AS jumla,
                  COUNT(m.id)::int AS risiti
           FROM generate_series(
                  CURRENT_DATE - INTERVAL '6 days',
                  CURRENT_DATE,
                  INTERVAL '1 day'
                ) AS d
           LEFT JOIN mauzo m
             ON m.tarehe = d::date
           GROUP BY d::date
           ORDER BY d::date`
        ),
      ]);

      const siku7 = weekRes.rows.map((r) => ({
        tarehe: r.tarehe,
        jumla: r.jumla,
        risiti: r.risiti,
      }));

      return {
        mauzo_ya_leo: mauzoRes.rows,
        mauzo_ya_leo_total: totalRes.rows[0].total,
        mauzo_kwa_njia: perMethodRes.rows.map((r) => ({
          njia: r.njia_ya_malipo,
          jumla: r.jumla,
        })),
        mauzo_7_siku: siku7,
        maagizo_ambayo_hajakusanywa: balancesRes.rows,
        salio_jumla_ajira: balancesRes.rows.reduce((sum, o) => sum + Number(o.salio || 0), 0),
        hisa_chini: lowRes.rows,
        shughuli_za_jikoni: kitchenRes.rows,
      };
    },
  },

  Mutation: {
    login: async (_, { id, pin }, ctx) => {
      // A1: lock out both the account and the source IP after repeated
      // failures, so 4-digit PINs cannot be ground from either direction.
      const ip = (ctx.req && (ctx.req.ip || ctx.req.socket?.remoteAddress)) || 'unknown';
      const accountKey = `id:${id}`;
      const ipKey = `ip:${ip}`;

      if (isLocked(accountKey) || isLocked(ipKey)) {
        throw new GraphQLError('Mwingiliano umefungiwa kwa muda. Jaribu tena baadaye.', {
          extensions: { code: 'TOO_MANY_ATTEMPTS' },
        });
      }

      const { rows } = await pool.query(
        'SELECT * FROM mtumiaji WHERE id = $1 AND active = true',
        [id]
      );
      const u = rows[0];
      // Always run a bcrypt comparison so a missing/inactive account and a
      // wrong PIN take the same time — otherwise response timing alone
      // reveals which staff IDs exist.
      const hash = u ? u.pin_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
      const pinOk = await bcrypt.compare(String(pin ?? ''), hash);

      if (!u || !pinOk) {
        const left = Math.min(recordFailure(accountKey), recordFailure(ipKey));
        throw new GraphQLError(
          left > 0
            ? `PIN si sahihi. Majaribio ${left} yaliyobaki.`
            : 'PIN si sahihi. Mwingiliano umefungiwa kwa muda.',
          { extensions: { code: 'UNAUTHENTICATED' } }
        );
      }

      clear(accountKey);
      clear(ipKey);
      const token = signToken(u);
      return {
        token,
        mtumiaji: { id: u.id, jina: u.jina, jukumu: u.jukumu, active: true },
      };
    },

    bathi_bidhaa: async (_, { input }, ctx) => {
      requireCan(ctx.user, 'product.manage');
      const familia = deriveFamilia(input.familia || input.jina);
      const ukubwa = deriveUkubwa(input.ukubwa, input.jina);
      // Friendly message before the index rejects it, so the owner gets
      // "a product with that family and size already exists" rather than a raw
      // constraint violation. The index is still the real backstop.
      const dupe = await pool.query(
        `SELECT id, jina FROM bidhaa
          WHERE active = true AND LOWER(familia) = LOWER($1) AND LOWER(ukubwa) = LOWER($2)`,
        [familia, ukubwa]
      );
      if (dupe.rows[0]) {
        throw new GraphQLError(
          `Bidhaa yenye familia "${familia}" na ukubwa "${ukubwa}" tayari ipo (${dupe.rows[0].jina}).`,
          { extensions: { code: 'BAD_REQUEST', existing_id: dupe.rows[0].id } }
        );
      }
      const { rows } = await pool.query(
        `INSERT INTO bidhaa (jina, bei, aina, familia, ukubwa, kategoria_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [input.jina, input.bei, input.aina || null, familia, ukubwa, input.kategoria_id || null]
      );
      return rows[0];
    },

    hariri_bidhaa: async (_, { id, input }, ctx) => {
      requireCan(ctx.user, 'product.manage');
      const cur = (await pool.query('SELECT jina, familia, ukubwa FROM bidhaa WHERE id = $1', [id])).rows[0];
      if (!cur) throw new GraphQLError('Bidhaa haipo.', { extensions: { code: 'NOT_FOUND' } });
      const familia = deriveFamilia(input.familia || cur.familia || input.jina || cur.jina);
      const ukubwa = deriveUkubwa(input.ukubwa, input.ukubwa || cur.ukubwa || input.jina || cur.jina);
      const dupe = await pool.query(
        `SELECT id, jina FROM bidhaa
          WHERE active = true AND id <> $1
            AND LOWER(familia) = LOWER($2) AND LOWER(ukubwa) = LOWER($3)`,
        [id, familia, ukubwa]
      );
      if (dupe.rows[0]) {
        throw new GraphQLError(
          `Bidhaa yenye familia "${familia}" na ukubwa "${ukubwa}" tayari ipo (${dupe.rows[0].jina}).`,
          { extensions: { code: 'BAD_REQUEST', existing_id: dupe.rows[0].id } }
        );
      }
      const { rows } = await pool.query(
        `UPDATE bidhaa SET jina = $1, bei = $2, aina = $3, familia = $4, ukubwa = $5,
                           kategoria_id = COALESCE($6, kategoria_id)
          WHERE id = $7 RETURNING *`,
        [input.jina, input.bei, input.aina || null, familia, ukubwa, input.kategoria_id || null, id]
      );
      return rows[0];
    },

    futa_bidhaa: async (_, { id }, ctx) => {
      requireCan(ctx.user, 'product.manage');
      await pool.query('UPDATE bidhaa SET active = false WHERE id = $1', [id]);
      return true;
    },

    ongeza_malighafi: async (_, { input }, ctx) => {
      requireCan(ctx.user, 'stock.adjust_restock');
      const { rows } = await pool.query(
        `INSERT INTO malighafi (jina, kiasi_kilichopo, kiwango_cha_chini, unit)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.jina, input.kiasi_kilichopo, input.kiwango_cha_chini, input.unit]
      );
      return rows[0];
    },

    hariri_malighafi: async (_, { id, input }, ctx) => {
      requireCan(ctx.user, 'stock.adjust_restock');
      const { rows } = await pool.query(
        `UPDATE malighafi SET jina = $1, kiasi_kilichopo = $2, kiwango_cha_chini = $3, unit = $4
         WHERE id = $5 RETURNING *`,
        [input.jina, input.kiasi_kilichopo, input.kiwango_cha_chini, input.unit, id]
      );
      if (!rows[0]) throw new GraphQLError('Malighafi haipo.', { extensions: { code: 'NOT_FOUND' } });
      return rows[0];
    },

    ongeza_mteja: async (_, { input }, ctx) => {
      requireCan(ctx.user, 'customer.manage');
      // Same phone, same person. The unique index on mteja(simu) is the
      // backstop; catching it here turns a raw constraint violation into a
      // message the cashier can act on.
      const simu = (input.simu || '').trim();
      if (simu) {
        const existing = await pool.query('SELECT id, jina FROM mteja WHERE simu = $1', [simu]);
        if (existing.rows[0]) {
          throw new GraphQLError(
            `Mteja "${existing.rows[0].jina}" tayari ana namba hiyo ya simu.`,
            { extensions: { code: 'ALREADY_EXISTS', existing_id: existing.rows[0].id } }
          );
        }
      }
      const { rows } = await pool.query(
        'INSERT INTO mteja (jina, simu, mzio, siku_ya_kuzaliwa) VALUES ($1, $2, $3, $4) RETURNING *',
        [input.jina, simu || null, (input.mzio || '').trim() || null, input.siku_ya_kuzaliwa || null]
      );
      return rows[0];
    },

    unda_mauzo: async (_, { bidhaa, njia_ya_malipo, punguzo }, ctx) => {
      const u = ctx.user;
      requireCan(u, 'sale.create');
      if (!bidhaa || bidhaa.length === 0) {
        throw new GraphQLError('Mauzo yanahitaji angalau bidhaa moja.', { extensions: { code: 'BAD_REQUEST' } });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const perItems = [];
        let jumla = 0;
        for (const item of bidhaa) {
          const kiasi = Number(item.kiasi);
          if (!Number.isFinite(kiasi) || kiasi <= 0) {
            throw new GraphQLError('Kiasi cha bidhaa lazima iwe zaidi ya sifuri.', {
              extensions: { code: 'BAD_REQUEST' },
            });
          }
          const { rows } = await client.query(
            'SELECT * FROM bidhaa WHERE id = $1 AND active = true',
            [item.bidhaa_id]
          );
          if (!rows[0]) throw new GraphQLError(`Bidhaa ${item.bidhaa_id} haipo.`, { extensions: { code: 'NOT_FOUND' } });
          const subtotal = Number(rows[0].bei) * kiasi;
          perItems.push({ rows: rows[0], kiasi, subtotal });
          jumla += subtotal;
        }
        if (punguzo != null && Number(punguzo) < 0) {
          throw new GraphQLError('Punguzo haliwezi kuwa hasi.', { extensions: { code: 'BAD_REQUEST' } });
        }
        if (punguzo) jumla = Math.max(0, jumla - Number(punguzo));
        const risiti_no = `RS-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const saleRes = await client.query(
          `INSERT INTO mauzo (mfanyakazi_id, jumla, njia_ya_malipo, risiti_no) VALUES ($1, $2, $3, $4) RETURNING *`,
          [u.sub, jumla, njia_ya_malipo, risiti_no]
        );
        for (const item of perItems) {
          await client.query(
            'INSERT INTO mauzo_bidhaa (mauzo_id, bidhaa_id, kiasi, bei) VALUES ($1, $2, $3, $4)',
            [saleRes.rows[0].id, item.rows.id, item.kiasi, item.rows.bei]
          );
        }
           await client.query('COMMIT');
           // Counter sales are ready-to-eat goods handed over at the till, so they
           // deliberately create no ticket: nothing for the kitchen to make. A
           // ticket number is only issued for a custom order that needs preparing.
           return { ...saleRes.rows[0], tikiti: null };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    unda_agizo: async (_, { input }, ctx) => {
      const u = ctx.user;
      requireCan(u, 'order.create');
      const bei_jumla = Number(input.bei_jumla);
      const malipo_ya_awali = Number(input.malipo_ya_awali || 0);
      if (!Number.isFinite(bei_jumla) || bei_jumla <= 0) {
        throw new GraphQLError('Bei jumla lazima iwe zaidi ya sifuri.', { extensions: { code: 'BAD_REQUEST' } });
      }
      // A deposit above the total would make the generated salio column negative.
      if (!Number.isFinite(malipo_ya_awali) || malipo_ya_awali < 0) {
        throw new GraphQLError('Malipo ya awali haliwezi kuwa hasi.', { extensions: { code: 'BAD_REQUEST' } });
      }
      if (malipo_ya_awali > bei_jumla) {
        throw new GraphQLError('Malipo ya awali hayawezi kuzidi bei jumla.', { extensions: { code: 'BAD_REQUEST' } });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let mtejaId = input.mteja_id;
        let mtejaJina = input.mteja_mpya?.jina;
        const simuMpya = (input.mteja_mpya?.simu || '').trim();
        if (!mtejaId && simuMpya) {
          // The same person ordering twice must not become two customer records
          // with split history. A phone number identifies a person well enough
          // to reuse the existing record, even if the name was typed slightly
          // differently ("Asha" vs "Asha M.").
          //
          // The name and allergy info from the new input are only applied when
          // they add something. Overwriting a recorded allergy with a blank
          // field would quietly erase safety information.
          const existing = (
            await client.query('SELECT id, jina, mzio FROM mteja WHERE simu = $1', [simuMpya])
          ).rows[0];
          if (existing) {
            mtejaId = existing.id;
            mtejaJina = existing.jina;
            const mzioMpya = (input.mteja_mpya.mzio || '').trim();
            if (mzioMpya && mzioMpya !== existing.mzio) {
              await client.query('UPDATE mteja SET mzio = $2 WHERE id = $1', [existing.id, mzioMpya]);
            }
          }
        }
        if (!mtejaId && input.mteja_mpya) {
          const { rows } = await client.query(
            'INSERT INTO mteja (jina, simu, mzio, siku_ya_kuzaliwa) VALUES ($1, $2, $3, $4) RETURNING id',
            [
              input.mteja_mpya.jina,
              simuMpya || null,
              (input.mteja_mpya.mzio || '').trim() || null,
              input.mteja_mpya.siku_ya_kuzaliwa || null,
            ]
          );
          mtejaId = rows[0].id;
        } else if (mtejaId) {
          const m = (
            await client.query('SELECT jina FROM mteja WHERE id = $1', [mtejaId])
          ).rows[0];
          mtejaJina = m?.jina;
        }
           // Which recipe this order is made from is decided here, not at the
           // counter. The cashier described a cake; the kitchen's recipe book is
           // an internal document and the person least able to choose correctly
           // from it was the one being asked to.
           //
           // A client may still send mapishi_id, and only the owner may: that is
           // the deliberate override for an order the matcher reads wrong. It is
           // recorded as 'fuati' so an overridden match is never later mistaken
           // for one the system worked out on its own.
           let mapishiId = null;
           let mapishiMethod = null;
           let mapishiScore = null;
           let mapishiReason = null;

           if (input.mapishi_id) {
             requireCan(u, 'recipe.override', 'Unaweza kubadilisha mapishi kwa agizo tu kama mmiliki.');
             const rec = (
               await client.query('SELECT id FROM mapishi WHERE id = $1 AND active', [input.mapishi_id])
             ).rows[0];
             if (!rec) {
               throw new GraphQLError('Mapishi hakupatikani.', { extensions: { code: 'NOT_FOUND' } });
             }
             mapishiId = rec.id;
             mapishiMethod = 'fuati';
             mapishiReason = {
               ulio: 'fuati',
               maelezo: 'Mmiliki alichagua mapishi mwenyewe badala ya kile kilichopatikana kwa njia ya kawaida.',
               maombi: { ladha: input.ladha, ukubwa: input.ukubwa, umbo: input.umbo },
             };
           } else {
             // The matcher is handed the whole active book and returns one
             // recipe. It never returns a list: a shortlist rendered anywhere in
             // the UI is a recipe picker again, and the decision goes back to the
             // cashier.
             const kitabu = (
               await client.query('SELECT id, ladha, ukubwa, active FROM mapishi WHERE active ORDER BY id')
             ).rows;
             const ulio = matchRecipe(
               { ladha: input.ladha, ukubwa: input.ukubwa, umbo: input.umbo },
               kitabu
             );
             mapishiId = ulio.mapishi_id;
             mapishiMethod = ulio.method;
             mapishiScore = ulio.score;
             mapishiReason = ulio.reason;
           }
             const { rows } = await client.query(
               `INSERT INTO agizo_maalum
                (mteja_id, ladha, design, ukubwa, tarehe_ya_kuchukua, bei_jumla, malipo_ya_awali, hali, created_by, mapishi_id, umbo, maelekezo_maalum,
                 mapishi_match_method, mapishi_match_score, mapishi_match)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'ordered', $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
               [
                 mtejaId,
                 input.ladha,
                 input.design || null,
                 input.ukubwa || null,
                 input.tarehe_ya_kuchukua,
                 input.bei_jumla,
                 malipo_ya_awali,
                 u.sub,
                 mapishiId,
                 (input.umbo || '').trim() || null,
                 (input.maelekezo_maalum || '').trim() || null,
                 mapishiMethod,
                 mapishiScore,
                 mapishiReason ? JSON.stringify(mapishiReason) : null,
               ]
             );
           const agizo = rows[0];
           const maelezo = `${agizo.ladha}${agizo.ukubwa ? ` — ${agizo.ukubwa}` : ''}`;
           const tikiti = await tikitishaAgizo(client, {
             agizo_id: agizo.id,
             jumla: agizo.bei_jumla,
             maelezo,
             jina: mtejaJina,
           });
           // Whatever was handed over at the counter is real money in the till,
           // so it is written into the sales ledger and linked back to the order.
           // A NULL malipo_ya_awali means "nothing paid yet" and records nothing.
           let malipo = null;
           if (Number(agizo.malipo_ya_awali) > 0) {
             const sale = await client.query(
               `INSERT INTO mauzo (mfanyakazi_id, jumla, njia_ya_malipo, risiti_no, agizo_id)
                VALUES ($1, $2, $3, $4, $5) RETURNING *`,
               [
                 u.sub,
                 agizo.malipo_ya_awali,
                 input.njia_ya_malipo || 'cash',
                 `AG-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                 agizo.id,
               ]
             );
             malipo = sale.rows[0];
           }
           await client.query('COMMIT');
           return { ...agizo, tikiti, malipo };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    badge_hali_order: async (_, { id, hali }, ctx) => {
      const u = ctx.user;
      const current = (
        await pool.query('SELECT hali, created_by FROM agizo_maalum WHERE id = $1', [id])
      ).rows[0];
      if (!current) throw new GraphQLError('Agizo halipo.', { extensions: { code: 'NOT_FOUND' } });

      const allowedForChef = new Set(['in_progress', 'ready']);
      const allowedForCashier = new Set(['collected']);

      if (u.jukumu === ROLE_OWNER) {
        // owner can set any
      } else if (u.jukumu === ROLE_CHEF && allowedForChef.has(hali)) {
        requireCan(u, 'order.advance_status');
      } else if (u.jukumu === ROLE_CASHIER && allowedForCashier.has(hali)) {
        requireCan(u, 'order.collect');
      } else {
        throw new GraphQLError('Hamna ruhusa ya kubadilisha hali ya agizo hili.', {
          extensions: { code: 'FORBIDDEN' },
        });
      }
      const { rows } = await pool.query(
        'UPDATE agizo_maalum SET hali = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [hali, id]
      );
      const ticketHali = {
        ordered: 'in_queue',
        in_progress: 'preparing',
        ready: 'ready',
        collected: 'collected',
        cancelled: 'cancelled',
      }[hali];
      if (ticketHali) {
        await pool.query(
          `UPDATE tikiti SET hali = $1, updated_at = NOW()
           WHERE agizo_id = $2 AND hali IN ('in_queue', 'preparing', 'ready')`,
          [ticketHali, id]
        );
      }
      return rows[0];
    },

    // Settle the outstanding balance on a special order at pickup. Takes money,
    // so it is gated on sale.create (owner + cashier) and never the chef, and it
    // writes the payment into the sales ledger exactly as the deposit was.
    lipa_salio: async (_, { id, kiasi, njia_ya_malipo }, ctx) => {
      const u = ctx.user;
      requireCan(u, 'sale.create');
      const amount = Number(kiasi);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new GraphQLError('Kiasi cha malipo lazima iwe zaidi ya sifuri.', {
          extensions: { code: 'BAD_REQUEST' },
        });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Lock the order so two tills cannot both collect the same balance.
        const { rows: curRows } = await client.query(
          'SELECT * FROM agizo_maalum WHERE id = $1 FOR UPDATE',
          [id]
        );
        const agizo = curRows[0];
        if (!agizo) throw new GraphQLError('Agizo halipo.', { extensions: { code: 'NOT_FOUND' } });
        if (agizo.hali === 'cancelled') {
          throw new GraphQLError('Agizo lililofutwa haliwezi kupewa malipo.', {
            extensions: { code: 'BAD_REQUEST' },
          });
        }
        const saldo = Number(agizo.salio);
        if (amount - saldo > 0.009) {
          throw new GraphQLError(
            `Malipo ni makubwa kuliko salio. Salio iliyobaki ni TSh ${Math.round(saldo)}.`,
            { extensions: { code: 'BAD_REQUEST' } }
          );
        }
        // salio is a generated column, so raising the amount paid recomputes it.
        const { rows: upRows } = await client.query(
          'UPDATE agizo_maalum SET malipo_ya_awali = malipo_ya_awali + $1, updated_at = NOW() WHERE id = $2 RETURNING *',
          [amount, id]
        );
        const sale = await client.query(
          `INSERT INTO mauzo (mfanyakazi_id, jumla, njia_ya_malipo, risiti_no, agizo_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [
            u.sub,
            amount,
            njia_ya_malipo || 'cash',
            `AG-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            id,
          ]
        );
        await client.query('COMMIT');
        return { agizo: upRows[0], malipo: sale.rows[0] };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    chukua_agizo: async (_, { id }, ctx) => {
      requireCan(ctx.user, 'order.collect');
      const cur = (await pool.query('SELECT hali FROM agizo_maalum WHERE id = $1', [id])).rows[0];
      if (!cur) throw new GraphQLError('Agizo halipo.', { extensions: { code: 'NOT_FOUND' } });
      if (cur.hali === 'cancelled') {
        throw new GraphQLError('Agizo lililofutwa haliwezi kuchukuliwa.', { extensions: { code: 'BAD_REQUEST' } });
      }
      const { rows } = await pool.query(
        `UPDATE agizo_maalum SET hali = 'collected', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
      );
      if (!rows[0]) throw new GraphQLError('Agizo halipo.', { extensions: { code: 'NOT_FOUND' } });
      await pool.query(
        `UPDATE tikiti SET hali = 'collected', updated_at = NOW() WHERE agizo_id = $1 AND hali NOT IN ('collected', 'cancelled')`,
        [id]
      );
      return rows[0];
    },

    futa_agizo: async (_, { id }, ctx) => {
      const u = ctx.user;
      requireCan(u, 'order.cancel');
      const cur = (await pool.query('SELECT hali FROM agizo_maalum WHERE id = $1', [id])).rows[0];
      if (!cur) throw new GraphQLError('Agizo halipo.', { extensions: { code: 'NOT_FOUND' } });
      if (cur.hali === 'collected') {
        throw new GraphQLError('Agizo lililokwisha chukuliwa haliwezi kufutwa.', { extensions: { code: 'BAD_REQUEST' } });
      }
      await pool.query('UPDATE agizo_maalum SET hali = $1, updated_at = NOW() WHERE id = $2', ['cancelled', id]);
      await pool.query(
        `UPDATE tikiti SET hali = 'cancelled', updated_at = NOW() WHERE agizo_id = $1 AND hali NOT IN ('collected', 'cancelled')`,
        [id]
      );
      return true;
    },

    /** Superseded by log_matumizi_kundi; kept so no old client breaks. */
    log_matumizi: async (_, { input }, ctx) => {
      const [row] = await insertUsageBatch(
        _,
        { agizo_id: input.agizo_id, kumbukumbu: null, vitu: null,
          malighafi_id: input.malighafi_id, kiasi: input.kiasi },
        ctx
      );
      return row;
    },

    log_matumizi_kundi: (_, { input }, ctx) =>
      insertUsageBatch(_, input, ctx),

    /**
     * The point stock actually moves. The DB trigger on kumbukumbu_matumizi
     * does the decrement when hali flips to 'imethibitishwa', so this resolver
     * must NOT also subtract by hand or stock would be reduced twice.
     */
    thibitisha_matumizi: async (_, { id, kiasi_halisi }, ctx) => {
      requireCan(ctx.user, 'usage.verify');
      const halisi = Number(kiasi_halisi);
      if (!Number.isFinite(halisi) || halisi < 0) {
        throw new GraphQLError('Kiasi halisi lazima kiwe namba isiyo chini ya sifuri.', {
          extensions: { code: 'BAD_REQUEST' },
        });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Lock the row so a double-tap on the confirm button cannot run the
        // UPDATE twice.
        const cur = (
          await client.query('SELECT * FROM kumbukumbu_matumizi WHERE id = $1 FOR UPDATE', [id])
        ).rows[0];
        if (!cur) throw new GraphQLError('Kumbukumbu halipo.', { extensions: { code: 'NOT_FOUND' } });
        if (cur.hali === 'imethibitishwa') {
          throw new GraphQLError('Kumbukumbu hii tayari imethibitishwa.', {
            extensions: { code: 'ALREADY_VERIFIED' },
          });
        }
        if (cur.kiasi_halisi !== null) {
          throw new GraphQLError('Kiasi halisi kimeweka tayari.', {
            extensions: { code: 'ALREADY_VERIFIED' },
          });
        }
        // halisi = 0 means "this ingredient was not actually used" (a cancelled
        // line or a mis-tap). It still marks the row verified, so the trigger
        // subtracts zero and the line stops sitting in the queue forever.
        const { rows } = await client.query(
          `UPDATE kumbukumbu_matumizi
              SET hali = 'imethibitishwa', kiasi_halisi = $2,
                  imethibitishwa_na = $3, tarehe_ya_uthibitisho = now()
            WHERE id = $1
            RETURNING *`,
          [id, halisi, ctx.user.sub]
        );
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    /**
     * BR-13: confirm a whole usage sheet and close the request that was raised
     * for it, in one transaction.
     *
     * Confirming the sheet is what moves stock — the existing DB trigger
     * trigger_usage_decrement_on_verify does the subtraction when each line
     * flips to imethibitishwa, so this resolver must not also subtract by hand
     * or stock would be reduced twice. That is the same contract the
     * single-line thibitisha_matumizi already keeps.
     *
     * Every line is confirmed in the same transaction, so stock can never be
     * left half-moved by a failure partway through a sheet. The row lock stops
     * two people confirming the same sheet at once.
     *
     * A line omitted from kuchagua is confirmed at the chef's own tapped
     * midpoint: the report already carries a defensible number for it, and
     * inventory overriding every line by hand is not what BR-13 asks for.
     */
    thibitisha_matumizi_kundi: async (_, { zingumiaji_id, kuchagua }, ctx) => {
      requireCan(ctx.user, 'usage.verify');
      const overrides = new Map();
      for (const k of kuchagua || []) {
        const lid = Number(k.id);
        if (!Number.isInteger(lid) || lid <= 0) {
          throw new GraphQLError('Mistari ya kuthibitisha haipatikani.', {
            extensions: { code: 'BAD_REQUEST' },
          });
        }
        if (k.kiasi_halisi === undefined || k.kiasi_halisi === null) {
          throw new GraphQLError('Kiasi halisi lazima kiwe namba isiyo chini ya sifuri.', {
            extensions: { code: 'BAD_REQUEST' },
          });
        }
        const q = Number(k.kiasi_halisi);
        if (!Number.isFinite(q) || q < 0) {
          throw new GraphQLError('Kiasi halisi lazima kiwe namba isiyo chini ya sifuri.', {
            extensions: { code: 'BAD_REQUEST' },
          });
        }
        if (overrides.has(lid)) {
          throw new GraphQLError('Mstari huo umeorodheshwa mara mbili.', {
            extensions: { code: 'BAD_REQUEST' },
          });
        }
        overrides.set(lid, q);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.fanya_kwa', $1, true)", [String(ctx.user.sub)]);

        const sheet = (
          await client.query(
            'SELECT * FROM zingumiaji_matumizi WHERE id = $1 FOR UPDATE',
            [zingumiaji_id]
          )
        ).rows[0];
        if (!sheet) {
          throw new GraphQLError('Kundi la matumizi halipo.', { extensions: { code: 'NOT_FOUND' } });
        }
        if (sheet.hali === 'imethibitishwa') {
          throw new GraphQLError('Kundi hili limehakikiwa tayari.', {
            extensions: { code: 'ALREADY_VERIFIED' },
          });
        }
        if (sheet.hali === 'imebadilishwa') {
          // An amendment supersedes the sheet, so the replacement is the thing
          // now waiting on inventory. Confirming the dead one would move stock
          // from taps the chef has already withdrawn.
          throw new GraphQLError('Kundi hili limebadilishwa. Hakiki kundi mpya.', {
            extensions: { code: 'ALREADY_VERIFIED' },
          });
        }

        const lines = (
          await client.query(
            `SELECT id, kiasi FROM kumbukumbu_matumizi
              WHERE zingumiaji_id = $1 AND hali = 'inakadiriwa'
              FOR UPDATE`,
            [zingumiaji_id]
          )
        ).rows;

        if (overrides.size) {
          const strays = [...overrides.keys()].filter(
            (id) => !lines.some((l) => l.id === id)
          );
          if (strays.length) {
            throw new GraphQLError('Baadhi ya mistari ya kuthibitisha ni ya kundi lingine.', {
              extensions: { code: 'BAD_REQUEST', mistari_ids: strays },
            });
          }
        }

        // kiasi = 0 means "not actually used". It still marks the line verified,
        // so the trigger subtracts zero and the line stops sitting in the queue.
        for (const l of lines) {
          const halisi = overrides.has(l.id) ? overrides.get(l.id) : Number(l.kiasi);
          await client.query(
            `UPDATE kumbukumbu_matumizi
                SET hali = 'imethibitishwa', kiasi_halisi = $2,
                    imethibitishwa_na = $3, tarehe_ya_uthibitisho = now()
              WHERE id = $1`,
            [l.id, halisi, ctx.user.sub]
          );
        }

        await client.query(
          `UPDATE zingumiaji_matumizi
              SET hali = 'imethibitishwa', imethibitishwa_na = $2, tarehe_ya_uthibitisho = now()
            WHERE id = $1`,
          [zingumiaji_id, ctx.user.sub]
        );

        // Resolving the request is the confirmation (BR-13), so the request is
        // closed in the same transaction as the stock movement. If this failed,
        // stock would have moved with an open request still claiming to be
        // waiting — the exact state the rule exists to prevent.
        await client.query(
          `UPDATE ombi
              SET hali = 'imekamilika',
                  jibu = COALESCE(jibu, 'Matumizi yamethibitishwa.'),
                  alizokamilisha_na = $2,
                  alizokamilisha_at = now(),
                  tarehe_ya_kufunguliwa = now()
            WHERE zingumiaji_id = $1
              AND hali NOT IN ('imekamilika', 'imekataa', 'imeghairi')`,
          [zingumiaji_id, ctx.user.sub]
        );

        const { rows } = await client.query(
          'SELECT * FROM zingumiaji_matumizi WHERE id = $1',
          [zingumiaji_id]
        );
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    unda_mapishi: async (_, { input }, ctx) => {
      requireCan(ctx.user, 'recipe.manage');
      const ladha = String(input.ladha || '').trim();
      const ukubwa = String(input.ukubwa || '').trim();
      if (!ladha || !ukubwa) {
        throw new GraphQLError('Jina na ukubwa wa mapishi vinahitajika.', {
          extensions: { code: 'BAD_REQUEST' },
        });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const v = await normaliseVariant(client, input);
        const lines = await normaliseIngredients(client, input.viambato, v.variant === 'fraction_of');

        // mapishi has UNIQUE(ladha, ukubwa) across ALL rows including inactive
        // ones, so a soft-deleted recipe would otherwise permanently block
        // re-authoring the same cake. Revive it instead.
        const prior = (
          await client.query('SELECT * FROM mapishi WHERE ladha = $1 AND ukubwa = $2', [ladha, ukubwa])
        ).rows[0];

        let id;
        if (prior && prior.active) {
          throw new GraphQLError(`Mapishi "${ladha}" (${ukubwa}) tayari upo.`, {
            extensions: { code: 'ALREADY_EXISTS', existing_id: prior.id },
          });
        }
        if (prior) {
          await client.query(
            `UPDATE mapishi SET active = true, dakika_kadirio = $2, mapamba_variant = $3,
                               mapishi_ibaba = $4, created_by = $5, sehemu_ya_uzito = $6, created_at = now()
              WHERE id = $1`,
            [prior.id, input.dakika_kadirio || 90, v.variant,
             v.mapishi_ibaba, ctx.user.sub, v.sehemu_ya_uzito]
          );
          await client.query('DELETE FROM mapishi_kipengele WHERE mapishi_id = $1', [prior.id]);
          id = prior.id;
        } else {
          const ins = await client.query(
            `INSERT INTO mapishi (ladha, ukubwa, dakika_kadirio, mapamba_variant, mapishi_ibaba, created_by, sehemu_ya_uzito)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [ladha, ukubwa, input.dakika_kadirio || 90, v.variant,
             v.mapishi_ibaba, ctx.user.sub, v.sehemu_ya_uzito]
          );
          id = ins.rows[0].id;
        }

        for (const l of lines) {
          await client.query(
            `INSERT INTO mapishi_kipengele
               (mapishi_id, malighafi_id, kiasi_cha_chini, kiasi_cha_juu, sehemu)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, l.malighafi_id, l.kiasi_cha_chini, l.kiasi_cha_juu, l.sehemu]
          );
        }
        await client.query('COMMIT');
        return (await client.query('SELECT * FROM mapishi WHERE id = $1', [id])).rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    hariri_mapishi: async (_, { id, input }, ctx) => {
      requireCan(ctx.user, 'recipe.manage');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cur = (await client.query('SELECT * FROM mapishi WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!cur) throw new GraphQLError('Mapishi halipo.', { extensions: { code: 'NOT_FOUND' } });
        const v = await normaliseVariant(client, input, id);
        const lines = await normaliseIngredients(client, input.viambato, v.variant === 'fraction_of');
        const clash = (
          await client.query('SELECT id FROM mapishi WHERE ladha = $1 AND ukubwa = $2 AND id <> $3',
            [String(input.ladha || '').trim(), String(input.ukubwa || '').trim(), id])
        ).rows[0];
        if (clash) {
          throw new GraphQLError('Mapishi mwingine wenye jina na ukubwa huo upo.', {
            extensions: { code: 'ALREADY_EXISTS', existing_id: clash.id },
          });
        }
        await client.query(
          `UPDATE mapishi SET ladha = $2, ukubwa = $3, dakika_kadirio = $4,
                              mapamba_variant = $5, mapishi_ibaba = $6, sehemu_ya_uzito = $7
            WHERE id = $1`,
          [id, String(input.ladha || '').trim(), String(input.ukubwa || '').trim(),
           input.dakika_kadirio || 90, v.variant,
           v.mapishi_ibaba, v.sehemu_ya_uzito]
        );
        await client.query('DELETE FROM mapishi_kipengele WHERE mapishi_id = $1', [id]);
        for (const l of lines) {
          await client.query(
            `INSERT INTO mapishi_kipengele
               (mapishi_id, malighafi_id, kiasi_cha_chini, kiasi_cha_juu, sehemu)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, l.malighafi_id, l.kiasi_cha_chini, l.kiasi_cha_juu, l.sehemu]
          );
        }
        await client.query('COMMIT');
        return (await client.query('SELECT * FROM mapishi WHERE id = $1', [id])).rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    /**
     * Soft delete, not DELETE. agizo_maalum.mapishi_id has no ON DELETE CASCADE
     * and past orders must keep pointing at the recipe they were baked from.
     */
    futa_mapishi: async (_, { id }, ctx) => {
      requireCan(ctx.user, 'recipe.manage');
      const { rows } = await pool.query(
        'UPDATE mapishi SET active = false WHERE id = $1 RETURNING id', [id]
      );
      if (!rows[0]) throw new GraphQLError('Mapishi halipo.', { extensions: { code: 'NOT_FOUND' } });
      return true;
    },

    unda_kategoria: async (_, { jina }, ctx) => {
      requireCan(ctx.user, 'category.manage');
      const name = String(jina || '').trim();
      if (!name) throw new GraphQLError('Jina la kategoria linahitajika.', { extensions: { code: 'BAD_REQUEST' } });
      const dupe = (await pool.query('SELECT id FROM kategoria WHERE LOWER(jina) = LOWER($1)', [name])).rows[0];
      if (dupe) {
        throw new GraphQLError('Kategoria hiyo tayari ipo.', { extensions: { code: 'ALREADY_EXISTS', existing_id: dupe.id } });
      }
      const { rows } = await pool.query('INSERT INTO kategoria (jina) VALUES ($1) RETURNING *', [name]);
      return rows[0];
    },

    hariri_kategoria: async (_, { id, jina }, ctx) => {
      requireCan(ctx.user, 'category.manage');
      const name = String(jina || '').trim();
      if (!name) throw new GraphQLError('Jina la kategoria linahitajika.', { extensions: { code: 'BAD_REQUEST' } });
      const clash = (
        await pool.query('SELECT id FROM kategoria WHERE LOWER(jina) = LOWER($1) AND id <> $2', [name, id])
      ).rows[0];
      if (clash) {
        throw new GraphQLError('Kategoria nyingine yenye jina hilo ipo.', { extensions: { code: 'ALREADY_EXISTS' } });
      }
      const { rows } = await pool.query('UPDATE kategoria SET jina = $2 WHERE id = $1 RETURNING *', [id, name]);
      if (!rows[0]) throw new GraphQLError('Kategoria haipo.', { extensions: { code: 'NOT_FOUND' } });
      return rows[0];
    },

    /**
     * Retire a category rather than deleting the row: bidhaa.kategoria_id has
     * no ON DELETE, and past sales should keep resolving their category.
     * Refused while any product still points at it, which turns "delete" into
     * an explicit reassign-then-retire step instead of orphaning products.
     */
    futa_kategoria: async (_, { id }, ctx) => {
      requireCan(ctx.user, 'category.manage');
      const used = (
        await pool.query('SELECT count(*)::int AS n FROM bidhaa WHERE kategoria_id = $1 AND active', [id])
      ).rows[0].n;
      if (used > 0) {
        throw new GraphQLError(
          `Kategoria ina bidhaa ${used} zilizo nazo. Hamunishene kwanza.`,
          { extensions: { code: 'CATEGORY_IN_USE', bidhaa_count: used } }
        );
      }
      const { rows } = await pool.query(
        'UPDATE kategoria SET active = false WHERE id = $1 RETURNING id', [id]
      );
      if (!rows[0]) throw new GraphQLError('Kategoria haipo.', { extensions: { code: 'NOT_FOUND' } });
      return true;
    },

    /** Bulk action: point many products at one category in a single call. */    panga_kategoria: async (_, { bidhaa_ids, kategoria_id }, ctx) => {
      requireCan(ctx.user, 'category.manage');
      const ids = (bidhaa_ids || []).map(Number).filter(Number.isInteger);
      if (!ids.length) {
        throw new GraphQLError('Chagua bidhaa angalau moja.', { extensions: { code: 'BAD_REQUEST' } });
      }
      const kat = (await pool.query('SELECT id FROM kategoria WHERE id = $1 AND active', [kategoria_id])).rows[0];
      if (!kat) throw new GraphQLError('Kategoria haipo.', { extensions: { code: 'NOT_FOUND' } });
      const { rowCount } = await pool.query(
        'UPDATE bidhaa SET kategoria_id = $1 WHERE id = ANY($2::int[])', [kategoria_id, ids]
      );
      return rowCount;
    },


    /**
     * Raise a request, or issue a directive. The schema exposes this as one
     * mutation; `input.aina` says which way the intent points.
     */
    tuma_ombi: async (_, { input }, ctx) => raiseOmbi(ctx, input),

    /**
     * Move a record to a new state. The reachable set, the role allowed to do
     * it, and the refusal of self-approval all come from the state machine, so
     * adding a button in the UI cannot grant a power the backend does not have.
     */
    sasisha_ombi: async (_, args, ctx) => moveOmbi(ctx, args),

    /** Shorthand for "done", the one closing state people actually reach for. */
    kamilisha_ombi: async (_, { id, jibu }, ctx) =>
      moveOmbi(ctx, { id, hali: 'imekamilika', jibu }),

    /** Withdraw something that has not been finished. */
    ghairi_ombi: async (_, { id, sababu }, ctx) =>
      moveOmbi(ctx, { id, hali: 'imeghairi', jibu: sababu }),


    marekebisho_hisa: async (_, { input }, ctx) => {
      const u = ctx.user;
      const perm = input.aina === 'restock' ? 'stock.adjust_restock' : 'stock.adjust_waste';
      requireCan(u, perm);
      const kiasi = Number(input.kiasi);
      // A negative "waste" would *increase* stock, the opposite of intent.
      if (!Number.isFinite(kiasi) || kiasi <= 0) {
        throw new GraphQLError('Kiasi cha marekebisho lazima kiwe zaidi ya sifuri.', {
          extensions: { code: 'BAD_REQUEST' },
        });
      }
      const ing = (
        await pool.query('SELECT id FROM malighafi WHERE id = $1', [input.malighafi_id])
      ).rows[0];
      if (!ing) throw new GraphQLError('Malighafi haipo.', { extensions: { code: 'NOT_FOUND' } });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const delta = input.aina === 'restock' ? kiasi : -kiasi;
        await client.query('UPDATE malighafi SET kiasi_kilichopo = kiasi_kilichopo + $1 WHERE id = $2', [delta, input.malighafi_id]);
        const { rows } = await client.query(
          `INSERT INTO marekebisho_hisa (malighafi_id, aina, kiasi, sababu, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [input.malighafi_id, input.aina, kiasi, input.sababu || null, u.sub]
        );
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        // Waste cannot exceed stock; CHECK (kiasi_kilichopo >= 0) caught it.
        if (err.code === '23514' || err.code === 'P0001') {
          throw new GraphQLError('Hisa haipo kiasi ya kutosha kwa marekebisho haya.', {
            extensions: { code: 'INSUFFICIENT_STOCK' },
          });
        }
        throw err;
      } finally {
        client.release();
      }
    },

    ongeza_mfanyakazi: async (_, { jina, jukumu, pin }, ctx) => {
      requireCan(ctx.user, 'staff.manage');
      if (pin.length < 4) {
        throw new GraphQLError('PIN lazima iwe na angalau tarakimu 4.', { extensions: { code: 'BAD_REQUEST' } });
      }
      const pin_hash = await bcrypt.hash(pin, 10);
      const { rows } = await pool.query(
        'INSERT INTO mtumiaji (jina, jukumu, pin_hash) VALUES ($1, $2, $3) RETURNING id, jina, jukumu',
        [jina, jukumu, pin_hash]
      );
      return rows[0];
    },

    hariri_mfanyakazi: async (_, { id, input }, ctx) => {
      requireCan(ctx.user, 'staff.manage');
      const target = (
        await pool.query('SELECT id, jina, jukumu, active FROM mtumiaji WHERE id = $1', [id])
      ).rows[0];
      if (!target) throw new GraphQLError('Mfanyakazi hapo.', { extensions: { code: 'NOT_FOUND' } });
      if (!target.active) throw new GraphQLError('Mfanyakazi huyu amefutwa.', { extensions: { code: 'BAD_REQUEST' } });

      const jina = input.jina ?? target.jina;
      const jukumu = input.jukumu ?? target.jukumu;

      // Guard the same way futa_mfanyakazi does: demoting the last active
      // owner would lock the shop out of every admin function.
      if (target.jukumu === ROLE_OWNER && jukumu !== ROLE_OWNER) {
        const { rows } = await pool.query(
          'SELECT COUNT(*)::int AS n FROM mtumiaji WHERE jukumu = $1 AND active = true',
          [ROLE_OWNER]
        );
        if (rows[0].n <= 1) {
          throw new GraphQLError('Huwezi kumbadilisha jukumu la mmiliki wa mwisho.', {
            extensions: { code: 'BAD_REQUEST' },
          });
        }
      }

      let pin_hash = null;
      let pinSql = '';
      let params = [jina, jukumu, id];
      if (input.pin != null && input.pin !== '') {
        if (String(input.pin).length < 4) {
          throw new GraphQLError('PIN lazima iwe na angalau tarakimu 4.', { extensions: { code: 'BAD_REQUEST' } });
        }
        pin_hash = await bcrypt.hash(String(input.pin), 10);
        pinSql = ', pin_hash = $4';
        params = [jina, jukumu, id, pin_hash];
      }
      const { rows } = await pool.query(
        `UPDATE mtumiaji SET jina = $1, jukumu = $2${pinSql} WHERE id = $3 RETURNING id, jina, jukumu`,
        params
      );
      return rows[0];
    },

    futa_mfanyakazi: async (_, { id }, ctx) => {
      requireCan(ctx.user, 'staff.manage');
      if (String(id) === String(ctx.user.sub)) {
        throw new GraphQLError('Huwezi kujifuta wewe mwenyewe.', { extensions: { code: 'BAD_REQUEST' } });
      }
      const target = (
        await pool.query('SELECT jukumu, active FROM mtumiaji WHERE id = $1', [id])
      ).rows[0];
      if (!target) throw new GraphQLError('Mfanyakazi hapo.', { extensions: { code: 'NOT_FOUND' } });
      if (!target.active) return true;

      if (target.jukumu === ROLE_OWNER) {
        const { rows } = await pool.query(
          'SELECT COUNT(*)::int AS n FROM mtumiaji WHERE jukumu = $1 AND active = true',
          [ROLE_OWNER]
        );
        if (rows[0].n <= 1) {
          throw new GraphQLError('Huwezi kumfuta mmiliki wa mwisho.', { extensions: { code: 'BAD_REQUEST' } });
        }
      }
      await pool.query('UPDATE mtumiaji SET active = false WHERE id = $1', [id]);
      return true;
    },

    soma_ukumbusho: async (_, { id }, ctx) => {
      requireCan(ctx.user, 'stock.read');
      const { rows } = await pool.query(
        `UPDATE ukumbusho SET imesomwa = true WHERE id = $1 RETURNING *`,
        [id]
      );
      if (!rows[0]) throw new GraphQLError('Ukumbusho haupo.', { extensions: { code: 'NOT_FOUND' } });
      return rows[0];
    },

    tengeneza_ukumbusho: async (_, __, ctx) => {
      requireAuthenticated(ctx.user);
      if (!can(ctx.user, 'report.access_dashboard') && !can(ctx.user, 'usage.read_all')) {
        throw new GraphQLError('Hamna ruhusa.', { extensions: { code: 'FORBIDDEN' } });
      }
      await generateUkumbusho();
      return true;
    },

    chukua_tikiti: async (_, { id }, ctx) => {
      requireCan(ctx.user, 'order.collect');
      const cur = (
        await pool.query('SELECT hali, agizo_id, mauzo_id FROM tikiti WHERE id = $1', [id])
      ).rows[0];
      if (!cur) throw new GraphQLError('Tikiti haipo.', { extensions: { code: 'NOT_FOUND' } });
      if (cur.hali === 'cancelled') {
        throw new GraphQLError('Tikiti lililofutwa haliwezi kuchukuliwa.', { extensions: { code: 'BAD_REQUEST' } });
      }
      if (cur.hali === 'collected') return cur;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `UPDATE tikiti SET hali = 'collected', updated_at = NOW() WHERE id = $1 RETURNING *`,
          [id]
        );
        if (cur.agizo_id) {
          await client.query(
            `UPDATE agizo_maalum SET hali = 'collected', updated_at = NOW() WHERE id = $1 AND hali NOT IN ('collected', 'cancelled')`,
            [cur.agizo_id]
          );
        }
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    futa_tikiti: async (_, { id }, ctx) => {
      requireCan(ctx.user, 'order.cancel');
      const cur = (
        await pool.query('SELECT hali, agizo_id FROM tikiti WHERE id = $1', [id])
      ).rows[0];
      if (!cur) throw new GraphQLError('Tikiti haipo.', { extensions: { code: 'NOT_FOUND' } });
      if (cur.hali === 'collected' || cur.hali === 'cancelled') return true;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE tikiti SET hali = 'cancelled', updated_at = NOW() WHERE id = $1`,
          [id]
        );
        // A cancelled ticket must not leave its custom order alive in the
        // kitchen queue or the owner's outstanding-balance report.
        if (cur.agizo_id) {
          await client.query(
            `UPDATE agizo_maalum SET hali = 'cancelled', updated_at = NOW()
             WHERE id = $1 AND hali NOT IN ('collected', 'cancelled')`,
            [cur.agizo_id]
          );
        }
        await client.query('COMMIT');
        return true;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    badge_hali_tikiti: async (_, { id, hali }, ctx) => {
      requireCan(ctx.user, 'order.advance_status');
      const cur = (
        await pool.query('SELECT hali, agizo_id FROM tikiti WHERE id = $1', [id])
      ).rows[0];
      if (!cur) throw new GraphQLError('Tikiti haipo.', { extensions: { code: 'NOT_FOUND' } });
      if (cur.hali === 'collected' || cur.hali === 'cancelled') {
        throw new GraphQLError('Tikiti lililokamilika haliwezi kubadilishwa.', { extensions: { code: 'BAD_REQUEST' } });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `UPDATE tikiti SET hali = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
          [hali, id]
        );
        if (cur.agizo_id) {
          const orderHali = { in_queue: 'ordered', preparing: 'in_progress', ready: 'ready', collected: 'collected', cancelled: 'cancelled' }[hali];
          await client.query(
            `UPDATE agizo_maalum SET hali = $1, updated_at = NOW() WHERE id = $2 AND hali != 'collected'`,
            [orderHali, cur.agizo_id]
          );
        }
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  },
};

module.exports = resolvers;