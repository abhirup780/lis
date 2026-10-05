import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CheckCircle2, Printer, ScanBarcode, TestTubes, XCircle } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { PatientLink, PriorityBadge, SpecimenStatusBadge, Tube } from '../components/lab'
import { Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Tabs } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { relative } from '../lib/format'
import { printLabels } from '../lib/labels'
import type { Page, Specimen, SpecimenStatus } from '../lib/types'

const REJECT_REASONS = ['Hemolyzed', 'Clotted', 'Insufficient volume', 'Unlabeled or mislabeled', 'Wrong tube type', 'Exceeded stability']

export default function SpecimensPage() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<SpecimenStatus>('pending')
  const [scan, setScan] = useState('')
  const [scanResult, setScanResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [rejecting, setRejecting] = useState<Specimen | null>(null)
  const [reason, setReason] = useState(REJECT_REASONS[0])
  const scanRef = useRef<HTMLInputElement>(null)

  const list = useQuery({
    queryKey: ['specimens', tab],
    queryFn: () => api<Page<Specimen>>('/specimens', { query: { status: tab, limit: 200 } }),
    refetchInterval: 20_000,
  })

  const action = useMutation({
    mutationFn: ({ id, act, reason }: { id: number; act: 'collect' | 'receive' | 'reject'; reason?: string }) =>
      api<Specimen>(`/specimens/${id}/action`, { method: 'POST', body: { action: act, reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['specimens'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['worklist'] })
    },
  })

  // Scanning a tube in the lab receives it in one step.
  async function onScan(e: FormEvent) {
    e.preventDefault()
    const accession = scan.trim()
    if (!accession) return
    try {
      const s = await api<Specimen>(`/specimens/by-accession/${encodeURIComponent(accession)}`)
      if (s.status === 'received') {
        setScanResult({ ok: true, text: `${accession} was already received` })
      } else if (s.status === 'rejected') {
        setScanResult({ ok: false, text: `${accession} was rejected (${s.rejection_reason})` })
      } else {
        await action.mutateAsync({ id: s.id, act: 'receive' })
        setScanResult({ ok: true, text: `Received ${accession} · ${s.patient.last_name}, ${s.patient.first_name} · ${s.specimen_type.name}` })
      }
    } catch (err) {
      setScanResult({ ok: false, text: err instanceof ApiError ? err.message : String(err) })
    }
    setScan('')
    scanRef.current?.focus()
  }

  return (
    <>
      <PageHeader title="Specimens" subtitle="Collection, receipt in the lab, and rejection." />
      {can('specimens:write') && (
        <Card className="mb-5">
          <form onSubmit={onScan} className="flex flex-wrap items-center gap-3">
            <ScanBarcode className="size-6 text-brand-700" />
            <input
              ref={scanRef}
              className="input max-w-sm font-mono text-base"
              placeholder="Scan or type accession to receive"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
            />
            <Button type="submit" loading={action.isPending}>Receive</Button>
            {scanResult && (
              <span className={clsx('flex items-center gap-1.5 text-sm font-medium', scanResult.ok ? 'text-emerald-700' : 'text-red-600')}>
                {scanResult.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                {scanResult.text}
              </span>
            )}
          </form>
        </Card>
      )}
      <Card bodyClassName="">
        <div className="border-b border-slate-100 p-3">
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'pending', label: 'Awaiting collection' },
              { value: 'collected', label: 'In transit' },
              { value: 'received', label: 'Received' },
              { value: 'rejected', label: 'Rejected' },
            ]}
          />
        </div>
        <ErrorNote error={action.error} />
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty icon={<TestTubes className="size-10" />} title="Nothing here" />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr><th className="th">Accession</th><th className="th">Patient</th><th className="th">Tube</th><th className="th">Tests</th><th className="th">Priority</th><th className="th">Status</th><th className="th">Created</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.items.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="td">
                    <div className="font-mono font-semibold">{s.accession}</div>
                    <Link to={`/orders/${s.order_id}`} className="font-mono text-xs text-brand-700 hover:underline">{s.order_number}</Link>
                  </td>
                  <td className="td"><PatientLink patient={s.patient} /><div className="font-mono text-xs text-slate-400">{s.patient.mrn}</div></td>
                  <td className="td"><Tube type={s.specimen_type} /></td>
                  <td className="td max-w-56 truncate text-xs text-slate-500" title={s.tests.map((t) => t.code).join(', ')}>{s.tests.map((t) => t.code).join(', ')}</td>
                  <td className="td"><PriorityBadge priority={s.priority} /></td>
                  <td className="td">
                    <SpecimenStatusBadge status={s.status} />
                    {s.rejection_reason && <div className="text-xs text-red-600">{s.rejection_reason}</div>}
                  </td>
                  <td className="td text-slate-500">{relative(s.created_at)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" title="Print label" onClick={() => printLabels([{ ...s, tests: s.tests }], s.patient, s.order_number, s.priority)}>
                        <Printer className="size-3.5" />
                      </Button>
                      {can('specimens:write') && s.status === 'pending' && (
                        <Button size="sm" variant="secondary" onClick={() => action.mutate({ id: s.id, act: 'collect' })}>Collect</Button>
                      )}
                      {can('specimens:write') && (s.status === 'pending' || s.status === 'collected') && (
                        <Button size="sm" onClick={() => action.mutate({ id: s.id, act: 'receive' })}>Receive</Button>
                      )}
                      {can('specimens:write') && s.status !== 'rejected' && (
                        <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setRejecting(s)}>Reject</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title={`Reject specimen ${rejecting?.accession ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={action.isPending}
              onClick={() => rejecting && action.mutate({ id: rejecting.id, act: 'reject', reason }, { onSuccess: () => setRejecting(null) })}
            >
              Reject and request recollection
            </Button>
          </>
        }
      >
        <Field label="Reason">
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REJECT_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <p className="mt-3 text-sm text-slate-500">A new accession number is created for a replacement tube, and the open tests move to it.</p>
      </Modal>
    </>
  )
}
