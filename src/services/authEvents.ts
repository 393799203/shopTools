type AuthFailureReason = 'UNAUTHORIZED' | 'SUBSCRIPTION_EXPIRED' | 'NOT_ACTIVATED'

type OnAuthFailCallback = (reason: AuthFailureReason) => void
let handler: OnAuthFailCallback | null = null

export function onAuthFail(cb: OnAuthFailCallback | null) {
  handler = cb
}

export function notifyAuthFail(reason: AuthFailureReason) {
  handler?.(reason)
}

export type { AuthFailureReason }
