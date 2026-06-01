const TIMESTAMP_WINDOW = 30

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message)
  const hash = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hash))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

function hmacSha256(key: string, message: string): Promise<string> {
  const keyBuffer = new TextEncoder().encode(key)
  return crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  ).then(cryptoKey => {
    const messageBuffer = new TextEncoder().encode(message)
    return crypto.subtle.sign('HMAC', cryptoKey, messageBuffer)
  }).then(signature => {
    const signatureArray = Array.from(new Uint8Array(signature))
    return signatureArray.map(b => b.toString(16).padStart(2, '0')).join('')
  })
}

function generateNonce(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function generateSignature(
  secret: string,
  method: string,
  path: string,
  body?: object | null
): Promise<{ timestamp: number; nonce: string; signature: string }> {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = generateNonce()
  const bodyHash = body ? await sha256(JSON.stringify(body)) : ''

  const message = `${timestamp}:${nonce}:${method}:${path}:${bodyHash}`
  const signature = await hmacSha256(secret, message)

  return { timestamp, nonce, signature }
}

export function applySignature(
  headers: Record<string, string>,
  timestamp: number,
  nonce: string,
  signature: string
): Record<string, string> {
  return {
    ...headers,
    'X-Timestamp': timestamp.toString(),
    'X-Nonce': nonce,
    'X-Signature': signature
  }
}

export { TIMESTAMP_WINDOW }