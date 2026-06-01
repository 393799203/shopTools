import { useState, useEffect, createContext, useContext, useCallback, useRef, type ReactNode } from 'react'
import { API_BASE } from '../services/api'
import { onAuthFail } from '../services/authEvents'
import { getDaysRemaining, getStoredCredentials, checkAndRefreshAuth } from '../services/auth'
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

interface AuthProviderProps {
  children: ReactNode
}

export default function AuthProvider({ children }: AuthProviderProps) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')
  const [daysRemaining, setDaysRemaining] = useState<number>(0)
  const [expiresAtStr, setExpiresAtStr] = useState<string>('')

  const checkAuth = useCallback(async () => {
    try {
      const result = await checkAndRefreshAuth(API_BASE)

      if (!result.activated) {
        setAuthStatus('not_activated')
        return
      }

      const storedCreds = await getStoredCredentials()
      if (storedCreds?.expiresAt) {
        setDaysRemaining(getDaysRemaining(storedCreds.expiresAt))
        const expiresDate = new Date(storedCreds.expiresAt * 1000)
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
        setAuthStatus('activated')
      }
    } catch (error) {
      console.error('Auth check failed:', error)
      setAuthStatus('not_activated')
    }
  }, [])

  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isRedirecting = useRef(false)

  const handleAuthFail = useCallback((reason: string) => {
    if (redirectTimer.current) {
      clearTimeout(redirectTimer.current)
    }

    if (isRedirecting.current) return
    isRedirecting.current = true

    if (reason === 'SUBSCRIPTION_EXPIRED') {
      message.warning('订阅已过期，请重新激活')
    } else if (reason === 'NOT_ACTIVATED') {
      message.warning('设备未激活，请先激活设备')
    } else if (reason === 'UNAUTHORIZED') {
      message.warning('身份验证失败，请重新激活')
    } else {
      message.warning(reason)
    }
    redirectTimer.current = setTimeout(() => {
      setAuthStatus('not_activated')
      isRedirecting.current = false
    }, 3000)
  }, [])

  useEffect(() => {
    onAuthFail(handleAuthFail)
    return () => { onAuthFail(null); if (redirectTimer.current) clearTimeout(redirectTimer.current) }
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
