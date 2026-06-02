import { message } from 'antd'

export type ErrorCode =
  // 认证类 (401)
  | 'AUTH_MISSING_HEADERS'
  | 'AUTH_REQUEST_EXPIRED'
  | 'AUTH_INVALID_TOKEN'
  | 'AUTH_SIGNATURE_ERROR'
  | 'AUTH_NONCE_USED'
  
  // 授权类 (403)
  | 'SUBSCRIPTION_EXPIRED'
  | 'QUOTA_EXHAUSTED'
  | 'DEVICE_NOT_ACTIVATED'
  
  // 业务类 (400/404/409)
  | 'LICENSE_FORMAT_ERROR'
  | 'LICENSE_INVALID'
  | 'LICENSE_ALREADY_USED'
  | 'TOKEN_MISMATCH'
  | 'DEVICE_NOT_FOUND'
  | 'PARAMETER_ERROR'
  | 'INVALID_FOLDER_PATH'
  
  // 网络类 (500/503)
  | 'NETWORK_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'SERVER_ERROR'
  
  // 本地系统类
  | 'MAC_ADDRESS_ERROR'
  
  // 未知
  | 'UNKNOWN'

export interface ApiError {
  code?: ErrorCode | string
  message?: string
  error?: string
}

const ERROR_MESSAGES: Record<string, string> = {
  // ===== 认证类 (401) =====
  'AUTH_MISSING_HEADERS': '缺少认证信息，请刷新页面重试',
  'AUTH_REQUEST_EXPIRED': '请求已超时，请重试',
  'AUTH_INVALID_TOKEN': '身份验证失败，请重新激活',
  'AUTH_SIGNATURE_ERROR': '签名验证失败，请重新激活',
  'AUTH_NONCE_USED': '请求重复提交，请稍后重试',
  
  // ===== 授权类 (403) =====
  'SUBSCRIPTION_EXPIRED': '订阅已过期且配额用完，请续费或充值',
  'QUOTA_EXHAUSTED': '订阅已过期且配额用完，请续费或充值',
  'DEVICE_NOT_ACTIVATED': '设备未激活，请先激活设备',
  
  // ===== 业务类 (400/404/409) =====
  'LICENSE_FORMAT_ERROR': '激活码格式错误，请检查输入',
  'LICENSE_INVALID': '激活码无效或已失效',
  'LICENSE_ALREADY_USED': '该激活码已被使用，请联系客服',
  'TOKEN_MISMATCH': '设备凭证不匹配，请重新激活',
  'DEVICE_NOT_FOUND': '设备未注册',
  'PARAMETER_ERROR': '参数错误，请检查输入',
  'INVALID_FOLDER_PATH': '文件夹路径无效或不存在',
  
  // ===== 网络类 (500/503) =====
  'NETWORK_ERROR': '网络连接失败，请检查网络',
  'SERVICE_UNAVAILABLE': '服务暂时不可用，请稍后重试',
  'SERVER_ERROR': '服务器繁忙，请稍后重试',
  
  // ===== 本地系统类 =====
  'MAC_ADDRESS_ERROR': '无法获取设备信息，请重启应用',
  
  // ===== 默认 =====
  'UNKNOWN': '操作失败，请重试'
}

const AUTH_FAILURE_CODES: string[] = [
  'SUBSCRIPTION_EXPIRED',
  'QUOTA_EXHAUSTED',
  'AUTH_INVALID_TOKEN',
  'AUTH_SIGNATURE_ERROR',
  'DEVICE_NOT_ACTIVATED'
]

