import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { Barcode } from '../components/lab'
import { Button, ErrorNote, Loading } from '../components/ui'
import { api } from '../lib/api'
import { age, date, fullDateTime, fullName, sexLabel } from '../lib/format'
import type { LabInfo, Order } from '../lib/types'

const FLAG_TEXT: Record<string, string> = { L: 'L', H: 'H', LL: 'LL *', HH: 'HH *', A: 'A' }

export default function ReportPage() {
  const id = Number(useParams().id)
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api<Order>(`/orders/${id}`) })
  const lab = useQuery({ queryKey: ['lab-info'], queryFn: () => api<LabInfo>('/orders/lab-info') })
  if (order.isLoading || lab.isLoading) return <Loading />
  if (!order.data || !lab.data) return <ErrorNote error={order.error ?? lab.error} />
  const o = order.data
  const p = o.patient
  const reported = o.tests.filter((t) => t.status !== 'cancelled')
  const departments = [...new Set(reported.map((t) => t.test.department.name))]
  const final = reported.every((t) => t.status === 'verified')
  const collected = o.specimens.map((s) => s.collected_at).filter(Boolean).sort()[0] ?? null
  const received = o.specimens.map((s) => s.received_at).filter(Boolean).sort()[0] ?? null
  const criticals = reported.filter((t) => t.is_critical && t.status === 'verified')

  return (
    <div className="min-h-full bg-slate-100 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end">
        <Button onClick={() => window.print()}><Printer className="size-4" />Print</Button>
      </div>
      <article className="mx-auto max-w-[210mm] bg-white p-10 text-[13px] text-slate-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
          <div>
            <h1 className="text-xl font-bold">{lab.data.name}</h1>
            <p className="text-slate-600">{lab.data.address}</p>
            <p className="text-slate-600">Laboratory director: {lab.data.director}</p>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold">{final ? 'Final report' : 'Preliminary report'}</div>
            <div className="mt-1"><Barcode value={o.order_number} height={30} width={1.2} /></div>
            <div className="font-mono text-xs">{o.order_number}</div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-x-10 gap-y-1 border-b border-slate-300 py-3">
          <Row label="Patient" value={<b>{fullName(p)}</b>} />
          <Row label="Ordering provider" value={o.ordering_provider} />
          <Row label="MRN" value={<span className="font-mono">{p.mrn}</span>} />
          <Row label="Priority" value={o.priority === 'stat' ? 'STAT' : 'Routine'} />
          <Row label="DOB / Age" value={`${date(p.date_of_birth)} (${age(p.date_of_birth)})`} />
          <Row label="Collected" value={fullDateTime(collected)} />
          <Row label="Sex" value={sexLabel(p.sex)} />
          <Row label="Received" value={fullDateTime(received)} />
          {o.clinical_info && <div className="col-span-2"><Row label="Clinical info" value={o.clinical_info} /></div>}
        </section>

        {departments.map((dept) => (
          <section key={dept} className="mt-5 break-inside-avoid">
            <h2 className="mb-1 border-b border-slate-300 pb-1 text-sm font-bold uppercase tracking-wide">{dept}</h2>
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 font-medium">Test</th>
                  <th className="py-1 text-right font-medium">Result</th>
                  <th className="w-12 py-1 pl-2 font-medium">Flag</th>
                  <th className="py-1 font-medium">Units</th>
                  <th className="py-1 font-medium">Reference range</th>
                </tr>
              </thead>
              <tbody>
                {reported.filter((t) => t.test.department.name === dept).map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 align-top">
                    <td className="py-1">
                      {t.test.name}
                      {t.is_amended && <span className="ml-1 text-xs italic">(corrected)</span>}
                      {t.comment && <div className="text-xs italic text-slate-600">{t.comment}</div>}
                    </td>
                    <td className={`py-1 text-right font-mono ${t.flag && t.flag !== 'N' ? 'font-bold' : ''}`}>
                      {t.status === 'verified' ? t.value_text : <span className="text-slate-400">{t.status === 'resulted' ? 'Pending review' : 'Pending'}</span>}
                    </td>
                    <td className="py-1 pl-2 font-mono font-bold">{t.status === 'verified' && t.flag ? FLAG_TEXT[t.flag] ?? '' : ''}</td>
                    <td className="py-1 text-slate-600">{t.test.unit}</td>
                    <td className="py-1 text-slate-600">{t.ref_text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        {criticals.length > 0 && (
          <p className="mt-5 border border-slate-900 p-2 text-xs">
            * Critical value. Results marked LL or HH were telephoned to the responsible clinician per laboratory policy.
          </p>
        )}

        <footer className="mt-8 flex justify-between border-t border-slate-300 pt-3 text-xs text-slate-500">
          <span>Flags: L low · H high · LL/HH critical · A abnormal</span>
          <span>Printed {fullDateTime(new Date().toISOString())}</span>
        </footer>
      </article>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 text-slate-500">{label}</span>
      <span>{value}</span>
    </div>
  )
}
