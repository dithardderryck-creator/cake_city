import { useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { ORDER_KWAJIKONI, HISA, MALIGHAFI, UKUMBUSHO } from '../graphql/queries'
import { BADGE_HALI_ORDER, LOG_MATUMIZI_KUNDI } from '../graphql/mutations'
import { Card, CardFull } from '../ui/Card'
import { Btn } from '../ui/Btn'
import { StatusPill } from '../ui/charts'
import { Modal } from '../ui/Modal'
import { FieldSquare } from '../ui/Field'
import { Hammer, CheckCircle, Warning, ArrowRight, ChefHat, Fire, Timer } from '@phosphor-icons/react'

const STATUS_META = {
  ordered: { tone: 'neutral', label: 'Imeagizwa', step: 0 },
  in_progress: { tone: 'copper', label: 'Inatengenezwa', step: 1 },
  ready: { tone: 'safe', label: 'Tayari', step: 2 },
}

const STEPS = ['Imeagizwa', 'Inatengenezwa', 'Tayari']

function StatusTimeline({ hali }) {
  const step = STATUS_META[hali]?.step ?? 0
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <span
            className={`h-1 rounded-full transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              i <= step ? (step === 2 ? 'bg-sage' : step === 1 ? 'bg-copper' : 'bg-espresso-muted') : 'bg-espresso/[0.1]'
            }`}
            style={{ width: i === 1 ? 28 : 28 }}
            title={s}
          />
          {i < 2 && <span className="w-0.5 h-0.5 rounded-full bg-espresso/[0.15]" />}
        </div>
      ))}
    </div>
  )
}

