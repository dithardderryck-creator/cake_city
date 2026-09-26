const { GraphQLScalarType, Kind, GraphQLError } = require('graphql');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { signToken } = require('../auth/jwt');
const { isLocked, recordFailure, clear } = require('../auth/loginAttempts');
const { predictStockFor, generateUkumbusho, getPrepTime } = require('../reminders/engine');
const { eatDateKey } = require('../lib/dates');
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
const insertUsageBatch = async (_, { agizo_id, kumbukumbu, vitu, malighafi_id, kiasi }, ctx) => {
  const u = ctx.user;
  requireCan(u, 'usage.create');

  const lines = (vitu || [{ malighafi_id, kiasi }]).map((l) => ({
    malighafi_id: Number(l.malighafi_id),
    kiasi: Number(l.kiasi),
  }));
  if (!lines.length) {
    throw new GraphQLError('Hakuna kitu chochote kilichorekodiwa.', {
      extensions: { code: 'BAD_REQUEST' },
    });
  }
  for (const l of lines) {
    if (!Number.isInteger(l.malighafi_id) || l.malighafi_id <= 0) {
      throw new GraphQLError('Chagua malighafi.', { extensions: { code: 'BAD_REQUEST' } });
    }
    if (!Number.isFinite(l.kiasi) || l.kiasi <= 0) {
      throw new GraphQLError('Kiasi kinachotumika lazima kiwe zaidi ya sifuri.', {
        extensions: { code: 'BAD_REQUEST' },
      });
    }
  }

  // The tap grid lets the chef hit the same ingredient more than once, so
  // fold repeats into a single summed row instead of storing three separate
  // "flour 1" lines for inventory to verify one at a time.
  const folded = new Map();
  for (const l of lines) folded.set(l.malighafi_id, (folded.get(l.malighafi_id) || 0) + l.kiasi);
  const merged = [...folded].map(([id, amt]) => ({ malighafi_id: id, kiasi: amt }));

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

    if (agizo_id) {
      const order = (await client.query('SELECT id FROM agizo_maalum WHERE id = $1', [agizo_id])).rows[0];
      if (!order) throw new GraphQLError('Agizo halipo.', { extensions: { code: 'NOT_FOUND' } });
    }

    // Reject retired ingredients: migration 004 kept the collapsed
    // duplicates as inactive rows, and logging against those would move
    // stock nobody is counting.
    const ids = merged.map((l) => l.malighafi_id);
    const found = (
      await client.query('SELECT id FROM malighafi WHERE id = ANY($1::int[]) AND active', [ids])
    ).rows.map((r) => r.id);
    const missing = ids.filter((id) => !found.includes(id));
    if (missing.length) {
      throw new GraphQLError('Baadhi ya malighafi hayapatikani au yameondolewa.', {
        extensions: { code: 'BAD_REQUEST', malighafi_ids: missing },
      });
    }

    const out = [];
    for (const l of merged) {
      const { rows } = await client.query(
        `INSERT INTO kumbukumbu_matumizi
           (agizo_id, malighafi_id, kiasi, mpishi_id, hali, kumbukumbu)
         VALUES ($1, $2, $3, $4, 'inakadiriwa', $5)
         RETURNING *`,
        [agizo_id || null, l.malighafi_id, l.kiasi, u.sub, note]
      );
      out.push(rows[0]);
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
 * Validate + normalise a recipe's ingredient lines. Shared by create and
 * edit so both reject the same mistakes the same way.
 */
const normaliseIngredients = async (client, viambato) => {
  if (!Array.isArray(viambato) || !viambato.length) {
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
    bei_jumla: (order, _, ctx) =>
      can(ctx.user, 'order.read_all') ? order.bei_jumla : null,
    malipo_ya_awali: (order, _, ctx) =>
      can(ctx.user, 'order.read_all') ? order.malipo_ya_awali : null,
    salio: (order, _, ctx) =>
      can(ctx.user, 'order.read_all') ? order.salio : null,
    created_by: (order, _, ctx) =>
      can(ctx.user, 'order.read_all') ? order.created_by : null,
    muda_hitajika: async (order) => {
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
      const { rows } = await pool.query(
        'SELECT * FROM mapishi_kipengele WHERE mapishi_id = $1 ORDER BY id',
        [m.id]
      );
      return rows;
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

    kumbukumbu_matumizi: async (_, { agizo_id }, ctx) => {
      requireCan(ctx.user, 'usage.read_all');
      const where = [];
      const params = [];
      if (agizo_id) { params.push(agizo_id); where.push(`agizo_id = $${params.length}`); }
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
            WHERE k.hali = 'inakadiriwa'
            ORDER BY k.tarehe DESC`
        );
        return rows;
      },

      kategoria: async (_, { active }, ctx) => {
        requireCan(ctx.user, 'stock.read');
        const activeCond = active === false ? '' : 'WHERE active = true';
        const { rows } = await pool.query(`SELECT * FROM kategoria ${activeCond} ORDER BY jina`);
        return rows;
      },

      ombi: async (_, { fungua }, ctx) => {
        requireAuthenticated(ctx.user);
        const params = [];
        let sql = 'SELECT * FROM ombi';
        if (fungua !== undefined && fungua !== null) {
          // Map the boolean to the enum label rather than casting: passing the
          // GraphQL boolean straight through arrives as the string "true",
          // which is not a valid hali_ombi value.
          params.push(fungua ? 'fungua' : 'imefanyika');
          sql += ` WHERE hali = $${params.length}::hali_ombi`;
        }
        // Both directions are visible to everyone, so you can see what you
        // asked for as well as what was asked of you. Open first.
        sql += ` ORDER BY (hali = 'fungua') DESC, created_at DESC`;
        const { rows } = await pool.query(sql, params);
        return rows;
      },

    marekebisho_hisa: async (_, __, ctx) => {
      requireAuthenticated(ctx.user);
      if (!can(ctx.user, 'usage.read_all') && !can(ctx.user, 'stock.adjust_restock') && !can(ctx.user, 'stock.adjust_waste')) {
        throw new GraphQLError('Hamna ruhusa ya kuona marekebisho.', { extensions: { code: 'FORBIDDEN' } });
      }
      const { rows } = await pool.query('SELECT * FROM marekebisho_hisa ORDER BY tarehe DESC');
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
      const { rows } = await pool.query(
        'INSERT INTO mteja (jina, simu, siku_ya_kuzaliwa) VALUES ($1, $2, $3) RETURNING *',
        [input.jina, input.simu || null, input.siku_ya_kuzaliwa || null]
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
        if (!mtejaId && input.mteja_mpya) {
          const { rows } = await client.query(
            'INSERT INTO mteja (jina, simu, siku_ya_kuzaliwa) VALUES ($1, $2, $3) RETURNING id',
            [input.mteja_mpya.jina, input.mteja_mpya.simu || null, input.mteja_mpya.siku_ya_kuzaliwa || null]
          );
          mtejaId = rows[0].id;
        } else if (mtejaId) {
          const m = (
            await client.query('SELECT jina FROM mteja WHERE id = $1', [mtejaId])
          ).rows[0];
          mtejaJina = m?.jina;
        }
        // Link the order to a recipe from the book. This is what makes the
        // chef's tap sheet prefill instead of starting blank, so it is set
        // here rather than inferred later. Validated against an ACTIVE recipe:
        // a retired recipe should not silently prefill a new order.
        let mapishiId = null;
        if (input.mapishi_id) {
          const rec = (
            await client.query('SELECT id FROM mapishi WHERE id = $1 AND active', [input.mapishi_id])
          ).rows[0];
          if (!rec) {
            throw new GraphQLError('Mapishi hakupatikani.', { extensions: { code: 'NOT_FOUND' } });
          }
          mapishiId = rec.id;
        }
        const { rows } = await client.query(
          `INSERT INTO agizo_maalum
           (mteja_id, ladha, design, ukubwa, tarehe_ya_kuchukua, bei_jumla, malipo_ya_awali, hali, created_by, mapishi_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ordered', $8, $9) RETURNING *`,
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
        const lines = await normaliseIngredients(client, input.viambato);

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
                               mapishi_ibaba = $4, created_by = $5, created_at = now()
              WHERE id = $1`,
            [prior.id, input.dakika_kadirio || 90, input.mapamba_variant || 'own_recipe',
             input.mapishi_ibaba || null, ctx.user.sub]
          );
          await client.query('DELETE FROM mapishi_kipengele WHERE mapishi_id = $1', [prior.id]);
          id = prior.id;
        } else {
          const ins = await client.query(
            `INSERT INTO mapishi (ladha, ukubwa, dakika_kadirio, mapamba_variant, mapishi_ibaba, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [ladha, ukubwa, input.dakika_kadirio || 90, input.mapamba_variant || 'own_recipe',
             input.mapishi_ibaba || null, ctx.user.sub]
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
        const lines = await normaliseIngredients(client, input.viambato);
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
                              mapamba_variant = $5, mapishi_ibaba = $6
            WHERE id = $1`,
          [id, String(input.ladha || '').trim(), String(input.ukubwa || '').trim(),
           input.dakika_kadirio || 90, input.mapamba_variant || 'own_recipe',
           input.mapishi_ibaba || null]
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

    tumia_ombi: async (_, { kwenda_kwa, ujumbe }, ctx) => {
      requireCan(ctx.user, 'ombi.tuma');
      const msg = String(ujumbe || '').trim();
      if (!msg) throw new GraphQLError('Andika ujumbe.', { extensions: { code: 'BAD_REQUEST' } });
      if (String(kwenda_kwa) === String(ctx.user.sub)) {
        throw new GraphQLError('Huwezi kujiombia mwenyewe.', { extensions: { code: 'BAD_REQUEST' } });
      }
      const to = (
        await pool.query('SELECT id FROM mtumiaji WHERE id = $1 AND active', [kwenda_kwa])
      ).rows[0];
      if (!to) throw new GraphQLError('Mfanyakaji hakupatikani.', { extensions: { code: 'NOT_FOUND' } });
      const { rows } = await pool.query(
        'INSERT INTO ombi (kutoka_kwa, kwenda_kwa, ujumbe) VALUES ($1, $2, $3) RETURNING *',
        [ctx.user.sub, kwenda_kwa, msg]
      );
      return rows[0];
    },

    /**
     * Only the person the request was addressed to may close it. The owner is
     * allowed too, otherwise a request sent to a staff member who then left
     * would sit open forever with nobody able to clear it.
     */
    fungua_ombi: async (_, { id, jibu }, ctx) => {
      requireCan(ctx.user, 'ombi.fungua');
      const cur = (await pool.query('SELECT * FROM ombi WHERE id = $1', [id])).rows[0];
      if (!cur) throw new GraphQLError('Ombi halipo.', { extensions: { code: 'NOT_FOUND' } });
      const isRecipient = String(cur.kwenda_kwa) === String(ctx.user.sub);
      if (!isRecipient && ctx.user.jukumu !== ROLE_OWNER) {
        throw new GraphQLError('Ombi huu ni wa mtu mwingine.', { extensions: { code: 'FORBIDDEN' } });
      }
      if (cur.hali === 'imefanyika') {
        throw new GraphQLError('Ombi tayari umefunguliwa.', { extensions: { code: 'ALREADY_CLOSED' } });
      }
      const { rows } = await pool.query(
        `UPDATE ombi SET hali = 'imefanyika', jibu = $2, tarehe_ya_kufunguliwa = now()
          WHERE id = $1 RETURNING *`,
        [id, jibu ? String(jibu).trim() : null]
      );
      return rows[0];
    },


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