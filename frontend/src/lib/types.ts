export type Role = 'admin' | 'manager' | 'technologist' | 'front_desk' | 'physician'

export interface Page<T> {
  items: T[]
  total: number
}

export interface User {
  id: number
  username: string
  full_name: string
  email: string | null
  role: Role
  is_active: boolean
  permissions: string[]
}

export interface UserBrief {
  id: number
  username: string
  full_name: string
}

export interface Patient {
  id: number
  mrn: string
  first_name: string
  last_name: string
  date_of_birth: string
  sex: 'M' | 'F' | 'U'
  phone: string | null
  email: string | null
  address: string | null
  created_at: string
}

export type PatientBrief = Pick<Patient, 'id' | 'mrn' | 'first_name' | 'last_name' | 'date_of_birth' | 'sex'>

export interface Department {
  id: number
  code: string
  name: string
}

export interface SpecimenType {
  id: number
  code: string
  name: string
  container: string
  cap_color: string
}

export interface ReferenceRange {
  id?: number
  sex: 'M' | 'F' | null
  age_min_days: number
  age_max_days: number
  low: number | null
  high: number | null
  critical_low: number | null
  critical_high: number | null
  normal_text: string | null
}

export interface TestBrief {
  id: number
  code: string
  name: string
  unit: string | null
  decimals: number
  result_type: string
  is_calculated: boolean
  department: Department
}

export interface TestDef extends TestBrief {
  loinc: string | null
  specimen_type: SpecimenType
  calc_key: string | null
  is_orderable: boolean
  is_active: boolean
  autoverify: boolean
  sort_order: number
  tat_routine_minutes: number
  tat_stat_minutes: number
  delta_percent: number | null
  amr_low: number | null
  amr_high: number | null
  reference_ranges: ReferenceRange[]
}

export interface Panel {
  id: number
  code: string
  name: string
  description: string | null
  department: Department
  tests: TestBrief[]
}

export type Flag = 'N' | 'L' | 'H' | 'LL' | 'HH' | 'A'
export type ResultStatus = 'pending' | 'resulted' | 'verified' | 'cancelled'

export interface Result {
  id: number
  test: TestBrief
  panel_id: number | null
  specimen_id: number | null
  status: ResultStatus
  value_text: string | null
  value_numeric: number | null
  unit: string | null
  ref_text: string | null
  ref_low: number | null
  ref_high: number | null
  flag: Flag | null
  is_critical: boolean
  delta_failed: boolean
  previous_value: number | null
  outside_amr: boolean
  comment: string | null
  source: string | null
  instrument: string | null
  entered_at: string | null
  entered_by: UserBrief | null
  verified_at: string | null
  verified_by: UserBrief | null
  auto_verified: boolean
  is_amended: boolean
}

export type SpecimenStatus = 'pending' | 'collected' | 'received' | 'rejected'

export interface SpecimenBrief {
  id: number
  accession: string
  status: SpecimenStatus
  specimen_type: SpecimenType
  collected_at: string | null
  received_at: string | null
  rejection_reason: string | null
}

export interface Specimen extends SpecimenBrief {
  order_id: number
  order_number: string
  priority: 'routine' | 'stat'
  patient: PatientBrief
  tests: TestBrief[]
  collected_by: UserBrief | null
  received_by: UserBrief | null
  created_at: string
}

export type OrderStatus = 'ordered' | 'in_progress' | 'completed' | 'cancelled'

export interface OrderSummary {
  id: number
  order_number: string
  patient: PatientBrief
  ordering_provider: string
  priority: 'routine' | 'stat'
  status: OrderStatus
  created_at: string
  completed_at: string | null
  test_count: number
  verified_count: number
  has_critical: boolean
  has_abnormal: boolean
}

export interface Order extends OrderSummary {
  clinical_info: string | null
  created_by: UserBrief | null
  specimens: SpecimenBrief[]
  tests: Result[]
}

export interface WorklistItem {
  specimen: SpecimenBrief
  order_id: number
  order_number: string
  priority: 'routine' | 'stat'
  patient: PatientBrief
  results: Result[]
  due_at: string | null
}

export interface ResultEntryResponse {
  updated: Result[]
  errors: { order_test_id: number; error: string }[]
}

export interface Critical {
  id: number
  status: 'pending' | 'notified'
  created_at: string
  notified_person: string | null
  read_back: boolean
  notes: string | null
  notified_at: string | null
  notified_by: UserBrief | null
  result: Result
  order_id: number
  order_number: string
  ordering_provider: string
  patient: PatientBrief
}

export interface HistoryEntry {
  id: number
  value_text: string | null
  flag: Flag | null
  verified_at: string | null
  amended_at: string
  reason: string
}

export interface TrendPoint {
  order_id: number
  order_number: string
  at: string
  value_numeric: number | null
  value_text: string | null
  flag: Flag | null
  ref_low: number | null
  ref_high: number | null
  unit: string | null
}

export interface QCTarget {
  id: number
  test: TestBrief
  mean: number
  sd: number
}

export interface QCMaterial {
  id: number
  name: string
  lot_number: string
  level: number
  expiry_date: string | null
  is_active: boolean
  department: Department
  targets: QCTarget[]
}

export interface QCResult {
  id: number
  target_id: number
  value: number
  z_score: number
  status: 'accepted' | 'warning' | 'rejected'
  violations: string[]
  comment: string | null
  run_at: string
  entered_by: UserBrief | null
}

export interface QCStatusItem {
  test: TestBrief
  material: string
  level: number
  target_id: number
  last_run_at: string | null
  last_value: number | null
  last_status: QCResult['status'] | null
  violations: string[]
}

export interface Dashboard {
  orders_today: number
  awaiting_collection: number
  in_lab: number
  stat_open: number
  awaiting_verification: number
  critical_pending: number
  qc_rejected: number
  overdue: number
  autoverified_today: number
  verified_today: number
  median_tat_minutes: number | null
  workload: { department: string; pending: number; resulted: number; verified_today: number }[]
  recent_orders: OrderSummary[]
}

export interface AuditEntry {
  id: number
  at: string
  user: UserBrief | null
  action: string
  entity_type: string
  entity_id: number | null
  details: Record<string, unknown>
}

export interface LabInfo {
  name: string
  address: string
  director: string
}
