import { notifyAuthFail } from './authEvents'

const LICENSE_PREFIX = 'ImgGuard-'
const STORAGE_KEY_TOKEN = 'imgguard_token'
const STORAGE_KEY_SECRET = 'imgguard_secret'
const STORAGE_KEY_EXPIRES = 'imgguard_expires'

function validateLicenseFormat(key: string): boolean {
  if (!key.startsWith(LICENSE_PREFIX)) return false
  const suffix = key.slice(LICENSE_PREFIX.length)
  const parts = suffix.split('-')
  if (parts.length !== 4) return false
  return parts.every(part => /^[A-Za-z0-9]{4}$/.test(part))
}

async function saveToStorage(key: string, value: string): Promise<void> {
  localStorage.setItem(key, value)
}

async function loadFromStorage(key: string): Promise<string | null> {
  return localStorage.getItem(key)
}

export interface ActivationResponse {
  token: string
  secret: string
  expiresAt: number
}

export interface DeviceStatusResponse {
  activated: boolean
  expired?: boolean
  token?: string
  secret?: string
  expiresAt?: number
  daysRemaining?: number
  licenseHistory?: Array<{
    licenseKey: string
    durationDays: number
    usedAt: string
  }>
}

async function getDeviceMac(): Promise<string> {
  try {
    if (window.electronAPI?.getDeviceMac) {
      return await window.electronAPI.getDeviceMac()
    }
    const res = await fetch('/api/device-info')
    if (res.ok) {
      const data = await res.json()
      return data.data?.mac || 'unknown'
    }
  } catch (e) {
  }
  return 'unknown'
}

export async function activate(licenseKey: string, apiBase: string, currentToken?: string, currentExpiresAt?: number): Promise<ActivationResponse> {
  if (!validateLicenseFormat(licenseKey)) {
    throw new Error('Invalid license key format. Expected: ImgGuard-XXXX-XXXX-XXXX-XXXX')
  }

  const deviceMac = await getDeviceMac()

  const res = await fetch(`${apiBase}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey, currentToken, currentExpiresAt, deviceMac })
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Activation failed' }))
    throw new Error(errorData.error || errorData.message || 'Activation failed')
  }

  const json = await res.json()
  if (!json.success || !json.data) throw new Error('Invalid activation response')

  const data: ActivationResponse = json.data

  await saveToStorage(STORAGE_KEY_TOKEN, data.token)
  await saveToStorage(STORAGE_KEY_SECRET, data.secret)
  await saveToStorage(STORAGE_KEY_EXPIRES, data.expiresAt.toString())

  return data
}

export async function getStoredCredentials(): Promise<{
  token: string
  secret: string
  expiresAt: number
} | null> {
  const token = await loadFromStorage(STORAGE_KEY_TOKEN)
  const secret = await loadFromStorage(STORAGE_KEY_SECRET)
  const expiresStr = await loadFromStorage(STORAGE_KEY_EXPIRES)

  if (!token || !secret || !expiresStr) return null

  const expiresAt = parseInt(expiresStr, 10)
  return { token, secret, expiresAt }
}

export function isSubscriptionValid(expiresAt: number): boolean {
  return Date.now() < expiresAt * 1000
}

export function getDaysRemaining(expiresAt: number): number {
  const now = Date.now()
  const expires = expiresAt * 1000
  const diff = expires - now
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export function isExpiringSoon(expiresAt: number, daysThreshold: number = 7): boolean {
  const remaining = getDaysRemaining(expiresAt)
  return remaining > 0 && remaining <= daysThreshold
}

export async function clearCredentials(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY_TOKEN)
  localStorage.removeItem(STORAGE_KEY_SECRET)
  localStorage.removeItem(STORAGE_KEY_EXPIRES)
}

export async function checkDeviceStatus(apiBase: string): Promise<DeviceStatusResponse | null> {
  try {
    const mac = await getDeviceMac()
    if (!mac || mac === 'unknown') return null

    const res = await fetch(`${apiBase}/device-status?mac=${encodeURIComponent(mac)}`)
    if (!res.ok) return null

    const json = await res.json()
    if (!json.success) return null

    const data: DeviceStatusResponse = json.data || json
    
    if (data.activated && data.token && data.secret && data.expiresAt) {
      await saveToStorage(STORAGE_KEY_TOKEN, data.token)
      await saveToStorage(STORAGE_KEY_SECRET, data.secret)
      await saveToStorage(STORAGE_KEY_EXPIRES, data.expiresAt.toString())
    }

    return data
  } catch (e) {
    console.error('Check device status error:', e)
    return null
  }
}

export interface AuthCheckResult {
  token?: string
  secret?: string
  activated: boolean
}

export async function checkAndRefreshAuth(apiBase: string): Promise<AuthCheckResult> {
  const stored = await getStoredCredentials()
  
  if (stored && isSubscriptionValid(stored.expiresAt)) {
    return { 
      activated: true, 
      token: stored.token,
      secret: stored.secret
    }
  }

  const deviceStatus = await checkDeviceStatus(apiBase)
  
  if (!deviceStatus) {
    return { activated: false }
  }

  if (!deviceStatus.activated) {
    await clearCredentials()
    notifyAuthFail('NOT_ACTIVATED')
    return { activated: false }
  }

  if (!deviceStatus.token || !deviceStatus.secret || !deviceStatus.expiresAt || deviceStatus.expired) {
    await clearCredentials()
    notifyAuthFail('SUBSCRIPTION_EXPIRED')
    return { activated: false }
  }

  return { 
    activated: true,
    token: deviceStatus.token,
    secret: deviceStatus.secret
  }
}

export type RecoverResult = 'recovered' | 'expired' | 'not_activated'

export async function tryRecover(apiBase: string): Promise<RecoverResult> {
  const deviceStatus = await checkDeviceStatus(apiBase)
  
  if (!deviceStatus) {
    await clearCredentials()
    notifyAuthFail('NOT_ACTIVATED')
    return 'not_activated'
  }

  if (!deviceStatus.activated) {
    await clearCredentials()
    notifyAuthFail('NOT_ACTIVATED')
    return 'not_activated'
  }

  if (!deviceStatus.token || !deviceStatus.secret || !deviceStatus.expiresAt || deviceStatus.expired) {
    await clearCredentials()
    notifyAuthFail('SUBSCRIPTION_EXPIRED')
    return 'expired'
  }

  return 'recovered'
}

export { validateLicenseFormat, LICENSE_PREFIX }