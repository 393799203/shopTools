import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Modal, message } from 'antd'
import { activate } from '../services/auth'
import { API_BASE } from '../services/api'
import { getErrorMessage } from '../utils/errorHandler'
import { useAuth } from '../contexts/AuthProvider'
import LicenseKeyInput from './LicenseKeyInput'

function Header() {
  const { expiresAtStr, daysRemaining, planType, isSubscriptionExpired, quotaRemaining, quotaTotal, recheck } = useAuth()
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
      const fullKey = 'ShopTools-' + renewKey
      // 后端会自动获取当前凭证，前端只需传 licenseKey
      await activate(fullKey, API_BASE)
      message.success('延期成功！')
      setRenewModalOpen(false)
      setRenewKey('')
      // 重新验证并更新认证状态和到期日期（不刷新页面）
      await recheck()
    } catch (error: any) {
      const errorData = error?.message ? { error: error.message } : {}
      message.error(getErrorMessage(errorData, undefined, '延期失败'))
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
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          
          {/* 混合模式：同时显示订阅状态和额度信息 */}
          <span style={{ 
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            {/* 订阅信息 */}
            {expiresAtStr && (
              <span style={{ 
                color: isSubscriptionExpired ? '#f85149' : daysRemaining <= 7 && daysRemaining > 0 ? '#d29922' : '#e6edf3'
              }}>
                {isSubscriptionExpired ? '已过期' : `到期：${expiresAtStr}`}
              </span>
            )}
            
            {/* 分隔符（两者都有时显示） */}
            {expiresAtStr && quotaRemaining !== null && (
              <span style={{ color: '#484f58' }}>|</span>
            )}
            
            {/* 额度信息 */}
            {quotaRemaining !== null && (
              <span style={{ 
                color: quotaRemaining <= 0 ? '#f85149' : quotaRemaining <= 1000 ? '#d29922' : '#e6edf3'
              }}>
                {quotaRemaining <= 0 ? '额度用尽' : `${quotaRemaining?.toLocaleString()} / ${quotaTotal?.toLocaleString()}`}
              </span>
            )}
          </span>
          
          {/* 续费/充值按钮 */}
          <Button 
            type="primary" 
            size="small" 
            onClick={() => setRenewModalOpen(true)} 
            style={{ 
              background: isSubscriptionExpired || (quotaRemaining !== null && quotaRemaining <= 0) ? '#da3633' : '#238636',
              borderColor: isSubscriptionExpired || (quotaRemaining !== null && quotaRemaining <= 0) ? '#da3633' : '#238636'
            }}
          >
            {isSubscriptionExpired || (quotaRemaining !== null && quotaRemaining <= 0) ? '续期/充值' : '续费'}
          </Button>
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
