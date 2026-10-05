import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, Search, TestTubes, X, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PatientBanner, Tube } from '../components/lab'
import { Button, Card, ErrorNote, Field, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { age, fullName } from '../lib/format'
import type { Order, Page, Panel, Patient, TestDef } from '../lib/types'

function PatientPicker({ onPick }: { onPick: (p: Patient) => void }) {
  const [q, setQ] = useState('')
  const { data } = useQuery({
    queryKey: ['patients', q],
    queryFn: () => api<Page<Patient>>('/patients', { query: { q, limit: 8 } }),
    enabled: q.length >= 2,
  })
  return (
    <div className="relative">
      <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
      <input className="input pl-9" placeholder="Find patient by name or MRN" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {q.length >= 2 && data && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {data.items.length === 0 && <div className="p-3 text-sm text-slate-500">No patients found</div>}
          {data.items.map((p) => (
            <button key={p.id} onClick={() => onPick(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-brand-50">
              <span className="font-medium">{fullName(p)}</span>
              <span className="text-xs text-slate-500"><span className="font-mono">{p.mrn}</span> · {p.sex} · {age(p.date_of_birth)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function NewOrderPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const presetId = params.get('patient')
  const [picked, setPicked] = useState<Patient | null>(null)
  const preset = useQuery({
    queryKey: ['patient', Number(presetId)],
    queryFn: () => api<Patient>(`/patients/${presetId}`),
    enabled: Boolean(presetId),
  })
  const patient = picked ?? preset.data ?? null

  const panels = useQuery({ queryKey: ['panels'], queryFn: () => api<Panel[]>('/catalog/panels') })
  const tests = useQuery({ queryKey: ['tests'], queryFn: () => api<TestDef[]>('/catalog/tests') })

  const [panelCodes, setPanelCodes] = useState<string[]>([])
  const [testCodes, setTestCodes] = useState<string[]>([])
  const [provider, setProvider] = useState('')
  const [priority, setPriority] = useState<'routine' | 'stat'>('routine')
  const [clinical, setClinical] = useState('')
  const [testFilter, setTestFilter] = useState('')

  const toggle = (list: string[], set: (v: string[]) => void, code: string) =>
    set(list.includes(code) ? list.filter((c) => c !== code) : [...list, code])

  // Preview the tubes the order will need, the same way the server splits them.
  const preview = useMemo(() => {
    const all = new Map<string, TestDef>()
    const byCode = new Map((tests.data ?? []).map((t) => [t.code, t]))
    for (const code of panelCodes) {
      for (const t of panels.data?.find((p) => p.code === code)?.tests ?? []) {
        const def = byCode.get(t.code)
        if (def) all.set(t.code, def)
      }
    }
    for (const code of testCodes) {
      const t = byCode.get(code)
      if (t) all.set(code, t)
    }
    const tubes = new Map<string, { label: string; type: TestDef['specimen_type']; count: number }>()
    for (const t of all.values()) {
      const key = `${t.specimen_type.code}-${t.department.code}`
      const entry = tubes.get(key) ?? { label: t.department.name, type: t.specimen_type, count: 0 }
      entry.count++
      tubes.set(key, entry)
    }
    return { count: all.size, tubes: [...tubes.values()] }
  }, [panelCodes, testCodes, panels.data, tests.data])

  const submit = useMutation({
    mutationFn: () =>
      api<Order>('/orders', {
        method: 'POST',
        body: { patient_id: patient!.id, ordering_provider: provider, priority, clinical_info: clinical || null, panel_codes: panelCodes, test_codes: testCodes },
      }),
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      navigate(`/orders/${order.id}`)
    },
  })

  const filteredTests = (tests.data ?? []).filter(
    (t) =>
      t.is_orderable &&
      t.is_active &&
      (!testFilter || `${t.code} ${t.name}`.toLowerCase().includes(testFilter.toLowerCase())),
  )

  return (
    <>
      <PageHeader title="New order" subtitle="Choose the patient, then panels or individual tests." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="1. Patient">
            {patient ? (
              <div className="flex items-start gap-3">
                <div className="flex-1"><PatientBanner patient={patient} /></div>
                <Button variant="ghost" onClick={() => setPicked(null)} title="Change patient"><X className="size-4" /></Button>
              </div>
            ) : (
              <PatientPicker onPick={setPicked} />
            )}
          </Card>

          <Card title="2. Panels">
            <div className="grid gap-2 sm:grid-cols-2">
              {panels.data?.map((p) => {
                const on = panelCodes.includes(p.code)
                return (
                  <button
                    key={p.code}
                    onClick={() => toggle(panelCodes, setPanelCodes, p.code)}
                    className={clsx(
                      'flex items-start gap-3 rounded-lg border p-3 text-left transition',
                      on ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    <span className={clsx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300')}>
                      {on && <Check className="size-3" />}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-slate-800">{p.name} <span className="font-mono text-xs text-slate-400">{p.code}</span></span>
                      <span className="block text-xs text-slate-500">{p.tests.map((t) => t.code).join(', ')}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Card>

          <Card title="3. Individual tests" actions={<input className="input w-56 py-1" placeholder="Filter tests" value={testFilter} onChange={(e) => setTestFilter(e.target.value)} />}>
            <div className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {filteredTests.map((t) => (
                <label key={t.code} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="accent-brand-700" checked={testCodes.includes(t.code)} onChange={() => toggle(testCodes, setTestCodes, t.code)} />
                  <span className="font-mono text-xs text-slate-500">{t.code}</span>
                  <span className="truncate">{t.name}</span>
                </label>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="4. Details">
            <div className="space-y-4">
              <Field label="Ordering provider"><input className="input" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Dr. …" /></Field>
              <div>
                <span className="label">Priority</span>
                <div className="grid grid-cols-2 gap-2">
                  {(['routine', 'stat'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      className={clsx(
                        'flex items-center justify-center gap-1.5 rounded-md border py-2 text-sm font-medium',
                        priority === p
                          ? p === 'stat' ? 'border-red-600 bg-red-600 text-white' : 'border-brand-700 bg-brand-700 text-white'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      {p === 'stat' && <Zap className="size-4" />}
                      {p === 'stat' ? 'STAT' : 'Routine'}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Clinical information"><textarea className="input" rows={3} value={clinical} onChange={(e) => setClinical(e.target.value)} placeholder="Diagnosis, medications, fasting status…" /></Field>
            </div>
          </Card>
          <Card title={<span className="flex items-center gap-2"><TestTubes className="size-4" />Summary</span>}>
            <p className="text-sm text-slate-600">{preview.count} tests</p>
            <ul className="mt-2 space-y-1.5">
              {preview.tubes.map((t, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <Tube type={t.type} />
                  <span className="text-xs text-slate-500">{t.label} · {t.count} tests</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-3">
              <ErrorNote error={submit.error} />
              <Button className="w-full" disabled={!patient || !provider || preview.count === 0} loading={submit.isPending} onClick={() => submit.mutate()}>
                Place order
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
