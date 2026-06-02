import { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from 'react'
import { API_BASE } from '../services/api'
import { verifyAuth, getDaysRemaining, type AuthResult } from '../services/auth'

type AuthStatus = 'checking' | 'not_activated' | 'activated'
type PlanType = 'subscription' | 'pay_per_use'

interface AuthContextValue {
  authStatus: AuthStatus
  daysRemaining: number
  expiresAtStr: string
  planType: PlanType
  isSubscriptionExpired?: boolean
  quotaRemaining: number | null
  quotaTotal: number | null
  refreshVersion: number
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
  const [planType, setPlanType] = useState<PlanType>('subscription')
  const [isSubscriptionExpired, setIsSubscriptionExpired] = useState<boolean>(false)
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null)
  const [quotaTotal, setQuotaTotal] = useState<number | null>(null)
  const [refreshVersion, setRefreshVersion] = useState<number>(0)

  const checkAuth = useCallback(async () => {
    console.log('[AuthProvider] Starting auth check...')
    
    const result: AuthResult = await verifyAuth(API_BASE)
    
    if (result.valid) {
      console.log('[AuthProvider] Auth valid (混合模式)', {
        planType: result.planType,
        isSubscriptionExpired: result.isSubscriptionExpired,
        quotaRemaining: result.quotaRemaining,
        quotaTotal: result.quotaTotal
      })
      
      const expired = result.isSubscriptionExpired || false
      setIsSubscriptionExpired(expired)
      
      setPlanType(result.planType)
      
      if (result.expiresAt > 0) {
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
      } else {
        setDaysRemaining(0)
        setExpiresAtStr('')
      }
      
      setQuotaRemaining(result.quotaRemaining ?? null)
      setQuotaTotal(result.quotaTotal ?? null)
      
      setAuthStatus('activated')
    } else {
      console.log(`[AuthProvider] Auth invalid, reason: ${result.reason}`)
      setAuthStatus('not_activated')
    }
  }, [])

  const recheckWithRefresh = useCallback(async () => {
    await checkAuth()
    setRefreshVersion(v => v + 1)
  }, [checkAuth])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  return (
    <AuthContext.Provider value={{ 
      authStatus, 
      daysRemaining, 
      expiresAtStr, 
      planType, 
      isSubscriptionExpired, 
      quotaRemaining, 
      quotaTotal, 
      refreshVersion,
      recheck: recheckWithRefresh 
    }}>
      {children}
    </AuthContext.Provider>
  )
}
