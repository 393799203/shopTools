import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Modal, message } from 'antd'
import { activate, getStoredCredentials } from '../services/auth'
import { API_BASE } from '../services/api'
import { useAuth } from '../contexts/AuthProvider'
import LicenseKeyInput from './LicenseKeyInput'

function Header() {
  const { expiresAtStr, daysRemaining } = useAuth()
  const [renewModalOpen, setRenewModalOpen] = useState(false)
  const [renewKey, setRenewKey] = useState('')
  const [renewLoading, setRenewLoading] = useState(false)

  const handleRenew = async () => {
    if (!renewKey.trim()) {
      message.warning('请输入激活码')
      return
    }
    setRenewLoading(true)
    try {
      const creds = await getStoredCredentials()
      const fullKey = 'ImgGuard-' + renewKey
      await activate(fullKey, API_BASE, creds?.token, creds?.expiresAt)
      message.success('延期成功！')
      setRenewModalOpen(false)
      setRenewKey('')
      window.location.reload()
    } catch (error: any) {
      message.error(error.message || '延期失败')
    } finally {
      setRenewLoading(false)
    }
  }

  return (
    <>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        height: '50px',
        borderBottom: '1px solid #30363d',
        background: '#1f2128',
        flexShrink: 0
      }}>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#58a6ff', marginRight: '40px' }}>ShopTools</div>
        <nav style={{ display: 'flex', gap: '32px' }}>
          <Link to="/sensitivewords" style={{
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 500,
            fontSize: '14px',
            padding: '15px',
            borderRadius: '2px',
            background: 'rgba(88,166,255,0.15)'
          }}>敏感词删图</Link>
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {expiresAtStr && (
            <span style={{ color: daysRemaining <= 7 && daysRemaining > 0 ? '#d29922' : '#8b949e', fontSize: '13px' }}>到期：{expiresAtStr}</span>
          )}
          {daysRemaining > 0 && daysRemaining <= 7 && (
            <Button type="link" size="small" onClick={() => setRenewModalOpen(true)} style={{ color: '#d29922' }}>续期</Button>
          )}
        </div>
      </header>
      <Modal
        title="订阅续期"
        open={renewModalOpen}
        onCancel={() => { setRenewModalOpen(false); setRenewKey('') }}
        onOk={handleRenew}
        confirmLoading={renewLoading}
        okText="确认"
        cancelText="取消"
      >
        <div style={{ display: 'flex', alignItems: 'center', marginTop: '16px' }}>
          <LicenseKeyInput
            value={renewKey}
            onChange={setRenewKey}
            onPressEnter={handleRenew}
            autoFocus
            size="small"
          />
        </div>
      </Modal>
    </>
  )
}

export default Header
