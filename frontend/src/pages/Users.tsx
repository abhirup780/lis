import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, ErrorNote, Field, Loading, Modal, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Role, User } from '../lib/types'

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: 'technologist', label: 'Technologist', description: 'Enter and verify results, run QC, document critical calls' },
  { value: 'front_desk', label: 'Front desk', description: 'Register patients, place orders, collect and receive specimens' },
  { value: 'physician', label: 'Physician', description: 'View results and place orders' },
  { value: 'manager', label: 'Lab manager', description: 'Technologist rights plus catalog, QC lots and audit trail' },
  { value: 'admin', label: 'Administrator', description: 'Everything, including user accounts' },
]

function UserModal({ user, onClose }: { user?: User; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    username: user?.username ?? '',
    full_name: user?.full_name ?? '',
    email: user?.email ?? '',
    role: user?.role ?? ('technologist' as Role),
    password: '',
    is_active: user?.is_active ?? true,
  })
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, email: form.email || null, password: form.password || undefined }
      return user
        ? api<User>(`/users/${user.id}`, { method: 'PATCH', body: { full_name: body.full_name, email: body.email, role: body.role, is_active: body.is_active, password: body.password } })
        : api<User>('/users', { method: 'POST', body })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
  })
  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.username}` : 'New user'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username"><input className="input" disabled={Boolean(user)} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field label="Full name"><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
        </div>
        <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Role">
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <span className="mt-1 block text-xs text-slate-400">{ROLES.find((r) => r.value === form.role)?.description}</span>
        </Field>
        <Field label={user ? 'New password (optional)' : 'Password'} hint="At least 8 characters">
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {user && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />Account active</label>
        )}
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  )
}

export default function UsersPage() {
  const { user: me } = useAuth()
  const [editing, setEditing] = useState<User | 'new' | null>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') })
  if (isLoading) return <Loading />
  return (
    <>
      <PageHeader title="Users" subtitle="Accounts and roles." actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" />New user</Button>} />
      <ErrorNote error={error} />
      <Card bodyClassName="">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60"><tr><th className="th">Name</th><th className="th">Username</th><th className="th">Role</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data?.map((u) => (
              <tr key={u.id}>
                <td className="td font-medium">{u.full_name}{u.id === me?.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}<div className="text-xs font-normal text-slate-500">{u.email}</div></td>
                <td className="td font-mono">{u.username}</td>
                <td className="td">{ROLES.find((r) => r.value === u.role)?.label}</td>
                <td className="td">{u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>}</td>
                <td className="td text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {editing && <UserModal user={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  )
}
