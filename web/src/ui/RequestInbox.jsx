/**
 * The request inbox, shared by every role that receives one.
 *
 * Two of the blueprint's flows run on this and nothing else: a usage report
 * raising a request to Inventory (BR-13), and a till raising a request to the
 * owner for a custom cake price (BR-05). They have the same shape — somebody
 * asked, somebody must answer, and the answer is a state change that also
 * does real work — so they belong in one place rather than two that drift.
 *
 * A request is a queue, not a notification. The list is ordered oldest first,
 * because the thing that has waited longest is the thing being squeezed, and
 * each row carries the work itself (the sheet, the order) so answering does
 * not require a second screen to remember what was asked.
 */
import { useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { OMBI } from '../graphql/queries'
import { KAMILISHA_OMBI, GHAIRI_OMBI, TOA_BEI } from '../graphql/mutations'
import { CardFull } from './Card'
import { Btn } from './Btn'
import { Badge } from './Badge'
import { Modal } from './Modal'
import { FieldSquare, TextArea } from './Field'
import { Select } from './Select'
import { StatusPill } from './charts'
import { Hourglass, Check, XCircle, Bell } from '@phosphor-icons/react'

function fmtTSh(v) {
  return `TSh ${Number(v || 0).toLocaleString('en-TZ')}`
}

// The states a request can actually be in, by the names the schema uses. The
// permission layer decides which of these the person in front of this screen
// is allowed to move; this only names them.
const STATE_TONE = {
  imeandikwa: 'neutral',
  imetumwa: 'copper',
  inasubiri: 'copper',
  imeanzishwa: 'copper',
  limekubaliwa: 'copper',
  inaendelea: 'copper',
  imeidhinishwa: 'copper',
  inahitaji: 'watch',
  imekamilika: 'safe',
  imekataa: 'danger',
  imeghairi: 'neutral',
}

const STATE_LABEL = {
  imeandikwa: 'Imeandikwa',
  imetumwa: 'Imetumwa',
  inasubiri: 'Inasubiri',
  imeanzishwa: 'Imeanzishwa',
  limekubaliwa: 'Imekubaliwa',
  inaendelea: 'Inaendelea',
  imeidhinishwa: 'Imeidhinishwa',
  inahitaji: 'Inahitaji taarifa',
  imekamilika: 'Imekamilika',
  imekataa: 'Imekataa',
  imeghairi: 'Imeghairiwa',
}

/**
 * A cake with no price. The owner is the only one who can give it one, so this
 * is where they do it: the description the cashier wrote, the name to read it
 * to, and one number. No deposit field unless they want one, because a
 * deposit is the owner's judgement too and forcing the question makes them
 * think about money before they have set the price.
 */
function QuoteCard({ request, onDone }) {
  const [bei, setBei] = useState('')
  const [amali, setAmali] = useState('')
  const [njia, setNjia] = useState('cash')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toaBei] = useMutation(TOA_BEI)

  const amaliNum = Number(amali) || 0
  const beiNum = Number(bei) || 0
  const badAmali = amaliNum > beiNum

  const submit = async (e) => {
    e.preventDefault()
    if (beiNum <= 0) return setErr('Weka bei kwanza.')
    setBusy(true)
    setErr(null)
    try {
      await toaBei({
        variables: { id: request.agizo.id, bei: beiNum, malipo_ya_awali: amaliNum, njia_ya_malipo: njia },
      })
      onDone()
    } catch (ex) {
      setErr(ex?.message || 'Bei imeshindwa. Jaribu tena.')
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="rounded-2xl bg-espresso/[0.03] ring-1 ring-hairline p-4">
        <p className="cc-eyebrow mb-1.5">Agizo</p>
        <p className="font-serif text-lg font-semibold">{request.agizo.ladha}</p>
        {request.agizo.ukubwa && (
          <p className="text-xs text-espresso-muted">Ukubwa: {request.agizo.ukubwa}</p>
        )}
        {request.agizo.umbo && <p className="text-xs text-espresso-muted">Umbo: {request.agizo.umbo}</p>}
        {request.agizo.maelekezo_maalum && (
          <p className="text-sm text-espresso-muted mt-2 leading-relaxed">
            {request.agizo.maelekezo_maalum}
          </p>
        )}
        {request.agizo.mteja && (
          <p className="text-sm font-medium mt-3">
            {request.agizo.mteja.jina}
            {request.agizo.mteja.simu && <span className="text-espresso-muted font-normal"> · {request.agizo.mteja.simu}</span>}
          </p>
        )}
      </div>

      <FieldSquare
        label="Bei (TSh)"
        type="number"
        min="0"
        required
        value={bei}
        onChange={(e) => setBei(e.target.value)}
        placeholder="80000"
      />

      {beiNum > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <FieldSquare
            label="Amepea (TSh)"
            type="number"
            min="0"
            value={amali}
            onChange={(e) => setAmali(e.target.value)}
            placeholder={String(beiNum)}
            error={badAmali ? 'Zaidi ya bei' : undefined}
          />
          <Select label="Njia" value={njia} onChange={(e) => setNjia(e.target.value)}>
            <option value="cash">Taslimu</option>
            <option value="mpesa">M-Pesa</option>
            <option value="tigopesa">Tigo Pesa</option>
            <option value="airtel_money">Airtel Money</option>
          </Select>
        </div>
      )}

      {err && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 ring-1 ring-red-200">{err}</p>
      )}

      <Btn type="submit" variant="primary" size="lg" iconRight={Check} disabled={busy || beiNum <= 0 || badAmali} className="w-full">
        {busy ? 'Inaweka...' : 'Weka Bei na Uanze'}
      </Btn>
      <p className="text-[11px] text-espresso-muted text-center">
        Bei ikisharekebishwa, agizo litaenda moja kwa moja na tikiti itatuma kwenye rafiki.
      </p>
    </form>
  )
}

