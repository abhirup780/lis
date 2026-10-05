import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Calculator, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Tube } from '../components/lab'
import { Badge, Button, Card, ErrorNote, Field, Loading, Modal, PageHeader, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ageRange } from '../lib/format'
import type { Panel, ReferenceRange, TestDef } from '../lib/types'

const num = (v: string) => (v.trim() === '' ? null : Number(v))
const str = (v: number | null | undefined) => (v == null ? '' : String(v))

function RangeText({ r, decimals }: { r: ReferenceRange; decimals: number }) {
  const f = (v: number | null) => (v == null ? null : v.toFixed(decimals))
  const normal = r.normal_text ?? (r.low != null && r.high != null ? `${f(r.low)} – ${f(r.high)}` : r.low != null ? `≥ ${f(r.low)}` : r.high != null ? `≤ ${f(r.high)}` : '—')
  return (
    <span className="text-xs">
      <span className="text-slate-400">{r.sex ?? 'Any'} · {ageRange(r.age_min_days, r.age_max_days)}:</span> <span className="font-mono">{normal}</span>
      {(r.critical_low != null || r.critical_high != null) && (
        <span className="ml-1 font-mono text-red-600">[crit {f(r.critical_low) ?? '—'} / {f(r.critical_high) ?? '—'}]</span>
      )}
    </span>
  )
}

