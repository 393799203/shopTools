import { Input } from 'antd'

const formatLicenseKey = (value: string): string => {
  const withoutPrefix = value.replace(/^ShopTools[-\s]*/i, '')
  const cleaned = withoutPrefix.replace(/[^A-Za-z0-9]/g, '')
  if (!cleaned) return ''
  let formatted = ''
  for (let i = 0; i < Math.min(cleaned.length, 16); i++) {
    if (i > 0 && i % 4 === 0) formatted += '-'
    formatted += cleaned[i]
  }
  return formatted
}

interface LicenseKeyInputProps {
  value: string
  onChange: (value: string) => void
  onPressEnter?: () => void
  autoFocus?: boolean
  size?: 'large' | 'middle' | 'small'
  placeholder?: string
}

export default function LicenseKeyInput({
  value,
  onChange,
  onPressEnter,
  autoFocus = false,
  size = 'large',
  placeholder = 'XXXX-XXXX-XXXX-XXXX'
}: LicenseKeyInputProps) {
  const height = size === 'large' ? '38px' : '32px'
  const inputHeight = size === 'large' ? '38px' : '32px'

  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      <span style={{
        border: '1px solid #d9d9d9',
        padding: '4px 11px',
        borderRadius: '6px 0 0 6px',
        background: '#fafafa',
        color: '#8c8c8c',
        fontSize: '14px',
        fontFamily: 'monospace',
        letterSpacing: 1,
        marginRight: '-1px',
        zIndex: 1,
        height,
        display: 'flex',
        alignItems: 'center'
      }}>ShopTools</span>
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(formatLicenseKey(e.target.value))}
        onPressEnter={onPressEnter}
        autoFocus={autoFocus}
        style={{ fontFamily: 'monospace', letterSpacing: 1, width: '100%', borderRadius: '0 6px 6px 0', height: inputHeight, padding: size === 'small' ? '0 11px' : undefined }}
      />
    </div>
  )
}
