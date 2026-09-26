import { useState } from 'react'
import { useMutation } from '@apollo/client'
import { Wallet } from '@phosphor-icons/react'
import { LIPA_SALIO } from '../graphql/mutations'
import { Btn } from './Btn'
import { FieldSquare } from './Field'
import { Modal } from './Modal'

const PAYMENT_LABELS = { cash: 'Taslimu', mpesa: 'M-Pesa', tigopesa: 'Tigo Pesa', airtel_money: 'Airtel Money' }

function fmtTSh(v) {
  return `TSh ${Number(v || 0).toLocaleString('sw-TZ', { maximumFractionDigits: 0 })}`
}

export default function CollectBalanceModal({ order, onClose, onDone, refetchQueries = [] }) {
  // Guarded because this component is mounted with a null order until the
  // cashier picks one. Reading order.salio unguarded threw on the very first
  // render and blanked the whole app.
  const owing = Number(order?.salio) || 0
  const [amount, setAmount] = useState(() => String(owing || ''))
  const [method, setMethod] = useState('cash')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const [lipa] = useMutation(LIPA_SALIO, { refetchQueries })

  const value = Number(amount) || 0
  const tooMuch = value > owing
  const nothing = value <= 0

  const submit = async () => {
    if (tooMuch || nothing) return
    setBusy(true)
    setErr(null)
    try {
      await lipa({ variables: { id: order.id, kiasi: value, njia_ya_malipo: method } })
      onDone?.()
      onClose()
    } catch (e) {
      setErr(e?.message || 'Malipo yashindwa. Jaribu tena.')
    } finally {
      setBusy(false)
    }
  }

  if (!order) return null

  return (
    <Modal open={!!order} onClose={onClose} title="Lipa Salio" className="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <p className="text-xs text-espresso-muted">{order.ladha} — {order.mteja?.jina || 'Mteja'}</p>
          <p className="cc-num text-2xl font-semibold mt-1">{fmtTSh(owing)}</p>
          <p className="text-[11px] text-espresso-muted/70 mt-1">Salio iliyobaki</p>
          {order.hali === 'collected' && (
            <p className="text-[11px] text-copper font-medium mt-2">Amechukuliwa lakini bado analipwa</p>
          )}
        </div>

        <FieldSquare
          label="Kiasi (TSh)"
          type="number"
          min="0"
          max={owing}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setAmount(String(owing))}
          className="self-start text-[11px] font-semibold text-copper hover:underline"
        >
          Lipa salio yote
        </button>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-espresso-muted">Njia ya malipo</span>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(PAYMENT_LABELS).map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMethod(k)}
                className={`px-2 py-2 rounded-lg text-[11px] font-semibold transition-all duration-300 active:scale-95 ${
                  method === k ? 'bg-espresso text-cream' : 'bg-espresso/[0.04] text-espresso-muted hover:bg-espresso/[0.07]'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {tooMuch && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 ring-1 ring-red-200">
            Kiasi ni zaidi ya salio lililobaki.
          </p>
        )}
        {err && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 ring-1 ring-red-200">{err}</p>
        )}

        <div className="flex gap-2">
          <Btn variant="ghost" size="md" className="flex-1" onClick={onClose}>Ghairi</Btn>
          <Btn
            variant="primary"
            size="md"
            className="flex-1"
            icon={Wallet}
            onClick={submit}
            disabled={busy || tooMuch || nothing}
          >
            {busy ? 'Inatuma...' : `Lipa ${fmtTSh(value)}`}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
