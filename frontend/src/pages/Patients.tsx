import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, Empty, ErrorNote, Field, Loading, Modal, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { age, date, fullName, sexLabel } from '../lib/format'
import type { Page, Patient } from '../lib/types'

type PatientInput = Omit<Patient, 'id' | 'created_at'>

const EMPTY: PatientInput = {
  mrn: '',
  first_name: '',
  last_name: '',
  date_of_birth: '',
  sex: 'F',
  phone: '',
  email: '',
  address: '',
}

export function PatientForm({ open, onClose, patient, onSaved }: {
  open: boolean
  onClose: () => void
  patient?: Patient
  onSaved?: (p: Patient) => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<PatientInput>(patient ? { ...patient } : EMPTY)
  const set = (k: keyof PatientInput, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, mrn: form.mrn || null, email: form.email || null, phone: form.phone || null, address: form.address || null }
      return patient
        ? api<Patient>(`/patients/${patient.id}`, { method: 'PUT', body })
        : api<Patient>('/patients', { method: 'POST', body })
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['patients'] })
      qc.invalidateQueries({ queryKey: ['patient', p.id] })
      onSaved?.(p)
      onClose()
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={patient ? 'Edit patient' : 'Register patient'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button form="patient-form" type="submit" loading={save.isPending}>{patient ? 'Save changes' : 'Register'}</Button>
        </>
      }
    >
      <form id="patient-form" onSubmit={submit} className="grid grid-cols-2 gap-4">
        <Field label="First name"><input className="input" required value={form.first_name} onChange={(e) => set('first_name', e.target.value)} autoFocus /></Field>
        <Field label="Last name"><input className="input" required value={form.last_name} onChange={(e) => set('last_name', e.target.value)} /></Field>
        <Field label="Date of birth"><input className="input" type="date" required max={new Date().toISOString().slice(0, 10)} value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} /></Field>
        <Field label="Sex">
          <select className="input" value={form.sex} onChange={(e) => set('sex', e.target.value)}>
            <option value="F">Female</option>
            <option value="M">Male</option>
            <option value="U">Unknown</option>
          </select>
        </Field>
        <Field label="MRN" hint="Leave empty to generate one"><input className="input font-mono" value={form.mrn ?? ''} onChange={(e) => set('mrn', e.target.value)} /></Field>
        <Field label="Phone"><input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email" className="col-span-2"><input className="input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Address" className="col-span-2"><textarea className="input" rows={2} value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <div className="col-span-2"><ErrorNote error={save.error} /></div>
      </form>
    </Modal>
  )
}

export default function PatientsPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['patients', q],
    queryFn: () => api<Page<Patient>>('/patients', { query: { q, limit: 100 } }),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle={data ? `${data.total} patients` : undefined}
        actions={can('patients:write') && <Button onClick={() => setCreating(true)}><Plus className="size-4" />Register patient</Button>}
      />
      <Card bodyClassName="">
        <div className="border-b border-slate-100 p-3">
          <div className="relative max-w-md">
            <Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search by name or MRN" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
        </div>
        {isLoading ? (
          <Loading />
        ) : error ? (
          <div className="p-4"><ErrorNote error={error} /></div>
        ) : !data?.items.length ? (
          <Empty icon={<Users className="size-10" />} title="No patients found" />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr><th className="th">Name</th><th className="th">MRN</th><th className="th">Date of birth</th><th className="th">Sex</th><th className="th">Phone</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/patients/${p.id}`)}>
                  <td className="td font-medium text-slate-800">{fullName(p)}</td>
                  <td className="td font-mono text-slate-600">{p.mrn}</td>
                  <td className="td">{date(p.date_of_birth)} <span className="text-slate-400">({age(p.date_of_birth)})</span></td>
                  <td className="td">{sexLabel(p.sex)}</td>
                  <td className="td text-slate-500">{p.phone ?? '—'}</td>
                  <td className="td text-right">
                    {can('orders:write') && (
                      <Link to={`/orders/new?patient=${p.id}`} onClick={(e) => e.stopPropagation()} className="text-sm font-medium text-brand-700 hover:underline">
                        New order
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {creating && <PatientForm open onClose={() => setCreating(false)} onSaved={(p) => navigate(`/patients/${p.id}`)} />}
    </>
  )
}
