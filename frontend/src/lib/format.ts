import type { PatientBrief } from './types'

export function fullName(p: Pick<PatientBrief, 'first_name' | 'last_name'>) {
  return `${p.last_name}, ${p.first_name}`
}

export function age(dob: string, at: Date = new Date()): string {
  const birth = new Date(`${dob}T00:00:00`)
  const days = Math.floor((at.getTime() - birth.getTime()) / 86_400_000)
  if (days < 31) return `${days}d`
  let years = at.getFullYear() - birth.getFullYear()
  const m = at.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && at.getDate() < birth.getDate())) years--
  if (years < 2) {
    const months = years * 12 + ((m + 12) % 12) - (at.getDate() < birth.getDate() ? 1 : 0)
    return `${months}mo`
  }
  return `${years}y`
}

export function sexLabel(sex: string) {
  return sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : 'Unknown'
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fullDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = (new Date(iso).getTime() - Date.now()) / 60000
  const abs = Math.abs(diff)
  const text = abs < 60 ? `${Math.round(abs)}m` : abs < 1440 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`
  return diff < 0 ? `${text} ago` : `in ${text}`
}

export function duration(minutes: number | null | undefined): string {
  if (minutes == null) return '—'
  if (minutes < 60) return `${Math.round(minutes)} min`
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`
}

export function ageRange(min: number, max: number): string {
  const fmt = (d: number) => (d >= 365 ? `${Math.round(d / 365)}y` : d >= 31 ? `${Math.round(d / 30)}mo` : `${d}d`)
  if (min === 0 && max >= 200 * 365) return 'All ages'
  if (max >= 200 * 365) return `≥ ${fmt(min)}`
  return `${fmt(min)} – ${fmt(max)}`
}
