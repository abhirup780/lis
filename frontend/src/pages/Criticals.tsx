import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PhoneCall, Siren } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FlagBadge, PatientLink, valueClass } from '../components/lab'
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { dateTime, relative } from '../lib/format'
import type { Critical } from '../lib/types'

function NotifyModal({ critical, onClose }: { critical: Critical; onClose: () => void }) {
  const qc = useQueryClient()
  const [person, setPerson] = useState('')
  const [readBack, setReadBack] = useState(false)
  const [notes, setNotes] = useState('')
  const save = useMutation({
    mutationFn: () =>
      api<Critical>(`/criticals/${critical.id}/acknowledge`, { method: 'POST', body: { notified_person: person, read_back: readBack, notes: notes || null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criticals'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
  })
  const r = critical.result
  return (
    <Modal
      open
      onClose={onClose}
      title="Document critical value notification"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!person.trim() || !readBack} loading={save.isPending} onClick={() => save.mutate()}>Save notification</Button>
        </>
      }
    >
      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
        <div className="text-sm text-slate-600">{critical.patient.last_name}, {critical.patient.first_name} · {critical.patient.mrn}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-medium">{r.test.name}</span>
          <span className={`text-xl ${valueClass(r.flag)}`}>{r.value_text}</span>
          <span className="text-sm text-slate-500">{r.unit}</span>
          <FlagBadge flag={r.flag} />
        </div>
        <div className="mt-1 text-xs text-slate-500">Ordered by {critical.ordering_provider} · Reference {r.ref_text}</div>
      </div>
      <div className="space-y-4">
        <Field label="Person notified" hint="Name and role, e.g. RN J. Doe, Ward 4B">
          <input className="input" value={person} onChange={(e) => setPerson(e.target.value)} autoFocus />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 accent-brand-700" checked={readBack} onChange={(e) => setReadBack(e.target.checked)} />
          <span>The recipient read back the patient name, test and value correctly.</span>
        </label>
        <Field label="Notes"><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  )
}

export default function CriticalsPage() {
  const { can } = useAuth()
  const [status, setStatus] = useState<'pending' | 'notified'>('pending')
  const [active, setActive] = useState<Critical | null>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['criticals', status],
    queryFn: () => api<Critical[]>('/criticals', { query: { status } }),
    refetchInterval: 15_000,
  })

  return (
    <>
      <PageHeader
        title="Critical values"
        subtitle="Verified critical results must be telephoned to the clinician with a read-back and documented here."
        actions={<Tabs value={status} onChange={setStatus} options={[{ value: 'pending', label: 'To notify' }, { value: 'notified', label: 'Notified' }]} />}
      />
      <Card bodyClassName="">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <div className="p-4"><ErrorNote error={error} /></div>
        ) : !data?.length ? (
          <Empty icon={<Siren className="size-10" />} title={status === 'pending' ? 'No critical values waiting' : 'No notifications yet'} />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr><th className="th">Patient</th><th className="th">Test</th><th className="th">Result</th><th className="th">Provider</th><th className="th">Verified</th><th className="th">{status === 'pending' ? 'Waiting' : 'Notified'}</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((c) => (
                <tr key={c.id} className={status === 'pending' ? 'bg-red-50/40' : ''}>
                  <td className="td"><PatientLink patient={c.patient} /><div className="font-mono text-xs text-slate-400">{c.patient.mrn}</div></td>
                  <td className="td">
                    <div className="font-medium">{c.result.test.name}</div>
                    <Link to={`/orders/${c.order_id}`} className="font-mono text-xs text-brand-700 hover:underline">{c.order_number}</Link>
                  </td>
                  <td className="td">
                    <span className={`text-base ${valueClass(c.result.flag)}`}>{c.result.value_text}</span>{' '}
                    <span className="text-xs text-slate-500">{c.result.unit}</span>{' '}
                    <FlagBadge flag={c.result.flag} compact />
                  </td>
                  <td className="td">{c.ordering_provider}</td>
                  <td className="td text-slate-500">{dateTime(c.result.verified_at)}</td>
                  <td className="td">
                    {status === 'pending' ? (
                      <Badge tone="red">{relative(c.created_at).replace(' ago', '')}</Badge>
                    ) : (
                      <div className="text-xs">
                        <div className="font-medium text-slate-700">{c.notified_person}</div>
                        <div className="text-slate-500">{dateTime(c.notified_at)} by {c.notified_by?.full_name}</div>
                        {c.notes && <div className="text-slate-500 italic">{c.notes}</div>}
                      </div>
                    )}
                  </td>
                  <td className="td text-right">
                    {status === 'pending' && can('criticals:write') && (
                      <Button size="sm" variant="danger" onClick={() => setActive(c)}><PhoneCall className="size-3.5" />Document call</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {active && <NotifyModal critical={active} onClose={() => setActive(null)} />}
    </>
  )
}
