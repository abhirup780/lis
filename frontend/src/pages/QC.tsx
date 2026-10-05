import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Activity, CheckCircle2, Plus, TriangleAlert, XCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { date, dateTime } from '../lib/format'
import type { QCMaterial, QCResult, QCStatusItem, TestDef } from '../lib/types'

const STATUS_STYLE = {
  accepted: { tone: 'green' as const, icon: <CheckCircle2 className="size-3" />, label: 'In control' },
  warning: { tone: 'amber' as const, icon: <TriangleAlert className="size-3" />, label: 'Warning' },
  rejected: { tone: 'red' as const, icon: <XCircle className="size-3" />, label: 'Rejected' },
}

function QCStatusBadge({ status }: { status: QCResult['status'] | null }) {
  if (!status) return <Badge>No runs</Badge>
  const s = STATUS_STYLE[status]
  return <Badge tone={s.tone}>{s.icon}{s.label}</Badge>
}

function LeveyJennings({ targetId, materials }: { targetId: number; materials: QCMaterial[] }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const target = materials.flatMap((m) => m.targets.map((t) => ({ ...t, material: m }))).find((t) => t.id === targetId)
  const results = useQuery({
    queryKey: ['qc-results', targetId],
    queryFn: () => api<QCResult[]>(`/qc/targets/${targetId}/results`, { query: { days: 60 } }),
  })
  const [value, setValue] = useState('')
  const add = useMutation({
    mutationFn: () => api<QCResult>('/qc/results', { method: 'POST', body: { target_id: targetId, value: Number(value) } }),
    onSuccess: () => {
      setValue('')
      qc.invalidateQueries({ queryKey: ['qc-results', targetId] })
      qc.invalidateQueries({ queryKey: ['qc-status'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
  if (!target) return null
  const { mean, sd } = target
  const data = (results.data ?? []).map((r) => ({ ...r, label: date(r.run_at) }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value) add.mutate()
  }
  const lines = [-3, -2, -1, 1, 2, 3]

  return (
    <Card
      title={
        <span>
          Levey-Jennings · {target.test.name} · {target.material.name} level {target.material.level}
          <span className="ml-2 font-normal text-slate-500">mean {mean} · SD {sd} {target.test.unit}</span>
        </span>
      }
      actions={
        can('qc:write') && (
          <form onSubmit={submit} className="flex items-center gap-2">
            <input className="input w-28 py-1 font-mono" placeholder="QC value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            <Button size="sm" type="submit" loading={add.isPending}><Plus className="size-3.5" />Add run</Button>
          </form>
        )
      }
    >
      <ErrorNote error={add.error} />
      {add.data && add.data.status !== 'accepted' && (
        <div className={clsx('mb-3 rounded-md border px-3 py-2 text-sm', add.data.status === 'rejected' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800')}>
          {add.data.status === 'rejected'
            ? `Run rejected (${add.data.violations.join(', ')}). Autoverification is paused for ${target.test.code} until a passing run.`
            : `Warning: ${add.data.violations.join(', ')}. Inspect the other rules before accepting patient results.`}
        </div>
      )}
      <div className="h-72">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 50, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis domain={[mean - 4 * sd, mean + 4 * sd]} tick={{ fontSize: 11, fill: '#64748b' }} width={56} tickFormatter={(v: number) => v.toFixed(target.test.decimals + 1)} />
            <ReferenceLine y={mean} stroke="#0f766e" strokeWidth={1.5} label={{ value: 'Mean', position: 'right', fontSize: 10, fill: '#0f766e' }} />
            {lines.map((k) => (
              <ReferenceLine
                key={k}
                y={mean + k * sd}
                stroke={Math.abs(k) === 3 ? '#dc2626' : Math.abs(k) === 2 ? '#f59e0b' : '#cbd5e1'}
                strokeDasharray={Math.abs(k) === 1 ? '4 4' : undefined}
                label={{ value: `${k > 0 ? '+' : ''}${k}SD`, position: 'right', fontSize: 10, fill: '#94a3b8' }}
              />
            ))}
            <Tooltip
              contentStyle={{ borderRadius: 8, fontSize: 12 }}
              formatter={(v, _n, item) => {
                const r = item.payload as QCResult
                return [`${v} (z ${r.z_score.toFixed(2)})${r.violations.length ? ` · ${r.violations.join(', ')}` : ''}`, 'Value']
              }}
            />
            <Line
              dataKey="value"
              stroke="#334155"
              strokeWidth={1.5}
              isAnimationActive={false}
              dot={(props) => {
                const r = props.payload as QCResult
                const fill = r.status === 'rejected' ? '#dc2626' : r.status === 'warning' ? '#f59e0b' : '#0f766e'
                return <circle key={r.id} cx={props.cx} cy={props.cy} r={r.status === 'accepted' ? 3.5 : 5} fill={fill} stroke="white" strokeWidth={1} />
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 max-h-48 overflow-y-auto">
        <table className="w-full text-xs">
          <thead><tr><th className="th">Run</th><th className="th">Value</th><th className="th">z</th><th className="th">Status</th><th className="th">By</th></tr></thead>
          <tbody className="divide-y divide-slate-50">
            {[...(results.data ?? [])].reverse().map((r) => (
              <tr key={r.id}>
                <td className="td text-slate-500">{dateTime(r.run_at)}</td>
                <td className="td font-mono">{r.value}</td>
                <td className="td font-mono">{r.z_score.toFixed(2)}</td>
                <td className="td"><QCStatusBadge status={r.status} /> {r.violations.length > 0 && <span className="ml-1 font-mono text-slate-500">{r.violations.join(', ')}</span>}</td>
                <td className="td text-slate-500">{r.entered_by?.full_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function NewMaterialModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const tests = useQuery({ queryKey: ['tests'], queryFn: () => api<TestDef[]>('/catalog/tests') })
  const [form, setForm] = useState({ name: '', lot_number: '', level: 1, expiry_date: '', department_code: 'CHEM' })
  const [targets, setTargets] = useState([{ test_code: '', mean: '', sd: '' }])
  const save = useMutation({
    mutationFn: () =>
      api<QCMaterial>('/qc/materials', {
        method: 'POST',
        body: {
          ...form,
          expiry_date: form.expiry_date || null,
          targets: targets.filter((t) => t.test_code).map((t) => ({ test_code: t.test_code, mean: Number(t.mean), sd: Number(t.sd) })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qc-materials'] })
      qc.invalidateQueries({ queryKey: ['qc-status'] })
      onClose()
    },
  })
  const deptTests = (tests.data ?? []).filter((t) => t.department.code === form.department_code && !t.is_calculated)
  return (
    <Modal open onClose={onClose} title="New QC lot" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Create</Button></>}>
      <div className="grid grid-cols-5 gap-3">
        <Field label="Material" className="col-span-2"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Lot"><input className="input" value={form.lot_number} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} /></Field>
        <Field label="Level">
          <select className="input" value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) })}>
            {[1, 2, 3].map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Expiry"><input type="date" className="input" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></Field>
        <Field label="Department" className="col-span-2">
          <select className="input" value={form.department_code} onChange={(e) => setForm({ ...form, department_code: e.target.value })}>
            <option value="CHEM">Clinical Chemistry</option>
            <option value="HEME">Hematology</option>
          </select>
        </Field>
      </div>
      <div className="mt-4 space-y-2">
        <span className="label">Analyte targets</span>
        {targets.map((t, i) => (
          <div key={i} className="grid grid-cols-5 gap-2">
            <select className="input col-span-3" value={t.test_code} onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, test_code: e.target.value } : x)))}>
              <option value="">Select test</option>
              {deptTests.map((d) => <option key={d.code} value={d.code}>{d.name} ({d.code})</option>)}
            </select>
            <input className="input" placeholder="Mean" inputMode="decimal" value={t.mean} onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, mean: e.target.value } : x)))} />
            <input className="input" placeholder="SD" inputMode="decimal" value={t.sd} onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, sd: e.target.value } : x)))} />
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setTargets([...targets, { test_code: '', mean: '', sd: '' }])}><Plus className="size-3.5" />Add analyte</Button>
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </Modal>
  )
}

export default function QCPage() {
  const { can } = useAuth()
  const status = useQuery({ queryKey: ['qc-status'], queryFn: () => api<QCStatusItem[]>('/qc/status') })
  const materials = useQuery({ queryKey: ['qc-materials'], queryFn: () => api<QCMaterial[]>('/qc/materials') })
  const [selected, setSelected] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  if (status.isLoading || materials.isLoading) return <Loading />
  const items = status.data ?? []
  const current = selected ?? items.find((i) => i.last_status === 'rejected')?.target_id ?? items[0]?.target_id ?? null

  return (
    <>
      <PageHeader
        title="Quality control"
        subtitle="Westgard multirule evaluation: 1-2s warning; 1-3s, 2-2s, R-4s, 4-1s and 10x reject the run and pause autoverification."
        actions={can('qc:manage') && <Button onClick={() => setCreating(true)}><Plus className="size-4" />New QC lot</Button>}
      />
      {items.length === 0 ? (
        <Card><Empty icon={<Activity className="size-10" />} title="No QC lots defined" /></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="Control status" bodyClassName="max-h-[640px] overflow-y-auto">
            <ul className="divide-y divide-slate-100">
              {items.map((i) => (
                <li key={i.target_id}>
                  <button
                    onClick={() => setSelected(i.target_id)}
                    className={clsx('flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-slate-50', current === i.target_id && 'bg-brand-50')}
                  >
                    <span>
                      <span className="text-sm font-medium text-slate-800">{i.test.name}</span>
                      <span className="block text-xs text-slate-500">Level {i.level} · {i.material}</span>
                    </span>
                    <span className="text-right">
                      <QCStatusBadge status={i.last_status} />
                      {i.violations.length > 0 && <span className="block font-mono text-[11px] text-red-600">{i.violations.join(', ')}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <div className="lg:col-span-2">{current && materials.data && <LeveyJennings key={current} targetId={current} materials={materials.data} />}</div>
        </div>
      )}
      {creating && <NewMaterialModal onClose={() => setCreating(false)} />}
    </>
  )
}
