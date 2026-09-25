import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { UKUMBUSHO } from '../graphql/queries'
import { SOMA_UKUMBUSHO } from '../graphql/mutations'
import { Bell, BellRinging, CheckCircle } from '@phosphor-icons/react'
import { Badge } from './Badge'

const REMINDER_META = {
  anza_kutengeneza:  { color: 'danger', label: 'Anza Sasa' },
  tarehe_ya_kuchukua: { color: 'copper', label: 'Tarehe ya Kuchukua' },
  hisa_itakosa:     { color: 'sage', label: 'Hisa Itakosa' },
  hisa_chini:       { color: 'sage', label: 'Hisa Chini' },
}

export function ReminderBell() {
  const [open, setOpen] = useState(false)
  const { data, refetch } = useQuery(UKUMBUSHO, { pollInterval: 30000 })
  const [mut] = useMutation(SOMA_UKUMBUSHO)
  const ref = useRef()
  const items = data?.ukumbusho || []
  const urgent = items.filter((r) => r.aina === 'anza_kutengeneza')

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const markRead = async (id) => {
    await mut({ variables: { id } })
    refetch()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); if (!open) refetch() }}
        className="relative inline-flex items-center justify-center w-7 h-7 rounded-full text-espresso-muted hover:bg-espresso/[0.04] hover:text-espresso transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-95"
        aria-label="Ukumbusho"
      >
        {urgent.length > 0
          ? <BellRinging weight="light" className="w-4 h-4 text-copper" />
          : <Bell weight="light" className="w-4 h-4" />}
        {items.length > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[15px] h-[15px] px-[3px] rounded-full bg-copper text-white text-[9px] font-bold tabular-nums">
            {items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-[340px] max-h-[70dvh] overflow-auto rounded-3xl bg-cream ring-1 ring-espresso/[0.08] shadow-[0_24px_64px_rgba(31,26,19,0.14)] p-4 md:p-5"
          style={{ animation: 'modal-in 0.45s var(--ease-out-expo) forwards' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif text-base font-semibold">Ukumbusho</h3>
            {items.length > 0 && <Badge color="copper">{items.length} zipo</Badge>}
          </div>

          {items.length === 0 && (
            <p className="text-sm text-espresso-muted/60 text-center py-8">Hakuna ukumbusho sasa</p>
          )}

          <div className="flex flex-col gap-2.5">
            {items.map((r) => {
              const meta = REMINDER_META[r.aina] || REMINDER_META.hisa_chini
              return (
                <div key={r.id} className="group rounded-2xl bg-espresso/[0.03] p-3.5 ring-1 ring-espresso/[0.05]">
                  <div className="flex items-center justify-between mb-1.5">
                    <Badge color={meta.color}>{meta.label}</Badge>
                    <button
                      onClick={() => markRead(r.id)}
                      className="text-espresso-muted hover:text-sage transition-colors"
                      aria-label="Weka kama imesomwa"
                    >
                      <CheckCircle weight="light" className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs leading-relaxed text-espresso">{r.ujumbe}</p>
                  {(r.agizo || r.malighafi) && (
                    <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-espresso-muted">
                      {r.agizo ? `${r.agizo.ladha} · ${r.agizo.tarehe_ya_kuchukua}` : `${r.malighafi.jina} (${r.malighafi.kiasi_kilichopo}${r.malighafi.unit})`}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}