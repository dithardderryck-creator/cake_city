import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { useAuth } from '../auth'
import {
  MALIGHAFI,
  KUMBUKUMU_MATUMIZI,
  MAREKEBISHO_HISA,
  UTABIRI_HISA,
  MATUMIZI_KUSUBIRI,
  MALEZO_MALIGHAFI,
  OMBI,
  WATUMISHI,
} from '../graphql/queries'
import {
  MAREKEBISHO_HISA_MUT,
  ONGEZA_MALIGHAFI,
  HARIRI_MALIGHAFI,
  THIBITISHA_MATUMIZI,
  TUMIA_OMBI,
  FUNGUA_OMBI,
} from '../graphql/mutations'
import { Card } from '../ui/Card'
import { Btn } from '../ui/Btn'
import { Badge } from '../ui/Badge'
import { Field, FieldSquare, TextArea } from '../ui/Field'
import { Select } from '../ui/Select'
import { Modal } from '../ui/Modal'
import { StatusPill, TrendChart } from '../ui/charts'
import {
  Package,
  PlusCircle,
  Trash,
  ArrowUpRight,
  Clipboard,
  TrendUp,
  Bell,
  PencilSimple,
  Check,
  MagnifyingGlass,
  ArrowsDownUp,
  ChatCircle,
  PaperPlaneTilt,
  X,
  Wrench,
  CalendarBlank,
  ArrowRight,
  Warning,
} from '@phosphor-icons/react'

const TABS = [
  { key: 'utabiri', label: 'Utabiri', icon: TrendUp },
  { key: 'stock', label: 'Hisa', icon: Package },
  { key: 'usage', label: 'Matumizi ya Mpishi', icon: Clipboard },
  { key: 'adjust', label: 'Marekebisho', icon: ArrowUpRight },
  { key: 'ombi', label: 'Maombi', icon: ChatCircle },
]

const LEVEL_META = {
  imeisha: { tone: 'danger', label: 'IMEISHA' },
  hatarini: { tone: 'danger', label: 'HATARINI' },
  angalia: { tone: 'watch', label: 'ANGALIA' },
  salama: { tone: 'safe', label: 'SALAMA' },
}

/**
 * How much cover the shop keeps when reordering. Every "agiza" suggestion on this
 * screen is ten days at the observed usage rate, stated in the label so the
 * number is a decision the clerk can argue with rather than a magic figure.
 */
const DAYS_OF_COVER = 10

/**
 * Today's date in the shop's own timezone.
 *
 * The browser may sit in any timezone, and the rest of the app is careful to
 * anchor "today" to Africa/Dar_es_Salaam, so a date range that used the
 * browser's clock would quietly include or miss a day of trading.
 */
function shopToday(offsetDays = 0) {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Dar_es_Salaam',
  }).format(new Date())
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + offsetDays * 86400000).toISOString().slice(0, 10)
}

const RANGES = [
  { key: 'leo', label: 'Leo', span: 0 },
  { key: '7', label: 'Siku 7', span: 6 },
  { key: '30', label: 'Siku 30', span: 29 },
  { key: 'zote', label: 'Zote', span: null },
]

function rangeVars(key) {
  const r = RANGES.find((x) => x.key === key) || RANGES[0]
  if (r.span === null) return { kutoka: null, kutia: null }
  return { kutoka: shopToday(-r.span), kutia: shopToday() }
}

/**
 * One place decides what "low" means, so the pills, the progress bars, the
 * counters and the "low stock only" filter can never disagree with each other.
 */
function stockLevel(i) {
  const qty = Number(i.kiasi_kilichopo) || 0
  const min = Number(i.kiwango_cha_chini) || 0
  if (qty <= 0) return { ...LEVEL_META.imeisha, key: 'imeisha' }
  if (qty <= min) return { ...LEVEL_META.hatarini, key: 'hatarini' }
  if (qty <= min * 2) return { ...LEVEL_META.angalia, key: 'angalia' }
  return { ...LEVEL_META.salama, key: 'salama' }
}

const needsOrdering = (i) => ['imeisha', 'hatarini'].includes(stockLevel(i).key)

/* ------------------------------------------------------------------ summary */

