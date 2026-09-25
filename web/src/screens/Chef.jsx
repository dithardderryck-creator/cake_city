import { useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { ORDER_KWAJIKONI, HISA, UKUMBUSHO } from '../graphql/queries'
import { BADGE_HALI_ORDER, LOG_MATUMIZI } from '../graphql/mutations'
import { Card, CardFull } from '../ui/Card'
import { Btn } from '../ui/Btn'
import { Select } from '../ui/Select'
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
  const { data: remindData } = useQuery(UKUMBUSHO, { pollInterval: 30000 })
  const [badgeHali] = useMutation(BADGE_HALI_ORDER, { refetchQueries: [{ query: ORDER_KWAJIKONI }, { query: UKUMBUSHO }] })
  const [logMatumizi] = useMutation(LOG_MATUMIZI)
  const [logOpen, setLogOpen] = useState(null)
  const [logForm, setLogForm] = useState({ malighafi_id: '', kiasi: '' })
  const [logBusy, setLogBusy] = useState(false)
  const [logMsg, setLogMsg] = useState('')

  const orders = data?.order_kwajikoni || []
  const lowStock = stockData?.hisa?.lowStock || []
  const startNow = (remindData?.ukumbusho || []).filter((r) => r.aina === 'anza_kutengeneza')

  const handleStatus = async (id, hali) => {
    await badgeHali({ variables: { id, hali } })
  }

  const submitLog = async (e) => {
    e.preventDefault()
    if (!logForm.malighafi_id || !logForm.kiasi) return
    setLogBusy(true)
    setLogMsg('')
    try {
      await logMatumizi({
        variables: {
          input: {
            agizo_id: String(logOpen.id),
            malighafi_id: String(logForm.malighafi_id),
            kiasi: Number(logForm.kiasi),
          },
        },
      })
      setLogMsg('Imerekodwa. Stock imeshapunguzwa.')
      setLogForm({ malighafi_id: '', kiasi: '' })
      refetch()
    } catch (err) {
      setLogMsg(err?.message?.includes('INSUFFICIENT_STOCK') ? 'Kiasi hakipatikani stock' : 'Hitilafu imetokea')
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
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider bg-sage/[0.1] text-sage-deep">
            <Fire weight="light" className="w-3.5 h-3.5" /> Jikoni
          </span>
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
                      <Btn variant="ghost" size="sm" onClick={() => { setLogOpen(o); setLogMsg('') }}>
                        Log Matumizi
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

      {/* Ingredient log modal */}
      <Modal open={!!logOpen} onClose={() => setLogOpen(null)} title="Log Matumizi ya Malighafi">
        {logOpen && (
          <form onSubmit={submitLog} className="flex flex-col gap-4">
            <p className="text-xs text-espresso-muted">Agizo: <span className="font-semibold text-espresso">{logOpen.ladha} — {logOpen.ukubwa || ''}</span></p>
            <Select
              label="Malighafi"
              value={logForm.malighafi_id}
              onChange={(e) => setLogForm((f) => ({ ...f, malighafi_id: e.target.value }))}
            >
              <option value="">— Chagua —</option>
              {(stockData?.hisa?.items || []).map((i) => (
                <option key={i.id} value={i.id}>{i.jina} ({i.kiasi_kilichopo} {i.unit} iliyopo)</option>
              ))}
            </Select>
            <FieldSquare
              label="Kiasi"
              type="number"
              min="0.1"
              step="0.1"
              required
              value={logForm.kiasi}
              onChange={(e) => setLogForm((f) => ({ ...f, kiasi: e.target.value }))}
              placeholder="mf. 2"
            />
            {logMsg && <p className={`text-xs font-medium text-center ${logMsg.includes('Hitilafu') || logMsg.includes('hakipatikani') ? 'text-red-500' : 'text-sage'}`}>{logMsg}</p>}
            <Btn type="submit" variant="accent" size="lg" iconRight={ArrowRight} disabled={logBusy} className="w-full">
              {logBusy ? 'Inachapisha...' : 'Rekodi Matumizi'}
            </Btn>
          </form>
        )}
      </Modal>
    </div>
  )
}