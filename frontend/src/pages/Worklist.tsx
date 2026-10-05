import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlarmClock, CheckCheck, FlaskConical, Pencil, Save } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FlagBadge, PatientLink, PriorityBadge, ResultIndicators, ResultStatusBadge, Tube, valueClass } from '../components/lab'
import { Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { age, relative } from '../lib/format'
import type { Result, ResultEntryResponse, WorklistItem } from '../lib/types'

function SpecimenCard({ item, onChanged }: { item: WorklistItem; onChanged: () => void }) {
  const { can } = useAuth()
  const [values, setValues] = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [amending, setAmending] = useState<Result | null>(null)

  const dirty = Object.entries(values).filter(([id, v]) => {
    const r = item.results.find((x) => x.id === Number(id))
    return v.trim() !== '' && v !== (r?.value_text ?? '')
  })

  const save = useMutation({
    mutationFn: () =>
      api<ResultEntryResponse>('/results', {
        method: 'POST',
        body: { results: dirty.map(([id, value]) => ({ order_test_id: Number(id), value })) },
      }),
    onSuccess: (res) => {
      setErrors(Object.fromEntries(res.errors.map((e) => [e.order_test_id, e.error])))
      setValues((v) => Object.fromEntries(Object.entries(v).filter(([id]) => res.errors.some((e) => e.order_test_id === Number(id)))))
      onChanged()
    },
  })

  const verify = useMutation({
    mutationFn: (ids: number[]) => api<ResultEntryResponse>('/results/verify', { method: 'POST', body: { order_test_ids: ids } }),
    onSuccess: (res) => {
      setErrors(Object.fromEntries(res.errors.map((e) => [e.order_test_id, e.error])))
      setSelected(new Set())
      onChanged()
    },
  })

  const reviewable = item.results.filter((r) => r.status === 'resulted' && !r.test.is_calculated)
  const overdue = item.due_at && new Date(item.due_at) < new Date()
  const editableIds = item.results.filter((r) => !r.test.is_calculated && r.status !== 'verified').map((r) => r.id)

  function onKey(e: KeyboardEvent<HTMLInputElement>, id: number) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const next = editableIds[editableIds.indexOf(id) + 1]
      if (next) document.getElementById(`res-${next}`)?.focus()
      else if (dirty.length) save.mutate()
    }
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className={clsx('card overflow-hidden', item.priority === 'stat' && 'border-red-200 ring-1 ring-red-100')}>
      <header className={clsx('flex flex-wrap items-center gap-x-5 gap-y-1 border-b px-4 py-2.5', item.priority === 'stat' ? 'border-red-100 bg-red-50/50' : 'border-slate-100 bg-slate-50/60')}>
        <span className="font-mono text-base font-semibold text-slate-900">{item.specimen.accession}</span>
        <span className="text-sm"><PatientLink patient={item.patient} /> <span className="text-slate-500">· {item.patient.sex} · {age(item.patient.date_of_birth)} · <span className="font-mono">{item.patient.mrn}</span></span></span>
        <Tube type={item.specimen.specimen_type} className="text-xs text-slate-500" />
        <PriorityBadge priority={item.priority} />
        <Link to={`/orders/${item.order_id}`} className="font-mono text-xs text-brand-700 hover:underline">{item.order_number}</Link>
        <span className={clsx('ml-auto flex items-center gap-1 text-xs', overdue ? 'font-semibold text-red-600' : 'text-slate-500')}>
          <AlarmClock className="size-3.5" />
          {overdue ? `Overdue ${relative(item.due_at)}` : `Due ${relative(item.due_at)}`}
        </span>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="th w-8">
              {can('results:verify') && reviewable.length > 0 && (
                <input
                  type="checkbox"
                  className="accent-brand-700"
                  checked={reviewable.every((r) => selected.has(r.id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(reviewable.map((r) => r.id)) : new Set())}
                />
              )}
            </th>
            <th className="th">Test</th><th className="th w-36">Result</th><th className="th">Unit</th><th className="th">Flag</th>
            <th className="th">Reference</th><th className="th">Previous</th><th className="th">Status</th><th className="th" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {item.results.map((r) => {
            const editable = can('results:write') && !r.test.is_calculated && r.status !== 'verified'
            return (
              <tr key={r.id} className={clsx(r.is_critical && 'bg-red-50/70', r.test.is_calculated && 'bg-slate-50/50')}>
                <td className="td">
                  {can('results:verify') && r.status === 'resulted' && !r.test.is_calculated && (
                    <input type="checkbox" className="accent-brand-700" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  )}
                </td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{r.test.name}</span>
                    <ResultIndicators result={r} />
                  </div>
                  <span className="font-mono text-xs text-slate-400">{r.test.code}</span>
                  {errors[r.id] && <div className="text-xs text-red-600">{errors[r.id]}</div>}
                </td>
                <td className="td">
                  {editable ? (
                    <input
                      id={`res-${r.id}`}
                      className={clsx('input w-28 py-1 text-right font-mono', valueClass(r.flag), errors[r.id] && 'border-red-400')}
                      value={values[r.id] ?? r.value_text ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
                      onKeyDown={(e) => onKey(e, r.id)}
                      inputMode={r.test.result_type === 'numeric' ? 'decimal' : 'text'}
                      autoComplete="off"
                    />
                  ) : (
                    <span className={clsx('text-base', valueClass(r.flag))}>{r.value_text ?? <span className="text-slate-300">—</span>}</span>
                  )}
                </td>
                <td className="td text-slate-500">{r.test.unit}</td>
                <td className="td"><FlagBadge flag={r.flag} compact /></td>
                <td className="td text-slate-500">{r.ref_text ?? '—'}</td>
                <td className="td font-mono text-slate-500">{r.previous_value ?? '—'}</td>
                <td className="td"><ResultStatusBadge result={r} /></td>
                <td className="td text-right">
                  {can('results:write') && r.status === 'verified' && !r.test.is_calculated && (
                    <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Amend result" onClick={() => setAmending(r)}>
                      <Pencil className="size-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-2.5">
        <ErrorNote error={save.error ?? verify.error} />
        {can('results:write') && (
          <Button variant="secondary" size="sm" disabled={!dirty.length} loading={save.isPending} onClick={() => save.mutate()}>
            <Save className="size-3.5" />Save {dirty.length > 0 && `(${dirty.length})`}
          </Button>
        )}
        {can('results:verify') && (
          <Button size="sm" disabled={!selected.size || dirty.length > 0} loading={verify.isPending} onClick={() => verify.mutate([...selected])} title={dirty.length ? 'Save changes first' : undefined}>
            <CheckCheck className="size-3.5" />Verify {selected.size > 0 && `(${selected.size})`}
          </Button>
        )}
      </footer>
      {amending && <AmendModal result={amending} onClose={() => setAmending(null)} onDone={onChanged} />}
    </div>
  )
}

function AmendModal({ result, onClose, onDone }: { result: Result; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState(result.value_text ?? '')
  const [reason, setReason] = useState('')
  const amend = useMutation({
    mutationFn: () =>
      api<ResultEntryResponse>('/results', { method: 'POST', body: { results: [{ order_test_id: result.id, value, amend_reason: reason }] } }),
    onSuccess: (res) => {
      if (res.errors.length) throw new Error(res.errors[0].error)
      onDone()
      onClose()
    },
  })
  return (
    <Modal
      open
      onClose={onClose}
      title={`Amend ${result.test.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!reason.trim() || !value.trim()} loading={amend.isPending} onClick={() => amend.mutate()}>Amend result</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          The verified value <span className="font-mono font-semibold">{result.value_text} {result.unit}</span> is kept in the result history.
          The corrected result needs verification again and is reported as corrected.
        </p>
        <Field label="Corrected value"><input className="input font-mono" value={value} onChange={(e) => setValue(e.target.value)} autoFocus /></Field>
        <Field label="Reason for amendment"><textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <ErrorNote error={amend.error} />
      </div>
    </Modal>
  )
}

export default function WorklistPage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const department = params.get('department') ?? ''
  const status = params.get('status') ?? 'open'
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const { data, isLoading, error } = useQuery({
    queryKey: ['worklist', department, status],
    queryFn: () => api<WorklistItem[]>('/worklist', { query: { department, status } }),
    refetchInterval: 20_000,
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['worklist'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['order'] })
    qc.invalidateQueries({ queryKey: ['criticals'] })
  }

  return (
    <>
      <PageHeader
        title="Result entry and verification"
        subtitle="STAT specimens first, then oldest. Press Enter to move to the next test; the last Enter saves."
        actions={
          <>
            <Tabs value={department} onChange={(v) => set('department', v)} options={[{ value: '', label: 'All' }, { value: 'CHEM', label: 'Chemistry' }, { value: 'HEME', label: 'Hematology' }]} />
            <Tabs value={status} onChange={(v) => set('status', v)} options={[{ value: 'open', label: 'Open' }, { value: 'review', label: 'To verify' }]} />
          </>
        }
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorNote error={error} />
      ) : !data?.length ? (
        <Card><Empty icon={<FlaskConical className="size-10" />} title="The worklist is clear">Received specimens appear here.</Empty></Card>
      ) : (
        <div className="space-y-4">
          {data.map((item) => (
            <SpecimenCard key={`${item.specimen.id}-${department}`} item={item} onChanged={refresh} />
          ))}
        </div>
      )}
    </>
  )
}
