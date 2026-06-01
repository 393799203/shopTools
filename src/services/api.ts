import { generateSignature, applySignature } from './signature'
import { checkAndRefreshAuth, activate as activateLicense, tryRecover } from './auth'
import { onAuthFail, notifyAuthFail } from './authEvents'

const API_BASE = 'http://localhost:3001/api'
const COMPANY_ID = import.meta.env.VITE_COMPANY_ID || 'default'

export function onUnauthorized(cb: (() => void) | null) {
  onAuthFail(cb ? (() => notifyAuthFail('UNAUTHORIZED')) : null)
}

async function doSignedRequest(
  method: string,
  path: string,
  token: string,
  secret: string,
  body?: object | null
): Promise<Response> {
  const fullPath = `${API_BASE.replace(/^https?:\/\/[^/]+/, '')}${path}`
  const { timestamp, nonce, signature } = await generateSignature(secret, method, fullPath, body)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Token': token,
    'X-Company-ID': COMPANY_ID
  }

  const signedHeaders = applySignature(headers, timestamp, nonce, signature)

  return fetch(`${API_BASE}${path}`, {
    method,
    headers: signedHeaders,
    body: body ? JSON.stringify(body) : undefined
  })
}

async function signedFetch(
  method: string,
  path: string,
  body?: object | null
): Promise<Response> {
  const result = await checkAndRefreshAuth(API_BASE)
  
  if (!result.activated || !result.token || !result.secret) {
    notifyAuthFail('NOT_ACTIVATED')
    throw new Error('NOT_ACTIVATED')
  }

  let res = await doSignedRequest(method, path, result.token, result.secret, body)

  if (!res.ok) {
    const recoverResult = await tryRecover(API_BASE)

    if (recoverResult === 'recovered') {
      const fresh = await checkAndRefreshAuth(API_BASE)
      if (fresh.activated && fresh.token && fresh.secret) {
        res = await doSignedRequest(method, path, fresh.token, fresh.secret, body)
        return res
      }
    }

    throw new Error(recoverResult)
  }

  return res
}

export const api = {
  async activate(licenseKey: string) {
    return activateLicense(licenseKey, API_BASE)
  },

  async getWords() {
    const res = await signedFetch('GET', '/words')
    return res.json()
  },

  async addWord(word: string) {
    const res = await signedFetch('POST', '/words', { word })
    return res.json()
  },

  async deleteWord(id: string) {
    const res = await signedFetch('DELETE', `/words/${id}`)
    return res.json()
  },

  async scanFolder(folderPath: string, onProgress?: (event: { type: string; data?: any[]; stats?: any; error?: string }) => void): Promise<{ success: boolean; data: any[]; stats?: any }> {
    const result = await checkAndRefreshAuth(API_BASE)

    if (!result.activated || !result.token || !result.secret) {
      notifyAuthFail('NOT_ACTIVATED')
      throw new Error('NOT_ACTIVATED')
    }

    const fullPath = `${API_BASE.replace(/^https?:\/\/[^/]+/, '')}/scan`
    const { timestamp, nonce, signature } = await generateSignature(result.secret, 'POST', fullPath, { folderPath })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Token': result.token,
      'X-Company-ID': COMPANY_ID
    }

    const signedHeaders = applySignature(headers, timestamp, nonce, signature)

    const response = await fetch(`${API_BASE}/scan`, {
      method: 'POST',
      headers: signedHeaders,
      body: JSON.stringify({ folderPath })
    })

    if (!response.ok) {
      let recoverResult = await tryRecover(API_BASE)

      if (recoverResult === 'recovered') {
        const fresh = await checkAndRefreshAuth(API_BASE)
        if (fresh.activated && fresh.token && fresh.secret) {
          return this.scanFolder(folderPath, onProgress)
        }
      }

      throw new Error(recoverResult)
    }

    // 流式处理响应
    console.log('📡 [API] 开始接收流式响应...')
    const reader = response.body?.getReader()
    if (!reader) {
      console.error('❌ [API] 无法获取 response body reader')
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    const allImages: any[] = []
    let finalStats: any = null
    let chunkCount = 0

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          console.log(`✅ [API] 流式响应完成，共收到 ${chunkCount} 个数据块`)
          break
        }

        chunkCount++
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const event = JSON.parse(line)

            console.log(`📦 [API] 收到事件: ${event.type}`, event.type === 'data' ? `(数量: ${event.data?.length || 0})` : '')

            if (onProgress) {
              onProgress(event)
            }

            if (event.type === 'data' && Array.isArray(event.data)) {
              allImages.push(...event.data)
              console.log(`📊 [API] 累计图片数: ${allImages.length}`)
            } else if (event.type === 'end') {
              finalStats = event.stats
              console.log(`📈 [API] 最终统计:`, event.stats)
            } else if (event.type === 'error') {
              throw new Error(event.error || 'Stream error')
            }
          } catch (parseError) {
            console.warn('⚠️ [API] 解析失败:', line.substring(0, 100))
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return {
      success: true,
      data: allImages,
      stats: finalStats
    }
  },

  async deleteImages(paths: string[]) {
    const res = await signedFetch('DELETE', '/images', { paths })
    return res.json()
  }
}

export { API_BASE }
