const COLORS = {
  neutral: 'bg-espresso/[0.05] text-espresso-muted',
  copper: 'bg-copper/[0.08] text-copper',
  sage: 'bg-sage/[0.12] text-sage',
  danger: 'bg-red-50 text-red-600',
  active: 'bg-copper text-white',
}

export function Badge({ children, color = 'neutral', className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em] ${COLORS[color]} ${className}`}>
      {children}
    </span>
  )
}