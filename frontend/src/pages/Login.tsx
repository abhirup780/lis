import { FlaskConical, ShieldCheck, Activity } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, ErrorNote, Field } from '../components/ui'
import { useAuth } from '../lib/auth'

const DEMO = [
  ['tech', 'Tech1234!', 'Technologist'],
  ['frontdesk', 'Front123!', 'Front desk'],
  ['manager', 'Manager123!', 'Lab manager'],
  ['admin', 'Admin123!', 'Administrator'],
]

export default function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(username, password)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-900 via-brand-800 to-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <span className="text-xl font-bold">LIS</span>
        </div>
        <div className="max-w-md space-y-6">
          <h1 className="text-3xl font-semibold leading-tight">Clinical chemistry and hematology, from order to verified report.</h1>
          <ul className="space-y-3 text-brand-100/90">
            <li className="flex gap-3"><FlaskConical className="size-5 shrink-0" />Autoverification with delta checks, critical values and analytical range rules</li>
            <li className="flex gap-3"><Activity className="size-5 shrink-0" />Westgard multirule QC with Levey-Jennings charts</li>
            <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0" />Role-based access and a complete audit trail</li>
          </ul>
        </div>
        <p className="text-xs text-brand-100/50">For laboratory use by authorized staff.</p>
      </div>
      <div className="flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500">Use your laboratory account.</p>
          </div>
          <Field label="Username">
            <input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" className="w-full" loading={busy} disabled={!username || !password}>
            Sign in
          </Button>
          <div className="rounded-lg border border-dashed border-slate-300 p-3">
            <p className="mb-2 text-xs font-medium text-slate-500">Demo accounts</p>
            <div className="grid grid-cols-2 gap-1.5">
              {DEMO.map(([u, p, label]) => (
                <button
                  type="button"
                  key={u}
                  onClick={() => {
                    setUsername(u)
                    setPassword(p)
                  }}
                  className="rounded-md bg-slate-100 px-2 py-1.5 text-left text-xs hover:bg-brand-50"
                >
                  <span className="font-medium text-slate-700">{label}</span>
                  <span className="block font-mono text-slate-500">{u}</span>
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
