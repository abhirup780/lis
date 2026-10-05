import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, FileText, History, MessageSquare, Printer, TestTubes } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  FlagBadge,
  Info,
  OrderStatusBadge,
  PatientBanner,
  PriorityBadge,
  ResultIndicators,
  ResultStatusBadge,
  SpecimenStatusBadge,
  Tube,
  valueClass,
} from '../components/lab'
import { Button, Card, ErrorNote, Loading, Modal, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { dateTime, fullDateTime } from '../lib/format'
import { printLabels } from '../lib/labels'
import type { HistoryEntry, Order, Result } from '../lib/types'

function HistoryModal({ orderId, result, onClose }: { orderId: number; result: Result; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['history', result.id],
    queryFn: () => api<HistoryEntry[]>(`/orders/${orderId}/tests/${result.id}/history`),
  })
  return (
    <Modal open onClose={onClose} title={`${result.test.name}: result history`}>
      <table className="w-full text-sm">
        <thead><tr><th className="th">Value</th><th className="th">Flag</th><th className="th">Amended</th><th className="th">Reason</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          <tr className="bg-brand-50/50">
            <td className={`td ${valueClass(result.flag)}`}>{result.value_text}</td>
            <td className="td"><FlagBadge flag={result.flag} compact /></td>
            <td className="td text-slate-500" colSpan={2}>Current value</td>
          </tr>
          {[...(data ?? [])].reverse().map((h) => (
            <tr key={h.id}>
              <td className="td font-mono text-slate-500 line-through">{h.value_text}</td>
              <td className="td"><FlagBadge flag={h.flag} compact /></td>
              <td className="td text-slate-500">{dateTime(h.amended_at)}</td>
              <td className="td">{h.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

export default function OrderDetailPage() {
  const id = Number(useParams().id)
  const { can } = useAuth()
  const qc = useQueryClient()
  const [historyFor, setHistoryFor] = useState<Result | null>(null)
  const { data: order, isLoading, error } = useQuery({ queryKey: ['order', id], queryFn: () => api<Order>(`/orders/${id}`) })

  const cancelOrder = useMutation({
    mutationFn: () => api<Order>(`/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: (o) => qc.setQueryData(['order', id], o),
  })
  const cancelTest = useMutation({
    mutationFn: (testId: number) => api<Order>(`/orders/${id}/tests/${testId}/cancel`, { method: 'POST' }),
    onSuccess: (o) => qc.setQueryData(['order', id], o),
  })

  if (isLoading) return <Loading />
  if (error || !order) return <ErrorNote error={error} />

  const departments = [...new Set(order.tests.map((t) => t.test.department.name))]
  const specimenById = new Map(order.specimens.map((s) => [s.id, s]))
  const open = order.status === 'ordered' || order.status === 'in_progress'

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-3"><span className="font-mono">{order.order_number}</span><OrderStatusBadge status={order.status} /><PriorityBadge priority={order.priority} /></span>}
        subtitle={`Ordered ${fullDateTime(order.created_at)} by ${order.created_by?.full_name ?? 'unknown'}`}
        actions={
          <>
            {can('orders:write') && open && !order.tests.some((t) => t.status === 'verified') && (
              <Button variant="secondary" loading={cancelOrder.isPending} onClick={() => confirm('Cancel this order and all its tests?') && cancelOrder.mutate()}>
                <Ban className="size-4" />Cancel order
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                printLabels(
                  order.specimens.filter((s) => s.status !== 'rejected').map((s) => ({ ...s, tests: order.tests.filter((t) => t.specimen_id === s.id && t.status !== 'cancelled').map((t) => t.test) })),
                  order.patient,
                  order.order_number,
                  order.priority,
                )
              }
            >
              <Printer className="size-4" />Labels
            </Button>
            <Link to={`/orders/${order.id}/report`} target="_blank"><Button><FileText className="size-4" />Report</Button></Link>
          </>
        }
      />
      <PatientBanner
        patient={order.patient}
        extra={
          <>
            <Info label="Provider" value={order.ordering_provider} />
            {order.clinical_info && <Info label="Clinical info" value={order.clinical_info} />}
          </>
        }
      />
      <ErrorNote error={cancelOrder.error ?? cancelTest.error} />

      <Card title={<span className="flex items-center gap-2"><TestTubes className="size-4" />Specimens</span>} className="mt-5" bodyClassName="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {order.specimens.map((s) => (
          <div key={s.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-slate-800">{s.accession}</span>
              <SpecimenStatusBadge status={s.status} />
            </div>
            <div className="mt-1 text-sm text-slate-600"><Tube type={s.specimen_type} /></div>
            <div className="mt-2 grid grid-cols-2 text-xs text-slate-500">
              <span>Collected {dateTime(s.collected_at)}</span>
              <span>Received {dateTime(s.received_at)}</span>
            </div>
            {s.rejection_reason && <div className="mt-1 text-xs text-red-600">Rejected: {s.rejection_reason}</div>}
          </div>
        ))}
      </Card>

      {departments.map((dept) => (
        <Card key={dept} title={dept} className="mt-5" bodyClassName="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <th className="th">Test</th><th className="th text-right">Result</th><th className="th">Unit</th><th className="th">Flag</th>
                <th className="th">Reference</th><th className="th">Status</th><th className="th">Verified</th><th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {order.tests.filter((t) => t.test.department.name === dept).map((t) => (
                <tr key={t.id} className={t.status === 'cancelled' ? 'opacity-50' : t.is_critical ? 'bg-red-50/60' : ''}>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{t.test.name}</span>
                      <ResultIndicators result={t} />
                    </div>
                    <div className="font-mono text-xs text-slate-400">{t.test.code} · {specimenById.get(t.specimen_id ?? 0)?.accession}</div>
                    {t.comment && <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><MessageSquare className="size-3" />{t.comment}</div>}
                  </td>
                  <td className={`td text-right text-base ${valueClass(t.flag)}`}>{t.value_text ?? <span className="text-slate-300">—</span>}</td>
                  <td className="td text-slate-500">{t.test.unit}</td>
                  <td className="td"><FlagBadge flag={t.flag} compact /></td>
                  <td className="td text-slate-500">{t.ref_text ?? '—'}</td>
                  <td className="td"><ResultStatusBadge result={t} /></td>
                  <td className="td text-xs text-slate-500">
                    {t.verified_at ? (
                      <>
                        {dateTime(t.verified_at)}
                        <div>{t.auto_verified ? 'Autoverified' : t.verified_by?.full_name}</div>
                      </>
                    ) : t.instrument ? (
                      <span>{t.instrument}</span>
                    ) : '—'}
                  </td>
                  <td className="td text-right whitespace-nowrap">
                    {t.is_amended && (
                      <button onClick={() => setHistoryFor(t)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Result history">
                        <History className="size-4" />
                      </button>
                    )}
                    {can('orders:write') && open && (t.status === 'pending' || t.status === 'resulted') && !t.test.is_calculated && (
                      <button
                        onClick={() => confirm(`Cancel ${t.test.name}?`) && cancelTest.mutate(t.id)}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title="Cancel test"
                      >
                        <Ban className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      {historyFor && <HistoryModal orderId={order.id} result={historyFor} onClose={() => setHistoryFor(null)} />}
    </>
  )
}