/** A usage sheet waiting on confirmation. The numbers are the request. */
function SheetCard({ request, onDone }) {
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [kamilisha] = useMutation(KAMILISHA_OMBI, { refetchQueries: [{ query: OMBI, variables: { fungua: true } }] })

  const run = async () => {
    setBusy(true)
    setErr(null)
    try {
      await kamilisha({ variables: { id: request.id, jibu: 'Imekubaliwa na hesabu' } })
      onDone()
    } catch (ex) {
      setErr(ex?.message || 'Imeshindwa. Jaribu tena.')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-espresso-muted leading-relaxed">{request.ujumbe}</p>
      {err && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 ring-1 ring-red-200">{err}</p>
      )}
      <Btn variant="primary" size="lg" icon={Check} disabled={busy} onClick={run} className="w-full">
        {busy ? 'Inafanya...' : 'Kubali na Kurekebisha Hisa'}
      </Btn>
      <p className="text-[11px] text-espresso-muted text-center">
        Hisa zinarekebishwa pale tu unapokubali. Hakuna kinachobadilika kabla ya muda huo.
      </p>
    </div>
  )
}

export default function RequestInbox({ title = 'Maombi' }) {
  const { data, loading, refetch } = useQuery(OMBI, {
    variables: { fungua: true, aina: 'ombi' },
    refetchInterval: 20000,
  })
  const [ghairi] = useMutation(GHAIRI_OMBI)
  const [active, setActive] = useState(null)
  const [showCancel, setShowCancel] = useState(null)
  const [sababu, setSababu] = useState('')

  const open = data?.ombi || []
  const waiters = open.filter((o) => o.hai)

  const row = (r) => {
    const isQuote = r.agizo && r.agizo.hali === 'awaiting_quote'
    const Title = r.mada || (isQuote ? 'Bei ya agizo' : 'Ombi')
    return (
      <div
        key={r.id}
        className="flex items-start gap-3 px-4 py-3.5 rounded-2xl bg-espresso/[0.02] ring-1 ring-hairline"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug">{Title}</p>
          {isQuote && r.agizo.mteja && (
            <p className="text-xs text-espresso-muted">
              {r.agizo.mteja.jina} · {r.agizo.ladha}
            </p>
          )}
          {!isQuote && r.malighafi && (
            <p className="text-xs text-espresso-muted">
              {r.malighafi.jina}{r.kiasi ? ` · ${r.kiasi}` : ''}
            </p>
          )}
          <p className="text-[11px] text-espresso-muted/70 mt-1">
            {r.kutoka_kwa?.jina} · {r.zingumiaji?.kumbukumbu ? `${r.zingumiaji.kumbukumbu} · ` : ''}
            {new Date(r.created_at).toLocaleString('en-TZ', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <StatusPill tone={STATE_TONE[r.hali] || 'neutral'}>{STATE_LABEL[r.hali] || r.hali}</StatusPill>
          {r.hai && (
            <div className="flex gap-1">
              <Btn size="sm" variant="primary" onClick={() => setActive(r)}>
                {isQuote ? 'Weka Bei' : 'Fungua'}
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => { setShowCancel(r); setSababu('') }}>
                <XCircle weight="light" className="w-3.5 h-3.5" />
              </Btn>
            </div>
          )}
        </div>
      </div>
    )
  }

  const doCancel = async () => {
    try {
      await ghairi({ variables: { id: showCancel.id, sababu: sababu || undefined } })
      setShowCancel(null)
      refetch()
    } catch { /* the row stays; a silent failure is worse than a stale list */ }
  }

  return (
    <>
      <CardFull className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-serif text-xl font-semibold flex items-center gap-2">
              <Bell weight="light" className="w-5 h-5 text-copper" />
              {title}
            </h2>
            <p className="text-xs text-espresso-muted">
              {waiters.length
                ? `${waiters.length} inasubiri jibu lako`
                : 'Hakuna kinachosubiri.'}
            </p>
          </div>
        </div>

        {loading && !data && (
          <p className="text-sm text-espresso-muted flex items-center gap-2 py-4">
            <Hourglass weight="light" className="w-4 h-4" /> Inapakia...
          </p>
        )}

        {!loading && waiters.length === 0 && (
          <p className="text-sm text-espresso-muted py-4">Hakuna maombi yaliyo wazi.</p>
        )}

        <div className="flex flex-col gap-2">{waiters.map(row)}</div>
      </CardFull>

      {/* Answering */}
      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.agizo?.hali === 'awaiting_quote' ? 'Weka Bei ya Agizo' : active?.mada || 'Ombi'}
        className="max-w-md"
      >
        {active && (
          active.agizo?.hali === 'awaiting_quote'
            ? <QuoteCard request={active} onDone={() => { setActive(null); refetch() }} />
            : <SheetCard request={active} onDone={() => { setActive(null); refetch() }} />
        )}
      </Modal>

      {/* Declining */}
      <Modal open={!!showCancel} onClose={() => setShowCancel(null)} title="Ghairi Ombi" className="max-w-sm">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-espresso-muted">
            Ombi hili litafutwa kwenye orodha ya wazi. Wafanyakazi wengine hawaoni.
          </p>
          <TextArea
            label="Sababu (si lazima)"
            value={sababu}
            onChange={(e) => setSababu(e.target.value)}
            placeholder="Kwa nini..."
          />
          <Btn variant="danger" size="lg" onClick={doCancel} className="w-full">
            Ghairi
          </Btn>
        </div>
      </Modal>
    </>
  )
}
