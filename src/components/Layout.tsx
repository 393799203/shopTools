import { Routes, Route, Navigate } from 'react-router-dom'
import { Statistic } from 'antd'
import Header from './Header'
import SensitiveWordPage from '../pages/SensitiveWordPage'
import { useAuth } from '../contexts/AuthProvider'

function Layout() {
  const { authStatus } = useAuth()

  if (authStatus === 'checking') {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <Statistic title="正在检查授权状态..." value="Loading..." />
      </div>
    )
  }

  return (
    <div style={{
      height: '100vh',
      display: 'grid',
      gridTemplateRows: 'auto 1fr'
    }}>
      <Header />
      <div style={{
        display: 'grid',
        gridTemplateColumns: '300px 1fr',
        overflow: 'hidden'
      }}>
        <Routes>
          <Route path="/" element={<Navigate to="/sensitivewords" replace />} />
          <Route path="/sensitivewords" element={<SensitiveWordPage />} />
        </Routes>
      </div>
    </div>
  )
}

export default Layout
