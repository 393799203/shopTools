import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Layout from './components/Layout'
import ActivationPanel from './components/ActivationPanel'
import AuthProvider, { useAuth } from './contexts/AuthProvider'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { authStatus } = useAuth()
  if (authStatus === 'not_activated') return <Navigate to="/activate" replace />
  if (authStatus === 'checking') return null
  return <>{children}</>
}

function ActivateRoute() {
  const navigate = useNavigate()
  const { recheck } = useAuth()
  return <ActivationPanel onActivated={async () => {
    await recheck()
    navigate('/', { replace: true })
  }} />
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/activate" element={<ActivateRoute />} />
          <Route path="/*" element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
