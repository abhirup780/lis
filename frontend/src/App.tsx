import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import { useAuth } from './lib/auth'
import LoginPage from './pages/Login'

const AuditPage = lazy(() => import('./pages/Audit'))
const CatalogPage = lazy(() => import('./pages/Catalog'))
const CriticalsPage = lazy(() => import('./pages/Criticals'))
const DashboardPage = lazy(() => import('./pages/Dashboard'))
const NewOrderPage = lazy(() => import('./pages/NewOrder'))
const OrderDetailPage = lazy(() => import('./pages/OrderDetail'))
const OrdersPage = lazy(() => import('./pages/Orders'))
const PatientDetailPage = lazy(() => import('./pages/PatientDetail'))
const PatientsPage = lazy(() => import('./pages/Patients'))
const QCPage = lazy(() => import('./pages/QC'))
const ReportPage = lazy(() => import('./pages/Report'))
const SpecimensPage = lazy(() => import('./pages/Specimens'))
const UsersPage = lazy(() => import('./pages/Users'))
const WorklistPage = lazy(() => import('./pages/Worklist'))

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) return <LoginPage />
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/orders/:id/report" element={<ReportPage />} />
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="patients" element={<PatientsPage />} />
          <Route path="patients/:id" element={<PatientDetailPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/new" element={<NewOrderPage />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
          <Route path="specimens" element={<SpecimensPage />} />
          <Route path="worklist" element={<WorklistPage />} />
          <Route path="criticals" element={<CriticalsPage />} />
          <Route path="qc" element={<QCPage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
