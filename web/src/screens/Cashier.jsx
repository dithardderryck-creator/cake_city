import { useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { BIDHAA, MAUZO_YA_LEO, AGIZO_MAALUM, UKUMBUSHO, TIKITI } from '../graphql/queries'
import { UNDA_MAUZO, UNDA_AGIZO, CHUKUA_AGIZO } from '../graphql/mutations'
import { Card, CardFull } from '../ui/Card'
import { Btn } from '../ui/Btn'
import { Field, FieldSquare } from '../ui/Field'
import { Select } from '../ui/Select'
import { StatusPill } from '../ui/charts'
import { Modal } from '../ui/Modal'
import { TicketSheet } from '../ui/TikitiCard'
import { Plus, Minus, ShoppingBag, Cake, ListChecks, Receipt, ArrowRight, Check, Phone, BellRinging, Timer, Printer } from '@phosphor-icons/react'

const TABS = [
  { key: 'sale',    label: 'Mauzo',        icon: ShoppingBag },
  { key: 'order',   label: 'Agizo Maalum', icon: Cake },
  { key: 'due',     label: 'Lazima Ichukuliwe', icon: ListChecks },
  { key: 'receipts', label: 'Mauzo ya Leo', icon: Receipt },
]

const PAYMENT_LABELS = { cash: 'Taslimu', mpesa: 'M-Pesa', tigopesa: 'Tigo Pesa', airtel_money: 'Airtel Money' }
const PAYMENT_META = { cash: { tone: 'neutral', dot: '#6B5E4F' }, mpesa: { tone: 'copper', dot: '#C47F3D' }, tigopesa: { tone: 'safe', dot: '#8A9A7B' }, airtel_money: { tone: 'watch', dot: '#BA7517' } }

function fmtTSh(v) {
  return `TSh ${Number(v).toLocaleString()}`
}

function SalesTab() {
  const { data, loading } = useQuery(BIDHAA)
  const [undamauzo] = useMutation(UNDA_MAUZO, { refetchQueries: [{ query: MAUZO_YA_LEO }] })
  const [cart, setCart] = useState([])
  const [payment, setPayment] = useState('cash')
  const [discount, setDiscount] = useState('')
  const [receiptOpen, setReceiptOpen] = useState(null)
  const [busy, setBusy] = useState(false)

  const products = data?.bidhaa || []
  const categories = [...new Set(products.map((p) => p.aina || 'Bidhaa'))]
  const [cat, setCat] = useState('Wote')
  const shown = cat === 'Wote' ? products : products.filter((p) => (p.aina || 'Bidhaa') === cat)

  const addItem = (p) => {
    setCart((prev) => {
      const exists = prev.find((i) => i.id === p.id)
      if (exists) return prev.map((i) => i.id === p.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { id: p.id, name: p.jina, price: p.bei, qty: 1, cat: p.aina || 'Bidhaa' }]
    })
  }

  const updateQty = (id, delta) => {
    setCart((prev) =>
      prev.map((i) => i.id === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i)
    )
  }

  const removeItem = (id) => setCart((prev) => prev.filter((i) => i.id !== id))

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const total = subtotal - (Number(discount) || 0)

  const submit = async () => {
    if (!cart.length) return
    setBusy(true)
    try {
      const { data } = await undamauzo({
        variables: {
          bidhaa: cart.map((i) => ({ bidhaa_id: String(i.id), kiasi: i.qty })),
          njiaYaMlipo: payment,
          punguzo: discount ? Number(discount) : null,
        },
      })
      setReceiptOpen({ ...data.unda_mauzo, items: [...cart] })
      setCart([])
      setDiscount('')
    } finally {
      setBusy(false)
    }
  }
  const printTicket = () => window.print()

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6">
      {/* Product grid */}
      <div>
        {/* Category chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
          {['Wote', ...categories].map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`cc-pill px-4 py-2 text-xs font-semibold ${cat === c ? 'cc-pill-active' : ''}`}
            >
              {c}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 stagger">
            {shown.map((p) => (
              <Card
                key={p.id}
                className="p-4 cursor-pointer hover:border-copper/40"
                inner={{ onClick: () => addItem(p) }}
              >
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-espresso-muted/70">{p.aina || 'Bidhaa'}</span>
                  <span className="text-sm font-medium leading-tight">{p.jina}</span>
                  <span className="cc-num text-base text-copper">{fmtTSh(p.bei)}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Cart */}
      <CardFull className="md:sticky md:top-24 self-start">
        <div className="flex items-center justify-between mb-4">
          <p className="cc-eyebrow">Kikapu</p>
          {cart.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-copper text-white text-[10px] font-bold tabular-nums">
              {cart.reduce((s, i) => s + i.qty, 0)}
            </span>
          )}
        </div>
        {cart.length === 0 ? (
          <p className="text-sm text-espresso-muted/60 py-8 text-center">Chagua bidhaa upande wa kushoto</p>
        ) : (
          <>
            <div className="flex flex-col gap-3 mb-4 max-h-[42dvh] overflow-auto pr-1">
              {cart.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-2 py-2 border-b border-hairline-soft last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{i.name}</p>
                    <p className="text-[10px] uppercase tracking-wider text-espresso-muted/70">{i.cat}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => updateQty(i.id, -1)} className="w-6 h-6 rounded-full bg-espresso/[0.04] flex items-center justify-center text-espresso-muted hover:bg-espresso/[0.08] transition-all duration-300 active:scale-90">
                      <Minus weight="light" className="w-3 h-3" />
                    </button>
                    <span className="text-xs font-semibold w-5 text-center tabular-nums">{i.qty}</span>
                    <button onClick={() => updateQty(i.id, 1)} className="w-6 h-6 rounded-full bg-espresso/[0.04] flex items-center justify-center text-espresso-muted hover:bg-espresso/[0.08] transition-all duration-300 active:scale-90">
                      <Plus weight="light" className="w-3 h-3" />
                    </button>
                    <button onClick={() => removeItem(i.id)} className="ml-1 w-5 h-5 rounded-full flex items-center justify-center text-espresso-muted/50 hover:text-red-500 hover:bg-red-50 transition-colors" aria-label="Ondoa">
                      ×
                    </button>
                    <span className="text-xs text-espresso-muted w-20 text-right tabular-nums">{fmtTSh(i.price * i.qty)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-hairline pt-3 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs text-espresso-muted">
                <span>Jumla ndogo</span>
                <span className="tabular-nums">{fmtTSh(subtotal)}</span>
              </div>
              <FieldSquare
                label="Punguzo (TSh)"
                type="number"
                min="0"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
              <div className="flex gap-1.5">
                {Object.entries(PAYMENT_LABELS).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setPayment(k)}
                    className={`flex-1 rounded-full px-2 py-2 text-[10px] font-semibold transition-all duration-400 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${payment === k ? 'bg-copper text-white' : 'bg-espresso/[0.04] text-espresso-muted hover:bg-espresso/[0.07]'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm font-medium text-espresso-muted">Jumla</span>
                <span className="cc-num text-xl font-semibold">{fmtTSh(Math.max(0, total))}</span>
              </div>
              <Btn variant="accent" size="lg" iconRight={ArrowRight} disabled={busy || !cart.length} onClick={submit} className="w-full">
                {busy ? 'Inachapisha...' : 'Maliza Mauzo'}
              </Btn>
            </div>
          </>
        )}
      </CardFull>

      {/* Receipt + ticket modal */}
      <Modal open={!!receiptOpen} onClose={() => setReceiptOpen(null)} title="Risiti na Tikiti" className="max-w-xl">
        {receiptOpen && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-12 h-12 rounded-full bg-sage/10 flex items-center justify-center">
              <Check weight="light" className="w-6 h-6 text-sage" />
            </div>
            <p className="text-sm text-espresso-muted">Risiti namba</p>
            <p className="font-serif text-lg font-semibold">{receiptOpen.risiti_no}</p>
            <p className="cc-num text-3xl font-semibold">{fmtTSh(receiptOpen.jumla)}</p>
            <StatusPill tone={PAYMENT_META[receiptOpen.njia_ya_malipo]?.tone || 'neutral'}>
              {PAYMENT_LABELS[receiptOpen.njia_ya_malipo]}
            </StatusPill>
            <div className="flex flex-col gap-1 w-full max-w-[260px] mt-2">
              {receiptOpen.items.map((i) => (
                <div key={i.id} className="flex items-center justify-between text-xs text-espresso-muted">
                  <span className="truncate">{i.qty}× {i.name}</span>
                  <span className="tabular-nums">{fmtTSh(i.price * i.qty)}</span>
                </div>
              ))}
            </div>

            {/* Numbered pickup ticket */}
            <div className="w-full flex flex-col items-center my-2 border-t border-hairline pt-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-espresso-muted mb-3">Tikiti yako ya kuchukua</p>
              <TicketSheet ticket={receiptOpen.tikiti} />
              <div className="flex gap-3 w-full mt-5">
                <Btn variant="ghost" size="md" icon={Printer} className="flex-1" onClick={printTicket}>Chapisha</Btn>
                <Btn variant="accent" size="md" iconRight={Phone} className="flex-1">WhatsApp</Btn>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function OrderTab() {
  const [undaaGizo] = useMutation(UNDA_AGIZO)
  const [form, setForm] = useState({
    jina: '', simu: '', ladha: '', design: '', ukubwa: '', tarehe: '', bei: '', amali: '',
  })
  const [busy, setBusy] = useState(false)
  const [orderResult, setOrderResult] = useState(null)

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.ladha || !form.tarehe || !form.bei) return
    setBusy(true)
    try {
      const { data } = await undaaGizo({
        variables: {
          input: {
            mteja_mpya: form.jina ? { jina: form.jina, simu: form.simu || undefined } : undefined,
            ladha: form.ladha,
            design: form.design || undefined,
            ukubwa: form.ukubwa || undefined,
            tarehe_ya_kuchukua: form.tarehe,
            bei_jumla: Number(form.bei),
            malipo_ya_awali: Number(form.amali) || 0,
          },
        },
      })
      setOrderResult(data.unda_agizo)
      setForm({ jina: '', simu: '', ladha: '', design: '', ukubwa: '', tarehe: '', bei: '', amali: '' })
    } catch { /* noop — Apollo surfaces errors */ }
    finally { setBusy(false) }
  }

  const beiNum = Number(form.bei) || 0
  const amaliNum = Number(form.amali) || 0
  const salio = beiNum - amaliNum

  const printOrder = () => window.print()

  return (
    <>
      <CardFull className="max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="cc-eyebrow mb-1">Mteja</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jina la mteja" value={form.jina} onChange={(e) => update('jina', e.target.value)} placeholder="Jina (si lazima)" />
            <Field label="Simu" value={form.simu} onChange={(e) => update('simu', e.target.value)} placeholder="+255..." inputMode="tel" />
          </div>
          <p className="cc-eyebrow mt-2 mb-1">Taarifa za Keki</p>
          <div className="grid grid-cols-2 gap-3">
            <FieldSquare label="Ladha" required value={form.ladha} onChange={(e) => update('ladha', e.target.value)} placeholder="Choco, Vanilla..." />
            <FieldSquare label="Ukubwa" value={form.ukubwa} onChange={(e) => update('ukubwa', e.target.value)} placeholder="Small / Medium / Large" />
          </div>
          <FieldSquare label="Muundo (Design)" value={form.design} onChange={(e) => update('design', e.target.value)} placeholder="Maelezo ya muundo..." />
          <div className="grid grid-cols-2 gap-3">
            <FieldSquare label="Tarehe ya kuchukua" type="date" required value={form.tarehe} onChange={(e) => update('tarehe', e.target.value)} />
            <FieldSquare label="Bei (TSh)" type="number" min="0" required value={form.bei} onChange={(e) => update('bei', e.target.value)} placeholder="80000" />
          </div>
          <FieldSquare label="Malipo ya Awali (deposit)" type="number" min="0" value={form.amali} onChange={(e) => update('amali', e.target.value)} placeholder="0" />
          <div className="flex items-center justify-between rounded-full bg-copper/[0.06] px-5 py-3">
            <span className="text-xs font-medium text-copper">Salio la Kulipa</span>
            <span className="cc-num text-lg font-semibold text-copper">{fmtTSh(Math.max(0, salio))}</span>
          </div>
          <Btn type="submit" variant="primary" size="lg" iconRight={ArrowRight} disabled={busy} className="w-full">
            {busy ? 'Inaundwa...' : 'Unda Agizo'}
          </Btn>
        </form>
      </CardFull>

      {/* Order ticket modal */}
      <Modal open={!!orderResult} onClose={() => setOrderResult(null)} title="Agizo Limetengenezwa" className="max-w-xl">
        {orderResult && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-12 h-12 rounded-full bg-copper/[0.1] flex items-center justify-center">
              <Check weight="light" className="w-6 h-6 text-copper" />
            </div>
            <p className="text-sm text-espresso-muted">Agizo namba</p>
            <p className="font-serif text-lg font-semibold">{orderResult.ladha} — {orderResult.ukubwa || '—'}</p>
            <p className="cc-num text-2xl font-semibold">{fmtTSh(orderResult.bei_jumla)}</p>
            <StatusPill tone="neutral">Imeagizwa</StatusPill>

            {orderResult.tikiti && (
              <div className="w-full flex flex-col items-center my-2 border-t border-hairline pt-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-espresso-muted mb-3">Tikiti ya agizo</p>
                <TicketSheet ticket={orderResult.tikiti} />
                <Btn variant="ghost" size="md" icon={Printer} className="mt-5" onClick={printOrder}>Chapisha Tikiti</Btn>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}

function DueTab() {
  const { data, loading, refetch } = useQuery(AGIZO_MAALUM, { variables: { hali: null } })
  const [chukua] = useMutation(CHUKUA_AGIZO, { refetchQueries: [{ query: AGIZO_MAALUM }] })

  const orders = (data?.agizo_maalum || []).filter((o) => o.hali !== 'collected' && o.hali !== 'cancelled')
  const sorted = [...orders].sort((a, b) => new Date(a.tarehe_ya_kuchukua) - new Date(b.tarehe_ya_kuchukua))

  const handleCollect = async (id) => {
    await chukua({ variables: { id } })
    refetch()
  }

  const statusMeta = { ordered: { tone: 'neutral', label: 'Imeagizwa' }, in_progress: { tone: 'copper', label: 'Inatengenezwa' }, ready: { tone: 'safe', label: 'Tayari' } }

  return (
    <div className="flex flex-col gap-3 stagger">
      {loading && <div className="flex justify-center py-12"><div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" /></div>}
      {!loading && orders.length === 0 && <p className="text-sm text-espresso-muted/60 text-center py-12">Hakuna maagizo ambayo bado hayajachukuliwa</p>}
      {sorted.map((o) => {
        const m = statusMeta[o.hali]
        const today = new Date()
        const dueDate = new Date(o.tarehe_ya_kuchukua)
        const isToday = dueDate.toDateString() === today.toDateString()
        const overdue = dueDate < new Date(today.setHours(0, 0, 0, 0))

        return (
          <Card key={o.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold truncate">{o.mteja?.jina || 'Mteja'}</span>
                  <StatusPill tone={m.tone}>{m.label}</StatusPill>
                  {isToday && <StatusPill tone="watch">Leo</StatusPill>}
                  {overdue && <StatusPill tone="danger">Imepitwa</StatusPill>}
                </div>
                <span className="text-xs text-espresso-muted">{o.ladha} — {o.ukubwa || '—'}</span>
                <span className="flex items-center gap-1 text-[11px] text-espresso-muted/70">
                  <Timer weight="light" className="w-3 h-3" /> Kadirio kuandaliwa: {o.muda_hitajika ? `${o.muda_hitajika} dk` : '—'} · Kuchukuliwa: {o.tarehe_ya_kuchukua}
                </span>
                {o.salio > 0 && <span className="text-[11px] text-copper font-medium">Salio: {fmtTSh(o.salio)}</span>}
              </div>
              {o.hali === 'ready' && (
                <Btn variant="accent" size="sm" icon={Check} onClick={() => handleCollect(o.id)}>
                  Imechukuliwa
                </Btn>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function ReceiptsTab() {
  const { data, loading } = useQuery(MAUZO_YA_LEO)
  const sales = data?.mauzo_ya_leo || []
  const total = sales.reduce((s, x) => s + Number(x.jumla), 0)

  return (
    <div className="flex flex-col gap-3 stagger">
      {loading && <div className="flex justify-center py-12"><div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" /></div>}
      {!loading && sales.length === 0 && <p className="text-sm text-espresso-muted/60 text-center py-12">Hakuna mauzo leo bado</p>}
      {sales.length > 0 && (
        <CardFull className="p-5 flex items-center justify-between">
          <div>
            <p className="cc-eyebrow">Mauzo ya Leo</p>
            <p className="cc-num text-2xl font-semibold mt-1">{fmtTSh(total)}</p>
          </div>
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-copper/[0.1] text-copper">
            <Receipt weight="light" className="w-4 h-4" />
          </span>
        </CardFull>
      )}
      {sales.map((s) => (
        <Card key={s.id} className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-mono text-espresso-muted">{s.risiti_no}</span>
              <span className="text-xs text-espresso-muted">{s.bidhaa.length} bidhaa · {new Date(s.created_at || s.tarehe).toLocaleTimeString('sw', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusPill tone={PAYMENT_META[s.njia_ya_malipo]?.tone || 'neutral'}>
                {PAYMENT_LABELS[s.njia_ya_malipo]}
              </StatusPill>
              <span className="cc-num text-base font-semibold">{fmtTSh(s.jumla)}</span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

export default function Cashier() {
  const [tab, setTab] = useState('sale')
  const { data: remindData } = useQuery(UKUMBUSHO, { pollInterval: 30000 })
  const pickups = (remindData?.ukumbusho || []).filter((r) => r.aina === 'tarehe_ya_kuchukua')

  return (
    <div className="flex flex-col gap-6">
      {pickups.length > 0 && (
        <div className="flex flex-col gap-2">
          {pickups.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-amber-50/80 ring-1 ring-amber-200/60 px-4 py-3"
              style={{ animation: 'reveal-up 0.6s var(--ease-out-expo) forwards' }}>
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <BellRinging weight="light" className="w-4 h-4 text-amber-600" />
              </div>
              <p className="text-xs text-amber-800 leading-relaxed flex-1">{r.ujumbe}</p>
              <button onClick={() => setTab('due')} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900 transition-colors">
                Tazama <ArrowRight weight="light" className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Tab bar */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map((t) => (
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

      {tab === 'sale' && <SalesTab />}
      {tab === 'order' && <OrderTab />}
      {tab === 'due' && <DueTab />}
      {tab === 'receipts' && <ReceiptsTab />}
    </div>
  )
}