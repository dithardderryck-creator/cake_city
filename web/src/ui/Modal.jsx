import { useEffect, useRef } from 'react'

export function Modal({ open, onClose, children, title, className = '' }) {
  const ref = useRef()

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[40] flex items-center justify-center p-4 md:p-8" role="dialog" aria-modal="true">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-espresso/30 backdrop-blur-md"
        style={{ animation: 'overlay-in 0.4s var(--ease-out-expo) forwards' }}
        onClick={onClose}
      />
      {/* content */}
      <div
        ref={ref}
        className={`relative bg-cream rounded-[2rem] ring-1 ring-espresso/[0.06] shadow-[0_24px_80px_rgba(31,26,19,0.12)] max-w-lg w-full max-h-[85dvh] overflow-auto p-6 md:p-8 ${className}`}
        style={{ animation: 'modal-in 0.5s var(--ease-out-expo) forwards' }}
      >
        {title && (
          <div className="mb-5">
            <h2 className="font-serif text-xl font-semibold">{title}</h2>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}