function EditTestModal({ test, onClose }: { test: TestDef; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: test.name,
    unit: test.unit ?? '',
    decimals: test.decimals,
    autoverify: test.autoverify,
    is_active: test.is_active,
    tat_routine_minutes: test.tat_routine_minutes,
    tat_stat_minutes: test.tat_stat_minutes,
    delta_percent: str(test.delta_percent),
    amr_low: str(test.amr_low),
    amr_high: str(test.amr_high),
  })
  const [ranges, setRanges] = useState(
    test.reference_ranges.map((r) => ({
      sex: r.sex ?? '',
      age_min_days: String(r.age_min_days),
      age_max_days: String(r.age_max_days),
      low: str(r.low),
      high: str(r.high),
      critical_low: str(r.critical_low),
      critical_high: str(r.critical_high),
    })),
  )
  const save = useMutation({
    mutationFn: () =>
      api<TestDef>(`/catalog/tests/${test.code}`, {
        method: 'PATCH',
        body: {
          ...form,
          unit: form.unit || null,
          delta_percent: num(form.delta_percent),
          amr_low: num(form.amr_low),
          amr_high: num(form.amr_high),
          reference_ranges: ranges.map((r) => ({
            sex: r.sex || null,
            age_min_days: Number(r.age_min_days),
            age_max_days: Number(r.age_max_days),
            low: num(r.low),
            high: num(r.high),
            critical_low: num(r.critical_low),
            critical_high: num(r.critical_high),
          })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tests'] })
      onClose()
    },
  })
  const setRange = (i: number, k: string, v: string) => setRanges(ranges.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={<span>Edit {test.name} <span className="font-mono text-sm text-slate-400">{test.code}</span></span>}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}
    >
      <div className="grid grid-cols-4 gap-3">
        <Field label="Name" className="col-span-2"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Unit"><input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
        <Field label="Decimals"><input type="number" min={0} max={6} className="input" value={form.decimals} onChange={(e) => setForm({ ...form, decimals: Number(e.target.value) })} /></Field>
        <Field label="TAT routine (min)"><input type="number" className="input" value={form.tat_routine_minutes} onChange={(e) => setForm({ ...form, tat_routine_minutes: Number(e.target.value) })} /></Field>
        <Field label="TAT STAT (min)"><input type="number" className="input" value={form.tat_stat_minutes} onChange={(e) => setForm({ ...form, tat_stat_minutes: Number(e.target.value) })} /></Field>
        <Field label="Delta limit (%)"><input className="input" value={form.delta_percent} onChange={(e) => setForm({ ...form, delta_percent: e.target.value })} /></Field>
        <div />
        <Field label="AMR low"><input className="input" value={form.amr_low} onChange={(e) => setForm({ ...form, amr_low: e.target.value })} /></Field>
        <Field label="AMR high"><input className="input" value={form.amr_high} onChange={(e) => setForm({ ...form, amr_high: e.target.value })} /></Field>
        <label className="col-span-2 flex items-center gap-4 pt-5 text-sm">
          <span className="flex items-center gap-2"><input type="checkbox" className="accent-brand-700" checked={form.autoverify} disabled={test.is_calculated} onChange={(e) => setForm({ ...form, autoverify: e.target.checked })} />Autoverify</span>
          <span className="flex items-center gap-2"><input type="checkbox" className="accent-brand-700" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />Active</span>
        </label>
      </div>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Reference and critical ranges</span>
          <Button size="sm" variant="ghost" onClick={() => setRanges([...ranges, { sex: '', age_min_days: '0', age_max_days: String(200 * 365), low: '', high: '', critical_low: '', critical_high: '' }])}>
            <Plus className="size-3.5" />Add range
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Sex</th><th className="th">Age from (days)</th><th className="th">Age to (days)</th><th className="th">Low</th><th className="th">High</th><th className="th">Critical low</th><th className="th">Critical high</th><th /></tr></thead>
          <tbody>
            {ranges.map((r, i) => (
              <tr key={i}>
                <td className="py-1 pr-1">
                  <select className="input py-1" value={r.sex} onChange={(e) => setRange(i, 'sex', e.target.value)}>
                    <option value="">Any</option><option value="F">F</option><option value="M">M</option>
                  </select>
                </td>
                {(['age_min_days', 'age_max_days', 'low', 'high', 'critical_low', 'critical_high'] as const).map((k) => (
                  <td key={k} className="py-1 pr-1"><input className="input py-1 font-mono" value={r[k]} onChange={(e) => setRange(i, k, e.target.value)} /></td>
                ))}
                <td><button className="p-1 text-slate-400 hover:text-red-600" onClick={() => setRanges(ranges.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-400">A sex-specific range takes precedence over an “Any” range for the same age.</p>
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </Modal>
  )
}

export default function CatalogPage() {
  const { can } = useAuth()
  const [view, setView] = useState<'tests' | 'panels'>('tests')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<TestDef | null>(null)
  const tests = useQuery({ queryKey: ['tests'], queryFn: () => api<TestDef[]>('/catalog/tests') })
  const panels = useQuery({ queryKey: ['panels'], queryFn: () => api<Panel[]>('/catalog/panels') })
  if (tests.isLoading) return <Loading />

  const filtered = (tests.data ?? []).filter((t) => !q || `${t.code} ${t.name} ${t.loinc}`.toLowerCase().includes(q.toLowerCase()))
  const depts = [...new Set(filtered.map((t) => t.department.name))]

  return (
    <>
      <PageHeader
        title="Test catalog"
        subtitle="Tests, LOINC codes, reference intervals, critical limits and autoverification rules."
        actions={
          <>
            <Tabs value={view} onChange={setView} options={[{ value: 'tests', label: 'Tests' }, { value: 'panels', label: 'Panels' }]} />
            {view === 'tests' && (
              <div className="relative">
                <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
                <input className="input w-64 pl-9" placeholder="Search tests" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            )}
          </>
        }
      />
      {view === 'panels' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {panels.data?.map((p) => (
            <Card key={p.code} title={<span>{p.name} <span className="font-mono text-xs text-slate-400">{p.code}</span></span>} actions={<Badge>{p.department.name}</Badge>}>
              {p.description && <p className="mb-2 text-sm text-slate-500">{p.description}</p>}
              <div className="flex flex-wrap gap-1.5">
                {p.tests.map((t) => (
                  <Badge key={t.code} tone={t.is_calculated ? 'violet' : 'slate'}>{t.is_calculated && <Calculator className="size-3" />}{t.code}</Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        depts.map((dept) => (
          <Card key={dept} title={dept} className="mb-5" bodyClassName="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr><th className="th">Code</th><th className="th">Test</th><th className="th">LOINC</th><th className="th">Specimen</th><th className="th">Unit</th><th className="th">Reference ranges</th><th className="th">Rules</th><th className="th" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.filter((t) => t.department.name === dept).map((t) => (
                  <tr key={t.code} className={t.is_active ? '' : 'opacity-50'}>
                    <td className="td font-mono font-semibold">{t.code}</td>
                    <td className="td">
                      {t.name}
                      {t.is_calculated && <Badge tone="violet" className="ml-2"><Calculator className="size-3" />Calculated</Badge>}
                    </td>
                    <td className="td font-mono text-xs text-slate-500">{t.loinc}</td>
                    <td className="td text-xs"><Tube type={t.specimen_type} /></td>
                    <td className="td text-slate-500">{t.unit}</td>
                    <td className="td"><div className="space-y-0.5">{t.reference_ranges.map((r, i) => <div key={i}><RangeText r={r} decimals={t.decimals} /></div>)}</div></td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1">
                        {t.autoverify && <Badge tone="green"><Bot className="size-3" />Auto</Badge>}
                        {t.delta_percent != null && <Badge tone="violet">Δ {t.delta_percent}%</Badge>}
                        {t.amr_low != null && <Badge>AMR {t.amr_low}–{t.amr_high}</Badge>}
                      </div>
                    </td>
                    <td className="td text-right">{can('catalog:write') && <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      )}
      {editing && <EditTestModal test={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