function resolveErrorCode(errorData: ApiError, statusCode?: number): string {
  if (errorData.code) {
    const code = errorData.code
    
    // 标准错误码直接返回
    if (ERROR_MESSAGES[code]) return code
    
    // 中间层错误码映射到标准错误码
    const middleLayerMapping: Record<string, string> = {
      'WORDS_ERROR': 'QUOTA_EXHAUSTED',
      'QUOTA_ERROR': 'QUOTA_EXHAUSTED',
    }
    
    if (middleLayerMapping[code]) {
      return middleLayerMapping[code]
    }
    
    // 未知错误码，继续用文案匹配
  }
  
  const errorMsg = (errorData.message || errorData.error || '').toLowerCase()
  
  // 优先根据错误文案内容匹配（不依赖状态码）
  if (errorMsg.includes('quota') || errorMsg.includes('额度') || errorMsg.includes('配额')) return 'QUOTA_EXHAUSTED'
  if (errorMsg.includes('expired') || errorMsg.includes('过期') || errorMsg.includes('到期')) return 'SUBSCRIPTION_EXPIRED'
  if (errorMsg.includes('activat') && errorMsg.includes('设备')) return 'DEVICE_NOT_ACTIVATED'
  if (errorMsg.includes('license') && (errorMsg.includes('format') || errorMsg.includes('格式'))) return 'LICENSE_FORMAT_ERROR'
  if (errorMsg.includes('license') && (errorMsg.includes('invalid') || errorMsg.includes('无效'))) return 'LICENSE_INVALID'
  if (errorMsg.includes('folder') || errorMsg.includes('文件夹') || errorMsg.includes('路径')) return 'INVALID_FOLDER_PATH'
  if (errorMsg.includes('token') && errorMsg.includes('mismatch')) return 'TOKEN_MISMATCH'
  if (errorMsg.includes('network') || errorMsg.includes('连接') || errorMsg.includes('unavailable') || errorMsg.includes('fetch')) return 'NETWORK_ERROR'
  if (errorMsg.includes('mac') && errorMsg.includes('获取')) return 'MAC_ADDRESS_ERROR'
  
  // 如果有状态码，做二次精确匹配
  if (statusCode === 401) {
    if (errorMsg.includes('token') || errorMsg.includes('invalid')) return 'AUTH_INVALID_TOKEN'
    if (errorMsg.includes('signature') || errorMsg.includes('签名')) return 'AUTH_SIGNATURE_ERROR'
    if (errorMsg.includes('nonce') || errorMsg.includes('used')) return 'AUTH_NONCE_USED'
    if (errorMsg.includes('missing') || errorMsg.includes('缺少')) return 'AUTH_MISSING_HEADERS'
    return 'AUTH_REQUEST_EXPIRED'
  }
  
  if (statusCode === 403) {
    return 'SUBSCRIPTION_EXPIRED'
  }
  
  if (statusCode === 400) {
    return 'PARAMETER_ERROR'
  }
  
  if (statusCode === 409) {
    if (errorMsg.includes('already used') || errorMsg.includes('已被使用')) return 'LICENSE_ALREADY_USED'
    return 'TOKEN_MISMATCH'
  }
  
  if ((statusCode ?? 0) >= 500) {
    return 'SERVER_ERROR'
  }
  
  return 'UNKNOWN'
}

export function handleApiError(errorData: ApiError, statusCode?: number): never {
  const errorCode = resolveErrorCode(errorData, statusCode) as ErrorCode
  const userMessage = ERROR_MESSAGES[errorCode] || errorData.message || errorData.error || ERROR_MESSAGES['UNKNOWN']
  
  console.error(`[ErrorHandler] ${errorCode}:`, { errorData, statusCode, resolvedMessage: userMessage })
  
  if (AUTH_FAILURE_CODES.includes(errorCode)) {
    message.warning(userMessage)
    throw new Error(userMessage)
  }
  
  if (statusCode === 403 || statusCode === 401) {
    message.warning(userMessage)
  } else {
    message.error(userMessage)
  }
  
  throw new Error(userMessage)
}

export function getErrorMessage(errorData: ApiError, statusCode?: number, fallback = '操作失败'): string {
  const errorCode = resolveErrorCode(errorData, statusCode)
  return ERROR_MESSAGES[errorCode] || errorData.message || errorData.error || fallback
}

export function isAuthFailure(error: any): boolean {
  try {
    const errorData = typeof error?.message === 'string' ? JSON.parse(error.message) : error
    const errorCode = errorData?.code || ''
    return AUTH_FAILURE_CODES.includes(errorCode)
  } catch {
    return false
  }
}
