import { useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { useAuth } from '../auth'
import { MALIGHAFI, KUMBUKUMBU_MATUMIZI, KUMBUKUMU_MATUMIZI, MAREKEBISHO_HISA, UTABIRI_HISA, MATUMIZI_KUSUBIRI } from '../graphql/queries'
import { MAREKEBISHO_HISA_MUT, ONGEZA_MALIGHAFI, HARIRI_MALIGHAFI, THIBITISHA_MATUMIZI } from '../graphql/mutations'
import { Card, CardFull } from '../ui/Card'
import { Btn } from '../ui/Btn'
import { Badge } from '../ui/Badge'
import { Field, FieldSquare } from '../ui/Field'
import { Select } from '../ui/Select'
import { Modal } from '../ui/Modal'
import { StatusPill, TrendChart } from '../ui/charts'
import { Package, PlusCircle, Trash, ArrowUpRight, Clipboard, TrendUp, Bell, Flag, PencilSimple, Check } from '@phosphor-icons/react'

const TABS = [
  { key: 'utabiri', label: 'Utabiri', icon: TrendUp },
  { key: 'stock', label: 'Hisa', icon: Package },
  { key: 'usage', label: 'Matumizi ya Mpishi', icon: Clipboard },
  { key: 'adjust', label: 'Marekebisho', icon: ArrowUpRight },
]

const LEVEL_META = {
  imeisha: { tone: 'danger', label: 'IMEISHA' },
  muhimu: { tone: 'danger', label: 'HATARINI' },
  mpotevu: { tone: 'watch', label: 'ANGALIA' },
}

const SPARK_COLORS = {
  imeisha: '#A32D2D',
  muhimu: '#A32D2D',
  mpotevu: '#BA7517',
  salama: '#3B6D11',
}

function range(end) {
  return Array.from({ length: end }, (_, i) => i)
}

function ForecastCard({ f, onFocus, selected }) {
  const tone = f.siku_zilizobaki <= 2 ? 'danger' : f.siku_zilizobaki <= 7 ? 'watch' : 'safe'
  const label = f.siku_zilizobaki <= 2 ? 'HATARINI' : f.siku_zilizobaki <= 7 ? 'ANGALIA' : 'SALAMA'
  const color = SPARK_COLORS[f.siku_zilizobaki <= 2 ? 'muhimu' : f.siku_zilizobaki <= 7 ? 'mpotevu' : 'salama']
  const trend = [...range(14)].map((i) =>
    Math.max(0, f.malighafi.kiasi_kilichopo - f.kiwango_cha_matumizi_kwa_siku * (i + 1))
  )

  return (
    <Card
      className={`p-5 cursor-pointer transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${selected ? 'ring-2 ring-copper/40' : 'hover:ring-copper/20'}`}
      inner={{ onClick: () => onFocus(f) }}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-[13px] text-espresso-muted">{f.malighafi.jina}</p>
          <p className="text-[10px] text-espresso-muted/60 mt-0.5">Sasa: {f.malighafi.kiasi_kilichopo} {f.malighafi.unit}</p>
        </div>
        <StatusPill tone={tone}>{label}</StatusPill>
      </div>
      <p className="cc-num text-3xl md:text-4xl leading-tight mt-2">
        ~{f.siku_zilizobaki} <span className="text-sm text-espresso-muted font-normal leading-[1.4]">siku</span>
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-espresso-muted">
          ~{Number(f.kiwango_cha_matumizi_kwa_siku).toFixed(1)} {f.malighafi.unit}/siku
        </span>
        <svg width="88" height="24" viewBox="0 0 88 24" aria-hidden="true">
          <polyline
            points={trend.map((v, i) => `${(i / (trend.length - 1)) * 88},${24 - 2 - (v / (Math.max(...trend, 1))) * 20}`).join(' ')}
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

function UtabiriTab() {
  const { data, loading } = useQuery(UTABIRI_HISA, { variables: { kiasi_chini_ya_siku: 30 } })
  const [focus, setFocus] = useState(null)
  const items = data?.utabiri_hisa || []
  const focused = focus || items[0] || null

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" /></div>

  return (
    <div className="flex flex-col gap-5">
      {/* Featured forecast cards */}
      {items.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-espresso-muted/70 text-center py-8">
            Hakuna malighafi itakayoisha ndani ya siku 30 — hisa zako zipo salama.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 stagger">
          {items.slice(0, 3).map((f) => (
            <ForecastCard key={f.malighafi.id} f={f} onFocus={setFocus} selected={focused?.malighafi?.id === f.malighafi.id} />
          ))}
        </div>
      )}

      {/* Focused ingredient trend chart */}
      {focused && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="cc-eyebrow">Mwenendo wa Hisa</span>
              <h2 className="font-serif text-base font-semibold mt-1">{focused.malighafi.jina}</h2>
              <p className="text-[11px] text-espresso-muted mt-0.5">
                Inategemewa kuisha <span className="font-semibold text-espresso">{focused.tarehe_kutabiriwa}</span>
              </p>
            </div>
            <StatusPill tone={LEVEL_META[focused.hali]?.tone || 'watch'}>
              {LEVEL_META[focused.hali]?.label || 'ANGALIA'}
            </StatusPill>
          </div>
          <div className="h-[180px]">
            <TrendChart
              data={[
                ...range(14).map((i) => ({
                  label: '',
                  actual: Math.round(focused.malighafi.kiasi_kilichopo + focused.kiwango_cha_matumizi_kwa_siku * (13 - i)),
                  forecast: null,
                })),
                ...range(7).map((i) => {
                  const v = focused.malighafi.kiasi_kilichopo - focused.kiwango_cha_matumizi_kwa_siku * (i + 1)
                  return {
                    label: i === 6 ? 'T' : '',
                    actual: null,
                    forecast: v > 0 ? Math.round(v) : 0,
                  }
                }),
              ]}
              threshold={focused.malighafi.kiwango_cha_chini}
            />
          </div>
        </Card>
      )}

      {/* Restock alert CTA */}
      {focused && (
        <Card className="p-5 flex items-center gap-4 justify-between flex-wrap border-copper/25">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-[#FAEEDA] flex items-center justify-center shrink-0">
              <Bell weight="light" className="w-4 h-4 text-[#854F0B]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-espresso leading-snug">
                Agiza {Math.ceil(focused.kiwango_cha_matumizi_kwa_siku * 10)} {focused.malighafi.unit} za {focused.malighafi.jina} kabla ya {focused.tarehe_kutabiriwa}
              </p>
              <p className="text-xs text-espresso-muted mt-0.5">Ili kuepuka upungufu wakati wa maagizo ya wiki hii</p>
            </div>
          </div>
          <Btn variant="accent" size="md" icon={Flag} className="shrink-0">Weka Kikumbusho</Btn>
        </Card>
      )}
    </div>
  )
}

function StockTab() {
  const { data, loading } = useQuery(MALIGHAFI)
  const { user } = useAuth()
  const canManage = ['owner', 'inventory'].includes(user?.jukumu)
  const [addOpen, setAddOpen] = useState(false)
  const items = data?.malighafi || []

  const level = (i) => {
    if (i.kiasi_kilichopo <= 0) return { tone: 'danger', label: 'IMEISHA' }
    if (i.kiasi_kilichopo <= i.kiwango_cha_chini * 1.3) return { tone: 'danger', label: 'HATARINI' }
    if (i.kiasi_kilichopo <= i.kiwango_cha_chini * 2) return { tone: 'watch', label: 'ANGALIA' }
    return { tone: 'safe', label: 'SALAMA' }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" /></div>

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div className="flex justify-end">
          <Btn variant="accent" size="md" icon={PlusCircle} onClick={() => setAddOpen(true)}>
            Ongeza Malighafi
          </Btn>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 stagger">
        {items.map((i) => {
          const lv = level(i)
          const maxQty = Math.max(i.kiasi_kilichopo, i.kiwango_cha_chini, 1)
          const pct = Math.min(100, (i.kiasi_kilichopo / maxQty) * 100)
          return (
            <Card key={i.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-semibold truncate">{i.jina}</p>
                  {canManage && <EditMalighafiBtn item={i} />}
                </div>
                <StatusPill tone={lv.tone}>{lv.label}</StatusPill>
              </div>
              <div className="flex items-end justify-between gap-4">
                <p className="cc-num text-2xl font-semibold">
                  {i.kiasi_kilichopo}
                  <span className="text-sm text-espresso-muted font-normal ml-1">{i.unit}</span>
                </p>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-espresso/[0.06] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${lv.tone === 'danger' ? 'bg-red-400' : lv.tone === 'watch' ? 'bg-copper' : 'bg-sage'}`}
                  style={{ width: `${Math.max(6, pct)}%` }}
                />
              </div>
            </Card>
          )
        })}
        {items.length === 0 && (
          <Card className="p-6 md:col-span-2">
            <p className="text-sm text-espresso-muted/70 text-center py-8">
              Hakuna malighafi bado. {canManage && 'Bonyeza "Ongeza Malighafi" kuanza kuweka hisa.'}
            </p>
          </Card>
        )}
      </div>
      {canManage && <AddMalighafiModal open={addOpen} onClose={() => setAddOpen(false)} />}
    </div>
  )
}

function EditMalighafiBtn({ item }) {
  const [open, setOpen] = useState(false)
  const [mut] = useMutation(HARIRI_MALIGHAFI, { refetchQueries: [{ query: MALIGHAFI }] })
  const [form, setForm] = useState({ jina: item.jina, kiasi: item.kiasi_kilichopo, chini: item.kiwango_cha_chini, unit: item.unit })
  const [busy, setBusy] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mut({ variables: { id: String(item.id), input: { jina: form.jina, kiasi_kilichopo: Number(form.kiasi), kiwango_cha_chini: Number(form.chini), unit: form.unit } } })
      setOpen(false)
    } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center justify-center w-6 h-6 rounded-full text-espresso-muted hover:bg-espresso/[0.05] hover:text-copper transition-colors" aria-label={`Hariri ${item.jina}`}>
        <PencilSimple weight="light" className="w-3.5 h-3.5" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Hariri ${item.jina}`}>
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label="Jina" required value={form.jina} onChange={(e) => setForm((f) => ({ ...f, jina: e.target.value }))} />
          <div className="grid grid-cols-3 gap-3">
            <FieldSquare label="Sasa" type="number" step="0.1" required value={form.kiasi} onChange={(e) => setForm((f) => ({ ...f, kiasi: e.target.value }))} />
            <FieldSquare label="Chini" type="number" step="0.1" required value={form.chini} onChange={(e) => setForm((f) => ({ ...f, chini: e.target.value }))} />
            <FieldSquare label="Unit" required value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
          </div>
          <Btn type="submit" variant="accent" size="lg" icon={Check} disabled={busy} className="w-full">Hifadhi</Btn>
        </form>
      </Modal>
    </>
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
        variables: { input: { jina: form.jina, kiasi_kilichopo: Number(form.kiasi) || 0, kiwango_cha_chini: Number(form.chini) || 0, unit: form.unit } },
      })
      setForm({ jina: '', kiasi: '', chini: '', unit: 'kg' })
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Ongeza Malighafi">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Jina la malighafi" required value={form.jina} onChange={(e) => setForm((f) => ({ ...f, jina: e.target.value }))} placeholder="Unga, Sukari..." />
        <div className="grid grid-cols-3 gap-3">
          <FieldSquare label="Kiasi sasa" type="number" step="0.1" value={form.kiasi} onChange={(e) => setForm((f) => ({ ...f, kiasi: e.target.value }))} placeholder="0" />
          <FieldSquare label="Kiwango chini" type="number" step="0.1" value={form.chini} onChange={(e) => setForm((f) => ({ ...f, chini: e.target.value }))} placeholder="0" />
          <FieldSquare label="Unit" required value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
        </div>
        <Btn type="submit" variant="accent" size="lg" icon={Check} disabled={busy} className="w-full">Ongeza</Btn>
      </form>
    </Modal>
  )
}

function VerifyQueue() {
  const { user } = useAuth()
  const canVerify = ['owner', 'inventory'].includes(user?.jukumu)
  const { data, loading, refetch } = useQuery(MATUMIZI_KUSUBIRI, {
    skip: !canVerify,
    pollInterval: 30000,
  })
  const [verify] = useMutation(THIBITISHA_MATUMIZI, {
    refetchQueries: [{ query: MATUMIZI_KUSUBIRI }, { query: KUMBUKUMU_MATUMIZI }, { query: MALIGHAFI }],
  })
  // { [id]: kiasi halisi }. Seeded from the chef's estimate so accepting a
  // number is one tap; typing a different one is the same number of taps.
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState('')

  const queue = data?.kumbukumbu_matumizi_kusubiri || []
  if (!canVerify || (loading && !queue.length)) return null

  const confirm = async (row) => {
    const val = draft[row.id] ?? row.kiasi
    if (val === '' || val === undefined || Number(val) < 0) {
      setMsg('Kiasi halisi lazima kiwe namba isiyo chini ya sifuri.');
      return
    }
    setBusy(row.id)
    setMsg('')
    try {
      await verify({ variables: { id: row.id, kiasi_halisi: Number(val) } })
      setMsg('Imethibitishwa. Hesa imepunguzwa.')
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
        <h3 className="font-serif text-base font-semibold">
          Matumizi ya kusubiri ({queue.length})
        </h3>
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
                      Tofauti na makadirio: {actual - estimate > 0 ? '+' : ''}{Math.round((actual - estimate) * 100) / 100} {ing?.unit}
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

function UsageTab() {
  const { data, loading } = useQuery(KUMBUKUMU_MATUMIZI)
  const logs = data?.kumbukumbu_matumizi || []

  return (
    <div className="flex flex-col gap-4">
      <VerifyQueue />
      <div className="flex flex-col gap-3 stagger">
        {loading && <div className="flex justify-center py-12"><div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" /></div>}
        {!loading && logs.length === 0 && <p className="text-sm text-espresso-muted/60 text-center py-12">Hakuna matumizi bado</p>}
        {logs.map((l) => (
          <Card key={l.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{l.malighafi?.jina}</span>
                <span className="text-[11px] text-espresso-muted">
                  {l.mpishi?.jina || 'Mpishi'} · Agizo: {l.agizo?.ladha || '—'} · {new Date(l.tarehe).toLocaleString('sw')}
                </span>
              </div>
              {/* A logged row is an estimate. Showing it as "-3 kg" next to a
                  pending row implied stock already moved, so say which it is. */}
              <div className="text-right">
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
    </div>
  )
}

function AdjustTab() {
  const { data, loading, refetch } = useQuery(MAREKEBISHO_HISA)
  const [mut] = useMutation(MAREKEBISHO_HISA_MUT, { refetchQueries: [{ query: MAREKEBISHO_HISA }, { query: MALIGHAFI }] })
  const [open, setOpen] = useState(null) // null | 'restock' | 'waste'
  const [pick, setPick] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState('')

  const items = data?.marekebisho_hisa || []

  const submit = async (e) => {
    e.preventDefault()
    if (!pick || !qty) return
    try {
      await mut({ variables: { input: { malighafi_id: String(pick), aina: open, kiasi: Number(qty), sababu: reason || undefined } } })
      setMsg('Imefanyika.')
      setPick(''); setQty(''); setReason('')
      setTimeout(() => { setMsg(''); setOpen(null) }, 1200)
    } catch { setMsg('Hitilafu imetokea') }
  }

  const malighafi = useQuery(MALIGHAFI).data?.malighafi || []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2">
        <Btn variant="accent" size="md" icon={PlusCircle} onClick={() => { setOpen('restock'); setMsg('') }}>
          Kujaza Upya
        </Btn>
        <Btn variant="ghost" size="md" icon={Trash} onClick={() => { setOpen('waste'); setMsg('') }}>
          Upotevu
        </Btn>
      </div>

      <div className="flex flex-col gap-3 stagger">
        {loading && <div className="flex justify-center py-8"><div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" /></div>}
        {!loading && items.length === 0 && <p className="text-sm text-espresso-muted/60 text-center py-8">Hakuna marekebisho bado</p>}
        {items.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{r.malighafi?.jina}</span>
                <span className="text-[11px] text-espresso-muted">
                  {r.created_by?.jina || 'Mfanyakazi'} · {new Date(r.tarehe).toLocaleString('sw')}
                  {r.sababu && <span> · {r.sababu}</span>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={r.aina === 'restock' ? 'sage' : 'danger'}>
                  {r.aina === 'restock' ? 'Kujaza Upya' : 'Upotevu'}
                </Badge>
                <span className={`text-xs font-semibold tabular-nums ${r.aina === 'restock' ? 'text-sage' : 'text-red-500'}`}>
                  {r.aina === 'restock' ? '+' : '-'}{r.kiasi} {r.malighafi?.unit}
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
              <option key={i.id} value={i.id}>{i.jina} ({i.kiasi_kilichopo} {i.unit})</option>
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
          {msg && <p className={`text-xs font-medium text-center ${msg.includes('Hitilafu') ? 'text-red-500' : 'text-sage'}`}>{msg}</p>}
          <Btn type="submit" variant={open === 'restock' ? 'accent' : 'danger'} size="lg" className="w-full">
            {open === 'restock' ? 'Ongeza Stoku' : 'Rekodi Upotevu'}
          </Btn>
        </form>
      </Modal>
    </div>
  )
}

export default function Inventory() {
  const [tab, setTab] = useState('utabiri')

  return (
    <div className="flex flex-col gap-6">
      <p className="hidden">Skrini ya utabiri wa hisa ikionyesha chati za mwenendo, hatari za kuisha kwa malighafi, na pendekezo la kuagiza upya</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${
              tab === t.key
                ? 'bg-espresso text-cream'
                : 'bg-espresso/[0.04] text-espresso-muted hover:bg-espresso/[0.07]'
            }`}
          >
            <t.icon weight="light" className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'utabiri' && <UtabiriTab />}
      {tab === 'stock' && <StockTab />}
      {tab === 'usage' && <UsageTab />}
      {tab === 'adjust' && <AdjustTab />}
    </div>
  )
}