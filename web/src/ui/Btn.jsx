import { forwardRef } from 'react'

const VARIANTS = {
  primary:
    'bg-espresso text-cream hover:bg-espresso-soft active:scale-[0.97]',
  accent:
    'bg-copper text-white hover:bg-copper-bright active:scale-[0.97]',
  ghost:
    'bg-transparent text-espresso hover:bg-espresso/[0.04] active:scale-[0.98]',
  danger:
    'bg-red-600 text-white hover:bg-red-700 active:scale-[0.97]',
}

const SIZES = {
  sm: 'px-4 py-2 text-xs gap-1.5',
  md: 'px-6 py-2.5 text-sm gap-2',
  lg: 'px-8 py-3.5 text-base gap-2.5',
}

export const Btn = forwardRef(function Btn(
  { children, variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, className = '', disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={`
        group inline-flex items-center justify-center rounded-full font-semibold
        transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]
        active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none select-none
        ${VARIANTS[variant]} ${SIZES[size]} ${className}
      `}
      {...props}
    >
      {Icon && (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-110 group-hover:translate-x-0.5">
          <Icon weight="light" className="w-3.5 h-3.5" />
        </span>
      )}
      {children}
      {IconRight && (
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-black/5 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-[1px] group-hover:scale-105">
          <IconRight weight="light" className="w-3.5 h-3.5" />
        </span>
      )}
    </button>
  )
})