function SummaryBar({ items, pending, myOpenRequests, onJump }) {
  const out = items.filter((i) => stockLevel(i).key === 'imeisha').length
  const low = items.filter(needsOrdering).length
  const stats = [
    {
      key: 'stock',
      label: 'Malighafi',
      value: items.length,
      sub: `${low} zinahitaji agizo`,
      tone: low > 0 ? 'watch' : 'safe',
      icon: Package,
    },
    {
      key: 'out',
      label: 'Zimeisha',
      value: out,
      sub: out ? 'Hisa ni sufuri' : 'Hakuna kilichokosewa',
      tone: out ? 'danger' : 'safe',
      icon: Warning,
    },
    {
      key: 'usage',
      label: 'Zinasubiri',
      value: pending,
      sub: pending ? 'Hesa bado hazijishukuliwe' : 'Hesa ziko sawa',
      tone: pending ? 'watch' : 'safe',
      icon: Clipboard,
    },
    {
      key: 'ombi',
      label: 'Maombi',
      value: myOpenRequests,
      sub: myOpenRequests ? 'Yanapaswa kujibiwa' : 'Hakuna yaliyo wazi',
      tone: myOpenRequests ? 'watch' : 'safe',
      icon: ChatCircle,
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger">
      {stats.map((s) => (
        <button
          key={s.key}
          onClick={() => onJump?.(s.key)}
          className={`text-left rounded-2xl px-4 py-3.5 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:ring-1 hover:ring-copper/25 ${
            s.tone === 'danger'
              ? 'bg-red-500/[0.06]'
              : s.tone === 'watch'
                ? 'bg-[#FAEEDA]'
                : 'bg-espresso/[0.03]'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <s.icon
              weight="light"
              className={`w-3.5 h-3.5 ${
                s.tone === 'danger' ? 'text-red-600' : s.tone === 'watch' ? 'text-[#854F0B]' : 'text-espresso-muted'
              }`}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-espresso-muted">
              {s.label}
            </span>
          </div>
          <p
            className={`cc-num text-2xl font-semibold leading-none ${
              s.tone === 'danger' ? 'text-red-600' : s.tone === 'watch' ? 'text-[#854F0B]' : 'text-espresso'
            }`}
          >
            {s.value}
          </p>
          <p className="text-[10px] text-espresso-muted mt-1 truncate">{s.sub}</p>
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------- range */

function RangePicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-espresso/[0.04] p-1">
      <CalendarBlank weight="light" className="w-3.5 h-3.5 text-espresso-muted ml-1.5" />
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          className={`rounded-full px-3 py-1 text-[11px] font-semibold whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            value === r.key ? 'bg-espresso text-cream' : 'text-espresso-muted hover:text-espresso'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------- requests */

function RequestSheet({ open, onClose, staff, meId, preset, refetch }) {
  const [send] = useMutation(TUMIA_OMBI, { refetchQueries: [{ query: OMBI }] })
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  // Defaults to the owner, since "can we buy more of this" is nearly always
  // aimed at them, and there is no way to send a request to yourself. Re-derived
  // whenever the sheet opens or the preset changes, so that the stock screen
  // ("request this ingredient") and the Maombi tab (blank) cannot leak a stale
  // draft into one another. Staff is a static lookup that resolves once, so this
  // will not overwrite text the user is currently typing.
  useEffect(() => {
    if (!open) return
    const others = (staff || []).filter((s) => String(s.id) !== String(meId))
    const owner = others.find((s) => s.jukumu === 'owner')
    setTo(owner ? owner.id : (others[0]?.id ?? ''))
    setText(preset || '')
    setErr('')
    setOk('')
  }, [open, staff, meId, preset])

  const submit = async (e) => {
    e.preventDefault()
    if (!to || !text.trim()) return
    setBusy(true)
    setErr('')
    try {
      await send({ variables: { kwenda_kwa: String(to), ujumbe: text.trim() } })
      setOk('Ombi limetumwa.')
      setText('')
      refetch?.()
      setTimeout(() => {
        setOk('')
        onClose()
      }, 900)
    } catch (err2) {
      setErr(err2?.message || 'Imeshindwa. Jaribu tena.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Tuma Ombi">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Select label="Mpelekee" required value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">— Chagua —</option>
          {(staff || [])
            .filter((s) => String(s.id) !== String(meId))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.jina} ({s.jukumu})
              </option>
            ))}
        </Select>
        <TextArea
          label="Ujumbe"
          required
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Cream ya kupenga imeisha. Tunaweza kununua lita 6?"
        />
        {err && <p className="text-xs font-medium text-red-500 text-center">{err}</p>}
        {ok && <p className="text-xs font-medium text-sage-deep text-center">{ok}</p>}
        <Btn type="submit" variant="accent" size="lg" icon={PaperPlaneTilt} disabled={busy} className="w-full">
          {busy ? 'Inatuma...' : 'Tuma'}
        </Btn>
      </form>
    </Modal>
  )
}

function RequestRow({ o, actionable, replying, onReply, onCancel, onSubmit, draft, setDraft, busy }) {
  return (
    <div className="rounded-2xl bg-espresso/[0.03] px-4 py-3.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-espresso leading-snug">{o.ujumbe}</p>
          <p className="text-[11px] text-espresso-muted mt-0.5">
            {o.kutoka_kwa?.jina} → {o.kwenda_kwa?.jina} · {new Date(o.created_at).toLocaleString('sw')}
          </p>
        </div>
        <Badge color={o.hali === 'fungua' ? 'copper' : 'sage'}>
          {o.hali === 'fungua' ? 'Wazi' : 'Imefanyika'}
        </Badge>
      </div>
      {o.jibu && (
        <p className="text-[12px] text-espresso bg-sage/[0.07] rounded-xl px-3 py-2 mt-2.5">
          <span className="font-semibold">Jibu:</span> {o.jibu}
        </p>
      )}
      {actionable && o.hali === 'fungua' && (
        <div className="flex items-end gap-2 mt-3 flex-wrap">
          {replying ? (
            <>
              <input
                autoFocus
                placeholder="Jibu lako (si lazima)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 min-w-[12rem] rounded-xl bg-white ring-1 ring-espresso/10 px-3 py-2 text-sm"
              />
              <Btn variant="accent" size="md" icon={Check} disabled={busy} onClick={onSubmit}>
                {busy ? 'Inahifadhi...' : 'Funga'}
              </Btn>
              <Btn variant="ghost" size="md" icon={X} onClick={onCancel}>
                Ghairi
              </Btn>
            </>
          ) : (
            <Btn variant="ghost" size="md" icon={ChatCircle} onClick={onReply}>
              Jibu na funga
            </Btn>
          )}
        </div>
      )}
    </div>
  )
}

function OmbiTab({ me, staff }) {
  const { data, loading, refetch } = useQuery(OMBI)
  const [close] = useMutation(FUNGUA_OMBI, { refetchQueries: [{ query: OMBI }] })
  const [sheet, setSheet] = useState(false)
  const [replying, setReplying] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const all = data?.ombi || []
  const canClose = (o) => String(o.kwenda_kwa?.id) === String(me?.id) || me?.jukumu === 'owner'
  const forMe = all.filter((o) => o.hali === 'fungua' && canClose(o))
  const fromMe = all.filter((o) => String(o.kutoka_kwa?.id) === String(me?.id))
  const done = all.filter((o) => o.hali === 'imefanyika' && canClose(o))

  const startReply = (o) => {
    setReplying(o.id)
    setDraft('')
  }

  const answer = async (o) => {
    setBusy(true)
    try {
      await close({ variables: { id: String(o.id), jibu: draft.trim() || null } })
      setReplying(null)
      setDraft('')
      refetch()
    } catch (e) {
      setDraft(e?.message || 'Imeshindwa')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Btn variant="accent" size="md" icon={PaperPlaneTilt} onClick={() => setSheet(true)}>
          Tuma Ombi
        </Btn>
      </div>

      {loading && (
        <div className="flex justify-center py-10">
          <div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" />
        </div>
      )}

      {!loading && forMe.length === 0 && fromMe.length === 0 && (
        <Card className="p-6">
          <p className="text-sm text-espresso-muted/70 text-center py-6">
            Hakuna ombi bado. Wakati malighafi inaikaribia kuisha, tuma ombi hapa.
          </p>
        </Card>
      )}

      {forMe.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-espresso-muted">
            Unapaswa kujibu ({forMe.length})
          </h3>
          {forMe.map((o) => (
            <RequestRow
              key={o.id}
              o={o}
              actionable
              replying={replying === o.id}
              onReply={() => startReply(o)}
              onCancel={() => setReplying(null)}
              onSubmit={() => answer(o)}
              draft={draft}
              setDraft={setDraft}
              busy={busy}
            />
          ))}
        </section>
      )}

      {fromMe.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-espresso-muted">
            Maombi yako ({fromMe.length})
          </h3>
          {fromMe.map((o) => (
            <RequestRow key={o.id} o={o} />
          ))}
        </section>
      )}

      {done.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-espresso-muted">
            Yamekamilika ({done.length})
          </h3>
          {done.slice(0, 10).map((o) => (
            <RequestRow key={o.id} o={o} />
          ))}
        </section>
      )}

      <RequestSheet
        open={sheet}
        onClose={() => setSheet(false)}
        staff={staff}
        meId={me?.id}
        refetch={refetch}
      />
    </div>
  )
}

/* -------------------------------------------------------------------- stock */

const SORTS = [
  { key: 'jina', label: 'Jina' },
  { key: 'hatari', label: 'Hatari zaidi' },
  { key: 'kiasi', label: 'Kiasi' },
]

function StockTab({ items, onOpen }) {
  const { user } = useAuth()
  const canManage = ['owner', 'inventory'].includes(user?.jukumu)
  const [addOpen, setAddOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('hatari')
  const [onlyLow, setOnlyLow] = useState(false)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = items.filter(
      (i) => (!needle || i.jina.toLowerCase().includes(needle)) && (!onlyLow || needsOrdering(i))
    )
    const rank = { imeisha: 0, hatarini: 1, angalia: 2, salama: 3 }
    out = [...out].sort((a, b) => {
      if (sort === 'jina') return a.jina.localeCompare(b.jina)
      if (sort === 'kiasi') return a.kiasi_kilichopo - b.kiasi_kilichopo
      const d = rank[stockLevel(a).key] - rank[stockLevel(b).key]
      if (d !== 0) return d
      return (a.kiasi_kilichopo / (a.kiwango_cha_chini || 1)) - (b.kiasi_kilichopo / (b.kiwango_cha_chini || 1))
    })
    return out
  }, [items, q, sort, onlyLow])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[14rem]">
          <div className="relative flex-1 min-w-[11rem]">
            <MagnifyingGlass
              weight="light"
              className="w-4 h-4 text-espresso-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tafuta malighafi..."
              className="w-full rounded-full bg-espresso/[0.04] pl-9 pr-8 py-2 text-sm placeholder:text-espresso-muted/50 focus:outline-none focus:ring-1 focus:ring-copper/30"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                aria-label="Futa utafutaji"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-espresso-muted hover:text-espresso"
              >
                <X weight="bold" className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            onClick={() => setOnlyLow((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-semibold transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              onlyLow ? 'bg-copper text-white' : 'bg-espresso/[0.04] text-espresso-muted hover:bg-espresso/[0.07]'
            }`}
          >
            <Warning weight="light" className="w-3.5 h-3.5" />
            Zinahitaji agizo
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full bg-espresso/[0.04] p-1">
            <ArrowsDownUp weight="light" className="w-3.5 h-3.5 text-espresso-muted ml-1.5" />
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  sort === s.key ? 'bg-espresso text-cream' : 'text-espresso-muted hover:text-espresso'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {canManage && (
            <Btn variant="accent" size="md" icon={PlusCircle} onClick={() => setAddOpen(true)}>
              Ongeza
            </Btn>
          )}
        </div>
      </div>

      {(q || onlyLow) && (
        <p className="text-[11px] text-espresso-muted">
          {shown.length} kati ya {items.length} malighafi
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 stagger">
        {shown.map((i) => {
          const lv = stockLevel(i)
          const maxQty = Math.max(i.kiasi_kilichopo, i.kiwango_cha_chini, 1)
          const pct = Math.min(100, (i.kiasi_kilichopo / maxQty) * 100)
          return (
            <button
              key={i.id}
              onClick={() => onOpen(i)}
              className="text-left rounded-2xl ring-1 ring-espresso/[0.06] p-5 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:ring-copper/30 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
            >
              <div className="flex items-start justify-between mb-3 gap-2">
                <p className="text-sm font-semibold truncate">{i.jina}</p>
                <StatusPill tone={lv.tone}>{lv.label}</StatusPill>
              </div>
              <div className="flex items-end justify-between gap-4">
                <p className="cc-num text-2xl font-semibold">
                  {i.kiasi_kilichopo}
                  <span className="text-sm text-espresso-muted font-normal ml-1">{i.unit}</span>
                </p>
                <span className="text-[10px] text-espresso-muted tabular-nums">
                  chini {i.kiwango_cha_chini} {i.unit}
                </span>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-espresso/[0.06] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                    lv.tone === 'danger' ? 'bg-red-400' : lv.tone === 'watch' ? 'bg-copper' : 'bg-sage'
                  }`}
                  style={{ width: `${Math.max(6, pct)}%` }}
                />
              </div>
            </button>
          )
        })}
        {shown.length === 0 && (
          <Card className="p-6 md:col-span-2">
            <p className="text-sm text-espresso-muted/70 text-center py-8">
              {onlyLow
                ? 'Hakuna malighafi inayohitaji agizo sasa hivi sasa.'
                : `Hakuna malighafi inayolingana na "${q}".`}
            </p>
          </Card>
        )}
      </div>
      {canManage && <AddMalighafiModal open={addOpen} onClose={() => setAddOpen(false)} />}
    </div>
  )
}

