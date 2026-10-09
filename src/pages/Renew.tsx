import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Copy } from 'lucide-react'
import { getLocalSession, loadBusinesses, loadMyPaymentRequests, submitPaymentRequest, type PaymentRequest, type SavedBusiness } from '../utils/supabaseClient'
import { PLAN_LIST, daysFor, priceFor, type Billing } from '../utils/plans'
import { Spinner } from '../components/Loaders'

// One or more UPI IDs, comma-separated in VITE_PAY_UPI_ID, e.g. "a@okaxis,b@ybl"
const UPI_LIST = ((import.meta.env.VITE_PAY_UPI_ID as string | undefined) || '').split(',').map(x => x.trim()).filter(Boolean)
const PAY_NAME = (import.meta.env.VITE_PAY_NAME as string | undefined)?.trim() || 'ReviewRadar'

const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function Renew() {
  const [loading,   setLoading]   = useState(true)
  const [isDemo,    setIsDemo]    = useState(false)
  const [bizList,   setBizList]   = useState<SavedBusiness[]>([])
  const [bizIdx,    setBizIdx]    = useState(0)
  const [plan,      setPlan]      = useState('basic')
  const [billing,   setBilling]   = useState<Billing>('monthly')
  const [method,    setMethod]    = useState<'upi' | 'cash'>('upi')
  const [step,      setStep]      = useState<1 | 2 | 3>(1)
  const [reference] = useState('')
  const [note,      setNote]      = useState('')
  const [busy,      setBusy]      = useState(false)
  const [err,       setErr]       = useState('')
  const [sent,      setSent]      = useState(false)
  const [history,   setHistory]   = useState<PaymentRequest[]>([])
  const [userCode,  setUserCode]  = useState('')
  const [qr,        setQr]        = useState('')
  const [copied,    setCopied]    = useState('')
  const [upiIdx,    setUpiIdx]    = useState(0)
  const UPI_ID = UPI_LIST[upiIdx] as string | undefined

  useEffect(() => {
    // Plan chosen on the pricing page (saved when "Start free" was clicked)
    try {
      const pref = JSON.parse(localStorage.getItem('rr_plan_pref') || 'null')
      if (pref?.plan && PLAN_LIST.some(p => p.id === pref.plan)) setPlan(pref.plan)
      if (pref?.billing === 'annual' || pref?.billing === 'monthly') setBilling(pref.billing)
    } catch { /* ignore */ }

    getLocalSession().then(async s => {
      if (!s) { setLoading(false); return }
      if (String(s.user.id).startsWith('mock_user')) { setIsDemo(true); setLoading(false); return }
      // Short code the customer writes in the UPI note so we can match the payment to them.
      setUserCode('RR-' + String(s.user.id).replace(/-/g, '').slice(0, 6).toUpperCase())
      const list = await loadBusinesses(s.user.id)
      setBizList(list); setLoading(false)
    })
  }, [])

  const biz = bizList[bizIdx]
  const amount = priceFor(plan, billing)
  const days = daysFor(billing)
  const code = biz?.slug || userCode

  // Payment history belongs to the customer (works before any business is connected).
  const [historyReady, setHistoryReady] = useState(false)
  useEffect(() => {
    if (loading || isDemo) return
    loadMyPaymentRequests().then(h => { setHistory(h); setHistoryReady(true) })
  }, [loading, isDemo, sent])

  // Already sent a request earlier? Go straight to the "waiting" screen.
  useEffect(() => {
    if (historyReady && history[0]?.status === 'pending') setStep(s => (s === 1 ? 3 : s))
  }, [historyReady, history])

  // On the "waiting" step, check for the admin's decision every 15 seconds.
  useEffect(() => {
    if (step !== 3) return
    const t = setInterval(() => loadMyPaymentRequests().then(setHistory), 15000)
    return () => clearInterval(t)
  }, [step])

  const upiLink = useMemo(() => UPI_ID
    ? `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(PAY_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(code || 'ReviewRadar')}`
    : '', [amount, code, UPI_ID])

  useEffect(() => {
    if (!upiLink) { setQr(''); return }
    import('qrcode').then(m => m.toDataURL(upiLink, { width: 220, margin: 1 })).then(setQr).catch(() => setQr(''))
  }, [upiLink])

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(''), 1500) }).catch(() => {})
  }

    const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const res = await submitPaymentRequest({ businessId: biz?.id ?? null, plan, billing, amount, reference, note, method })
    setBusy(false)
    if (res.error) return setErr(res.error)
    setSent(true); setNote(''); setStep(3)
  }

  const hasPending = history.some(h => h.status === 'pending')

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-neutral-400 hover:text-black">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">{biz ? 'Renew your plan' : 'Choose your plan & pay'}</h1>
          <p className="mt-1 text-sm text-neutral-500">Pick a plan, pay by UPI or cash, then tap <b>Request access</b>. After we check the payment we unlock your dashboard, and then you connect your business.</p>
        </div>

        {loading && <Spinner size="sm" label="Loading…" />}

        {!loading && isDemo && (
          <p className="border border-neutral-200 p-4 text-sm text-neutral-500">This is the demo account, so there is nothing to renew. <Link to="/signup" className="underline text-black">Sign up</Link> to connect your own business.</p>
        )}

        {!loading && !isDemo && (
          <>
            {bizList.length > 1 && (
              <select value={bizIdx} onChange={e => setBizIdx(Number(e.target.value))} className="w-full border border-neutral-200 px-3 py-2.5 text-sm">
                {bizList.map((b, i) => <option key={b.place_id} value={i}>{b.name}</option>)}
              </select>
            )}

            {biz && (
              <div className="border border-neutral-100 p-4 text-sm flex flex-wrap justify-between gap-2">
                <span className="font-semibold text-black">{biz.name}</span>
                <span className="text-neutral-500">Access until <b className="text-black">{fmtDate(biz.access_ends_at)}</b>{biz.plan ? ` · ${biz.plan} (${biz.billing})` : ''}</span>
              </div>
            )}

            {/* 1. Choose */}
            <section className={`space-y-4 ${step === 1 ? '' : 'hidden'}`}>
              <p className="text-[11px] uppercase tracking-widest font-semibold text-neutral-400">1 · Choose your plan</p>
              <div className="flex gap-2">
                {(['monthly', 'annual'] as Billing[]).map(b => (
                  <button key={b} onClick={() => setBilling(b)} className={`px-4 py-2 text-[11px] uppercase tracking-widest font-semibold border ${billing === b ? 'bg-black text-white border-black' : 'border-neutral-200 text-neutral-500 hover:border-black'}`}>
                    {b === 'annual' ? 'Yearly (save)' : 'Monthly'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {PLAN_LIST.map(p => (
                  <button key={p.id} onClick={() => setPlan(p.id)} className={`p-3 text-left border ${plan === p.id ? 'border-black bg-neutral-50' : 'border-neutral-200 hover:border-neutral-400'}`}>
                    <p className="text-sm font-bold text-black">{p.name}</p>
                    <p className="text-xs text-neutral-500">₹{(billing === 'annual' ? p.annual : p.monthly).toLocaleString('en-IN')}/mo</p>
                  </button>
                ))}
              </div>
              <p className="text-sm text-neutral-600">
                You pay <b className="text-black">₹{amount.toLocaleString('en-IN')}</b> for <b className="text-black">{days} days</b>{billing === 'annual' ? ' (12 months billed once)' : ''}.
                Need Enterprise? <Link to="/#pricing" className="underline">Contact us</Link>.
              </p>
              <button onClick={() => setStep(2)} className="bg-black text-white px-5 py-3 text-[11px] uppercase tracking-widest font-semibold">Continue to payment</button>
            </section>

            {/* 2. Pay */}
            <section className={`space-y-4 ${step === 2 ? '' : 'hidden'}`}>
              <p className="text-[11px] uppercase tracking-widest font-semibold text-neutral-400">2 · Choose how you are paying</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Payment method">
                {(['upi', 'cash'] as const).map(m => (
                  <button type="button" key={m} role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                    className={`flex items-center gap-3 p-4 text-left border transition-colors ${method === m ? 'border-black bg-neutral-50' : 'border-neutral-200 hover:border-neutral-400'}`}>
                    <span className={`h-5 w-5 shrink-0 border flex items-center justify-center ${method === m ? 'bg-black border-black' : 'border-neutral-300'}`}>
                      {method === m && <Check className="h-3.5 w-3.5 text-white" />}
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-black">{m === 'upi' ? 'Pay by UPI' : 'Pay by cash'}</span>
                      <span className="block text-xs text-neutral-500">{m === 'upi' ? 'Scan the QR code, then tap confirm' : 'Hand us the cash in person, then send a request'}</span>
                    </span>
                  </button>
                ))}
              </div>
              {method === 'cash' && (
                <p className="border border-neutral-200 p-4 text-sm text-neutral-600">Pay <b className="text-black">₹{amount.toLocaleString('en-IN')}</b> in cash to us in person. Then tap <b>Request access</b> below. We get notified and unlock your account once we have received the cash.</p>
              )}
              {method === 'upi' && UPI_LIST.length > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-neutral-500">Pay to:</span>
                  {UPI_LIST.map((u, i) => (
                    <button type="button" key={u} onClick={() => setUpiIdx(i)}
                      className={`px-3 py-1.5 text-xs font-mono border ${upiIdx === i ? 'bg-black text-white border-black' : 'border-neutral-200 text-neutral-600 hover:border-neutral-400'}`}>{u}</button>
                  ))}
                </div>
              )}
              {method === 'upi' && (UPI_ID ? (
                <div className="border border-neutral-200 p-4 flex flex-col sm:flex-row gap-5 items-start">
                  {qr && <img src={qr} alt="UPI QR code" width={160} height={160} className="border border-neutral-100" />}
                  <div className="space-y-2 text-sm">
                    <p className="text-neutral-500">Scan with any UPI app, or pay to:</p>
                    <button onClick={() => copy(UPI_ID, 'upi')} className="inline-flex items-center gap-2 font-mono text-black border border-neutral-200 px-3 py-1.5 hover:border-black">
                      {UPI_ID} {copied === 'upi' ? <Check className="h-3.5 w-3.5 text-teal-dark" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <p className="text-neutral-500">Amount: <b className="text-black">₹{amount.toLocaleString('en-IN')}</b>. In the payment note write: <button onClick={() => copy(code, 'code')} className="font-mono text-black underline">{code || '—'}</button></p>
                    <a href={upiLink} className="sm:hidden inline-block bg-black text-white px-4 py-2 text-[11px] uppercase tracking-widest font-semibold">Open UPI app</a>
                  </div>
                </div>
              ) : (
                <p className="border border-amber-300 bg-amber-50 text-amber-800 text-xs p-3">Payment details are not set up yet. Please contact us to pay.</p>
              ))}
            </section>

            {/* 3. Confirm */}
            <section className={`space-y-4 ${step === 2 ? '' : 'hidden'}`}>
              <p className="text-[11px] uppercase tracking-widest font-semibold text-neutral-400">3 · Confirm your payment</p>
              {sent ? (
                <p className="border border-teal bg-neutral-50 p-4 text-sm text-black">Thanks! We got your request and will unlock your account as soon as we confirm the payment.</p>
              ) : (
                <form onSubmit={submit} className="space-y-3">
                  <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" maxLength={300}
                    className="w-full border border-neutral-200 px-3 py-2.5 text-sm focus:outline-none focus:border-black" />
                  {err && <p className="text-xs text-red-500">{err}</p>}
                  {hasPending && <p className="text-xs text-amber-700">You already have a payment waiting for approval. Only send another if it is a different payment.</p>}
                  <button disabled={busy} className="bg-black text-white px-5 py-3 text-[11px] uppercase tracking-widest font-semibold disabled:opacity-40">
                    {busy ? 'Sending…' : 'Request access'}
                  </button>
                </form>
              )}
            </section>

            {step === 2 && <button onClick={() => setStep(1)} className="text-[11px] uppercase tracking-widest text-neutral-400 hover:text-black">← Change plan</button>}

            {step === 3 && (
              <section className="border border-neutral-200 p-5 space-y-3">
                {history[0]?.status === 'approved' ? (<>
                  <p className="text-lg font-bold text-black">Approved. You're all set.</p>
                  <p className="text-sm text-neutral-600">{biz ? 'Your plan is active. Thank you!' : 'Your account is unlocked. Next step: connect your business to see your reviews.'}</p>
                  <Link to="/dashboard" className="inline-block bg-black text-white px-5 py-3 text-[11px] uppercase tracking-widest font-semibold">{biz ? 'Go to dashboard' : 'Connect your business'}</Link>
                </>) : history[0]?.status === 'rejected' ? (<>
                  <p className="text-lg font-bold text-red-500">We couldn't confirm this payment.</p>
                  <p className="text-sm text-neutral-600">Check the details and try again, or contact us.</p>
                  <button onClick={() => { setStep(2); setSent(false) }} className="border border-black px-5 py-3 text-[11px] uppercase tracking-widest font-semibold">Try again</button>
                </>) : (<>
                  <p className="text-lg font-bold text-black">Waiting for approval</p>
                  <p className="text-sm text-neutral-600">We have your {history[0]?.method === 'cash' ? 'cash request' : 'payment details'}. We approve it as soon as we confirm the payment, usually the same day. This page updates by itself, and we'll email you too.</p>
                  <Link to="/dashboard" className="inline-block text-[11px] uppercase tracking-widest text-neutral-400 hover:text-black">Go to dashboard</Link>
                  <Spinner size="sm" label="Checking for approval…" />
                </>)}
              </section>
            )}

            {history.length > 0 && (
              <section className="space-y-2">
                <p className="text-[11px] uppercase tracking-widest font-semibold text-neutral-400">Your payments</p>
                {history.map(h => (
                  <div key={h.id} className="flex flex-wrap justify-between gap-2 border border-neutral-100 px-3 py-2 text-xs">
                    <span>{fmtDate(h.created_at)} · {h.plan} {h.billing} · ₹{h.amount.toLocaleString('en-IN')} · <span className="font-mono">{h.reference}</span></span>
                    <span className={h.status === 'approved' ? 'text-teal-dark font-semibold' : h.status === 'rejected' ? 'text-red-500 font-semibold' : 'text-amber-600 font-semibold'}>
                      {h.status === 'approved' ? `Approved (+${h.days_granted} days)` : h.status === 'rejected' ? 'Not accepted' : 'Waiting for approval'}
                    </span>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
