import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { TIKITI } from '../graphql/queries'
import { CHUKUA_TIKITI, BADGE_HALI_TIKITI, FUTA_TIKITI } from '../graphql/mutations'
import { TikitiCard } from './TikitiCard'
import { Btn } from './Btn'
import { X, Check, Trash, Kanban, ForkKnife } from '@phosphor-icons/react'

const COLUMNS = [
  { key: 'in_queue', label: 'Foleni',       tone: 'border-neutral-200', empty: 'Hakuna kwenye foleni' },
  { key: 'preparing', label: 'Inatengenezwa', tone: 'border-copper-border', empty: 'Jiko liko tayari' },
  { key: 'ready',     label: 'Tayari kuchukuliwa', tone: 'border-sage/30', empty: 'Bado hakuna kilichokamilika' },
  { key: 'collected', label: 'Imechukuliwa', tone: 'border-hairline', empty: 'Hakuna bado' },
]

export function TicketBoard({ open, onClose }) {
  const { data, loading, refetch } = useQuery(TIKITI, {
    pollInterval: 5000,
    skip: !open,
    fetchPolicy: 'cache-and-network',
  })
  const [chukua] = useMutation(CHUKUA_TIKITI, { refetchQueries: [{ query: TIKITI }] })
  const [badge] = useMutation(BADGE_HALI_TIKITI, { refetchQueries: [{ query: TIKITI }] })
  const [futa] = useMutation(FUTA_TIKITI, { refetchQueries: [{ query: TIKITI }] })
  const [busyId, setBusyId] = useState(null)

  const today = new Date().toLocaleDateString('sw', { day: 'numeric', month: 'long' })
  const colored = useMemo(() => {
    const list = data?.tikiti || []
    const now = new Date()
    return list.map((t) => {
      const created = new Date(t.created_at || t.tarehe)
      const mins = Math.round((now - created) / 60000)
      return { ...t, waits: !isNaN(mins) && t.hali !== 'collected' && t.hali !== 'cancelled' ? mins : null }
    })
  }, [data])

  if (!open) return null

  const act = async (fn, id) => {
    setBusyId(id)
    try {
      await fn({ variables: { id } })
      refetch()
    } finally {
      setBusyId(null)
    }
  }
  const handleNext = (t) => act((v) => badge(v), t.id)
  const handleCollect = (t) => act((v) => chukua(v), t.id)
  const handleCancel = (t) => act((v) => futa(v), t.id)

  return (
    <div className="fixed inset-0 z-[45] flex flex-col" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-espresso/40 backdrop-blur-md" style={{ animation: 'overlay-in 0.4s var(--ease-out-expo) forwards' }} onClick={onClose} />

      <div className="relative flex flex-col flex-1 min-h-0 p-4 md:p-6" style={{ animation: 'reveal-up 0.55s var(--ease-out-expo) forwards' }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <span className="w-10 h-10 rounded-full bg-cream text-espresso flex items-center justify-center shadow-lg ring-1 ring-espresso/[0.06]">
            <ForkKnife weight="light" className="w-5 h-5" />
          </span>
          <div className="flex flex-col">
            <h2 className="font-serif text-2xl font-semibold text-cream leading-none">Ubao wa Tikiti</h2>
            <span className="text-[11px] text-cream/70">{today}</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-cream/90 text-espresso shadow-lg hover:bg-cream transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-95"
            aria-label="Funga Ubao"
          >
            <X weight="light" className="w-5 h-5" />
          </button>
        </div>

        {/* Columns */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-cream/40 border-t-cream animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 flex-1 min-h-0 overflow-auto pb-2">
            {COLUMNS.map((col) => {
              const tickets = colored.filter((t) => t.hali === col.key)
              return (
                <div key={col.key} className="flex flex-col min-h-[220px]">
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
                          {t.hali === 'in_queue' && (
                            <>
                              <Btn size="sm" variant="primary" onClick={() => handleNext(t)} disabled={busyId === t.id} className="flex-1 text-[10px] px-2.5 py-1.5">
                                Anza Kutengeneza
                              </Btn>
                              <Btn size="sm" variant="ghost" onClick={() => handleCancel(t)} disabled={busyId === t.id} className="text-red-500 hover:bg-red-50 text-[10px] px-2.5 py-1.5" icon={Trash} aria-label="Futa tikiti">
                              </Btn>
                            </>
                          )}
                          {t.hali === 'preparing' && (
                            <Btn size="sm" variant="accent" onClick={() => handleNext(t)} disabled={busyId === t.id} className="flex-1 text-[10px] px-2.5 py-1.5">
                              Tayari
                            </Btn>
                          )}
                          {t.hali === 'ready' && (
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
        )}
      </div>
    </div>
  )
}

export function BoardToggle({ open, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-95 ${
        open ? 'bg-espresso text-cream' : 'bg-espresso/[0.04] text-espresso-muted hover:bg-espresso/[0.07]'
      }`}
      aria-label="Fungua ubao wa tikiti"
    >
      <Kanban weight="light" className="w-3.5 h-3.5" />
      Ubao
    </button>
  )
}