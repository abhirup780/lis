import clsx from 'clsx'
import JsBarcode from 'jsbarcode'
import { AlertTriangle, Bot, Calculator, Siren, TrendingUp } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { age, date, fullName, sexLabel } from '../lib/format'
import type { Flag, OrderStatus, PatientBrief, Result, ResultStatus, SpecimenStatus, SpecimenType } from '../lib/types'
import { Badge, type Tone } from './ui'

const FLAG_STYLE: Record<Flag, { tone: Tone; label: string }> = {
  N: { tone: 'green', label: 'Normal' },
  L: { tone: 'blue', label: 'Low' },
  H: { tone: 'amber', label: 'High' },
  LL: { tone: 'solidRed', label: 'Critical low' },
  HH: { tone: 'solidRed', label: 'Critical high' },
  A: { tone: 'amber', label: 'Abnormal' },
}

export function FlagBadge({ flag, compact }: { flag: Flag | null; compact?: boolean }) {
  if (!flag) return <span className="text-slate-300">—</span>
  const style = FLAG_STYLE[flag]
  return (
    <Badge tone={style.tone} className="font-semibold">
      {(flag === 'LL' || flag === 'HH') && <Siren className="size-3" />}
      {compact ? flag : style.label}
    </Badge>
  )
}

export function valueClass(flag: Flag | null) {
  return clsx(
    'font-mono tabular-nums',
    (flag === 'LL' || flag === 'HH') && 'font-bold text-red-600',
    (flag === 'H' || flag === 'A') && 'font-semibold text-amber-700',
    flag === 'L' && 'font-semibold text-sky-700',
  )
}

const ORDER_STATUS: Record<OrderStatus, { tone: Tone; label: string }> = {
  ordered: { tone: 'slate', label: 'Ordered' },
  in_progress: { tone: 'blue', label: 'In progress' },
  completed: { tone: 'green', label: 'Completed' },
  cancelled: { tone: 'red', label: 'Cancelled' },
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status]
  return <Badge tone={s.tone}>{s.label}</Badge>
}

const SPECIMEN_STATUS: Record<SpecimenStatus, { tone: Tone; label: string }> = {
  pending: { tone: 'slate', label: 'Awaiting collection' },
  collected: { tone: 'violet', label: 'Collected' },
  received: { tone: 'green', label: 'Received' },
  rejected: { tone: 'red', label: 'Rejected' },
}

export function SpecimenStatusBadge({ status }: { status: SpecimenStatus }) {
  const s = SPECIMEN_STATUS[status]
  return <Badge tone={s.tone}>{s.label}</Badge>
}

const RESULT_STATUS: Record<ResultStatus, { tone: Tone; label: string }> = {
  pending: { tone: 'slate', label: 'Pending' },
  resulted: { tone: 'amber', label: 'To verify' },
  verified: { tone: 'green', label: 'Verified' },
  cancelled: { tone: 'red', label: 'Cancelled' },
}

export function ResultStatusBadge({ result }: { result: Pick<Result, 'status' | 'auto_verified' | 'is_amended'> }) {
  const s = RESULT_STATUS[result.status]
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={s.tone}>
        {result.status === 'verified' && result.auto_verified && <Bot className="size-3" />}
        {s.label}
      </Badge>
      {result.is_amended && <Badge tone="violet">Amended</Badge>}
    </span>
  )
}

export function ResultIndicators({ result }: { result: Result }) {
  return (
    <span className="inline-flex items-center gap-1">
      {result.test.is_calculated && (
        <span title="Calculated" className="text-slate-400">
          <Calculator className="size-3.5" />
        </span>
      )}
      {result.delta_failed && (
        <span title={`Delta check failed (previous ${result.previous_value})`}>
          <Badge tone="violet">
            <TrendingUp className="size-3" />Δ {result.previous_value}
          </Badge>
        </span>
      )}
      {result.outside_amr && (
        <span title="Outside the analytical measuring range; dilute or repeat">
          <Badge tone="amber">
            <AlertTriangle className="size-3" />
            AMR
          </Badge>
        </span>
      )}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: 'routine' | 'stat' }) {
  return priority === 'stat' ? <Badge tone="solidRed">STAT</Badge> : <Badge>Routine</Badge>
}

export function Tube({ type, className }: { type: SpecimenType; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)} title={type.container}>
      <span className="inline-block h-3.5 w-2 rounded-t-sm rounded-b-full ring-1 ring-black/10" style={{ background: type.cap_color }} />
      <span>{type.name}</span>
    </span>
  )
}

export function PatientLink({ patient }: { patient: PatientBrief }) {
  return (
    <Link to={`/patients/${patient.id}`} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
      {fullName(patient)}
    </Link>
  )
}

export function PatientBanner({ patient, extra }: { patient: PatientBrief & { phone?: string | null }; extra?: React.ReactNode }) {
  return (
    <div className="card flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800">
          {patient.first_name[0]}
          {patient.last_name[0]}
        </div>
        <div>
          <Link to={`/patients/${patient.id}`} className="text-base font-semibold text-slate-900 hover:underline">
            {fullName(patient)}
          </Link>
          <div className="font-mono text-xs text-slate-500">{patient.mrn}</div>
        </div>
      </div>
      <Info label="DOB" value={`${date(patient.date_of_birth)} (${age(patient.date_of_birth)})`} />
      <Info label="Sex" value={sexLabel(patient.sex)} />
      {patient.phone && <Info label="Phone" value={patient.phone} />}
      {extra}
    </div>
  )
}

export function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm text-slate-700">{value}</div>
    </div>
  )
}

export function Barcode({ value, height = 40, width = 1.6 }: { value: string; height?: number; width?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (ref.current) {
      JsBarcode(ref.current, value, { format: 'CODE128', height, width, displayValue: false, margin: 0 })
    }
  }, [value, height, width])
  return <svg ref={ref} />
}
