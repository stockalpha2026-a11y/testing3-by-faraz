import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { adminApprove, adminBusinesses, adminCandidate, adminGrant, adminLog, adminReject, adminRequests, adminSetAccess, adminWaitingConnect, getLocalSession, isAdmin, localSignIn, localSignOut, mfaState, notifyDecision, type AdminBusiness, type AdminLogRow, type AdminRequest, type AdminWaiting } from '../utils/supabaseClient'
import AdminMfa from '../components/AdminMfa'
import { daysFor, type Billing } from '../utils/plans'
import { Spinner } from '../components/Loaders'

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const left = (d: number | null) => d === null ? '—' : d <= 0 ? `Expired ${Math.abs(d)}d ago` : `${d} day${d === 1 ? '' : 's'}`
const leftColor = (d: number | null) => d === null ? 'text-neutral-400' : d <= 0 ? 'text-red-500' : d <= 7 ? 'text-amber-600' : 'text-teal-dark'

function AdminSignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!email.trim() || !password) return setErr('Enter your email and password.')
    setBusy(true)
    try {
      const { session, error } = await localSignIn(email, password)
      if (error || !session) { setErr(error?.message || 'Incorrect email or password.'); setBusy(false); return }
      onDone()
    } catch {
      setErr('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">Admin sign in</h1>
          <p className="text-xs text-neutral-400 mt-1">Use your admin email and password. You will also need your authenticator code.</p>
        </div>
        {err && <div className="px-4 py-3 border border-red-200 bg-red-50 text-red-600 text-xs leading-relaxed">{err}</div>}
        <input type="email" autoComplete="username" placeholder="Admin email" value={email} onChange={e => setEmail(e.target.value)}
          className="w-full border border-neutral-300 px-3 py-2.5 text-sm text-black focus:outline-none focus:border-black" />
        <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
          className="w-full border border-neutral-300 px-3 py-2.5 text-sm text-black focus:outline-none focus:border-black" />
        <button type="submit" disabled={busy}
          className="w-full bg-black text-white py-2.5 text-[11px] uppercase tracking-widest disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <Link to="/dashboard" className="block text-center text-[11px] uppercase tracking-widest text-neutral-400 hover:text-black">Back to dashboard</Link>
      </form>
    </div>
  )
}

function NotAdmin() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-5">
        <h1 className="text-2xl font-bold text-black tracking-tight">Not an admin account</h1>
        <p className="text-sm text-neutral-500">You are signed in, but this account does not have admin access. Sign out and sign in with the admin email.</p>
        <button onClick={async () => { await localSignOut(); window.location.href = '/admin' }}
          className="w-full bg-black text-white py-2.5 text-[11px] uppercase tracking-widest">Sign out</button>
        <Link to="/dashboard" className="block text-center text-[11px] uppercase tracking-widest text-neutral-400 hover:text-black">Back to dashboard</Link>
      </div>
    </div>
  )
}

