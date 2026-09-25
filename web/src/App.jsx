import { useState } from 'react'
import { useAuth } from './auth'
import { SignOut, ChefHat, Package, Storefront, Swatches } from '@phosphor-icons/react'
import { ReminderBell } from './ui/ReminderBell'
import { TicketBoard, BoardToggle } from './ui/TicketBoard'
import Login from './screens/Login'
import Cashier from './screens/Cashier'
import Chef from './screens/Chef'
import Inventory from './screens/Inventory'
import Owner from './screens/Owner'

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-[100dvh] flex items-center justify-center"><div className="w-5 h-5 rounded-full border-2 border-copper border-t-transparent animate-spin" /></div>
  return user ? <Shell /> : <Login />
}

const ROLE_META = {
  owner:     { label: 'Mmiliki',        color: 'bg-copper/10 text-copper' },
  cashier:   { label: 'Mfanyakazi wa Kaunta', color: 'bg-copper/10 text-copper' },
  chef:      { label: 'Mpishi',         color: 'bg-sage/12 text-sage' },
  inventory: { label: 'Mfanyakazi wa Hisa', color: 'bg-espresso/[0.06] text-espresso-muted' },
}

const ROLE_ICONS = {
  owner: Storefront,
  cashier: Swatches,
  chef: ChefHat,
  inventory: Package,
}

function Shell() {
  const { user, logout } = useAuth()
  const meta = ROLE_META[user.jukumu]
  const RoleIcon = ROLE_ICONS[user.jukumu]
  const today = new Date().toLocaleDateString('sw', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const canBoard = ['owner', 'cashier', 'chef'].includes(user.jukumu)
  const [boardOpen, setBoardOpen] = useState(false)

  return (
    <div className="min-h-[100dvh]">
      {/* ── Floating Island Nav ─────────────────────────────── */}
      <div className="fixed top-4 left-0 right-0 z-30 flex justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 px-4 py-2 rounded-full bg-white/70 backdrop-blur-xl ring-1 ring-hairline shadow-[0_4px_24px_rgba(31,26,19,0.06)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${meta.color}`}>
            <RoleIcon weight="light" className="w-3 h-3" />
            {meta.label}
          </span>
          <span className="w-px h-4 bg-espresso/[0.08]" />
          <span className="text-xs font-medium text-espresso-muted hidden sm:block">{user.jina}</span>
          <span className="w-px h-4 bg-espresso/[0.08] hidden sm:block" />
          <span className="text-[10px] text-espresso-muted/70 hidden md:block capitalize">{today}</span>
          <span className="w-px h-4 bg-espresso/[0.08]" />
          {canBoard && <BoardToggle open={boardOpen} onToggle={() => setBoardOpen((v) => !v)} />}
          <ReminderBell />
          <button
            onClick={logout}
            className="ml-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full text-espresso-muted hover:bg-espresso/[0.04] hover:text-espresso transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-95"
            aria-label="Ondoka"
          >
            <SignOut weight="light" className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      <div className="pt-20 pb-12 px-4 md:px-8 max-w-7xl mx-auto">
        {user.jukumu === 'owner'     && <Owner />}
        {user.jukumu === 'cashier'   && <Cashier />}
        {user.jukumu === 'chef'      && <Chef />}
        {user.jukumu === 'inventory' && <Inventory />}
      </div>

      {/* ── Live Ticket Board ───────────────────────────────── */}
      {canBoard && (
        <TicketBoard open={boardOpen} onClose={() => setBoardOpen(false)} />
      )}
    </div>
  )
}