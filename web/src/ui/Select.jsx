import { forwardRef } from 'react'

export const Select = forwardRef(function Select({ label, error, className = '', children, ...props }, ref) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-espresso-muted">
          {label}
        </label>
      )}
      <div className="rounded-full bg-white/60 ring-1 ring-espresso/[0.08] p-[3px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] focus-within:ring-copper/30">
        <select
          ref={ref}
          className="w-full bg-transparent rounded-full px-4 py-2.5 text-sm text-espresso appearance-none cursor-pointer focus:outline-none"
          {...props}
        >
          {children}
        </select>
      </div>
      {error && <span className="text-[11px] text-red-500 font-medium">{error}</span>}
    </div>
  )
})