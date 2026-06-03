import { handleApiError, getErrorMessage } from '../utils/errorHandler'

const API_BASE = 'http://localhost:3001/api'
const COMMON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Company-ID': import.meta.env.VITE_COMPANY_ID || 'default'
}

export function onUnauthorized(cb: (() => void) | null) {
  // 后端已统一验证身份，前端不再需要处理未授权回调
}

export const api = {
  async activate(licenseKey: string) {
    const res = await fetch(`${API_BASE}/activate`, {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: JSON.stringify({ licenseKey })
    })
    return res.json()
  },

  async getWords() {
    const res = await fetch(`${API_BASE}/words`, { headers: COMMON_HEADERS })
    return handleResponse(res)  // 数据加载类：默认通知
  },

  async addWord(word: string) {
    const res = await fetch(`${API_BASE}/words`, {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: JSON.stringify({ word })
    })
    return handleResponse(res, false)  // 操作类：不通知
  },

  async deleteWord(id: string) {
    const res = await fetch(`${API_BASE}/words/${id}`, {
      method: 'DELETE',
      headers: COMMON_HEADERS
    })
    return handleResponse(res, false)  // 操作类：不通知
  },

  async scanFolder(folderPath: string, onProgress?: (event: { type: string; data?: any[]; stats?: any; error?: string }) => void): Promise<{ success: boolean; data: any[]; stats?: any }> {
    let response: Response
    
    try {
      response = await fetch(`${API_BASE}/scan`, {
        method: 'POST',
        headers: COMMON_HEADERS,
        body: JSON.stringify({ folderPath })
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '请求失败' }))
        handleApiError(errorData, response.status)
      }
    } catch (error: any) {
      throw error
    }

    console.log('[API] Starting stream response...')
    const reader = response.body?.getReader()
    if (!reader) {
      console.error('[API] Cannot get response body reader')
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    const allImages: any[] = []
    let finalStats: any = null

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          console.log(`[API] Stream completed`)
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const event = JSON.parse(line)

            if (onProgress) {
              onProgress(event)
            }

            if (event.type === 'data' && Array.isArray(event.data)) {
              allImages.push(...event.data)
            } else if (event.type === 'end') {
              finalStats = event.stats
            } else if (event.type === 'error') {
              throw new Error(event.error || 'Stream error')
            }
          } catch (parseError) {
            console.warn('[API] Parse failed:', line.substring(0, 100))
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
    const res = await fetch(`${API_BASE}/images`, {
      method: 'DELETE',
      headers: COMMON_HEADERS,
      body: JSON.stringify({ paths })
    })
    return handleResponse(res, false)  // 操作类：不通知
  },

  async moveImages(paths: string[], targetDir: string) {
    const res = await fetch(`${API_BASE}/images/move`, {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: JSON.stringify({ paths, targetDir })
    })
    return handleResponse(res, false)  // 操作类：不通知
  }
}

async function handleResponse(res: Response, shouldNotifyAuthFail = true): Promise<any> {
  if (res.ok) {
    return res.json()
  }
  
  const errorData = await res.json().catch(() => ({ error: '请求失败' }))
  
  if (shouldNotifyAuthFail) {
    handleApiError(errorData, res.status)
  } else {
    throw new Error(getErrorMessage(errorData, res.status))
  }
}

export { API_BASE }
