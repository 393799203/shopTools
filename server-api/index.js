require('dotenv').config()

const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const { Pool } = require('pg')

const app = express()
app.use(cors())
app.use(express.json())

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'picfilter',
  password: process.env.DB_PASS || 'postgres',
  port: process.env.DB_PORT || 5432,
})

const TIMESTAMP_WINDOW = 30
const NONCE_EXPIRES = 5 * 60

function sha256(message) {
  return crypto.createHash('sha256').update(message).digest('hex')
}

function hmacSha256(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest('hex')
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

function generateSecret() {
  return crypto.randomBytes(32).toString('hex')
}

async function cleanExpiredNonces() {
  try {
    await pool.query('DELETE FROM used_nonces WHERE expires_at < NOW()')
  } catch (error) {
    console.error('Error cleaning expired nonces:', error)
  }
}
setInterval(cleanExpiredNonces, 60 * 1000)

async function verifySignature(req, res, next) {
  try {
    const token = req.headers['x-token']
    const timestamp = req.headers['x-timestamp']
    const nonce = req.headers['x-nonce']
    const signature = req.headers['x-signature']

    if (!token || !timestamp || !nonce || !signature) {
      return res.status(401).json({ success: false, error: 'Missing authentication headers' })
    }

    const now = Math.floor(Date.now() / 1000)
    const ts = parseInt(timestamp, 10)
    if (isNaN(ts) || Math.abs(now - ts) > TIMESTAMP_WINDOW) {
      return res.status(401).json({ success: false, error: 'Request expired' })
    }

    const client = await pool.connect()
    try {
      const deviceResult = await client.query(
        'SELECT * FROM devices WHERE current_token = $1',
        [token]
      )

      if (deviceResult.rows.length === 0) {
        return res.status(401).json({ success: false, error: 'Invalid token' })
      }

      const device = deviceResult.rows[0]

      if (device.expires_at < now) {
        return res.status(401).json({ success: false, code: 'SUBSCRIPTION_EXPIRED', error: 'Subscription expired' })
      }

      const nonceResult = await client.query(
        'SELECT id FROM used_nonces WHERE token = $1 AND nonce = $2',
        [token, nonce]
      )
      if (nonceResult.rows.length > 0) {
        return res.status(401).json({ success: false, error: 'Nonce already used' })
      }

      await client.query(
        'INSERT INTO used_nonces (id, token, nonce, expires_at) VALUES ($1, $2, $3, $4)',
        [crypto.randomUUID(), token, nonce, new Date(Date.now() + NONCE_EXPIRES * 1000)]
      )

      const body = Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : ''
      const bodyHash = body ? sha256(body) : ''
      const method = req.method.toUpperCase()
      const path = req.originalUrl

      const message = `${timestamp}:${nonce}:${method}:${path}:${bodyHash}`
      const expectedSignature = hmacSha256(device.current_secret, message)

      if (signature !== expectedSignature) {
        return res.status(401).json({ success: false, error: 'Invalid signature' })
      }

      await client.query(
        'UPDATE devices SET updated_at = NOW() WHERE mac = $1',
        [device.mac]
      )

      req.device = device
      next()
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('Signature verification error:', error)
    res.status(500).json({ success: false, error: 'Internal server error' })
  }
}

app.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } })
})

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'ShopToolsAdmin2024Secure!'

function verifyAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret']
  if (!secret || secret !== ADMIN_SECRET) {
    return res.status(401).json({ success: false, error: 'Admin access denied' })
  }
  next()
}

