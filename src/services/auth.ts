const LICENSE_PREFIX = 'ShopTools-'

export interface ActivationResponse {
  token: string
  secret: string
  expiresAt: number
}

export interface DeviceStatusResponse {
  activated: boolean
  isExpired?: boolean  // 订阅是否过期（独立于当前有效模式）
  token?: string
  secret?: string
  expiresAt?: number | string | null
  daysRemaining?: number | null
  planType?: 'subscription' | 'pay_per_use'
  quotaRemaining?: number | null
  quotaTotal?: number | null
  licenseHistory?: Array<{
    licenseKey: string
    durationDays: number
    usedAt: string
  }>
}

function validateLicenseFormat(key: string): boolean {
  if (!key.startsWith(LICENSE_PREFIX)) return false
  const suffix = key.slice(LICENSE_PREFIX.length)
  const parts = suffix.split('-')
  if (parts.length !== 4) return false
  return parts.every(part => /^[A-Za-z0-9]{4}$/.test(part))
}

export function getDaysRemaining(expiresAt: number): number {
  const now = Date.now()
  const expires = expiresAt * 1000
  const diff = expires - now
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export async function activate(licenseKey: string, apiBase: string): Promise<ActivationResponse> {
  if (!validateLicenseFormat(licenseKey)) {
    throw new Error('Invalid license key format. Expected: ShopTools-XXXX-XXXX-XXXX-XXXX')
  }

  // 后端会自动获取当前凭证，前端只需传 licenseKey
  const res = await fetch(`${apiBase}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey })
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Activation failed' }))
    throw new Error(errorData.error || errorData.message || 'Activation failed')
  }

  const json = await res.json()
  if (!json.success || !json.data) throw new Error('Invalid activation response')

  const data: ActivationResponse = json.data

  console.log('[Auth] Activation successful')
  return data
}

export type AuthResult = 
  | { valid: true; token: string; secret: string; expiresAt: number; planType: 'subscription' | 'pay_per_use'; isSubscriptionExpired?: boolean; quotaRemaining?: number | null; quotaTotal?: number | null }
  | { valid: false; reason: 'NOT_ACTIVATED' | 'ERROR' }

export async function verifyAuth(apiBase: string): Promise<AuthResult> {
  try {
    const res = await fetch(`${apiBase}/device-status`)
    
    if (!res.ok) {
      console.error(`[Auth] Device status request failed: ${res.status}`)
      return { valid: false, reason: 'ERROR' }
    }
    
    const json = await res.json()
    
    if (!json.success) {
      console.error('[Auth] Device status returned unsuccessful:', json)
      return { valid: false, reason: 'NOT_ACTIVATED' }
    }

    const data: DeviceStatusResponse = json.data || json

    if (!data.activated) {
      console.log('[Auth] Device not activated')
      return { valid: false, reason: 'NOT_ACTIVATED' }
    }

    // 无论哪种模式，只要 activated=true 就算有效（不跳转激活页）
    // 服务端返回的 planType 是动态计算的 effectivePlanType（订阅优先 + 按量兜底）
    // isExpired 表示订阅是否过期（独立于当前有效模式）
    const isSubscriptionExpired = !!data.isExpired  // 直接使用 isExpired 字段
    
    const expiresAtNum = typeof data.expiresAt === 'string' ? parseInt(data.expiresAt, 10) : (data.expiresAt || 0)
    
    console.log('[Auth] Verification successful (混合模式)', {
      planType: data.planType,
      isSubscriptionExpired,
      quotaRemaining: data.quotaRemaining,
      hasSubscription: data.planType === 'subscription',
      hasQuota: data.planType === 'pay_per_use'
    })
    
    return {
      valid: true,
      token: data.token || '',
      secret: data.secret || '',
      expiresAt: expiresAtNum,
      planType: data.planType || 'subscription',
      isSubscriptionExpired,
      quotaRemaining: data.quotaRemaining ?? null,
      quotaTotal: data.quotaTotal ?? null
    }
  } catch (error) {
    console.error('[Auth] Verify auth error:', error)
    return { valid: false, reason: 'ERROR' }
  }
}

export { validateLicenseFormat, LICENSE_PREFIX }