function fmtPrep(min) {
  if (!min) return null
  if (min < 60) return `${min} dk`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} saa ${m} dk` : `${h} saa`
}

export default function Chef() {
  const { data, loading, refetch } = useQuery(ORDER_KWAJIKONI)
  const { data: stockData } = useQuery(HISA)
  const { data: ingData } = useQuery(MALIGHAFI)
  const { data: remindData } = useQuery(UKUMBUSHO, { pollInterval: 30000 })
  const [badgeHali] = useMutation(BADGE_HALI_ORDER, { refetchQueries: [{ query: ORDER_KWAJIKONI }, { query: UKUMBUSHO }] })
  const [logKundi] = useMutation(LOG_MATUMIZI_KUNDI, { refetchQueries: [{ query: MALIGHAFI }, { query: HISA }] })
  // null = closed. An object with order:null is a STANDALONE batch: regular shop
  // production like "20 mandazi" that has no order behind it.
  const [logOpen, setLogOpen] = useState(null)
  // { [malighafi_id]: kiasi } — the running tally of what has been tapped
  const [taps, setTaps] = useState({})
  const [logNote, setLogNote] = useState('')
  const [logBusy, setLogBusy] = useState(false)
  const [logMsg, setLogMsg] = useState('')

  const orders = data?.order_kwajikoni || []
  const ingredients = ingData?.malighafi || []
  const lowStock = stockData?.hisa?.lowStock || []
  const startNow = (remindData?.ukumbusho || []).filter((r) => r.aina === 'anza_kutengeneza')

  const handleStatus = async (id, hali) => {
    await badgeHali({ variables: { id, hali } })
  }

  /** Open the sheet, optionally seeded from an order's recipe. */
  const openLog = (order) => {
    const seed = {}
    // Only a CUSTOM cake order that came from the recipe book gets a prefill.
    // Everything else — regular products, and off-book custom orders — starts
    // empty, because a guessed ingredient list is worse than a blank sheet.
    for (const line of order?.mapishi?.viambato || []) {
      const mid = String(line.malighafi.id)
      // Start at the midpoint of the suggested range; the chef taps to adjust.
      seed[mid] = Math.round(((line.kiasi_cha_chini + line.kiasi_cha_juu) / 2) * 100) / 100
    }
    setTaps(seed)
    setLogNote('')
    setLogMsg('')
    setLogOpen(order || { order: null })
  }

  const closeLog = () => { setLogOpen(null); setTaps({}); setLogNote(''); setLogMsg('') }

  /** Tap once to add a sensible step, again to add more, tap the pill to remove. */
  const step = (unit) => (unit === 'pcs' ? 1 : 0.25)
  const tapAdd = (ing) => {
    const id = String(ing.id)
    setTaps((t) => ({ ...t, [id]: (t[id] || 0) + step(ing.unit) }))
  }
  const tapRemove = (id) => {
    const key = String(id)
    setTaps((t) => {
      const next = { ...t }
      delete next[key]
      return next
    })
  }

  const tapTotal = Object.values(taps).reduce((a, b) => a + b, 0)
  const tapCount = Object.keys(taps).length
  // Without an order there is nothing to explain the entry, so the note is
  // required. The server enforces this too; catching it here saves a round trip.
  const noteRequired = !logOpen?.order

  const submitLog = async (e) => {
    e.preventDefault()
    if (!tapCount) { setLogMsg('Gonga kitu chochote kwanza.'); return }
    if (noteRequired && !logNote.trim()) { setLogMsg('Andika maelezo ya kile kundi.'); return }
    setLogBusy(true)
    setLogMsg('')
    try {
      await logKundi({
        variables: {
          input: {
            agizo_id: logOpen?.order ? String(logOpen.order.id) : null,
            kumbukumbu: logNote.trim() || null,
            vitu: Object.entries(taps).map(([malighafi_id, kiasi]) => ({
              malighafi_id: malighafi_id,
              kiasi: Number(kiasi),
            })),
          },
        },
      })
      setLogMsg('Imerekodwa. Hesa zitasubiri kuthibitishwa na hesabu.')
      setTaps({})
      setLogNote('')
      refetch()
    } catch (err) {
      setLogMsg(err?.message || 'Hitilafu imetokea')
    } finally {
      setLogBusy(false)
    }
  }

  const activeCount = orders.length

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-6">
      {/* Kitchen queue */}
      <div>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-sage/12 flex items-center justify-center">
              <ChefHat weight="light" className="w-4 h-4 text-sage" />
            </div>
            <div>
              <h1 className="font-serif text-xl font-semibold">Foleo ya Jikoni</h1>
              <p className="text-[11px] text-espresso-muted">Maagizo {activeCount} yanayoendelea</p>
            </div>
          </div>
            <div className="flex items-center gap-2">
              {/* Regular production has no order, so it needs its own way in. */}
              <Btn variant="ghost" size="sm" icon={Hammer} onClick={() => openLog(null)}>
                Kundi la Uzalishaji
              </Btn>
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider bg-sage/[0.1] text-sage-deep">
                <Fire weight="light" className="w-3.5 h-3.5" /> Jikoni
              </span>
            </div>
        </div>

        {startNow.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {startNow.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-red-50/80 ring-1 ring-red-100 px-4 py-3"
                style={{ animation: 'reveal-up 0.6s var(--ease-out-expo) forwards' }}>
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <Fire weight="light" className="w-4 h-4 text-red-500" />
                </div>
                <p className="text-xs text-red-700 leading-relaxed flex-1">{r.ujumbe}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 stagger">
          {loading && <div className="flex justify-center py-12"><div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" /></div>}
          {!loading && orders.length === 0 && (
            <CardFull className="text-center py-12">
              <p className="text-sm text-espresso-muted/60">Hakuna maagizo bado</p>
            </CardFull>
          )}
          {orders.map((o) => {
            const meta = STATUS_META[o.hali]
            return (
              <Card key={o.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="font-serif text-base font-semibold">{o.ladha}</span>
                      <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
                      {o.ukubwa && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-espresso-muted">
                          <span className="w-1.5 h-1.5 rounded-full bg-copper/50" /> {o.ukubwa}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[11px] text-espresso-muted">
                        <Timer weight="light" className="w-3 h-3" /> Kadirio: {fmtPrep(o.muda_hitajika)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-espresso-muted">
                        <span className="w-1.5 h-1.5 rounded-full bg-sage/60" /> Kuchukuliwa: {o.tarehe_ya_kuchukua}
                      </span>
                    </div>
                    {o.design && (
                      <p className="text-[11px] text-espresso-muted leading-relaxed max-w-[52ch] mb-3">
                        <span className="font-medium text-espresso-muted">Muundo:</span> {o.design}
                      </p>
                    )}
                    <StatusTimeline hali={o.hali} />
                  </div>
                </div>
                <div className="flex gap-2 pt-4 border-t border-hairline mt-4">
                  {o.hali === 'ordered' && (
                    <Btn variant="accent" size="sm" icon={Hammer} onClick={() => handleStatus(o.id, 'in_progress')}>
                      Anza Kutengeneza
                    </Btn>
                  )}
                  {o.hali === 'in_progress' && (
                    <>
                      <Btn variant="accent" size="sm" icon={CheckCircle} onClick={() => handleStatus(o.id, 'ready')}>
                        Tayari
                      </Btn>
                      <Btn variant="ghost" size="sm" onClick={() => openLog(o)}>
                        {o.mapishi ? 'Rekodi Matumizi' : 'Weka Malighafi'}
                      </Btn>
                    </>
                  )}
                  {o.hali === 'ready' && (
                    <StatusPill tone="safe">Imekwisha</StatusPill>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Stock glance */}
      <div className="flex flex-col gap-4">
        <CardFull>
          <p className="cc-eyebrow mb-4">Hisa ya Sasa</p>
          {lowStock.length > 0 && (
            <div className="flex flex-col gap-2 mb-4">
              {lowStock.map((i) => (
                <div key={i.id} className="flex items-center gap-2 rounded-full bg-red-50/80 px-3 py-1.5">
                  <Warning weight="light" className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  <span className="text-[11px] text-red-600 font-medium truncate">{i.jina}: {i.kiasi_kilichopo} {i.unit}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {(stockData?.hisa?.items || []).slice(0, 8).map((i) => {
              const low = i.kiasi_kilichopo <= i.kiwango_cha_chini
              const pct = Math.min(100, (i.kiasi_kilichopo / Math.max(i.kiasi_kilichopo, i.kiwango_cha_chini, 1)) * 100)
              return (
                <div key={i.id} className="flex items-center justify-between gap-2 py-1">
                  <span className="text-xs text-espresso-muted truncate max-w-[110px]">{i.jina}</span>
                  <div className="flex items-center gap-2 flex-1 justify-end">
                    <div className="h-1 w-14 rounded-full bg-espresso/[0.06] overflow-hidden">
                      <div className={`h-full rounded-full ${low ? 'bg-red-400' : 'bg-sage'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                    <span className="text-xs font-medium tabular-nums w-14 text-right">
                      {i.kiasi_kilichopo} <span className="text-espresso-muted/60">{i.unit}</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </CardFull>
      </div>

      {/* Ingredient tap sheet. Prefilled from a custom order's recipe, or blank
          for a regular batch. Nothing here moves stock. */}
      <Modal
        open={!!logOpen}
        onClose={closeLog}
        title={logOpen?.order ? 'Rekodi Matumizi' : 'Rekodi Kundi la Uzalishaji'}
      >
        {logOpen && (
          <form onSubmit={submitLog} className="flex flex-col gap-4">
            <div className="rounded-2xl bg-espresso/[0.03] ring-1 ring-espresso/[0.06] px-4 py-3">
              {logOpen.order ? (
                <>
                  <p className="text-[11px] uppercase tracking-wider text-espresso-muted">Agizo</p>
                  <p className="font-semibold text-espresso">
                    {logOpen.order.ladha} — {logOpen.order.ukubwa || ''}
                  </p>
                  {logOpen.order.mapishi ? (
                    <p className="text-xs text-sage-deep mt-1">
                      Mapishi: {logOpen.order.mapishi.ladha} ({logOpen.order.mapishi.ukubwa})
                    </p>
                  ) : (
                    <p className="text-xs text-espresso-muted mt-1">
                      Hakuna mapishi — andika kile unachotumia.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[11px] uppercase tracking-wider text-espresso-muted">Uzalishaji wa kawaida</p>
                  <p className="font-semibold text-espresso">Hakuna agizo — fungua kile unachotengeneza</p>
                </>
              )}
            </div>

            {logOpen.order?.mapishi?.viambato?.length > 0 && (
              <p className="text-xs text-espresso-muted -mt-1">
                Vimewekwa wastani wa mapishi. Gonga ili kubadilisha.
              </p>
            )}

            {/* Tap targets. Big on purpose: this is used with wet or floured hands. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ingredients.map((ing) => {
                const id = String(ing.id)
                const amt = taps[id] || 0
                return (
                  <button
                    key={ing.id}
                    type="button"
                    onClick={() => (amt ? tapRemove(ing.id) : tapAdd(ing))}
                    aria-pressed={!!amt}
                    className={`relative text-left rounded-2xl px-3 py-3 min-h-[64px] transition-all duration-200 ${
                      amt
                        ? 'bg-sage text-white shadow-sm'
                        : 'bg-white ring-1 ring-espresso/[0.08] hover:ring-espresso/20 active:scale-[0.97]'
                    }`}
                  >
                    <span className={`block text-sm font-semibold ${amt ? 'text-white' : 'text-espresso'}`}>
                      {ing.jina}
                    </span>
                    {amt ? (
                      <span className="block text-xs text-white/80 mt-0.5">
                        {amt} {ing.unit} · ondoa
                      </span>
                    ) : (
                      <span className="block text-[11px] text-espresso-muted mt-0.5">
                        {(ing.kiasi_kilichopo ?? 0)} {ing.unit} zilizopo
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Running tally, tappable to clear a line. */}
            {tapCount > 0 && (
              <div className="flex flex-col gap-1.5 rounded-2xl bg-espresso/[0.03] p-3">
                {Object.entries(taps).map(([id, amt]) => {
                  const ing = ingredients.find((x) => String(x.id) === id)
                  return (
                    <div key={id} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-espresso">
                        {ing?.jina || `#${id}`} — {ing?.unit}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => tapRemove(id)}
                          className="w-6 h-6 rounded-full bg-white ring-1 ring-espresso/10 text-espresso-muted text-xs leading-none"
                          aria-label={`Ondoa ${ing?.jina}`}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="0"
                          step="0.25"
                          value={amt}
                          onChange={(e) => setTaps((t) => ({ ...t, [id]: Number(e.target.value) }))}
                          className="w-16 rounded-lg bg-white ring-1 ring-espresso/10 px-2 py-1 text-xs text-espresso text-right"
                        />
                        <button
                          type="button"
                          onClick={() => tapAdd(ing || { id, unit: '' })}
                          className="w-6 h-6 rounded-full bg-sage text-white text-xs leading-none"
                          aria-label={`Ongeza ${ing?.jina}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <FieldSquare
              label={noteRequired ? 'Maelezo ya kundi *' : 'Maelezo (si lazima)'}
              value={logNote}
              onChange={(e) => setLogNote(e.target.value)}
              placeholder={noteRequired ? 'mf. 20 mandazi' : 'mf. alikuwa mbaya kidogo'}
            />

            {logMsg && (
              <p
                className={`text-xs font-medium text-center ${
                  logMsg.startsWith('Ime') ? 'text-sage' : 'text-red-500'
                }`}
              >
                {logMsg}
              </p>
            )}

            <div className="flex items-center gap-3">
              <Btn
                type="submit"
                variant="accent"
                size="lg"
                iconRight={ArrowRight}
                disabled={logBusy || !tapCount}
                className="flex-1"
              >
                {logBusy ? 'Inachapisha...' : `Rekodi ${tapCount ? `(${tapCount})` : ''}`}
              </Btn>
              <Btn type="button" variant="ghost" size="lg" onClick={() => setTaps({})}>
                Futa
              </Btn>
            </div>

            <p className="text-[11px] text-espresso-muted text-center">
              Kumbukumbu hii ni makadirio. Hesa zitapunguzwa na hesabu baada ya kuthibitishwa.
            </p>
          </form>
        )}
      </Modal>
    </div>
  )
}