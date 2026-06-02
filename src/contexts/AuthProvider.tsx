import { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from 'react'
import { API_BASE } from '../services/api'
import { onAuthFail } from '../services/authEvents'
import { verifyAuth, getDaysRemaining, type AuthResult } from '../services/auth'
import { message } from 'antd'

type AuthStatus = 'checking' | 'not_activated' | 'activated'

interface AuthContextValue {
  authStatus: AuthStatus
  daysRemaining: number
  expiresAtStr: string
  recheck: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')
  const [daysRemaining, setDaysRemaining] = useState<number>(0)
  const [expiresAtStr, setExpiresAtStr] = useState<string>('')

  const checkAuth = useCallback(async () => {
    console.log('[AuthProvider] Starting auth check...')
    
    const result: AuthResult = await verifyAuth(API_BASE)
    
    if (result.valid) {
      console.log('[AuthProvider] Auth valid, setting activated')
      setDaysRemaining(getDaysRemaining(result.expiresAt))
      
      const expiresDate = new Date(result.expiresAt * 1000)
      setExpiresAtStr(expiresDate.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).replace(/\//g, '-'))
      
      setAuthStatus('activated')
    } else {
      console.log(`[AuthProvider] Auth invalid, reason: ${result.reason}`)
      setAuthStatus('not_activated')
    }
  }, [])

  const handleAuthFail = useCallback((reason: string) => {
    console.log(`[AuthProvider] Auth failed with reason: ${reason}`)
    
    if (reason === 'SUBSCRIPTION_EXPIRED') {
      message.warning('订阅已过期，请重新激活')
    } else if (reason === 'NOT_ACTIVATED') {
      message.warning('设备未激活，请先激活设备')
    } else if (reason === 'UNAUTHORIZED') {
      message.warning('身份验证失败，请重新激活')
    } else {
      message.warning(reason || '认证失败')
    }

    checkAuth()
  }, [checkAuth])

  useEffect(() => {
    onAuthFail(handleAuthFail)
    return () => onAuthFail(null)
  }, [handleAuthFail])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  return (
    <AuthContext.Provider value={{ authStatus, daysRemaining, expiresAtStr, recheck: checkAuth }}>
      {children}
    </AuthContext.Provider>
  )
}