function AddMalighafiModal({ open, onClose }) {
  const [mut] = useMutation(ONGEZA_MALIGHAFI, { refetchQueries: [{ query: MALIGHAFI }] })
  const [form, setForm] = useState({ jina: '', kiasi: '', chini: '', unit: 'kg' })
  const [busy, setBusy] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mut({
        variables: {
          input: {
            jina: form.jina,
            kiasi_kilichopo: Number(form.kiasi) || 0,
            kiwango_cha_chini: Number(form.chini) || 0,
            unit: form.unit,
          },
        },
      })
      setForm({ jina: '', kiasi: '', chini: '', unit: 'kg' })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Ongeza Malighafi">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field
          label="Jina la malighafi"
          required
          value={form.jina}
          onChange={(e) => setForm((f) => ({ ...f, jina: e.target.value }))}
          placeholder="Unga, Sukari..."
        />
        <div className="grid grid-cols-3 gap-3">
          <FieldSquare
            label="Kiasi sasa"
            type="number"
            step="0.1"
            value={form.kiasi}
            onChange={(e) => setForm((f) => ({ ...f, kiasi: e.target.value }))}
            placeholder="0"
          />
          <FieldSquare
            label="Kiwango chini"
            type="number"
            step="0.1"
            value={form.chini}
            onChange={(e) => setForm((f) => ({ ...f, chini: e.target.value }))}
            placeholder="0"
          />
          <FieldSquare
            label="Unit"
            required
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
          />
        </div>
        <Btn type="submit" variant="accent" size="lg" icon={Check} disabled={busy} className="w-full">
          Ongeza
        </Btn>
      </form>
    </Modal>
  )
}

