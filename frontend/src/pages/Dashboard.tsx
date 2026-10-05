import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Activity, AlarmClock, Bot, ClipboardList, FlaskConical, Siren, TestTubes, Timer, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { OrderStatusBadge, PatientLink, PriorityBadge } from '../components/lab'
import { Card, ErrorNote, Loading, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { duration, relative } from '../lib/format'
import type { Dashboard } from '../lib/types'

function Stat({ label, value, icon, to, tone = 'default', hint }: {
  label: string
  value: ReactNode
  icon: ReactNode
  to?: string
  tone?: 'default' | 'alert' | 'warn'
  hint?: string
}) {
  const body = (
    <div
      className={clsx(
        'card flex h-full items-start gap-3 p-4 transition',
        to && 'hover:border-brand-500/40 hover:shadow-sm',
        tone === 'alert' && 'border-red-200 bg-red-50/60',
        tone === 'warn' && 'border-amber-200 bg-amber-50/60',
      )}
    >
      <div
        className={clsx(
          'rounded-lg p-2 [&>svg]:size-5',
          tone === 'alert' ? 'bg-red-100 text-red-600' : tone === 'warn' ? 'bg-amber-100 text-amber-700' : 'bg-brand-50 text-brand-700',
        )}
      >
        {icon}
      </div>
      <div>
        <div className="text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
      </div>
    </div>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { data, error, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/dashboard'),
    refetchInterval: 30_000,
  })
  if (isLoading) return <Loading />
  if (error || !data) return <ErrorNote error={error} />

  const autoRate = data.verified_today ? Math.round((data.autoverified_today / data.verified_today) * 100) : null

  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user?.full_name}`}
        subtitle="Live view of the laboratory. Refreshes every 30 seconds."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Critical values to call" value={data.critical_pending} icon={<Siren />} to="/criticals" tone={data.critical_pending ? 'alert' : 'default'} />
        <Stat label="QC rules violated" value={data.qc_rejected} icon={<Activity />} to="/qc" tone={data.qc_rejected ? 'alert' : 'default'} hint="Autoverification paused for those tests" />
        <Stat label="Overdue specimens" value={data.overdue} icon={<AlarmClock />} to="/worklist" tone={data.overdue ? 'warn' : 'default'} hint="Past turnaround target" />
        <Stat label="Open STAT orders" value={data.stat_open} icon={<Zap />} to="/orders?priority=stat" tone={data.stat_open ? 'warn' : 'default'} />
        <Stat label="Orders today" value={data.orders_today} icon={<ClipboardList />} to="/orders" />
        <Stat label="Awaiting collection" value={data.awaiting_collection} icon={<TestTubes />} to="/specimens" />
        <Stat label="Results to verify" value={data.awaiting_verification} icon={<FlaskConical />} to="/worklist?status=review" hint={`${data.in_lab} specimens in the lab`} />
        <Stat
          label="Median TAT (7 days)"
          value={duration(data.median_tat_minutes)}
          icon={<Timer />}
          hint="Receipt to verification"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Card title="Workload by department" className="lg:col-span-3">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.workload} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="department" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={32} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="pending" name="Pending" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="resulted" name="To verify" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="verified_today" name="Verified today" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Autoverification today" className="lg:col-span-2">
          <div className="flex h-64 flex-col items-center justify-center gap-4">
            <div className="relative size-40">
              <svg viewBox="0 0 36 36" className="size-full -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                <circle
                  cx="18"
                  cy="18"
                  r="15.9"
                  fill="none"
                  stroke="#0d9488"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${autoRate ?? 0} 100`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-semibold text-slate-900">{autoRate == null ? '—' : `${autoRate}%`}</span>
                <span className="flex items-center gap-1 text-xs text-slate-500"><Bot className="size-3" />autoverified</span>
              </div>
            </div>
            <p className="text-center text-sm text-slate-500">
              {data.autoverified_today} of {data.verified_today} results released without manual review
            </p>
          </div>
        </Card>
      </div>

      <Card title="Recent orders" className="mt-5" bodyClassName="" actions={<Link to="/orders" className="text-sm text-brand-700 hover:underline">View all</Link>}>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              <th className="th">Order</th>
              <th className="th">Patient</th>
              <th className="th">Priority</th>
              <th className="th">Progress</th>
              <th className="th">Status</th>
              <th className="th">Ordered</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.recent_orders.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="td">
                  <Link to={`/orders/${o.id}`} className="font-mono text-brand-700 hover:underline">{o.order_number}</Link>
                </td>
                <td className="td"><PatientLink patient={o.patient} /></td>
                <td className="td"><PriorityBadge priority={o.priority} /></td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-brand-600" style={{ width: `${(o.verified_count / Math.max(o.test_count, 1)) * 100}%` }} />
                    </div>
                    <span className="text-xs text-slate-500">{o.verified_count}/{o.test_count}</span>
                    {o.has_critical && <Siren className="size-3.5 text-red-600" />}
                  </div>
                </td>
                <td className="td"><OrderStatusBadge status={o.status} /></td>
                <td className="td text-slate-500">{relative(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}
