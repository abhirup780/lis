import { useQuery } from '@tanstack/react-query'
import { ClipboardList, LineChart as LineIcon, Pencil, Plus, Siren } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { OrderStatusBadge, PatientBanner, PriorityBadge, valueClass } from '../components/lab'
import { Button, Card, Empty, ErrorNote, Loading, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { date, dateTime } from '../lib/format'
import type { OrderSummary, Patient, TestDef, TrendPoint } from '../lib/types'
import { PatientForm } from './Patients'

function Trend({ patientId }: { patientId: number }) {
  const tests = useQuery({ queryKey: ['tests'], queryFn: () => api<TestDef[]>('/catalog/tests') })
  const [code, setCode] = useState('HGB')
  const trend = useQuery({
    queryKey: ['trend', patientId, code],
    queryFn: () => api<TrendPoint[]>(`/patients/${patientId}/trend/${code}`),
  })
  const points = (trend.data ?? []).filter((p) => p.value_numeric != null)
  const latest = points.at(-1)
  const test = tests.data?.find((t) => t.code === code)
  const chartData = points.map((p) => ({ ...p, label: date(p.at) }))
  // Keep the reference band in view so values read against it.
  const values = points.map((p) => p.value_numeric as number)
  const lo = Math.min(...values, latest?.ref_low ?? Infinity)
  const hi = Math.max(...values, latest?.ref_high ?? -Infinity)
  const pad = (hi - lo) * 0.1 || 1
  const domain: [number, number] = [Math.max(0, lo - pad), hi + pad]

  return (
    <Card
      title={<span className="flex items-center gap-2"><LineIcon className="size-4" />Cumulative trend</span>}
      actions={
        <select className="input w-64 py-1" value={code} onChange={(e) => setCode(e.target.value)}>
          {['CHEM', 'HEME'].map((dept) => (
            <optgroup key={dept} label={dept === 'CHEM' ? 'Chemistry' : 'Hematology'}>
              {tests.data?.filter((t) => t.department.code === dept && t.result_type === 'numeric').map((t) => (
                <option key={t.code} value={t.code}>{t.name} ({t.code})</option>
              ))}
            </optgroup>
          ))}
        </select>
      }
    >
      {points.length === 0 ? (
        <Empty title="No verified results for this test yet" />
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="h-64 md:col-span-3">
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                {latest?.ref_low != null && latest?.ref_high != null && (
                  <ReferenceArea y1={latest.ref_low} y2={latest.ref_high} fill="#14b8a6" fillOpacity={0.12} />
                )}
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis domain={domain} tick={{ fontSize: 11, fill: '#64748b' }} width={44} tickFormatter={(v: number) => v.toFixed(test?.decimals ?? 1)} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v} ${test?.unit ?? ''}`, test?.name ?? code]} />
                <Line type="linear" dataKey="value_numeric" stroke="#0f766e" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1 text-sm">
            <div className="text-xs font-medium uppercase text-slate-400">Results</div>
            {[...points].reverse().map((p) => (
              <Link key={p.order_id} to={`/orders/${p.order_id}`} className="flex justify-between rounded px-2 py-1 hover:bg-slate-50">
                <span className="text-slate-500">{dateTime(p.at)}</span>
                <span className={valueClass(p.flag)}>{p.value_text}</span>
              </Link>
            ))}
            {latest?.ref_low != null && (
              <p className="pt-2 text-xs text-slate-400">Shaded band: reference range {latest.ref_low}–{latest.ref_high} {latest.unit}</p>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

export default function PatientDetailPage() {
  const id = Number(useParams().id)
  const { can } = useAuth()
  const [editing, setEditing] = useState(false)
  const patient = useQuery({ queryKey: ['patient', id], queryFn: () => api<Patient>(`/patients/${id}`) })
  const orders = useQuery({ queryKey: ['patient', id, 'orders'], queryFn: () => api<OrderSummary[]>(`/patients/${id}/orders`) })

  if (patient.isLoading) return <Loading />
  if (patient.error || !patient.data) return <ErrorNote error={patient.error} />
  const p = patient.data

  return (
    <>
      <PageHeader
        title="Patient record"
        actions={
          <>
            {can('patients:write') && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" />Edit</Button>}
            {can('orders:write') && (
              <Link to={`/orders/new?patient=${p.id}`}><Button><Plus className="size-4" />New order</Button></Link>
            )}
          </>
        }
      />
      <PatientBanner patient={p} extra={p.email ? <span className="text-sm text-slate-500">{p.email}</span> : null} />
      <div className="mt-5 space-y-5">
        <Trend patientId={id} />
        <Card title={<span className="flex items-center gap-2"><ClipboardList className="size-4" />Orders</span>} bodyClassName="">
          {!orders.data?.length ? (
            <Empty title="No orders yet" />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr><th className="th">Order</th><th className="th">Ordered</th><th className="th">Provider</th><th className="th">Priority</th><th className="th">Results</th><th className="th">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.data.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="td"><Link to={`/orders/${o.id}`} className="font-mono text-brand-700 hover:underline">{o.order_number}</Link></td>
                    <td className="td text-slate-600">{dateTime(o.created_at)}</td>
                    <td className="td">{o.ordering_provider}</td>
                    <td className="td"><PriorityBadge priority={o.priority} /></td>
                    <td className="td">
                      <span className="text-slate-600">{o.verified_count}/{o.test_count}</span>
                      {o.has_critical && <Siren className="ml-2 inline size-3.5 text-red-600" />}
                      {!o.has_critical && o.has_abnormal && <span className="ml-2 text-xs font-medium text-amber-700">abnormal</span>}
                    </td>
                    <td className="td"><OrderStatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      {editing && <PatientForm open patient={p} onClose={() => setEditing(false)} />}
    </>
  )
}
