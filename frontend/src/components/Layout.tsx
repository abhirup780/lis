import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Activity,
  BookOpen,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Siren,
  TestTubes,
  UserCog,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Dashboard } from '../lib/types'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  manager: 'Lab manager',
  technologist: 'Technologist',
  front_desk: 'Front desk',
  physician: 'Physician',
}

function NavItem({ to, icon, children, count, alert }: {
  to: string
  icon: ReactNode
  children: ReactNode
  count?: number
  alert?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
          isActive ? 'bg-white/10 text-white' : 'text-brand-100/80 hover:bg-white/5 hover:text-white',
        )
      }
    >
      <span className="[&>svg]:size-4.5">{icon}</span>
      <span className="flex-1">{children}</span>
      {!!count && (
        <span
          className={clsx(
            'min-w-5 rounded-full px-1.5 text-center text-xs font-semibold',
            alert ? 'animate-pulse bg-red-500 text-white' : 'bg-white/15 text-white',
          )}
        >
          {count}
        </span>
      )}
    </NavLink>
  )
}

export default function Layout() {
  const { user, logout, can } = useAuth()
  const counts = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/dashboard'),
    refetchInterval: 30_000,
  })
  const d = counts.data

  return (
    <div className="flex h-full">
      <aside className="no-print flex w-60 shrink-0 flex-col bg-gradient-to-b from-brand-900 to-slate-900 text-white">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <img src="/favicon.svg" alt="" className="size-8" />
          <div>
            <div className="text-base font-bold tracking-tight">LIS</div>
            <div className="text-[11px] text-brand-100/70">Laboratory Information System</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          <NavItem to="/" icon={<LayoutDashboard />}>Dashboard</NavItem>
          <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-brand-100/40">Front office</div>
          <NavItem to="/patients" icon={<Users />}>Patients</NavItem>
          <NavItem to="/orders" icon={<ClipboardList />}>Orders</NavItem>
          <NavItem to="/specimens" icon={<TestTubes />} count={d?.awaiting_collection}>Specimens</NavItem>
          <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-brand-100/40">Laboratory</div>
          <NavItem to="/worklist" icon={<FlaskConical />} count={d?.awaiting_verification}>Result entry</NavItem>
          <NavItem to="/criticals" icon={<Siren />} count={d?.critical_pending} alert>Critical values</NavItem>
          <NavItem to="/qc" icon={<Activity />} count={d?.qc_rejected} alert>Quality control</NavItem>
          <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-brand-100/40">Administration</div>
          <NavItem to="/catalog" icon={<BookOpen />}>Test catalog</NavItem>
          {can('audit:read') && <NavItem to="/audit" icon={<ScrollText />}>Audit trail</NavItem>}
          {can('users:write') && <NavItem to="/users" icon={<UserCog />}>Users</NavItem>}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold">
              {user?.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user?.full_name}</div>
              <div className="text-xs text-brand-100/60">{ROLE_LABEL[user?.role ?? '']}</div>
            </div>
            <button onClick={logout} title="Sign out" className="rounded p-1.5 text-brand-100/70 hover:bg-white/10 hover:text-white">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