export default function Admin() {
  const [state,    setState]    = useState<'loading' | 'out' | 'notadmin' | 'mfa' | 'yes'>('loading')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [log,      setLog]      = useState<AdminLogRow[]>([])
  const [reason,   setReason]   = useState('')
  const focusId = useSearchParams()[0].get('request')
  const [tab, setTab] = useState<'payments' | 'customers' | 'demo'>('payments')
  const [waiting, setWaiting] = useState<AdminWaiting[]>([])
  const [endDate, setEndDate] = useState<Record<string, string>>({})
  const [requests, setRequests] = useState<AdminRequest[]>([])
  const [bizs,     setBizs]     = useState<AdminBusiness[]>([])
  const [days,     setDays]     = useState<Record<string, string>>({})
  const [msg,      setMsg]      = useState('')
  const [busy,     setBusy]     = useState('')

  const reload = useCallback(async () => {
    const [r, b, l, w] = await Promise.all([adminRequests('pending'), adminBusinesses(), adminLog(), adminWaitingConnect()])
    setRequests(r); setBizs(b); setLog(l); setWaiting(w)
  }, [])

  const init = useCallback(() => {
    getLocalSession().then(async s => {
      if (!s || String(s.user.id).startsWith('mock_user')) return setState('out')
      if (!(await adminCandidate())) return setState('notadmin')
      // On the admin list: require the authenticator step before anything else.
      const m = await mfaState()
      if (m.level !== 'aal2') { setFactorId(m.factorId); return setState('mfa') }
      if (!(await isAdmin())) return setState('notadmin')
      await reload(); setState('yes')
    })
  }, [reload])

  useEffect(() => { init() }, [init])

  const grant = async (businessId: string, n: number, opts: { plan?: string; billing?: string; request?: string } = {}) => {
    if (!Number.isFinite(n) || n < 1 || n > 800) return setMsg('Enter a number of days between 1 and 800.')
    if (!opts.request && !reason.trim()) return setMsg('Write a reason first (it is saved in the log).')
    setBusy(businessId + (opts.request || ''))
    const err = await adminGrant(businessId, Math.round(n), opts.plan, opts.billing, opts.request, opts.request ? 'Payment approved' : reason.trim())
    setBusy('')
    setMsg(err ? `Error: ${err}` : `Done: access extended by ${Math.round(n)} days.`)
    if (!err) { reload(); if (opts.request) notifyDecision(opts.request) }
  }
  const approve = async (r: AdminRequest) => {
    setBusy(r.id)
    const err = await adminApprove(r.id)
    setBusy('')
    if (err) return setMsg(`Error: ${err}`)
    setMsg(r.business_id ? 'Approved. Access extended.' : 'Approved. The customer can now connect their business.')
    reload(); notifyDecision(r.id)
  }
  // Grace period tools: every change needs a reason and is saved in the log.
  const setEnd = async (b: AdminBusiness, end: Date, label: string) => {
    if (!reason.trim()) return setMsg('Write a reason first (it is saved in the log).')
    setBusy(b.id)
    const err = await adminSetAccess(b.id, end, reason.trim())
    setBusy('')
    setMsg(err ? `Error: ${err}` : `Done: ${b.name} ${label}.`)
    if (!err) reload()
  }
  const removeDays = (b: AdminBusiness, n: number) => {
    if (!Number.isFinite(n) || n < 1) return setMsg('Enter how many days to remove.')
    const base = b.access_ends_at ? new Date(b.access_ends_at) : new Date()
    setEnd(b, new Date(base.getTime() - n * 86400000), `lost ${n} days`)
  }
  const pauseNow = (b: AdminBusiness) => setEnd(b, new Date(), 'is paused (access ends now)')
  const setDate = (b: AdminBusiness) => {
    const v = endDate[b.id]
    if (!v) return setMsg('Pick a date first.')
    const d = new Date(v + 'T23:59:59')
    if (isNaN(d.getTime())) return setMsg('That date is not valid.')
    setEnd(b, d, `now ends on ${fmt(d.toISOString())}`)
  }
  const reject = async (id: string) => {
    setBusy(id); const err = await adminReject(id); setBusy('')
    setMsg(err ? `Error: ${err}` : 'Request rejected.'); if (!err) { reload(); notifyDecision(id) }
  }

  if (state === 'loading') return <div className="min-h-screen flex items-center justify-center"><Spinner size="sm" label="Loading…" /></div>
  if (state === 'out') return <AdminSignIn onDone={init} />
  if (state === 'notadmin') return <NotAdmin />
  if (state === 'mfa') return <AdminMfa factorId={factorId} onDone={init} />

  const expiring = bizs.filter(b => b.days_left !== null && b.days_left <= 7)

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <div className="flex items-center justify-between">
          <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-neutral-400 hover:text-black"><ArrowLeft className="h-3.5 w-3.5" /> Dashboard</Link>
          <button onClick={() => { reload(); setMsg('') }} className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-neutral-400 hover:text-black"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">Admin</h1>
          <p className="text-sm text-neutral-500 mt-1">Check your bank/UPI message first, then approve. Approving adds days to the NFC access.</p>
        </div>
        <div className="flex gap-2 border-b border-neutral-200">
          {([['payments', `Payments (${requests.length})`], ['customers', `Customers (${bizs.length})`], ['demo', 'Live demo']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2.5 text-[11px] uppercase tracking-widest font-semibold border-b-2 -mb-px ${tab === k ? 'border-black text-black' : 'border-transparent text-neutral-400 hover:text-black'}`}>{label}</button>
          ))}
        </div>
        {msg && <p className="border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-black">{msg}</p>}

        {tab === 'demo' && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-neutral-500">Live demo: The Coffee Concept, Jabalpur (sample data). Show this to a customer on your laptop. You stay signed in as admin.</p>
              <a href="/demo-embed" target="_blank" rel="noreferrer" className="text-[11px] uppercase tracking-widest text-teal-dark font-semibold hover:text-black whitespace-nowrap ml-4">Open full screen</a>
            </div>
            <iframe title="Live demo" src="/demo-embed" className="w-full border border-neutral-200 bg-white" style={{ height: '75vh', minHeight: 520 }} />
          </section>
        )}

        {focusId && (requests.some(r => r.id === focusId)
          ? <p className="border border-black bg-neutral-50 px-4 py-3 text-sm text-black">Opened from the email. Check the payment in your bank/UPI app (or hold the cash), then approve it below.</p>
          : <p className="border border-neutral-200 px-4 py-3 text-sm text-neutral-500">That request was already handled, or it was not found.</p>)}

        {/* Pending */}
        {tab === 'payments' && <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-semibold text-neutral-400">Waiting for approval ({requests.length})</p>
          {requests.length === 0 && <p className="text-sm text-neutral-400 border border-dashed border-neutral-200 p-6 text-center">No pending payments.</p>}
          {[...requests].sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId)).map(r => (
            <div key={r.id} className={`border p-4 space-y-3 ${r.id === focusId ? 'border-black ring-1 ring-black' : 'border-neutral-200'}`}>
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-semibold text-black">{r.business_name}</p>
                  <p className="text-xs text-neutral-400">{r.owner_email} · {fmt(r.created_at)} · <b className={r.method === 'cash' ? 'text-amber-700' : 'text-black'}>{r.method === 'cash' ? 'CASH' : 'UPI'}</b></p>
                </div>
                <p className="text-sm text-black"><b>₹{r.amount.toLocaleString('en-IN')}</b> · {r.plan} · {r.billing}</p>
              </div>
              <p className="text-sm text-neutral-600">{r.method === 'cash' ? 'Cash request' : 'UPI request'}: <span className="font-mono text-black">{r.reference}</span>{r.note ? ` · “${r.note}”` : ''}</p>
              {r.method === 'cash' && <p className="text-xs text-amber-700">Approve only after you have the cash in your hand.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <button disabled={busy === r.id} onClick={() => approve(r)}
                  className="bg-black text-white px-4 py-2 text-[11px] uppercase tracking-widest font-semibold disabled:opacity-40">
                  Approve +{daysFor(r.billing as Billing)} days
                </button>
                <button disabled={busy === r.id} onClick={() => reject(r.id)} className="border border-neutral-200 px-4 py-2 text-[11px] uppercase tracking-widest font-semibold text-neutral-500 hover:border-red-400 hover:text-red-500">Reject</button>
              </div>
            </div>
          ))}
        </section>}

        {tab === 'payments' && waiting.length > 0 && (
          <section className="space-y-2">
            <p className="text-[11px] uppercase tracking-widest font-semibold text-neutral-400">Approved, not connected yet ({waiting.length})</p>
            {waiting.map(w => (
              <p key={w.user_id} className="border border-neutral-100 px-3 py-2 text-xs text-neutral-600">
                <b className="text-black">{w.email}</b> · {w.plan} {w.billing} · {w.days_credit} days waiting · approved {fmt(w.approved_at)}
              </p>
            ))}
          </section>
        )}

        {/* Expiring */}
        {tab === 'customers' && expiring.length > 0 && (
          <section className="border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <b>{expiring.length} business{expiring.length > 1 ? 'es' : ''}</b> expired or expiring within 7 days: {expiring.map(b => b.name).join(', ')}.
          </section>
        )}

        {/* All businesses */}
        {tab === 'customers' && <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-semibold text-neutral-400">All businesses ({bizs.length})</p>
          <input value={reason} onChange={e => setReason(e.target.value.slice(0, 200))} placeholder="Reason for giving days (required, saved in the log). E.g. grace period, cash received, demo extension"
            className="w-full border border-neutral-200 px-3 py-2.5 text-sm focus:outline-none focus:border-black" />
          <div className="overflow-x-auto border border-neutral-100">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-widest text-neutral-400 border-b border-neutral-100">
                <th className="p-3">Business</th><th className="p-3">Plan</th><th className="p-3">Access</th><th className="p-3">Taps (blocked)</th><th className="p-3">Give days</th>
              </tr></thead>
              <tbody>
                {bizs.map(b => (
                  <tr key={b.id} className="border-b border-neutral-50 align-top">
                    <td className="p-3"><p className="font-semibold text-black">{b.name}</p><p className="text-xs text-neutral-400">{b.owner_email}</p></td>
                    <td className="p-3 text-neutral-600">{b.plan ? `${b.plan} · ${b.billing}` : 'Free month'}</td>
                    <td className="p-3"><p className={`font-semibold ${leftColor(b.days_left)}`}>{left(b.days_left)}</p><p className="text-xs text-neutral-400">until {fmt(b.access_ends_at)}</p></td>
                    <td className="p-3 text-neutral-600">{b.total_taps} ({b.blocked_taps})</td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button disabled={busy === b.id} onClick={() => grant(b.id, 30)} className="border border-neutral-200 px-2 py-1 text-xs hover:border-black">+30</button>
                        <button disabled={busy === b.id} onClick={() => grant(b.id, 365)} className="border border-neutral-200 px-2 py-1 text-xs hover:border-black">+365</button>
                        <input value={days[b.id] || ''} onChange={e => setDays(d => ({ ...d, [b.id]: e.target.value.replace(/\D/g, '').slice(0, 3) }))} placeholder="days" className="w-16 border border-neutral-200 px-2 py-1 text-xs" />
                        <button disabled={busy === b.id || !days[b.id]} onClick={() => grant(b.id, Number(days[b.id]))} className="bg-black text-white px-2 py-1 text-xs disabled:opacity-40">Add</button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <input type="date" value={endDate[b.id] || ''} onChange={e => setEndDate(d => ({ ...d, [b.id]: e.target.value }))} className="border border-neutral-200 px-2 py-1 text-xs" />
                        <button disabled={busy === b.id || !endDate[b.id]} onClick={() => setDate(b)} className="border border-neutral-200 px-2 py-1 text-xs hover:border-black disabled:opacity-40">Set end date</button>
                        <button disabled={busy === b.id || !days[b.id]} onClick={() => removeDays(b, Number(days[b.id]))} className="border border-neutral-200 px-2 py-1 text-xs hover:border-red-400 hover:text-red-500 disabled:opacity-40">Remove days</button>
                        <button disabled={busy === b.id} onClick={() => pauseNow(b)} className="border border-red-200 text-red-500 px-2 py-1 text-xs hover:bg-red-50">Pause now</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {bizs.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-neutral-400">No customer businesses yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-neutral-400">Grace period: “Add” gives extra days (from today if already expired). “Set end date” picks an exact day. “Remove days” takes days back (type the number in the days box). “Pause now” ends access today. Every change needs a reason and is saved in the log.</p>
        </section>}

        {/* Activity log */}
        {tab !== 'demo' && <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-semibold text-neutral-400">Recent activity</p>
          {log.length === 0 && <p className="text-sm text-neutral-400 border border-dashed border-neutral-200 p-6 text-center">Nothing yet.</p>}
          {log.slice(0, 15).map((l, i) => (
            <p key={i} className="border border-neutral-100 px-3 py-2 text-xs text-neutral-600">
              {fmt(l.created_at)} · <b className="text-black">{l.business_name}</b> · +{l.days} days · {l.reason || '—'} · <span className="text-neutral-400">{l.admin_email}</span>
            </p>
          ))}
        </section>}
      </div>
    </div>
  )
}
