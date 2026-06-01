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

  async scanFolder(folderPath: string): Promise<{ success: boolean; data: any[]; stats?: any }> {
    const res = await signedFetch('POST', '/scan', { folderPath })
    return res.json()
  },

  async deleteImages(paths: string[]) {
    const res = await signedFetch('DELETE', '/images', { paths })
    return res.json()
  }
}

export { API_BASE }
