import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { TIKITI } from '../graphql/queries'
import { CHUKUA_TIKITI, BADGE_HALI_TIKITI, FUTA_TIKITI } from '../graphql/mutations'
import { useAuth } from '../auth'
import { TikitiCard } from './TikitiCard'
import { Btn } from './Btn'
import { Check, Trash, Kanban, ForkKnife, ArrowLeft, Warning } from '@phosphor-icons/react'

const COLUMNS = [
  { key: 'in_queue', label: 'Foleni',       tone: 'border-neutral-200', empty: 'Hakuna kwenye foleni' },
  { key: 'preparing', label: 'Inatengenezwa', tone: 'border-copper-border', empty: 'Jiko liko tayari' },
  { key: 'ready',     label: 'Tayari kuchukuliwa', tone: 'border-sage/30', empty: 'Bado hakuna kilichokamilika' },
  { key: 'collected', label: 'Imechukuliwa', tone: 'border-hairline', empty: 'Hakuna bado' },
]

// Mirrors the permission map in src/auth/permissions.js. The board is rendered
// for owner, chef and cashier, and each role only ever sees the actions the API
// will actually accept for them — otherwise a tap fails with FORBIDDEN.
const CAN = {
  owner:     { advance: true, collect: true, cancel: true },
  chef:      { advance: true, collect: true, cancel: false },
  cashier:   { advance: false, collect: true, cancel: false },
  inventory: { advance: false, collect: false, cancel: false },
}

// Counter sales are ready-to-eat and no longer create tickets, so this board is
// purely the kitchen's custom-order queue. `aina !== 'mauzo'` also hides any
// counter-sale tickets left behind by older versions of the app.
export function TicketBoard({ onBack }) {
  const { user } = useAuth()
  const allowed = CAN[user?.jukumu] || CAN.inventory
  const { data, loading, refetch } = useQuery(TIKITI, {
    pollInterval: 5000,
    fetchPolicy: 'cache-and-network',
  })
  const [chukua] = useMutation(CHUKUA_TIKITI, { refetchQueries: [{ query: TIKITI }] })
  const [badge] = useMutation(BADGE_HALI_TIKITI, { refetchQueries: [{ query: TIKITI }] })
  const [futa] = useMutation(FUTA_TIKITI, { refetchQueries: [{ query: TIKITI }] })
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const today = new Date().toLocaleDateString('sw', { day: 'numeric', month: 'long' })
  const colored = useMemo(() => {
    const list = (data?.tikiti || []).filter((t) => t.aina !== 'mauzo')
    const now = new Date()
    return list.map((t) => {
      const created = new Date(t.created_at || t.tarehe)
      const mins = Math.round((now - created) / 60000)
      return { ...t, waits: !isNaN(mins) && t.hali !== 'collected' && t.hali !== 'cancelled' ? mins : null }
    })
  }, [data])

  // Previously this had try/finally with no catch, so a rejected mutation became
  // an unhandled promise rejection and the button silently did nothing.
  const act = async (fn, id) => {
    setBusyId(id)
    setError(null)
    try {
      await fn({ variables: { id } })
      refetch()
    } catch (err) {
      setError(err?.message || 'Hitilafu imetokea. Jaribu tena.')
    } finally {
      setBusyId(null)
    }
  }
  const handleNext = (t) => act((v) => badge(v), t.id)
  const handleCollect = (t) => act((v) => chukua(v), t.id)
  const handleCancel = (t) => act((v) => futa(v), t.id)

  const openCount = colored.filter((t) => t.hali !== 'collected' && t.hali !== 'cancelled').length

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center gap-3 mb-5">
        <span className="w-10 h-10 rounded-full bg-copper/10 text-copper flex items-center justify-center ring-1 ring-copper/20">
          <ForkKnife weight="light" className="w-5 h-5" />
        </span>
        <div className="flex flex-col">
          <h2 className="font-serif text-2xl font-semibold leading-none">Ubao wa Tikiti</h2>
          <span className="text-[11px] text-espresso-muted">
            {today} · maagizo {openCount > 0 ? `yako ${openCount} yanasubiri` : 'yote yamekamilika'}
          </span>
        </div>
        <div className="flex-1" />
        {onBack && (
          <Btn variant="ghost" size="md" icon={ArrowLeft} onClick={onBack}>Rudi kwenye kazi</Btn>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 mb-4 px-3.5 py-3 rounded-xl bg-red-50 text-red-700 ring-1 ring-red-200 text-sm">
          <Warning weight="fill" className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-xs font-semibold">Funga</button>
        </div>
      )}

      {/* Board */}
      {loading ? (
        <div className="rounded-2xl bg-espresso flex items-center justify-center h-64">
          <div className="w-6 h-6 rounded-full border-2 border-cream/40 border-t-cream animate-spin" />
        </div>
      ) : (
        <div className="rounded-2xl bg-espresso p-4 md:p-5 shadow-lg ring-1 ring-espresso/[0.06]">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {COLUMNS.map((col) => {
              const tickets = colored.filter((t) => t.hali === col.key)
              return (
                <div key={col.key} className="flex flex-col min-h-[180px]">
                  <div className={`flex items-center gap-2 px-1 py-2 border-b ${col.tone}`}>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-cream">{col.label}</span>
                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-cream/15 text-cream text-[10px] font-bold tabular-nums px-1.5">
                      {tickets.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2.5 pt-3">
                    {tickets.length === 0 && (
                      <p className="text-[11px] text-cream/40 px-1">{col.empty}</p>
                    )}
                    {tickets.map((t) => (
                      <div key={t.id} className="relative">
                        <TikitiCard ticket={t} compact />
                        {t.waits != null && (
                          <span className="absolute -top-2 -right-2 bg-copper text-white text-[9px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 shadow">
                            dk {t.waits}
                          </span>
                        )}
                        <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                          {t.hali === 'in_queue' && allowed.advance && (
                            <>
                              <Btn size="sm" variant="primary" onClick={() => handleNext(t)} disabled={busyId === t.id} className="flex-1 text-[10px] px-2.5 py-1.5">
                                Anza Kutengeneza
                              </Btn>
                              {allowed.cancel && (
                                <Btn size="sm" variant="ghost" onClick={() => handleCancel(t)} disabled={busyId === t.id} className="text-red-500 hover:bg-red-50 text-[10px] px-2.5 py-1.5" icon={Trash} aria-label="Futa tikiti" />
                              )}
                            </>
                          )}
                          {t.hali === 'preparing' && allowed.advance && (
                            <Btn size="sm" variant="accent" onClick={() => handleNext(t)} disabled={busyId === t.id} className="flex-1 text-[10px] px-2.5 py-1.5">
                              Tayari
                            </Btn>
                          )}
                          {t.hali === 'ready' && allowed.collect && (
                            <Btn size="sm" variant="accent" onClick={() => handleCollect(t)} icon={Check} disabled={busyId === t.id} className="flex-1 text-[10px] px-2.5 py-1.5">
                              Imechukuliwa
                            </Btn>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function BoardToggle({ active, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-95 ${
        active ? 'bg-espresso text-cream' : 'bg-espresso/[0.04] text-espresso-muted hover:bg-espresso/[0.07]'
      }`}
      aria-label="Fungua ubao wa tikiti"
      aria-current={active ? 'page' : undefined}
    >
      <Kanban weight="light" className="w-3.5 h-3.5" />
      Tikiti
    </button>
  )
}
