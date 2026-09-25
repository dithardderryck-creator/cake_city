import { useReveal } from '../hooks/useReveal'

/* Default Card — beveled hairline card (reference style). */
export function Card({ children, className = '', inner = {}, ...props }) {
  const ref = useReveal()
  return (
    <div
      ref={ref}
      className={`cc-card reveal-up p-5 md:p-6 ${className}`}
      {...props}
    >
      <div className="h-full" {...inner}>
        {children}
      </div>
    </div>
  )
}

export function CardFull({ children, className = '', ...props }) {
  const ref = useReveal()
  return (
    <div
      ref={ref}
      className={`reveal-up rounded-[1.5rem] bg-espresso/[0.04] ring-1 ring-espresso/[0.06] p-[5px] shadow-[0_1px_3px_rgba(31,26,19,0.03)] ${className}`}
      {...props}
    >
      <div className="rounded-[calc(1.5rem-5px)] bg-cream shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] p-5 md:p-6 h-full">
        {children}
      </div>
    </div>
  )
}