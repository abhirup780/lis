import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ClipboardList, Plus, Search, Siren } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { OrderStatusBadge, PatientLink, PriorityBadge } from '../components/lab'
import { Button, Card, Empty, ErrorNote, Loading, PageHeader, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { dateTime } from '../lib/format'
import type { OrderSummary, Page } from '../lib/types'

type Filter = 'open' | 'completed' | 'all'
const STATUS: Record<Filter, string | undefined> = { open: 'ordered,in_progress', completed: 'completed', all: undefined }

export default function OrdersPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [filter, setFilter] = useState<Filter>('open')
  const [q, setQ] = useState('')
  const priority = params.get('priority') ?? undefined
  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', filter, q, priority],
    queryFn: () => api<Page<OrderSummary>>('/orders', { query: { q, status: STATUS[filter], priority, limit: 100 } }),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader
        title={priority === 'stat' ? 'STAT orders' : 'Orders'}
        subtitle={data ? `${data.total} orders` : undefined}
        actions={can('orders:write') && <Link to="/orders/new"><Button><Plus className="size-4" />New order</Button></Link>}
      />
      <Card bodyClassName="">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <Tabs value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }]} />
          <div className="relative w-80">
            <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
            <input className="input pl-9" placeholder="Order number, patient, MRN or provider" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {isLoading ? (
          <Loading />
        ) : error ? (
          <div className="p-4"><ErrorNote error={error} /></div>
        ) : !data?.items.length ? (
          <Empty icon={<ClipboardList className="size-10" />} title="No orders match" />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr><th className="th">Order</th><th className="th">Patient</th><th className="th">Provider</th><th className="th">Priority</th><th className="th">Progress</th><th className="th">Status</th><th className="th">Ordered</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/orders/${o.id}`)}>
                  <td className="td font-mono text-brand-700">{o.order_number}</td>
                  <td className="td" onClick={(e) => e.stopPropagation()}><PatientLink patient={o.patient} /><div className="font-mono text-xs text-slate-400">{o.patient.mrn}</div></td>
                  <td className="td">{o.ordering_provider}</td>
                  <td className="td"><PriorityBadge priority={o.priority} /></td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-brand-600" style={{ width: `${(o.verified_count / Math.max(o.test_count, 1)) * 100}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">{o.verified_count}/{o.test_count}</span>
                      {o.has_critical && <Siren className="size-3.5 text-red-600" />}
                    </div>
                  </td>
                  <td className="td"><OrderStatusBadge status={o.status} /></td>
                  <td className="td text-slate-500">{dateTime(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  )
}