app.post('/admin/license', verifyAdmin, async (req, res) => {
  try {
    const { licenseKey, durationDays } = req.body

    if (!licenseKey || !licenseKey.startsWith('ShopTools-')) {
      return res.status(400).json({ success: false, error: 'Invalid license key format' })
    }

    const client = await pool.connect()
    try {
      await client.query(
        `INSERT INTO licenses (id, license_key, duration_days)
         VALUES ($1, $2, $3)
         ON CONFLICT (license_key) DO UPDATE
         SET duration_days = EXCLUDED.duration_days,
             is_active = true`,
        [crypto.randomUUID(), licenseKey, durationDays || null]
      )

      res.json({ success: true, data: { licenseKey, durationDays } })
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('Admin create license error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/admin/licenses', verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT license_key, duration_days, is_active, created_at FROM licenses ORDER BY created_at DESC'
    )
    res.json({ success: true, data: result.rows })
  } catch (error) {
    console.error('Admin list licenses error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/device-status', async (req, res) => {
  try {
    const { mac } = req.query

    if (!mac || mac === 'unknown') {
      return res.status(400).json({ success: false, error: 'MAC address required' })
    }

    const client = await pool.connect()
    try {
      const deviceResult = await client.query(
        'SELECT * FROM devices WHERE mac = $1',
        [mac]
      )

      if (deviceResult.rows.length === 0) {
        return res.json({
          success: true,
          data: {
            activated: false,
            message: 'Device not activated'
          }
        })
      }

      const device = deviceResult.rows[0]
      const now = Math.floor(Date.now() / 1000)
      const isExpired = device.expires_at < now
      const daysRemaining = Math.max(0, Math.ceil((device.expires_at - now) / 86400))

      const historyResult = await client.query(
        'SELECT license_key, duration_days, used_at FROM device_license_history WHERE device_mac = $1 ORDER BY used_at DESC LIMIT 10',
        [mac]
      )

      console.log('📱 设备状态查询:', {
        mac,
        isExpired,
        daysRemaining,
        expiresAt: new Date(device.expires_at * 1000).toISOString()
      })

      res.json({
        success: true,
        data: {
          activated: true,
          expired: isExpired,
          token: device.current_token,
          secret: device.current_secret,
          expiresAt: device.expires_at,
          daysRemaining,
          createdAt: device.created_at,
          licenseHistory: historyResult.rows.map(row => ({
            licenseKey: row.license_key,
            durationDays: row.duration_days,
            usedAt: row.used_at
          }))
        }
      })
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('Device status error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.post('/api/activate', async (req, res) => {
  try {
    const { licenseKey, currentToken, deviceMac } = req.body

    console.log('🔑 激活请求:', { 
      hasLicenseKey: !!licenseKey, 
      hasCurrentToken: !!currentToken,
      deviceMac: deviceMac || 'N/A',
      licenseKey: licenseKey?.substring(0, 20) + '...',
      currentToken: currentToken?.substring(0, 20) + '...'
    })

    if (!licenseKey || !licenseKey.startsWith('ShopTools-')) {
      return res.status(400).json({ success: false, error: 'Invalid license key format' })
    }

    if (!deviceMac || deviceMac === 'unknown') {
      return res.status(400).json({ success: false, error: 'Device MAC address required' })
    }

    const client = await pool.connect()
    try {
      const licenseResult = await client.query(
        'SELECT * FROM licenses WHERE license_key = $1 AND is_active = true',
        [licenseKey]
      )

      if (licenseResult.rows.length === 0) {
        return res.status(401).json({ success: false, error: 'Invalid or inactive license key' })
      }

      const license = licenseResult.rows[0]

      if (!license.is_active) {
        return res.status(409).json({
          success: false,
          error: 'License key already used. Please contact support for reset.',
          code: 'LICENSE_ALREADY_USED'
        })
      }

      const durationDays = parseInt(license.duration_days, 10) || 1
      const now = new Date()
      const nowTimestamp = Math.floor(now.getTime() / 1000)
      let expiresAt

      if (currentToken) {
        const existingDevice = await client.query(
          'SELECT * FROM devices WHERE mac = $1',
          [deviceMac]
        )

        if (existingDevice.rows.length === 0) {
          return res.status(401).json({ success: false, error: 'Device not found. Please activate first.' })
        }

        const device = existingDevice.rows[0]
        if (device.current_token !== currentToken) {
          console.log('⚠️ Token 不匹配:', { 
            stored: device.current_token?.substring(0, 20), 
            received: currentToken?.substring(0, 20)
          })
          return res.status(403).json({
            success: false,
            error: 'Invalid token for this device.',
            code: 'TOKEN_MISMATCH'
          })
        }

        let baseExpiresAt = parseInt(device.expires_at, 10)
        if (!baseExpiresAt || isNaN(baseExpiresAt)) {
          baseExpiresAt = nowTimestamp
        }
        
        const additionalSeconds = durationDays * 86400
        expiresAt = baseExpiresAt + additionalSeconds

        console.log('📊 延期计算:', {
          deviceMac,
          licenseKey: license.license_key,
          durationDays,
          additionalDays: (additionalSeconds / 86400) + '天',
          baseExpiresAt: new Date(baseExpiresAt * 1000).toISOString(),
          result: new Date(expiresAt * 1000).toISOString()
        })

        const newToken = generateToken()
        const newSecret = generateSecret()

        await client.query('BEGIN')
        try {
          await client.query(
            'UPDATE devices SET current_token = $1, current_secret = $2, expires_at = $3, updated_at = NOW() WHERE mac = $4',
            [newToken, newSecret, expiresAt, deviceMac]
          )

          await client.query(
            `INSERT INTO device_license_history (id, device_mac, license_key, license_id, duration_days, used_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [crypto.randomUUID(), deviceMac, licenseKey, license.id, durationDays]
          )

          await client.query(
            'UPDATE licenses SET is_active = false WHERE id = $1',
            [license.id]
          )

          await client.query('COMMIT')
        } catch (e) {
          await client.query('ROLLBACK')
          throw e
        }

        res.json({
          success: true,
          data: {
            token: newToken,
            secret: newSecret,
            expiresAt
          }
        })
        return
      }

      const token = generateToken()
      const secret = generateSecret()
      expiresAt = nowTimestamp + durationDays * 86400

      console.log('🆕 首次激活:', {
        deviceMac,
        licenseKey: license.license_key,
        durationDays,
        expiresAt: new Date(expiresAt * 1000).toISOString()
      })

      await client.query('BEGIN')
      try {
        await client.query(
          `INSERT INTO devices (mac, current_token, current_secret, expires_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (mac) DO UPDATE SET
             current_token = EXCLUDED.current_token,
             current_secret = EXCLUDED.current_secret,
             expires_at = EXCLUDED.expires_at,
             updated_at = NOW()`,
          [deviceMac, token, secret, expiresAt]
        )

        await client.query(
          `INSERT INTO device_license_history (id, device_mac, license_key, license_id, duration_days, used_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [crypto.randomUUID(), deviceMac, licenseKey, license.id, durationDays]
        )

        await client.query(
          'UPDATE licenses SET is_active = false WHERE id = $1',
          [license.id]
        )

        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      }

      res.json({
        success: true,
        data: {
          token,
          secret,
          expiresAt
        }
      })
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('Activation error:', error)
    res.status(500).json({ success: false, error: 'Activation failed' })
  }
})

app.post('/api/admin/update-device-expiry', verifyAdmin, async (req, res) => {
  try {
    const { deviceMac, expiresAt } = req.body

    if (!deviceMac || !expiresAt) {
      return res.status(400).json({ success: false, error: 'deviceMac and expiresAt required' })
    }

    const result = await pool.query(
      'UPDATE devices SET expires_at = $1, updated_at = NOW() WHERE mac = $2 RETURNING mac, expires_at',
      [new Date(expiresAt).getTime() / 1000, deviceMac]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Device not found' })
    }

    const device = result.rows[0]
    console.log(`[Admin] Updated device expiry: MAC=${device.mac}, newExpiresAt=${new Date(device.expires_at * 1000).toISOString()}`)

    res.json({
      success: true,
      data: {
        mac: device.mac,
        expiresAt: device.expires_at,
        expiresAtISO: new Date(device.expires_at * 1000).toISOString()
      }
    })
  } catch (error) {
    console.error('Update device expiry error:', error)
    res.status(500).json({ success: false, error: 'Failed to update device expiry' })
  }
})

app.post('/api/admin/reset-license', verifyAdmin, async (req, res) => {
  try {
    const { licenseKey } = req.body

    if (!licenseKey) {
      return res.status(400).json({ success: false, error: 'License key required' })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const licenseResult = await client.query(
        'SELECT id FROM licenses WHERE license_key = $1',
        [licenseKey]
      )

      if (licenseResult.rows.length === 0) {
        await client.query('ROLLBACK')
        return res.status(404).json({ success: false, error: 'License not found' })
      }

      const licenseId = licenseResult.rows[0].id

      await client.query(
        'UPDATE licenses SET is_active = true WHERE id = $1',
        [licenseId]
      )

      await client.query('COMMIT')

      console.log(`[ADMIN] License reset: ${licenseKey}`)
      res.json({ success: true, data: { message: 'License reset successfully' } })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('Reset error:', error)
    res.status(500).json({ success: false, error: 'Reset failed' })
  }
})

app.get('/api/words', verifySignature, async (req, res) => {
  try {
    const companyId = req.headers['x-company-id'] || 'default'
    const client = await pool.connect()
    const result = await client.query(
      'SELECT id, word, company_id, created_at FROM sensitive_words WHERE company_id = $1 ORDER BY created_at DESC',
      [companyId]
    )
    client.release()
    res.json({ success: true, data: result.rows })
  } catch (error) {
    console.error('Error fetching words:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.post('/api/words', verifySignature, async (req, res) => {
  try {
    const { word } = req.body
    if (!word || !word.trim()) {
      return res.status(400).json({ success: false, error: '敏感词不能为空' })
    }

    const companyId = req.headers['x-company-id'] || 'default'
    const id = crypto.randomUUID()
    const client = await pool.connect()
    await client.query(
      'INSERT INTO sensitive_words (id, word, company_id) VALUES ($1, $2, $3)',
      [id, word.trim(), companyId]
    )
    client.release()

    res.json({ success: true, data: { id, word: word.trim(), companyId } })
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ success: false, error: '该敏感词已存在' })
    }
    console.error('Error adding word:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.delete('/api/words/:id', verifySignature, async (req, res) => {
  try {
    const { id } = req.params
    const companyId = req.headers['x-company-id'] || 'default'
    const client = await pool.connect()
    const result = await client.query(
      'DELETE FROM sensitive_words WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, companyId]
    )
    client.release()

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: '敏感词不存在' })
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting word:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.post('/api/scan', verifySignature, async (req, res) => {
  try {
    const { folderPath } = req.body
    if (!folderPath) {
      return res.status(400).json({ success: false, error: 'folderPath is required' })
    }
    res.json({ success: true, data: { scanned: 0, images: [] } })
  } catch (error) {
    console.error('Error scanning folder:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.delete('/api/images', verifySignature, async (req, res) => {
  try {
    const { paths } = req.body
    if (!paths || !Array.isArray(paths)) {
      return res.status(400).json({ success: false, error: 'paths array is required' })
    }
    res.json({ success: true, data: { deleted: paths.length } })
  } catch (error) {
    console.error('Error deleting images:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ShopTools API server running on port ${PORT}`)
})