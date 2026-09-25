import { StatusPill } from './charts'

const AINA_LABEL = { mauzo: 'Mauzo ya Kaunta', agizo: 'Agizo Maalum' }
const HALI_META = {
  in_queue:    { label: 'Kwenye Foleni',  tone: 'neutral' },
  preparing:   { label: 'Inatengenezwa',  tone: 'copper' },
  ready:       { label: 'Tayari',         tone: 'safe' },
  collected:   { label: 'Imechukuliwa',   tone: 'neutral' },
  cancelled:   { label: 'Imefutwa',       tone: 'danger' },
}

function fmt(v) {
  return `TSh ${Number(v || 0).toLocaleString()}`
}

function TicketLogo() {
  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex flex-col">
        <span className="font-serif text-sm font-semibold tracking-tight">Cake City</span>
        <span className="text-[9px] uppercase tracking-[0.2em] text-espresso-muted">Daha la Kimilachiwa</span>
      </div>
      <div className="w-8 h-8 rounded-full bg-copper/[0.08] flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-4 h-4 text-copper" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}

function Barcode({ seed }) {
  const bars = []
  let x = 0
  let s = 2
  let i = 0
  const n = String(seed || 0)
  while (x < 100) {
    const w = 1 + ((n[(i * 7 + 3) % n.length]?.charCodeAt(0) || 7) % 3)
    bars.push({ x, w })
    x += w + s
    i++
  }
  return (
    <svg viewBox="0 0 100 16" className="w-full h-4" preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, k) => (
        <rect key={k} x={b.x} y={0} width={b.w} height={16} fill="#1F1A13" />
      ))}
    </svg>
  )
}

/**
 * Commercial-style pickup ticket. `compact` shrinks it for the live board;
 * wrap in `.ticket-sheet` to print only this card.
 */
export function TikitiCard({ ticket, compact = false, actions = null }) {
  const meta = HALI_META[ticket?.hali] || HALI_META.in_queue
  const num = String(ticket?.namba || 0).padStart(2, '0')
  const aina = AINA_LABEL[ticket?.aina] || 'Tikiti'
  const items = ticket?.maelezo || (ticket?.aina === 'agizo' ? ticket?.agizo?.ladha : '')

  return (
    <div className={`cc-ticket ${compact ? 'cc-ticket-compact' : ''}`}>
      <div className="flex flex-col gap-3 p-4">
        <TicketLogo />

        <div className="flex items-center justify-between">
          <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
          <span className="text-[9px] uppercase tracking-[0.18em] text-espresso-muted">{aina}</span>
        </div>

        {/* Perforation */}
        <div className="cc-perf" />

        <div className="flex flex-col items-center py-2">
          <span className="text-[9px] uppercase tracking-[0.25em] text-espresso-muted">Namba ya Tikiti</span>
          <span className="font-serif font-semibold cc-ticket-num tabular-nums">
            {num}
          </span>
        </div>

        {ticket?.jina && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-espresso-muted">Mteja</span>
            <span className="font-medium">{ticket.jina}</span>
          </div>
        )}
        {items && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-espresso-muted">Kitu</span>
            <span className="font-medium text-right max-w-[60%] truncate">{items}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-xs">
          <span className="text-espresso-muted">Jumla</span>
          <span className="font-serif font-semibold text-sm">{fmt(ticket?.jumla)}</span>
        </div>

        <div className="cc-perf" />
        <Barcode seed={`${ticket?.namba || ''}${ticket?.tarehe || ''}`} />
        <span className="text-[8px] text-espresso-muted/70 text-center uppercase tracking-[0.25em]">
          {ticket?.tarehe || ''}
        </span>

        {actions && <div className="flex gap-2 mt-1">{actions}</div>}
      </div>
    </div>
  )
}

/** Full-width sheet used for printing after a sale/order. */
export function TicketSheet({ ticket }) {
  if (!ticket) return null
  return (
    <div className="ticket-sheet flex justify-center">
      <TikitiCard ticket={ticket} />
    </div>
  )
}