/* ---------------------------------------------------------- detail + editing */

function IngredientDetail({ item, onClose }) {
  const { data, loading, refetch } = useQuery(MALEZO_MALIGHAFI, {
    variables: { id: String(item.id) },
    skip: !item,
  })
  const { user } = useAuth()
  const canAdjust = ['owner', 'inventory'].includes(user?.jukumu)
  const [edit, setEdit] = useState(false)
  const [correct, setCorrect] = useState(false)

  const d = data?.maelezo_malighafi
  const ing = d?.malighafi
  const lv = ing ? stockLevel(ing) : null

  const chart = useMemo(() => {
    const days = d?.mwenendo || []
    if (!days.length) return []
    // Anchor at the last recorded balance, then project forward at the observed
    // daily rate. The actual side is real; only the forward tail is a forecast.
    const last = days[days.length - 1].kiasi
    const recent = days.slice(-7)
    const spent = recent.reduce((a, s) => a + Math.max(0, -s.mabadiliko), 0)
    const rate = recent.length ? spent / recent.length : 0
    const out = days.map((s) => ({ label: s.tarehe.slice(5), actual: s.kiasi, forecast: null }))
    for (let i = 1; i <= 7; i += 1) {
      out.push({
        label: i === 7 ? 'T' : '',
        actual: null,
        forecast: Math.max(0, last - rate * i),
      })
    }
    return out
  }, [d])

  const LABEL = { matumizi: 'Matumizi', kujaza: 'Kujaza upya', upotevu: 'Upotevu' }
  const COLOR = { matumizi: 'text-copper', kujaza: 'text-sage', upotevu: 'text-red-500' }

  return (
    <Modal
      open={!!item}
      onClose={() => {
        setEdit(false)
        setCorrect(false)
        onClose()
      }}
      title={ing?.jina || item?.jina}
      className="max-w-2xl"
    >
      {loading && (
        <div className="flex justify-center py-10">
          <div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" />
        </div>
      )}

      {ing && (
        <div className="flex flex-col gap-5">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <p className="cc-num text-3xl font-semibold leading-none">
                {ing.kiasi_kilichopo}
                <span className="text-base text-espresso-muted font-normal ml-1.5">{ing.unit}</span>
              </p>
              <p className="text-[11px] text-espresso-muted mt-1.5">
                Kiwango cha chini {ing.kiwango_cha_chini} {ing.unit}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill tone={lv.tone}>{lv.label}</StatusPill>
              {canAdjust && (
                <>
                  <Btn variant="ghost" size="sm" icon={Wrench} onClick={() => setCorrect(true)}>
                    Sahihisha
                  </Btn>
                  <Btn variant="ghost" size="sm" icon={PencilSimple} onClick={() => setEdit(true)}>
                    Hariri
                  </Btn>
                </>
              )}
            </div>
          </div>

          <div>
            <span className="cc-eyebrow">Mwenendo wa Hisa</span>
            {d.mwenendo.length > 1 ? (
              <div className="h-[170px] mt-2">
                <TrendChart data={chart} threshold={ing.kiwango_cha_chini} />
              </div>
            ) : (
              <p className="text-[11px] text-espresso-muted mt-2">
                Hakuna mwenendo wa kuthibitisha bado — malighafi hii haijasumbuliwa.
                Mstari wa awali unatokana na kiasi cha sasa tu.
              </p>
            )}
            {d.mwenendo.length > 1 && (
              <p className="text-[10px] text-espresso-muted/70 mt-1">
                Mstari halisi unatokana na mabadiliko yaliyorekodiwa. Sehemu iliyo kuonyeshwa
                kwa mstari wa kuvuka ni utabiri, si historia.
              </p>
            )}
          </div>

          {d.mapishi.length > 0 && (
            <div>
              <span className="cc-eyebrow">Mapishi yanayotumia ({d.mapishi.length})</span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {d.mapishi.map((r) => (
                  <span
                    key={`${r.mapishi_id}-${r.ukubwa}`}
                    className="rounded-full bg-espresso/[0.04] px-2.5 py-1 text-[11px] text-espresso"
                  >
                    {r.ladha}
                    {r.ukubwa ? ` / ${r.ukubwa}` : ''}
                    <span className="text-espresso-muted tabular-nums ml-1.5">
                      {r.kiasi_cha_chini}–{r.kiasi_cha_juu}
                    </span>
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-espresso-muted/70 mt-1.5">
                Kama unakosewa, hii ndiyo maana inayokutafaa kununua.
              </p>
            </div>
          )}

          <div>
            <span className="cc-eyebrow">Marekebisho ({d.vipengele.length})</span>
            {d.vipengele.length === 0 ? (
              <p className="text-[11px] text-espresso-muted mt-2">
                Hakuna mabadiliko yaliyorekodiwa bado.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5 mt-2 max-h-56 overflow-y-auto pr-1">
                {d.vipengele.map((v) => (
                  <div
                    key={`${v.aina}-${v.tarehe}-${v.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-espresso/[0.03] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-espresso">
                        {LABEL[v.aina]}
                        {v.sababu ? <span className="font-normal text-espresso-muted"> · {v.sababu}</span> : null}
                      </p>
                      <p className="text-[10px] text-espresso-muted">
                        {new Date(v.tarehe).toLocaleString('sw')}
                        {v.mwingilieji ? ` · ${v.mwingilieji.jina}` : ''}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold tabular-nums shrink-0 ${COLOR[v.aina]}`}>
                      {v.mabadiliko > 0 ? '+' : ''}
                      {v.mabadiliko} {ing.unit}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {edit && ing && (
        <EditDetailsModal
          item={ing}
          onClose={() => setEdit(false)}
          onSaved={() => {
            setEdit(false)
            refetch()
          }}
        />
      )}
      {correct && ing && (
        <CorrectStockModal
          item={ing}
          onClose={() => setCorrect(false)}
          onSaved={() => {
            setCorrect(false)
            refetch()
          }}
        />
      )}
    </Modal>
  )
}

function EditDetailsModal({ item, onClose, onSaved }) {
  const [mut] = useMutation(HARIRI_MALIGHAFI, { refetchQueries: [{ query: MALIGHAFI }] })
  const [form, setForm] = useState({
    jina: item.jina,
    chini: item.kiwango_cha_chini,
    unit: item.unit,
  })
  const [busy, setBusy] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      // Deliberately no kiasi_kilichopo here. The quantity is changed through a
      // restock or wastage entry instead, so every movement in the ledger has a
      // reason attached to it and the history stays trustworthy.
      await mut({
        variables: {
          id: String(item.id),
          input: { jina: form.jina, kiwango_cha_chini: Number(form.chini), unit: form.unit },
        },
      })
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Hariri ${item.jina}`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field
          label="Jina"
          required
          value={form.jina}
          onChange={(e) => setForm((f) => ({ ...f, jina: e.target.value }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <FieldSquare
            label="Kiwango cha chini"
            type="number"
            step="0.1"
            required
            value={form.chini}
            onChange={(e) => setForm((f) => ({ ...f, chini: e.target.value }))}
          />
          <FieldSquare
            label="Unit"
            required
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
          />
        </div>
        <p className="text-[11px] text-espresso-muted bg-espresso/[0.03] rounded-xl px-3 py-2">
          Kiasi halisi hakibadilishwi hapa. Tumia <strong>Sahihisha</strong> ili kuandika
          marekebisho ya kujaza au upotevu, ili kila mabadiliko ya hisa yawe na sababu.
        </p>
        <Btn type="submit" variant="accent" size="lg" icon={Check} disabled={busy} className="w-full">
          Hifadhi
        </Btn>
      </form>
    </Modal>
  )
}

function CorrectStockModal({ item, onClose, onSaved }) {
  const [mut] = useMutation(MAREKEBISHO_HISA_MUT, {
    refetchQueries: [{ query: MALIGHAFI }, { query: MAREKEBISHO_HISA }],
  })
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const delta = Number(qty || 0)
  const after = Number(item.kiasi_kilichopo) + delta
  const aina = delta >= 0 ? 'restock' : 'waste'
  const invalid = qty === '' || delta === 0 || !reason.trim() || after < 0

  const save = async (e) => {
    e.preventDefault()
    if (invalid) return
    setBusy(true)
    setErr('')
    try {
      await mut({
        variables: {
          input: {
            malighafi_id: String(item.id),
            aina,
            kiasi: Math.abs(delta),
            sababu: `Sahihisho: ${reason.trim()}`,
          },
        },
      })
      onSaved()
    } catch (e2) {
      setErr(e2?.message || 'Imeshindwa. Jaribu tena.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Sahihisha hisa ya ${item.jina}`}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <p className="text-[11px] text-espresso-muted bg-espresso/[0.03] rounded-xl px-3 py-2">
          Hesabu kwanza <strong className="tabular-nums">{item.kiasi_kilichopo} {item.unit}</strong>.
          Weka tofauti: chanya kama ulikuwa umekosea kuhesabu, hasi kama umekosea kutumia.
        </p>
        <FieldSquare
          label="Tofauti (+ au −)"
          type="number"
          step="0.1"
          required
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="mfano −2.5"
        />
        {qty !== '' && delta !== 0 && (
          <p className="text-[12px] text-espresso">
            Itarekodiwa kama{' '}
            <strong>{aina === 'restock' ? 'Kujaza upya' : 'Upotevu'}</strong> ·{' '}
            <span className={`tabular-nums ${after < 0 ? 'text-red-500' : ''}`}>
              {item.kiasi_kilichopo} → {after} {item.unit}
            </span>
          </p>
        )}
        <Field
          label="Sababu (inahitajika)"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Nimehesabu vibao vya zamani"
        />
        {after < 0 && (
          <p className="text-[11px] text-red-500 font-medium">
            Hesabu hiyo itakuwa hasi. Hakuna hisa ya kutosha — chagua tofauti ndogo.
          </p>
        )}
        {err && <p className="text-xs font-medium text-red-500 text-center">{err}</p>}
        <Btn
          type="submit"
          variant={aina === 'restock' ? 'accent' : 'danger'}
          size="lg"
          icon={Check}
          disabled={busy || invalid}
          className="w-full"
        >
          {busy ? 'Inahifadhi...' : 'Rekodi Marekebisho'}
        </Btn>
      </form>
    </Modal>
  )
}

/* ----------------------------------------------------------------- forecast */

function UtabiriTab({ onRequest }) {
  const { data, loading } = useQuery(UTABIRI_HISA, { variables: { kiasi_chini_ya_siku: 30 } })
  const [focus, setFocus] = useState(null)
  const items = data?.utabiri_hisa || []
  const focused = focus || items[0] || null

  // Every item the forecast flags, not just the first three. The old view cut
  // the list at three, so a fourth ingredient about to run out simply did not
  // exist on this screen.
  const [showAll, setShowAll] = useState(false)
  const listed = showAll ? items : items.slice(0, 6)

  return (
    <div className="flex flex-col gap-5">
      {loading && (
        <div className="flex justify-center py-10">
          <div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <Card className="p-6">
          <p className="text-sm text-espresso-muted/70 text-center py-8">
            Hakuna malighafi itakayoisha ndani ya siku 30 — hisa zako zipo salama.
          </p>
        </Card>
      )}

      {items.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger">
            {listed.map((f) => (
              <ForecastCard
                key={f.malighafi.id}
                f={f}
                selected={focused?.malighafi?.id === f.malighafi.id}
                onFocus={setFocus}
              />
            ))}
          </div>
          {items.length > 6 && (
            <div className="flex justify-center">
              <Btn variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Onyesha kidogo' : `Onyesha zote (${items.length})`}
              </Btn>
            </div>
          )}
        </>
      )}

      {focused && <FocusedForecast f={focused} onRequest={onRequest} />}
    </div>
  )
}

function FocusedForecast({ f, onRequest }) {
  const { data, loading } = useQuery(MALEZO_MALIGHAFI, { variables: { id: String(f.malighafi.id) } })
  const d = data?.maelezo_malighafi
  const ing = d?.malighafi
  const rate = Number(f.kiwango_cha_matumizi_kwa_siku) || 0
  const suggest = Math.ceil(rate * DAYS_OF_COVER * 10) / 10

  const chart = useMemo(() => {
    const days = d?.mwenendo || []
    if (!days.length) return []
    const last = days[days.length - 1].kiasi
    const out = days.map((s) => ({ label: s.tarehe.slice(5), actual: s.kiasi, forecast: null }))
    for (let i = 1; i <= DAYS_OF_COVER; i += 1) {
      out.push({ label: i === DAYS_OF_COVER ? 'T' : '', actual: null, forecast: Math.max(0, last - rate * i) })
    }
    return out
  }, [d, rate])

  return (
    <>
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <span className="cc-eyebrow">Mwenendo wa Hisa</span>
            <h2 className="font-serif text-base font-semibold mt-1">{f.malighafi.jina}</h2>
            <p className="text-[11px] text-espresso-muted mt-0.5">
              Inategemewa kuisha{' '}
              <span className="font-semibold text-espresso">{f.tarehe_kutabiriwa}</span>
            </p>
          </div>
          <StatusPill tone={stockLevel(f.malighafi).tone}>
            {f.siku_zilizobaki <= 2 ? 'HATARINI' : f.siku_zilizobaki <= 7 ? 'ANGALIA' : 'SALAMA'}
          </StatusPill>
        </div>

        {loading && (
          <div className="h-[180px] flex items-center justify-center">
            <div className="w-4 h-4 rounded-full border-2 border-copper border-t-transparent animate-spin" />
          </div>
        )}

        {!loading && (d?.mwenendo?.length || 0) > 1 ? (
          <>
            <div className="h-[180px]">
              <TrendChart data={chart} threshold={f.malighafi.kiwango_cha_chini} />
            </div>
            <p className="text-[10px] text-espresso-muted/70 mt-2">
              Mstari halisi unatokana na mabadiliko yaliyorekodiwa; sehemu ya kuvuka ni utabiri
              kwa kiwango cha {Number(rate).toFixed(2)} {f.malighafi.unit}/siku.
            </p>
          </>
        ) : (
          !loading && (
            <p className="text-[11px] text-espresso-muted bg-espresso/[0.03] rounded-xl px-3 py-2.5">
              Bado hakuna historia ya mabadiliko ya kuthibitisha. Utabiri hapa chini unatokana
              na kiwango cha matumizi pekee, si kwenye kila siku.
            </p>
          )
        )}
      </Card>

      <Card className="p-5 flex items-center gap-4 justify-between flex-wrap border-copper/25">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-[#FAEEDA] flex items-center justify-center shrink-0">
            <Bell weight="light" className="w-4 h-4 text-[#854F0B]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-espresso leading-snug">
              Agiza {suggest} {f.malighafi.unit} za {f.malighafi.jina} kabla ya {f.tarehe_kutabiriwa}
            </p>
            <p className="text-xs text-espresso-muted mt-0.5">
              Kwa siku {DAYS_OF_COVER} za matumizi. Tafuta bei, kisha omba kununua.
            </p>
          </div>
        </div>
        <Btn
          variant="accent"
          size="md"
          icon={ArrowRight}
          className="shrink-0"
          onClick={() =>
            onRequest(
              `Ninahitaji kununua ${suggest} ${f.malighafi.unit} za ${f.malighafi.jina}. ` +
                `Inaisha kwenye umbuko wa siku ${f.siku_zilizobaki}, na inatibika kwa siku ${DAYS_OF_COVER}.`
            )
          }
        >
          Omba Ununuzi
        </Btn>
      </Card>
    </>
  )
}

function ForecastCard({ f, onFocus, selected }) {
  const tone = f.siku_zilizobaki <= 2 ? 'danger' : f.siku_zilizobaki <= 7 ? 'watch' : 'safe'
  const label = f.siku_zilizobaki <= 2 ? 'HATARINI' : f.siku_zilizobaki <= 7 ? 'ANGALIA' : 'SALAMA'
  const color = f.siku_zilizobaki <= 2 ? '#A32D2D' : f.siku_zilizobaki <= 7 ? '#BA7517' : '#3B6D11'
  const rate = Number(f.kiwango_cha_matumizi_kwa_siku) || 0
  const trend = Array.from({ length: 14 }, (_, i) =>
    Math.max(0, f.malighafi.kiasi_kilichopo - rate * (i + 1))
  )

  return (
    <Card
      className={`p-5 cursor-pointer transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        selected ? 'ring-2 ring-copper/40' : 'hover:ring-copper/20'
      }`}
      inner={{ onClick: () => onFocus(f) }}
    >
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0">
          <p className="text-[13px] text-espresso-muted truncate">{f.malighafi.jina}</p>
          <p className="text-[10px] text-espresso-muted/60 mt-0.5">
            Sasa: {f.malighafi.kiasi_kilichopo} {f.malighafi.unit}
          </p>
        </div>
        <StatusPill tone={tone}>{label}</StatusPill>
      </div>
      <p className="cc-num text-3xl md:text-4xl leading-tight mt-2">
        ~{f.siku_zilizobaki}{' '}
        <span className="text-sm text-espresso-muted font-normal leading-[1.4]">siku</span>
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] text-espresso-muted">
          ~{rate.toFixed(1)} {f.malighafi.unit}/siku
        </span>
        <svg width="88" height="24" viewBox="0 0 88 24" aria-hidden="true" className="shrink-0">
          <polyline
            points={trend
              .map((v, i) => `${(i / (trend.length - 1)) * 88},${24 - 2 - (v / (Math.max(...trend, 1))) * 20}`)
              .join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------- usage */

function VerifyQueue({ queue, loading, refetch }) {
  const [verify] = useMutation(THIBITISHA_MATUMIZI, {
    refetchQueries: [{ query: MATUMIZI_KUSUBIRI }, { query: KUMBUKUMU_MATUMIZI }, { query: MALIGHAFI }],
  })
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState('')

  if (loading && !queue.length) return null

  const confirm = async (row) => {
    const val = draft[row.id] ?? row.kiasi
    if (val === '' || val === undefined || Number(val) < 0) {
      setMsg('Kiasi halisi lazima kiwe namba isiyo chini ya sifuri.')
      return
    }
    setBusy(row.id)
    setMsg('')
    try {
      await verify({ variables: { id: row.id, kiasi_halisi: Number(val) } })
      setMsg('Imethibitishwa. Hesa imepunguzwa.')
      setDraft((d) => {
        const next = { ...d }
        delete next[row.id]
        return next
      })
      refetch()
    } catch (e) {
      setMsg(e?.message || 'Imeshindwa. Jaribu tena.')
    } finally {
      setBusy(null)
    }
  }

  if (!queue.length) {
    return (
      <Card className="p-5 border-sage/25 bg-sage/[0.04]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-sage/15 flex items-center justify-center shrink-0">
            <Check weight="bold" className="w-4 h-4 text-sage-deep" />
          </div>
          <div>
            <p className="text-sm font-semibold text-sage-deep">Hakuna matumizi ya kusubiri</p>
            <p className="text-[11px] text-espresso-muted">Matumizi yote yame$thibitishwa. Hesa ziko sawa.</p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-5 border-copper/30">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h3 className="font-serif text-base font-semibold">Matumizi ya kusubiri ({queue.length})</h3>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-espresso-muted">
          Hakusaidii hesa bado
        </span>
      </div>
      <p className="text-[11px] text-espresso-muted mb-4">
        Mpishi aliandika makadirio. Weka kiasi halisi — stock hupunguzwa hapa, si pale.
      </p>

      <div className="flex flex-col gap-2.5">
        {queue.map((row) => {
          const ing = row.malighafi
          const estimate = row.kiasi
          const typed = draft[row.id]
          const actual = typed === undefined || typed === '' ? estimate : Number(typed)
          const changed = Math.abs(actual - estimate) > 1e-9
          const stockNow = Number(ing?.kiasi_kilichopo || 0)
          const after = stockNow - actual
          const negative = after < 0
          const context = row.mapishi_ladha
            ? `${row.mapishi_ladha} — ${row.mapishi_ukubwa || ''}`
            : row.agizo_ladha
              ? `${row.agizo_ladha} — ${row.agizo_ukubwa || ''}`
              : null

          return (
            <div key={row.id} className="rounded-2xl bg-espresso/[0.03] px-4 py-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-espresso">{ing?.jina}</p>
                  <p className="text-[11px] text-espresso-muted">
                    {row.mpishi?.jina || 'Mpishi'}
                    {context ? ` · ${context}` : ''}
                    {row.kumbukumbu ? ` · “${row.kumbukumbu}”` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] uppercase tracking-wider text-espresso-muted">Aliandika</p>
                  <p className="text-sm font-semibold text-espresso tabular-nums">
                    {estimate} {ing?.unit}
                  </p>
                </div>
              </div>

              <div className="flex items-end gap-2 mt-3 flex-wrap">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-espresso-muted mb-1">
                    Kiasi halisi
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={typed === undefined ? String(estimate) : typed}
                    onChange={(e) => setDraft((d) => ({ ...d, [row.id]: e.target.value }))}
                    className="w-24 rounded-xl bg-white ring-1 ring-espresso/10 px-3 py-2 text-sm text-espresso tabular-nums"
                  />
                </div>
                <div className="flex-1 min-w-[9rem] pb-2">
                  <p className="text-[11px] text-espresso-muted">
                    Hesa sasa <span className="font-semibold tabular-nums">{stockNow} {ing?.unit}</span>
                    {' → '}
                    <span className={`font-semibold tabular-nums ${negative ? 'text-red-500' : 'text-sage-deep'}`}>
                      {after} {ing?.unit}
                    </span>
                  </p>
                  {changed && (
                    <p className="text-[11px] text-copper font-medium">
                      Tofauti na makadirio: {actual - estimate > 0 ? '+' : ''}
                      {Math.round((actual - estimate) * 100) / 100} {ing?.unit}
                    </p>
                  )}
                </div>
                <Btn
                  variant={changed ? 'accent' : 'ghost'}
                  size="md"
                  icon={Check}
                  disabled={busy === row.id}
                  onClick={() => confirm(row)}
                >
                  {busy === row.id ? 'Inahifadhi...' : 'Thibitisha'}
                </Btn>
              </div>

              {negative && (
                <p className="text-[11px] text-red-500 mt-2 font-medium">
                  Hesabu hii itakuwa hasi — maana yake tuliishiwa kuliko tulivyodhani.
                </p>
              )}
            </div>
          )
        })}
      </div>

      {msg && <p className="text-xs font-medium text-center mt-3 text-sage-deep">{msg}</p>}
    </Card>
  )
}

function UsageTab({ queue, queueLoading, refetchQueue }) {
  const [range, setRange] = useState('7')
  const vars = useMemo(() => rangeVars(range), [range])
  const { data, loading } = useQuery(KUMBUKUMU_MATUMIZI, { variables: vars })
  const logs = data?.kumbukumbu_matumizi || []
  const pending = logs.filter((l) => l.hali === 'inakadiriwa').length

  return (
    <div className="flex flex-col gap-4">
      <VerifyQueue queue={queue} loading={queueLoading} refetch={refetchQueue} />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-serif text-base font-semibold">Matumizi</h3>
        <RangePicker value={range} onChange={setRange} />
      </div>

      <div className="flex flex-col gap-3 stagger">
        {loading && (
          <div className="flex justify-center py-10">
            <div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" />
          </div>
        )}
        {!loading && logs.length === 0 && (
          <p className="text-sm text-espresso-muted/60 text-center py-10">
            Hakuna matumizi kwa kipindi hiki.
          </p>
        )}
        {logs.map((l) => (
          <Card key={l.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium">{l.malighafi?.jina}</span>
                <span className="text-[11px] text-espresso-muted">
                  {l.mpishi?.jina || 'Mpishi'} · Agizo: {l.agizo?.ladha || '—'} ·{' '}
                  {new Date(l.tarehe).toLocaleString('sw')}
                </span>
              </div>
              <div className="text-right shrink-0">
                {l.hali === 'inakadiriwa' ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-copper">
                    Hakijathibitishwa
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-copper tabular-nums">
                    -{l.kiasi_halisi ?? l.kiasi} {l.malighafi?.unit}
                  </span>
                )}
                <p className="text-[11px] text-espresso-muted tabular-nums">
                  aliandika {l.kiasi} {l.malighafi?.unit}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {pending > 0 && !loading && (
        <p className="text-[11px] text-espresso-muted text-center">
          {pending} ya matumizi haya bado yanasubiri kuthibitishwa.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ adjust */

function AdjustTab() {
  const [range, setRange] = useState('30')
  const vars = useMemo(() => rangeVars(range), [range])
  const { data, loading } = useQuery(MAREKEBISHO_HISA, { variables: vars })
  const [mut] = useMutation(MAREKEBISHO_HISA_MUT, {
    refetchQueries: [{ query: MAREKEBISHO_HISA }, { query: MALIGHAFI }],
  })
  const [open, setOpen] = useState(null)
  const [pick, setPick] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState('')

  const { data: ingData } = useQuery(MALIGHAFI)
  const malighafi = ingData?.malighafi || []
  const items = data?.marekebisho_hisa || []

  const submit = async (e) => {
    e.preventDefault()
    if (!pick || !qty) return
    try {
      await mut({
        variables: {
          input: { malighafi_id: String(pick), aina: open, kiasi: Number(qty), sababu: reason || undefined },
        },
      })
      setMsg('Imefanyika.')
      setPick('')
      setQty('')
      setReason('')
      setTimeout(() => {
        setMsg('')
        setOpen(null)
      }, 1200)
    } catch {
      setMsg('Hitilafu imetokea')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-2">
          <Btn variant="accent" size="md" icon={PlusCircle} onClick={() => { setOpen('restock'); setMsg('') }}>
            Kujaza Upya
          </Btn>
          <Btn variant="ghost" size="md" icon={Trash} onClick={() => { setOpen('waste'); setMsg('') }}>
            Upotevu
          </Btn>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      <div className="flex flex-col gap-3 stagger">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" />
          </div>
        )}
        {!loading && items.length === 0 && (
          <p className="text-sm text-espresso-muted/60 text-center py-8">
            Hakuna marekebisho kwa kipindi hiki.
          </p>
        )}
        {items.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium">{r.malighafi?.jina}</span>
                <span className="text-[11px] text-espresso-muted">
                  {r.created_by?.jina || 'Mfanyakazi'} · {new Date(r.tarehe).toLocaleString('sw')}
                  {r.sababu && <span> · {r.sababu}</span>}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge color={r.aina === 'restock' ? 'sage' : 'danger'}>
                  {r.aina === 'restock' ? 'Kujaza Upya' : 'Upotevu'}
                </Badge>
                <span className={`text-xs font-semibold tabular-nums ${r.aina === 'restock' ? 'text-sage' : 'text-red-500'}`}>
                  {r.aina === 'restock' ? '+' : '-'}
                  {r.kiasi} {r.malighafi?.unit}
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open === 'restock' ? 'Kujaza Upya' : 'Log Upotevu'}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Select label="Malighafi" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">— Chagua —</option>
            {malighafi.map((i) => (
              <option key={i.id} value={i.id}>
                {i.jina} ({i.kiasi_kilichopo} {i.unit})
              </option>
            ))}
          </Select>
          <FieldSquare
            label={open === 'restock' ? 'Kiasi cha kujaza' : 'Kiasi kilichoharibika'}
            type="number"
            min="0.1"
            step="0.1"
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <FieldSquare label="Sababu (hiari)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {msg && (
            <p className={`text-xs font-medium text-center ${msg.includes('Hitilafu') ? 'text-red-500' : 'text-sage'}`}>
              {msg}
            </p>
          )}
          <Btn type="submit" variant={open === 'restock' ? 'accent' : 'danger'} size="lg" className="w-full">
            {open === 'restock' ? 'Ongeza Stoku' : 'Rekodi Upotevu'}
          </Btn>
        </form>
      </Modal>
    </div>
  )
}

/* -------------------------------------------------------------------- shell */

export default function Inventory() {
  const { user } = useAuth()
  const [tab, setTab] = useState('utabiri')
  const [openItem, setOpenItem] = useState(null)
  const [requestSeed, setRequestSeed] = useState(null)
  const [requestOpen, setRequestOpen] = useState(false)

  const { data: ingData } = useQuery(MALIGHAFI)
  const items = ingData?.malighafi || []

  // The verification queue is this role's main daily task, so it is fetched once
  // at the top of the screen and handed to the tab. The old code queried it with
  // skip:true to read a count for the badge, which meant the badge sat at zero
  // forever while the real queue rendered separately inside the Usage tab.
  const {
    data: queueData,
    loading: queueLoading,
    refetch: refetchQueue,
  } = useQuery(MATUMIZI_KUSUBIRI, { pollInterval: 30000 })

  const { data: ombiData } = useQuery(OMBI)
  const { data: staffData } = useQuery(WATUMISHI)

  const queue = queueData?.kumbukumbu_matumizi_kusubiri || []
  const pending = queue.length
  const low = items.filter(needsOrdering).length
  const myOpenRequests = (ombiData?.ombi || []).filter(
    (o) => o.hali === 'fungua' && String(o.kwenda_kwa?.id) === String(user?.id)
  ).length

  // The verification queue is this role's main daily task, so its count leads the
  // tab label instead of being hidden inside the tab.
  const badges = {
    utabiri: null,
    stock: low || null,
    usage: pending || null,
    adjust: null,
    ombi: myOpenRequests || null,
  }

  const jump = (key) => {
    if (key === 'out' || key === 'stock') setTab('stock')
    if (key === 'usage') setTab('usage')
    if (key === 'ombi') setTab('ombi')
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="hidden">
        Skrini ya utabiri wa hisa ikionyesha chati za mwenendo, hatari za kuisha kwa malighafi,
        na pendekezo la kuagiza upya
      </p>

      <SummaryBar
        items={items}
        pending={pending}
        myOpenRequests={myOpenRequests}
        onJump={jump}
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map((t) => {
          const n = badges[t.key]
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${
                tab === t.key ? 'bg-espresso text-cream' : 'bg-espresso/[0.04] text-espresso-muted hover:bg-espresso/[0.07]'
              }`}
            >
              <t.icon weight="light" className="w-3.5 h-3.5" />
              {t.label}
              {n ? (
                <span
                  className={`ml-0.5 rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums ${
                    tab === t.key ? 'bg-cream/20 text-cream' : 'bg-copper/15 text-copper'
                  }`}
                >
                  {n}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {tab === 'utabiri' && (
        <UtabiriTab
          onRequest={(text) => {
            setRequestSeed(text)
            setRequestOpen(true)
          }}
        />
      )}
      {tab === 'stock' && <StockTab items={items} onOpen={setOpenItem} />}
      {tab === 'usage' && (
        <UsageTab queue={queue} queueLoading={queueLoading} refetchQueue={refetchQueue} />
      )}
      {tab === 'adjust' && <AdjustTab />}
      {tab === 'ombi' && <OmbiTab me={user} staff={staffData?.staff} />}

      {openItem && <IngredientDetail item={openItem} onClose={() => setOpenItem(null)} />}

      <RequestSheet
        open={requestOpen}
        onClose={() => {
          setRequestOpen(false)
          setRequestSeed(null)
        }}
        staff={staffData?.staff}
        meId={user?.id}
        preset={requestSeed}
      />
    </div>
  )
}
