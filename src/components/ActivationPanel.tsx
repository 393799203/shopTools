import { useState } from 'react'
import { Button, Card, Typography, message } from 'antd'
import { SafetyOutlined } from '@ant-design/icons'
import { api } from '../services/api'
import { getErrorMessage } from '../utils/errorHandler'
import LicenseKeyInput from './LicenseKeyInput'

const { Title, Text } = Typography

interface ActivationPanelProps {
  onActivated: () => void
}

export default function ActivationPanel({ onActivated }: ActivationPanelProps) {
  const [licenseKey, setLicenseKey] = useState('')
  const [loading, setLoading] = useState(false)

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      message.warning('请输入 License Key')
      return
    }
    setLoading(true)
    try {
      const fullKey = 'ShopTools-' + licenseKey
      await api.activate(fullKey.trim())
      message.success('激活成功！')
      onActivated()
    } catch (error: any) {
      const errorData = error?.message ? { error: error.message } : {}
      message.error(getErrorMessage(errorData, undefined, '激活失败，请检查 License Key 是否正确'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      width: '100vw',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }}>
      <Card
        style={{ width: 420, textAlign: 'center' }}
        cover={
          <div style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            padding: 40,
            color: 'white'
          }}>
            <SafetyOutlined style={{ fontSize: 48 }} />
            <Title level={2} style={{ color: 'white', marginTop: 16, marginBottom: 0 }}>
              ShopTools
            </Title>
            <Text style={{ color: 'rgba(255,255,255,0.8)' }}>
              智能图片安全管理
            </Text>
          </div>
        }
      >
        <div style={{ padding: '24px 24px 32px' }}>
          <Title level={4}>激活产品</Title>
          <Text type="secondary">
            请输入您的 License Key 以激活产品
          </Text>

          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <LicenseKeyInput
                value={licenseKey}
                onChange={setLicenseKey}
                onPressEnter={handleActivate}
              />
            </div>

            <Button
              type="primary"
              size="large"
              block
              loading={loading}
              onClick={handleActivate}
            >
              激活
            </Button>
          </div>

          <div style={{ marginTop: 24, padding: '16px', background: '#f5f5f5', borderRadius: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              输入激活码后半部分，系统会自动格式化并拼接前缀
            </Text>
          </div>
        </div>
      </Card>
    </div>
  )
}
