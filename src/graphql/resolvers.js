const { GraphQLScalarType, Kind, GraphQLError } = require('graphql');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { signToken } = require('../auth/jwt');
const { predictStockFor, generateUkumbusho, getPrepTime } = require('../reminders/engine');
const { nextTicketNumber, tikitishaMauzo, tikitishaAgizo } = require('../tickets/engine');
const {
  ROLE_OWNER,
  ROLE_CASHIER,
  ROLE_CHEF,
  ROLE_INVENTORY,
  requireCan,
  can,
} = require('../auth/permissions');

const DateScalar = new GraphQLScalarType({
  name: 'Date',
  description: 'Date (YYYY-MM-DD)',
  serialize: (v) => (v instanceof Date ? localDateKey(v) : v),
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
const localDateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

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

const resolvers = {
  Date: DateScalar,
  DateTime: DateTimeScalar,
  JSON: JSONScalar,

  AgizoMaalum: {
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
      // Cashier sees their own today sales; owner sees all today's sales.
      const today = localDateKey(new Date());
      if (ctx.user.jukumu === ROLE_CASHIER) {
        const { rows } = await pool.query(
          `SELECT * FROM mauzo WHERE tarehe = $1 AND mfanyakazi_id = $2 ORDER BY created_at DESC`,
          [today, ctx.user.sub]
        );
        return rows;
      }
      requireCan(ctx.user, 'sale.read_all');
      const { rows } = await pool.query(
        `SELECT * FROM mauzo WHERE tarehe = $1 ORDER BY created_at DESC`,
        [today]
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
      const { rows } = await pool.query(`SELECT * FROM malighafi ORDER BY jina`);
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
      const { rows } = await pool.query('SELECT * FROM malighafi ORDER BY jina');
      return rows;
    },

    marekebisho_hisa: async (_, __, ctx) => {
      requireCan(ctx.user, 'usage.read_all') || requireCan(ctx.user, 'stock.adjust_restock') || requireCan(ctx.user, 'stock.adjust_waste');
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
      requireCan(ctx.user, 'usage.read_all') || requireCan(ctx.user, 'stock.read');
      if (!can(ctx.user, 'usage.read_all') && !can(ctx.user, 'stock.adjust_restock') && !can(ctx.user, 'stock.adjust_waste')) {
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
      const today = localDateKey(new Date());

      const [mauzoRes, totalRes, perMethodRes, balancesRes, lowRes, kitchenRes, weekRes] = await Promise.all([
        pool.query('SELECT * FROM mauzo WHERE tarehe = $1 ORDER BY created_at DESC', [today]),
        pool.query('SELECT COALESCE(SUM(jumla), 0)::float AS total FROM mauzo WHERE tarehe = $1', [today]),
        pool.query(
          'SELECT njia_ya_malipo, COALESCE(SUM(jumla), 0)::float AS jumla FROM mauzo WHERE tarehe = $1 GROUP BY njia_ya_malipo',
          [today]
        ),
        pool.query(
          `SELECT * FROM agizo_maalum WHERE hali NOT IN ('collected', 'cancelled') ORDER BY tarehe_ya_kuchukua`
        ),
        pool.query(
          `SELECT id, jina, kiasi_kilichopo, kiwango_cha_chini, unit FROM malighafi WHERE kiasi_kilichopo <= kiwango_cha_chini ORDER BY jina`
        ),
        pool.query(
          `SELECT * FROM agizo_maalum WHERE hali IN ('in_progress', 'ready') ORDER BY tarehe_ya_kuchukua`
        ),
        pool.query(
          `SELECT tarehe::date AS tarehe, COALESCE(SUM(jumla), 0)::float AS jumla, COUNT(*)::int AS risiti
           FROM mauzo
           WHERE tarehe >= CURRENT_DATE - INTERVAL '6 days'
           GROUP BY tarehe::date
           ORDER BY tarehe::date`
        ),
      ]);

      const siku7 = (() => {
        const byDay = new Map(weekRes.rows.map((r) => [localDateKey(r.tarehe), r]));
        const out = [];
        for (let d = 6; d >= 0; d--) {
          const date = new Date();
          date.setDate(date.getDate() - d);
          const key = localDateKey(date);
          const hit = byDay.get(key);
          out.push({
            tarehe: key,
            jumla: hit ? hit.jumla : 0,
            risiti: hit ? hit.risiti : 0,
          });
        }
        return out;
      })();

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
      const { rows } = await pool.query(
        'SELECT * FROM mtumiaji WHERE id = $1 AND active = true',
        [id]
      );
      const u = rows[0];
      if (!u || !(await bcrypt.compare(pin, u.pin_hash))) {
        throw new GraphQLError('PIN si sahihi.', {
          extensions: { code: 'UNAUTHORIZED' },
        });
      }
      const token = signToken(u);
      return {
        token,
        mtumiaji: { id: u.id, jina: u.jina, jukumu: u.jukumu, active: true },
      };
    },

    bathi_bidhaa: async (_, { input }, ctx) => {
      requireCan(ctx.user, 'product.manage');
      const { rows } = await pool.query(
        'INSERT INTO bidhaa (jina, bei, aina) VALUES ($1, $2, $3) RETURNING *',
        [input.jina, input.bei, input.aina || null]
      );
      return rows[0];
    },

    hariri_bidhaa: async (_, { id, input }, ctx) => {
      requireCan(ctx.user, 'product.manage');
      const { rows } = await pool.query(
        `UPDATE bidhaa SET jina = $1, bei = $2, aina = $3 WHERE id = $4 RETURNING *`,
        [input.jina, input.bei, input.aina || null, id]
      );
      if (!rows[0]) throw new GraphQLError('Bidhaa haipo.', { extensions: { code: 'NOT_FOUND' } });
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
        const saleLine = perItems
          .map((i) => (i.kiasi > 1 ? `${i.kiasi}× ${i.rows.jina}` : i.rows.jina))
          .join(', ');
        const tikiti = await tikitishaMauzo(client, {
          mauzo_id: saleRes.rows[0].id,
          jumla,
          maelezo: saleLine,
        });
        await client.query('COMMIT');
        return { ...saleRes.rows[0], tikiti };
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
        const { rows } = await client.query(
          `INSERT INTO agizo_maalum
           (mteja_id, ladha, design, ukubwa, tarehe_ya_kuchukua, bei_jumla, malipo_ya_awali, hali, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ordered', $8) RETURNING *`,
          [
            mtejaId,
            input.ladha,
            input.design || null,
            input.ukubwa || null,
            input.tarehe_ya_kuchukua,
            input.bei_jumla,
            malipo_ya_awali,
            u.sub,
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
        await client.query('COMMIT');
        return { ...agizo, tikiti };
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

    log_matumizi: async (_, { input }, ctx) => {
      const u = ctx.user;
      requireCan(u, 'usage.create');
      const kiasi = Number(input.kiasi);
      if (!Number.isFinite(kiasi) || kiasi <= 0) {
        throw new GraphQLError('Kiasi kinachotumika lazima kiwe zaidi ya sifuri.', {
          extensions: { code: 'BAD_REQUEST' },
        });
      }
      const order = (
        await pool.query('SELECT hali, created_by FROM agizo_maalum WHERE id = $1', [input.agizo_id])
      ).rows[0];
      if (!order) throw new GraphQLError('Agizo halipo.', { extensions: { code: 'NOT_FOUND' } });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Lock the ingredient row so two concurrent usage logs against the same
        // ingredient serialise here instead of both passing a stale stock check.
        const ing = (
          await client.query(
            'SELECT kiasi_kilichopo FROM malighafi WHERE id = $1 FOR UPDATE',
            [input.malighafi_id]
          )
        ).rows[0];
        if (!ing) throw new GraphQLError('Malighafi haipo.', { extensions: { code: 'NOT_FOUND' } });
        if (kiasi > Number(ing.kiasi_kilichopo)) {
          throw new GraphQLError('Kiasi kinachotumika kinazidi hisa iliyopo.', {
            extensions: { code: 'INSUFFICIENT_STOCK' },
          });
        }
        const { rows } = await client.query(
          `INSERT INTO kumbukumbu_matumizi (agizo_id, malighafi_id, kiasi, mpishi_id) VALUES ($1, $2, $3, $4) RETURNING *`,
          [input.agizo_id, input.malighafi_id, kiasi, u.sub]
        );
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        // The malighafi CHECK (kiasi_kilichopo >= 0) is the hard backstop if a
        // race still slips through; surface it as the same stock error.
        if (err.code === '23514' || err.code === 'P0001') {
          throw new GraphQLError('Kiasi kinachotumika kinazidi hisa iliyopo.', {
            extensions: { code: 'INSUFFICIENT_STOCK' },
          });
        }
        throw err;
      } finally {
        client.release();
      }
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
      requireCan(ctx.user, 'report.access_dashboard') || requireCan(ctx.user, 'stock.read');
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