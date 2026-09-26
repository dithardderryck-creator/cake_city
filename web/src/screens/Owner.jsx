import { useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { useAuth } from '../auth'
import { RIPORT_DASHBOARD, STAFF, BIDHAA, UTABIRI_HISA, UKUMBUSHO, KUMBUKUMBU_KITENDO } from '../graphql/queries'
import { BATHI_BIDHAA, HARIRI_BIDHAA, FUTA_BIDHAA, ONGEZA_MFANYAKAZI, HARIRI_MFANYAKAZI, FUTA_MFANYAKAZI, FUTA_AGIZO } from '../graphql/mutations'
import { Card, CardFull } from '../ui/Card'
import { Btn } from '../ui/Btn'
import { Badge } from '../ui/Badge'
import { Modal } from '../ui/Modal'
import { FieldSquare } from '../ui/Field'
import { Select } from '../ui/Select'
import { Sparkline, TrendChart, StatusPill } from '../ui/charts'
import CollectBalanceModal from '../ui/CollectBalanceModal'
import { ChartLineUp, Wallet, Package, ChefHat, UserPlus, Plus, XCircle, Bell, Hourglass, Pencil, Trash, Scroll } from '@phosphor-icons/react'

const PAYMENT_LABELS = { cash: 'Taslimu', mpesa: 'M-Pesa', tigopesa: 'Tigo Pesa', airtel_money: 'Airtel Money' }
const PAYMENT_COLORS = { cash: '#6B5E4F', mpesa: '#C47F3D', tigopesa: '#8A9A7B', airtel_money: '#D4A59A' }

function fmtTSh(v) {
  return `TSh ${Number(v).toLocaleString()}`
}

function useDash() {
  const { data, loading, refetch } = useQuery(RIPORT_DASHBOARD)
  return { data: data?.riport_dashboard || null, loading, refetch }
}

function SplitStat({ icon: Icon, label, value, sub, spark, sparkColor = '#C47F3D' }) {
  return (
    <Card className="flex flex-col gap-3 p-5 md:p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-espresso-muted">
          <Icon weight="light" className="w-4 h-4 text-copper" />
          <span className="cc-eyebrow">{label}</span>
        </div>
        {spark && <Sparkline values={spark} color={sparkColor} />}
      </div>
      <p className="cc-num text-2xl md:text-[1.7rem] leading-tight">{value}</p>
      {sub && <p className="text-xs text-espresso-muted/80 mt-auto">{sub}</p>}
    </Card>
  )
}

function OverviewTab() {
  const { data, loading, refetch } = useDash()
  const { data: forecastData } = useQuery(UTABIRI_HISA, { variables: { kiasi_chini_ya_siku: 14 } })
  const { data: remindData } = useQuery(UKUMBUSHO)
  const [futaAgizo] = useMutation(FUTA_AGIZO, { refetchQueries: [{ query: RIPORT_DASHBOARD }] })
  const [paying, setPaying] = useState(null)

  if (loading) return <div className="flex justify-center py-20"><div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" /></div>
  if (!data) return null

  const week = (data.mauzo_7_siku || []).map((d) => ({
    label: new Date(d.tarehe).toLocaleDateString('sw', { day: 'numeric', month: 'numeric' }),
    actual: d.jumla,
    forecast: null,
  }))
  const forecasts = forecastData?.utabiri_hisa || []
  const reminders = remindData?.ukumbusho || []
  const lowStock = data.hisa_chini || []

  return (
    <div className="flex flex-col gap-5">
      {/* ── Hero row: sales total + 7-day chart ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">
        <CardFull className="flex flex-col justify-between gap-6 p-6 md:p-7">
          <div>
            <div className="flex items-center gap-2 text-espresso-muted mb-2">
              <ChartLineUp weight="light" className="w-4 h-4 text-copper" />
              <span className="cc-eyebrow">Mauzo ya Leo</span>
            </div>
            <p className="cc-num text-4xl md:text-5xl leading-none">{fmtTSh(data.mauzo_ya_leo_total)}</p>
            <p className="text-xs text-espresso-muted mt-2">
              {(data.mauzo_ya_leo || []).length} risiti leo
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(data.mauzo_kwa_njia || []).map((s) => (
              <span
                key={s.njia}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ background: 'var(--color-copper-soft)', color: PAYMENT_COLORS[s.njia] }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: PAYMENT_COLORS[s.njia] }} />
                {PAYMENT_LABELS[s.njia]}: {fmtTSh(s.jumla)}
              </span>
            ))}
          </div>
        </CardFull>

        <CardFull className="p-6 md:p-7">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="cc-eyebrow">Siku 7 za Mwisho</span>
              <h2 className="font-serif text-lg font-semibold mt-1">Mwenendo wa Mauzo</h2>
            </div>
            <div className="hidden md:flex items-center gap-1.5 text-[10px] text-espresso-muted">
              <span className="w-4 h-0.5 rounded bg-copper" />
              Mauzo ya kila siku
            </div>
          </div>
          <div className="h-[210px]">
            <TrendChart data={week} />
          </div>
        </CardFull>
      </div>

      {/* ── Secondary stats ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger">
        <SplitStat icon={Wallet} label="Salio Inayodaiwa" value={fmtTSh(data.salio_jumla_ajira)} sub={`${(data.maagizo_ambayo_hajakusanywa || []).length} maagizo hayajakusanywa`} />
        <SplitStat icon={ChefHat} label="Jikoni Sasa" value={data.shughuli_za_jikoni?.length || 0} sub="maagizo ya kikazi" />
        <SplitStat
          icon={Package}
          label="Hisa Chini"
          value={lowStock.length}
          sub="malighafi zinahitaji kujazwa"
          spark={lowStock.slice(0, 6).map((i) => i.kiasi_kilichopo)}
          sparkColor="#A32D2D"
        />
        <SplitStat icon={ChartLineUp} label="Mauzo Leo" value={data.mauzo_ya_leo?.length || 0} sub="risiti zinazotolewa" />
      </div>

      {/* ── Stock forecast strip ────────────────────────────────── */}
      {forecasts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-serif text-base font-semibold">Utabiri wa Hisa</h3>
            <span className="cc-eyebrow">Malighafi zinazokaribia kuisha</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 stagger">
            {forecasts.slice(0, 3).map((f) => (
              <Card key={f.malighafi.id} className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-[13px] text-espresso-muted">{f.malighafi.jina}</p>
                  <StatusPill tone={f.siku_zilizobaki <= 2 ? 'danger' : 'watch'}>
                    {f.siku_zilizobaki <= 2 ? 'Hatari' : 'Angalia'}
                  </StatusPill>
                </div>
                <p className="cc-num text-3xl leading-tight">
                  ~{f.siku_zilizobaki} <span className="text-sm text-espresso-muted font-normal">siku</span>
                </p>
                <div className="mt-2 flex items-end justify-between">
                  <span className="text-[11px] text-espresso-muted">
                    {f.malighafi.kiasi_kilichopo} {f.malighafi.unit} iliyopo · ~{Number(f.kiwango_cha_matumizi_kwa_siku).toFixed(1)}/siku
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── Alerts + Outstanding ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <h3 className="font-serif text-base font-semibold mb-3 flex items-center gap-2">
            <Bell weight="light" className="w-4 h-4 text-copper" /> Ukumbusho
          </h3>
          <div className="flex flex-col gap-2.5">
            {reminders.length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-espresso-muted/70 text-center py-4">Hakuna ukumbusho sasa</p>
              </Card>
            )}
            {reminders.slice(0, 4).map((r) => (
              <Card key={r.id} className="p-4 flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-copper/[0.08] flex items-center justify-center shrink-0 mt-0.5">
                  <Hourglass weight="light" className="w-3.5 h-3.5 text-copper" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-relaxed text-espresso">{r.ujumbe}</p>
                  <p className="text-[10px] uppercase tracking-wider text-espresso-muted mt-1">lengo: {r.lengo}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-serif text-base font-semibold mb-3">Salio Inayosubiri</h3>
          <div className="flex flex-col gap-2.5">
            {(data.maagizo_ambayo_hajakusanywa || []).length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-espresso-muted/70 text-center py-4">Hakuna salio za kudaiwa</p>
              </Card>
            )}
            {(data.maagizo_ambayo_hajakusanywa || []).slice(0, 8).map((o) => (
              <Card key={o.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{o.ladha} <span className="text-espresso-muted font-normal">({o.ukubwa || '—'})</span></p>
                  <p className="text-[11px] text-espresso-muted truncate">{o.mteja?.jina || 'Mteja'} · {o.tarehe_ya_kuchukua}</p>
                  {o.hali === 'collected' && (
                    <p className="text-[10px] text-copper font-medium mt-0.5">Amechukuliwa — bado hazjalipwa</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="cc-num text-base text-copper">{fmtTSh(o.salio)}</span>
                  <Btn variant="primary" size="sm" icon={Wallet} onClick={() => setPaying(o)}>
                    Lipa
                  </Btn>
                  <Btn variant="ghost" size="sm" icon={XCircle} onClick={() => futaAgizo({ variables: { id: o.id } })} title="Futa">
                    Futa
                  </Btn>
                </div>
              </Card>
            ))}
            {(data.maagizo_ambayo_hajakusanywa || []).length > 8 && (
              <p className="text-[11px] text-espresso-muted/60 text-center pt-1">
                Na {(data.maagizo_ambayo_hajakusanywa || []).length - 8} zaidi hazionekani hapa
              </p>
            )}
          </div>

          <CollectBalanceModal
            key={paying?.id || 'none'}
            order={paying}
            onClose={() => setPaying(null)}
            onDone={refetch}
            refetchQueries={[{ query: RIPORT_DASHBOARD }]}
          />
        </div>
      </div>
    </div>
  )
}

function ProductsTab() {
  const { data, loading } = useQuery(BIDHAA)
  const [bathi] = useMutation(BATHI_BIDHAA, { refetchQueries: [{ query: BIDHAA }] })
  const [hariri] = useMutation(HARIRI_BIDHAA, { refetchQueries: [{ query: BIDHAA }] })
  const [futa] = useMutation(FUTA_BIDHAA, { refetchQueries: [{ query: BIDHAA }] })
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null) // product being edited, else null
  const [form, setForm] = useState({ jina: '', bei: '', aina: '' })

  const openAdd = () => { setEditing(null); setForm({ jina: '', bei: '', aina: '' }); setOpen(true) }
  const openEdit = (p) => { setEditing(p); setForm({ jina: p.jina, bei: String(p.bei), aina: p.aina || '' }); setOpen(true) }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.jina || !form.bei) return
    const input = { jina: form.jina, bei: Number(form.bei), aina: form.aina || undefined }
    if (editing) {
      await hariri({ variables: { id: String(editing.id), input } })
    } else {
      await bathi({ variables: { input } })
    }
    setForm({ jina: '', bei: '', aina: '' })
    setOpen(false)
  }

  const groups = (data?.bidhaa || []).reduce((acc, p) => {
    const k = p.aina || 'Bidhaa'
    if (!acc[k]) acc[k] = []
    acc[k].push(p)
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Btn variant="accent" size="md" icon={Plus} onClick={openAdd}>Bidhaa Mpya</Btn>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger">
        {(data?.bidhaa || []).map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <Badge color="neutral" className="self-start">{p.aina || 'Bidhaa'}</Badge>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(p)}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-espresso-muted hover:bg-espresso/[0.05] hover:text-espresso transition-all duration-300 active:scale-90"
                    aria-label="Hariri"
                  >
                    <Pencil weight="light" className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => futa({ variables: { id: String(p.id) } })}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-espresso-muted/50 hover:bg-red-50 hover:text-red-500 transition-all duration-300 active:scale-90"
                    aria-label="Futa"
                  >
                    <Trash weight="light" className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">{p.jina}</p>
                <p className="cc-num text-lg text-copper mt-1.5">{fmtTSh(p.bei)}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Hariri Bidhaa' : 'Bidhaa Mpya'}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldSquare label="Jina" required value={form.jina} onChange={(e) => setForm((f) => ({ ...f, jina: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <FieldSquare label="Bei (TSh)" type="number" min="0" required value={form.bei} onChange={(e) => setForm((f) => ({ ...f, bei: e.target.value }))} />
            <FieldSquare label="Aina" value={form.aina} onChange={(e) => setForm((f) => ({ ...f, aina: e.target.value }))} placeholder="Cake" />
          </div>
          <Btn type="submit" variant="accent" size="lg" className="w-full">Hifadhi</Btn>
        </form>
      </Modal>
    </div>
  )
}

function StaffTab() {
  const { user: me } = useAuth()
  const { data, loading } = useQuery(STAFF)
  const [ongeza] = useMutation(ONGEZA_MFANYAKAZI, { refetchQueries: [{ query: STAFF }] })
  const [hariri] = useMutation(HARIRI_MFANYAKAZI, { refetchQueries: [{ query: STAFF }] })
  const [futa] = useMutation(FUTA_MFANYAKAZI, { refetchQueries: [{ query: STAFF }] })
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null) // staff being edited, else null
  const [form, setForm] = useState({ jina: '', jukumu: 'cashier', pin: '' })
  const [msg, setMsg] = useState('')

  const ROLE_LABELS = { owner: 'Mmiliki', cashier: 'Kaunta', chef: 'Mpishi', inventory: 'Hisa' }
  const ROLE_DESC = {
    owner: 'Ufikiaji kamili wa muhtasari',
    cashier: 'Mauzo na maagizo',
    chef: 'Foleo ya jikoni',
    inventory: 'Hisa na utabiri',
  }

  const staffList = (data?.staff || []).map((s) => ({ ...s, active: s.active !== false }))
  const activeOwners = staffList.filter((s) => s.jukumu === 'owner' && s.active).length
  const isLastOwner = (s) => s.jukumu === 'owner' && s.active && activeOwners <= 1

  const openAdd = () => { setEditing(null); setForm({ jina: '', jukumu: 'cashier', pin: '' }); setMsg(''); setOpen(true) }
  const openEdit = (s) => { setEditing(s); setForm({ jina: s.jina, jukumu: s.jukumu, pin: '' }); setMsg(''); setOpen(true) }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.jina) { setMsg('Jina lahitajika'); return }
    if (!editing && form.pin.length < 4) { setMsg('PIN lazima iwe tarakimu 4 zaidi'); return }
    setMsg('')
    try {
      if (editing) {
        const input = { jina: form.jina, jukumu: form.jukumu }
        if (form.pin) input.pin = form.pin
        await hariri({ variables: { id: String(editing.id), input } })
      } else {
        await ongeza({ variables: { jina: form.jina, jukumu: form.jukumu, pin: form.pin } })
      }
      setMsg('Imefanyika.')
      setForm({ jina: '', jukumu: 'cashier', pin: '' })
      setTimeout(() => { setMsg(''); setOpen(false) }, 1000)
    } catch (err) {
      setMsg(err?.message?.includes('PIN') ? 'PIN lazima iwe tarakimu 4 zaidi' : 'Hitilafu imetokea')
    }
  }

  const remove = async (s) => {
    if (!confirm(`Una uhakika unamtaka aondoke ${s.jina}?`)) return
    try {
      await futa({ variables: { id: String(s.id) } })
    } catch (err) {
      setMsg(err?.message?.includes('mwisho') || err?.message?.includes('mwenyewe') ? err.message : 'Hitilafu imetokea')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Btn variant="accent" size="md" icon={UserPlus} onClick={openAdd}>Mfanyakazi Mpya</Btn>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 stagger">
        {staffList.map((s) => (
          <Card key={s.id} className={`p-5 ${!s.active ? 'opacity-50' : ''}`}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Badge color={s.jukumu === 'owner' ? 'copper' : 'neutral'}>{ROLE_LABELS[s.jukumu]}</Badge>
                  {!s.active && <Badge color="danger">Wamefutwa</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  {String(s.id) === String(me?.id) ? (
                    <span title="Wewe ndiye" className="text-[9px] font-semibold uppercase tracking-wider text-espresso-muted/40 px-2">Wewe</span>
                  ) : (
                    <>
                      <button
                        onClick={() => openEdit(s)}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-espresso-muted hover:bg-espresso/[0.05] hover:text-espresso transition-all duration-300 active:scale-90"
                        aria-label="Hariri"
                      >
                        <Pencil weight="light" className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => remove(s)}
                        disabled={isLastOwner(s) || !s.active}
                        title={isLastOwner(s) ? 'Huwezi kumfuta mmiliki wa mwisho' : 'Futa'}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-espresso-muted/50 hover:bg-red-50 hover:text-red-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-espresso-muted/50 transition-all duration-300 active:scale-90"
                        aria-label="Futa"
                      >
                        <Trash weight="light" className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div>
                <p className="font-serif text-lg font-semibold leading-tight">{s.jina}</p>
                <p className="text-[11px] text-espresso-muted mt-1">{ROLE_DESC[s.jukumu]}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {msg && <p className={`text-xs font-medium text-center ${msg.includes('Hitilafu') ? 'text-red-500' : 'text-sage'}`}>{msg}</p>}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Hariri Mfanyakazi' : 'Mfanyakazi Mpya'}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldSquare label="Jina" required value={form.jina} onChange={(e) => setForm((f) => ({ ...f, jina: e.target.value }))} />
          <Select label="Jukumu" value={form.jukumu} onChange={(e) => setForm((f) => ({ ...f, jukumu: e.target.value }))}>
            <option value="owner">Mmiliki</option>
            <option value="cashier">Mfanyakazi wa Kaunta</option>
            <option value="chef">Mpishi</option>
            <option value="inventory">Mfanyakazi wa Hisa</option>
          </Select>
          <FieldSquare
            label={editing ? 'PIN Mpya (hiari — achia tupu kama haubadilishi)' : 'PIN'}
            type="password"
            inputMode="numeric"
            maxLength={6}
            required={!editing}
            value={form.pin}
            onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))}
          />
          <Btn type="submit" variant="accent" size="lg" className="w-full">Hifadhi</Btn>
        </form>
      </Modal>
    </div>
  )
}

const AUDIT_TABLES = [
  { value: '', label: 'Vyote' },
  { value: 'mauzo', label: 'Mauzo' },
  { value: 'mauzo_bidhaa', label: 'Mauzo Bidhaa' },
  { value: 'agizo_maalum', label: 'Maagizo' },
  { value: 'tikiti', label: 'Tikiti' },
  { value: 'mtumiaji', label: 'Wafanyakazi' },
  { value: 'bidhaa', label: 'Bidhaa' },
  { value: 'malighafi', label: 'Malighafi' },
  { value: 'kumbukumbu_matumizi', label: 'Matumizi' },
  { value: 'marekebisho_hisa', label: 'Marekebisho Hisa' },
]

function AuditTab() {
  const [meza, setMeza] = useState('')
  const { data, loading } = useQuery(KUMBUKUMBU_KITENDO, { variables: { meza: meza || undefined, kikomo: 200 } })
  const rows = data?.kumbukumbu_kitendo || []

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-8 h-8 rounded-full bg-espresso/[0.05] flex items-center justify-center shrink-0">
            <Scroll weight="light" className="w-4 h-4 text-espresso-muted" />
          </span>
          <div>
            <p className="text-sm font-semibold">Ukaguzi wa Kitendo</p>
            <p className="text-[11px] text-espresso-muted">Habari haziwezi kufutwa — ni karatasi ya daima ya shughuli zote za mfumo.</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {AUDIT_TABLES.map((t) => (
            <button
              key={t.value}
              onClick={() => setMeza(t.value)}
              className={`rounded-full px-3 py-1.5 text-[10px] font-semibold transition-all duration-400 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${meza === t.value ? 'bg-copper text-white' : 'bg-espresso/[0.04] text-espresso-muted hover:bg-espresso/[0.07]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" /></div>
      ) : (
        <div className="flex flex-col gap-2 stagger">
          {rows.map((r) => {
            const ts = r.tarehe ? new Date(r.tarehe) : null
            const time = ts ? ts.toLocaleTimeString('sw', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
            const opColor = r.kitendo === 'INSERT' ? 'text-sage' : r.kitendo === 'UPDATE' ? 'text-copper' : 'text-red-500'
            const brief = (r.data_ya_baada && (r.data_ya_baada.jina || r.data_ya_baada.risiti_no))
              ? JSON.stringify(r.data_ya_baada).slice(0, 110) + '…'
              : `#${r.node_id}`
            return (
              <Card key={r.id} className="p-4">
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-bold uppercase w-16 text-center tabular-nums ${opColor}`}>
                    {r.kitendo}
                  </span>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-xs font-medium">{r.meza}</span>
                    <span className="text-[11px] text-espresso-muted/70 tabular-nums">{time}</span>
                  </div>
                  <span className="text-[11px] text-espresso-muted/60 truncate max-w-[60%]">{brief}</span>
                </div>
              </Card>
            )
          })}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-espresso-muted/60 text-center py-8">Hakuna habari ukaguzi bado</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function Owner() {
  const [tab, setTab] = useState('overview')
  const tabs = [
    { key: 'overview', label: 'Muhtasari', icon: ChartLineUp },
    { key: 'products', label: 'Bidhaa', icon: Package },
    { key: 'staff', label: 'Wafanyakazi', icon: UserPlus },
    { key: 'audit', label: 'Ukaguzi', icon: Scroll },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="cc-eyebrow text-copper">Mmiliki</span>
          <h1 className="font-serif text-2xl md:text-3xl font-semibold leading-tight">Muhtasari wa Duka</h1>
          <p className="text-xs text-espresso-muted">Mwongozo wa biashara kwa picha moja</p>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${
              tab === t.key
                ? 'bg-copper text-white shadow-[0_2px_8px_rgba(196,127,61,0.2)]'
                : 'bg-espresso/[0.04] text-espresso-muted hover:bg-espresso/[0.07]'
            }`}
          >
            <t.icon weight="light" className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}