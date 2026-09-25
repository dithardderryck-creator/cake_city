import { useState } from 'react'
import { useAuth } from '../auth'
import { useQuery, gql } from '@apollo/client'
import { motion } from 'framer-motion'
import { Cake, ArrowRight, Lock } from '@phosphor-icons/react'
import { Field } from '../ui/Field'
import { Btn } from '../ui/Btn'
import { Select } from '../ui/Select'

const WAFANYAKAZI = gql`
  query Wafanyakazi { wafanyakazi { id jina jukumu } }
`

const ROLE_LABELS = {
  owner: 'Mmiliki',
  cashier: 'Mfanyakazi wa Kaunta',
  chef: 'Mpishi',
  inventory: 'Mfanyakazi wa Hisa',
}

export default function Login() {
  const { login } = useAuth()
  const { data } = useQuery(WAFANYAKAZI)
  const [staffId, setStaffId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!staffId) { setError('Chagua mfanyakazi'); return }
    if (pin.length < 4) { setError('PIN lazima iwe na tarakimu 4'); return }
    setError('')
    setBusy(true)
    try {
      await login(staffId, pin)
    } catch {
      setError('PIN si sahihi')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const staffList = data?.wafanyakazi || []

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-12 md:py-24">
      {/* Background glow — radial copper orb */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-copper/[0.04] blur-[120px]" />
        <div className="absolute bottom-[-5%] left-1/4 w-[400px] h-[400px] rounded-full bg-sage/[0.03] blur-[100px]" />
      </div>

      {/* Logo mark */}
      <motion.div
        initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.9, ease: [0.32, 0.72, 0, 1] }}
        className="mb-10 flex items-center gap-3"
      >
        <div className="w-10 h-10 rounded-full bg-copper/10 flex items-center justify-center">
          <Cake weight="light" className="w-5 h-5 text-copper" />
        </div>
        <span className="font-serif text-lg font-semibold tracking-tight">Cake City</span>
      </motion.div>

      {/* Eyebrow tag */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.1, ease: [0.32, 0.72, 0, 1] }}
      >
        <span className="inline-flex items-center rounded-full bg-copper/[0.06] text-copper px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] mb-6">
          Ingia kwenye mfumo
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h1
        initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.9, delay: 0.15, ease: [0.32, 0.72, 0, 1] }}
        className="font-serif text-4xl md:text-5xl font-semibold text-center leading-[1.1] max-w-md mb-10"
      >
        Karibu tena
      </motion.h1>

      {/* Login card */}
      <motion.div
        initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.8, delay: 0.25, ease: [0.32, 0.72, 0, 1] }}
        className="w-full max-w-sm"
      >
        <div className="cc-card p-6 md:p-7 rounded-[1.25rem]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <Select
              label="Mfanyakazi"
              value={staffId}
              onChange={(e) => { setStaffId(e.target.value); setError('') }}
            >
              <option value="">— Chagua jina —</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.jina} ({ROLE_LABELS[s.jukumu]})</option>
              ))}
            </Select>

            <div className="relative">
              <Field
                label="PIN"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="Ingiza PIN yako"
                maxLength={6}
                value={pin}
                onChange={(e) => { setPin(e.target.value); setError('') }}
                error={error}
              />
              <Lock weight="light" className="absolute right-5 bottom-[18px] w-4 h-4 text-espresso-muted/40 pointer-events-none" />
            </div>

            <Btn
              type="submit"
              variant="accent"
              size="lg"
              iconRight={ArrowRight}
              disabled={busy}
              className="w-full mt-1"
            >
              {busy ? 'Inaingia...' : 'Ingia'}
            </Btn>
          </form>
        </div>
      </motion.div>
    </div>
  )
}