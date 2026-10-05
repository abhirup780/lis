import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, Empty, ErrorNote, Loading, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { fullDateTime } from '../lib/format'
import type { AuditEntry, Page } from '../lib/types'

const PAGE = 50
const ACTIONS = ['', 'auth', 'patient', 'order', 'specimen', 'result', 'critical', 'qc', 'test', 'user']

function details(d: Record<string, unknown>) {
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

export default function AuditPage() {
  const [action, setAction] = useState('')
  const [offset, setOffset] = useState(0)
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', action, offset],
    queryFn: () => api<Page<AuditEntry>>('/audit', { query: { action, limit: PAGE, offset } }),
    placeholderData: keepPreviousData,
  })
  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle="Every sign-in, order, specimen event, result entry, verification and configuration change."
        actions={
          <select className="input w-48" value={action} onChange={(e) => { setAction(e.target.value); setOffset(0) }}>
            {ACTIONS.map((a) => <option key={a} value={a}>{a ? `${a[0].toUpperCase()}${a.slice(1)} events` : 'All events'}</option>)}
          </select>
        }
      />
      <Card bodyClassName="">
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorNote error={error} /></div> : !data?.items.length ? (
          <Empty icon={<ScrollText className="size-10" />} title="No events" />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr><th className="th">When</th><th className="th">User</th><th className="th">Action</th><th className="th">Entity</th><th className="th">Details</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="td whitespace-nowrap text-slate-500">{fullDateTime(e.at)}</td>
                    <td className="td">{e.user?.full_name ?? <span className="text-slate-400">System</span>}</td>
                    <td className="td"><Badge tone={e.action.includes('amended') || e.action.includes('cancel') || e.action.includes('reject') ? 'amber' : 'slate'}>{e.action}</Badge></td>
                    <td className="td font-mono text-xs text-slate-500">{e.entity_type}#{e.entity_id}</td>
                    <td className="td max-w-xl truncate text-xs text-slate-600" title={details(e.details)}>{details(e.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm text-slate-500">
              <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(offset - PAGE)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  )
}
