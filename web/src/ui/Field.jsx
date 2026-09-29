import { forwardRef } from 'react'

export const Field = forwardRef(function Field({ label, error, className = '', ...props }, ref) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-espresso-muted">
          {label}
        </label>
      )}
      <div className="rounded-full bg-white/60 ring-1 ring-espresso/[0.08] p-[3px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] focus-within:ring-copper/30 focus-within:shadow-[0_0_0_3px_rgba(196,127,61,0.08)]">
        <input
          ref={ref}
          className="w-full bg-transparent rounded-full px-4 py-2.5 text-sm text-espresso placeholder:text-espresso-muted/50 focus:outline-none"
          {...props}
        />
      </div>
      {error && <span className="text-[11px] text-red-500 font-medium">{error}</span>}
    </div>
  )
})

export const FieldSquare = forwardRef(function FieldSquare({ label, error, hint, className = '', ...props }, ref) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-espresso-muted">
          {label}
        </label>
      )}
      <div className="rounded-2xl bg-white/60 ring-1 ring-espresso/[0.08] p-[3px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] focus-within:ring-copper/30 focus-within:shadow-[0_0_0_3px_rgba(196,127,61,0.08)]">
        <input
          ref={ref}
          className="w-full bg-transparent rounded-[calc(1rem-3px)] px-4 py-3 text-sm text-espresso placeholder:text-espresso-muted/50 focus:outline-none"
          {...props}
        />
      </div>
      {/* hint is pulled out of props above so it does not land on the DOM input
          as an unknown attribute, and does not get mistaken for a value. */}
      {hint && !error && <span className="text-[11px] text-espresso-muted/80">{hint}</span>}
      {error && <span className="text-[11px] text-red-500 font-medium">{error}</span>}
    </div>
  )
})

/**
 * Multi-line counterpart to Field. Anything a person writes a sentence into
 * (a staff request, a wastage reason) needs a real textarea — a one-line input
 * hides what was actually written and truncates on mobile.
 */
export const TextArea = forwardRef(function TextArea({ label, error, className = '', rows = 3, ...props }, ref) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-espresso-muted">
          {label}
        </label>
      )}
      <div className="rounded-2xl bg-white/60 ring-1 ring-espresso/[0.08] p-[3px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] focus-within:ring-copper/30 focus-within:shadow-[0_0_0_3px_rgba(196,127,61,0.08)]">
        <textarea
          ref={ref}
          rows={rows}
          className="w-full bg-transparent rounded-[calc(1rem-3px)] px-4 py-3 text-sm text-espresso placeholder:text-espresso-muted/50 focus:outline-none resize-y"
          {...props}
        />
      </div>
      {error && <span className="text-[11px] text-red-500 font-medium">{error}</span>}
    </div>
  )
})