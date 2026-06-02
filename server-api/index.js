require('dotenv').config()

const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
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
      
      // 动态计算当前有效模式：订阅优先，按量兜底
      const hasSubscription = device.expires_at && device.expires_at > now
      const hasQuota = (device.quota_remaining || 0) > 0
      
      if (!hasSubscription && !hasQuota) {
        // 都不可用，根据设备类型返回对应错误
        if ((device.quota_total || 0) > 0) {
          return res.status(403).json({ success: false, code: 'QUOTA_EXHAUSTED', error: '订阅已到期且配额已用完' })
        } else {
          return res.status(401).json({ success: false, code: 'SUBSCRIPTION_EXPIRED', error: 'Subscription expired' })
        }
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
    const { licenseKey, durationDays, licenseType, quotaAmount } = req.body

    if (!licenseKey || !licenseKey.startsWith('ShopTools-')) {
      return res.status(400).json({ success: false, error: 'Invalid license key format' })
    }

    const type = licenseType || 'subscription'
    const amount = parseInt(quotaAmount, 10) || 0
    const days = type === 'pay_per_use' ? 0 : (parseInt(durationDays, 10) || 365)

    const client = await pool.connect()
    try {
      await client.query(
        `INSERT INTO licenses (id, license_key, duration_days, license_type, quota_amount)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (license_key) DO UPDATE
         SET duration_days = EXCLUDED.duration_days,
             license_type = EXCLUDED.license_type,
             quota_amount = EXCLUDED.quota_amount,
             is_active = true`,
        [crypto.randomUUID(), licenseKey, days, type, amount]
      )

      res.json({ 
        success: true, 
        data: { 
          licenseKey, 
          durationDays: days, 
          licenseType: type,
          quotaAmount: amount
        } 
      })
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
      
      let effectivePlanType
      let isSubscriptionExpired  // 订阅是否过期（独立于有效模式）
      let daysRemaining = null
      let quotaRemaining = null
      let quotaTotal = null
      
      // 先判断订阅状态（独立于额度）
      if (device.expires_at && device.expires_at > now) {
        // ✅ 订阅未过期
        isSubscriptionExpired = false
        daysRemaining = Math.max(0, Math.ceil((device.expires_at - now) / 86400))
      } else {
        // ❌ 订阅已过期（或从未激活过）
        isSubscriptionExpired = true
        daysRemaining = 0
      }
      
      // 再判断当前有效模式（用于扣费）
      const hasSubscription = !isSubscriptionExpired  // 订阅有效
      const hasQuota = (device.quota_remaining || 0) > 0
      
      if (hasSubscription) {
        // ✅ 订阅有效 → 使用订阅模式（优先）
        effectivePlanType = 'subscription'
        console.log(`📱 设备状态: 订阅模式有效 (${daysRemaining}天后到期)`)
      } else if (hasQuota) {
        // ⚠️ 订阅过期但有额度 → 使用按量模式（兜底）
        effectivePlanType = 'pay_per_use'
        quotaRemaining = device.quota_remaining || 0
        quotaTotal = device.quota_total || 0
        console.log(`📱 设备状态: 按量模式 (剩余${quotaRemaining}张, 订阅已过期)`)
      } else {
        // ❌ 都不可用 → 根据最后激活的类型显示
        if ((device.quota_total || 0) > 0) {
          effectivePlanType = 'pay_per_use'
          quotaRemaining = 0
          quotaTotal = device.quota_total || 0
          console.log('📱 设备状态: 额度已用完 (订阅已过期)')
        } else {
          effectivePlanType = 'subscription'
          console.log('📱 设备状态: 订阅已过期')
        }
      }

      const historyResult = await client.query(
        `SELECT h.license_key, h.duration_days, h.used_at, l.license_type, l.quota_amount
         FROM device_license_history h 
         LEFT JOIN licenses l ON h.license_id = l.id 
         WHERE h.device_mac = $1 
         ORDER BY h.used_at DESC LIMIT 10`,
        [mac]
      )

      console.log('📱 设备状态查询:', {
        mac,
        effectivePlanType,
        hasSubscription,
        hasQuota,
        isSubscriptionExpired,  // 订阅是否过期
        daysRemaining,
        quotaRemaining,
        quotaTotal,
        expiresAt: device.expires_at ? new Date(device.expires_at * 1000).toISOString() : null
      })

      const responseData = {
        activated: true,
        planType: effectivePlanType,
        token: device.current_token,
        secret: device.current_secret,
        createdAt: device.created_at,
        licenseHistory: historyResult.rows.map(row => {
          const isQuota = row.license_type === 'pay_per_use'
          return {
            licenseKey: row.license_key,
            licenseType: row.license_type || 'subscription',
            ...(isQuota 
              ? { quotaAmount: row.quota_amount || row.duration_days } 
              : { durationDays: row.duration_days }
            ),
            usedAt: row.used_at
          }
        })
      }

      // 始终返回所有可用信息（让用户同时看到订阅和额度状态）
      // effectivePlanType 只表示当前有效模式（用于扣费判断）
      // isExpired 表示订阅是否过期（独立于当前有效模式）
      responseData.isExpired = isSubscriptionExpired  // 订阅是否过期
      responseData.expiresAt = device.expires_at || null
      responseData.daysRemaining = daysRemaining  // 订阅剩余天数（0表示已过期）
      responseData.quotaRemaining = quotaRemaining !== null ? quotaRemaining : (device.quota_remaining || 0)
      responseData.quotaTotal = quotaTotal !== null ? quotaTotal : (device.quota_total || 0)

      res.json({
        success: true,
        data: responseData
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
      const licenseType = license.license_type || 'subscription'
      const quotaAmount = parseInt(license.quota_amount, 10) || 0
      const durationDays = parseInt(license.duration_days, 10) || 1

      if (!license.is_active) {
        return res.status(409).json({
          success: false,
          error: 'License key already used. Please contact support for reset.',
          code: 'LICENSE_ALREADY_USED'
        })
      }

      const nowTimestamp = Math.floor(Date.now() / 1000)
      
      if (licenseType === 'pay_per_use') {
        console.log('💰 按量付费激活（增加额度）:', { deviceMac, quotaAmount })

        let existingDevice
        if (currentToken) {
          existingDevice = await client.query(
            'SELECT * FROM devices WHERE mac = $1',
            [deviceMac]
          )

          if (existingDevice.rows.length > 0 && existingDevice.rows[0].current_token !== currentToken) {
            return res.status(403).json({
              success: false,
              error: 'Invalid token for this device.',
              code: 'TOKEN_MISMATCH'
            })
          }
        }

        const newToken = generateToken()
        const newSecret = generateSecret()

        await client.query('BEGIN')
        try {
          if (existingDevice && existingDevice.rows.length > 0) {
            await client.query(
              `UPDATE devices SET 
                current_token = $1, 
                current_secret = $2, 
                quota_remaining = COALESCE(quota_remaining, 0) + $3,
                quota_total = COALESCE(quota_total, 0) + $3,
                updated_at = NOW() 
               WHERE mac = $4`,
              [newToken, newSecret, quotaAmount, deviceMac]
            )
          } else {
            const futureDate = new Date()
            futureDate.setFullYear(futureDate.getFullYear() + 100)
            const farFutureTimestamp = Math.floor(futureDate.getTime() / 1000)

            await client.query(
              `INSERT INTO devices (mac, current_token, current_secret, expires_at, quota_remaining, quota_total, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $5, NOW(), NOW())
               ON CONFLICT (mac) DO UPDATE SET
                 current_token = EXCLUDED.current_token,
                 current_secret = EXCLUDED.current_secret,
                 quota_remaining = devices.quota_remaining + $5,
                 quota_total = devices.quota_total + $5,
                 updated_at = NOW()`,
              [deviceMac, newToken, newSecret, farFutureTimestamp, quotaAmount]
            )
          }

          await client.query(
            `INSERT INTO quota_orders (id, device_mac, amount, order_no, payment_status)
             VALUES ($1, $2, $3, $4, 'paid')`,
            [crypto.randomUUID(), deviceMac, quotaAmount, licenseKey]
          )

          await client.query(
            `INSERT INTO device_license_history (id, device_mac, license_key, license_id, duration_days, used_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [crypto.randomUUID(), deviceMac, licenseKey, license.id, quotaAmount]
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

        const updatedDevice = await client.query(
          'SELECT quota_remaining, quota_total FROM devices WHERE mac = $1',
          [deviceMac]
        )

        res.json({
          success: true,
          data: {
            token: newToken,
            secret: newSecret,
            planType: 'pay_per_use',
            quotaRemaining: updatedDevice.rows[0].quota_remaining,
            quotaTotal: updatedDevice.rows[0].quota_total,
            message: `成功充值 ${quotaAmount} 张额度`
          }
        })
        return
      }

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
        
        if (!baseExpiresAt || isNaN(baseExpiresAt) || baseExpiresAt <= nowTimestamp) {
          baseExpiresAt = nowTimestamp
          console.log('⚠️ 已过期或无有效时间，从当前时间开始计算')
        } else {
          console.log('✅ 未过期，从原到期时间开始计算')
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
            expiresAt,
            planType: 'subscription'
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
          `INSERT INTO devices (mac, current_token, current_secret, expires_at, plan_type, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'subscription', NOW(), NOW())
           ON CONFLICT (mac) DO UPDATE SET
             current_token = EXCLUDED.current_token,
             current_secret = EXCLUDED.current_secret,
             expires_at = EXCLUDED.expires_at,
             plan_type = 'subscription',
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
          expiresAt,
          planType: 'subscription'
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

app.delete('/api/admin/device/:mac', verifyAdmin, async (req, res) => {
  try {
    const { mac } = req.params

    if (!mac || mac === 'unknown') {
      return res.status(400).json({ success: false, error: 'MAC address required' })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const deviceResult = await client.query(
        'SELECT mac, created_at FROM devices WHERE mac = $1',
        [mac]
      )

      if (deviceResult.rows.length === 0) {
        await client.query('ROLLBACK')
        return res.status(404).json({ success: false, error: 'Device not found' })
      }

      try {
        await client.query(
          'DELETE FROM device_license_history WHERE device_mac = $1',
          [mac]
        )
        console.log(`[Admin] 已清理 device_license_history`)
      } catch (e) {
        console.log(`[Admin] device_license_history 清理失败:`, e.message)
      }

      try {
        await client.query(
          'DELETE FROM quota_usage_log WHERE device_mac = $1',
          [mac]
        )
        console.log(`[Admin] 已清理 quota_usage_log`)
      } catch (e) {
        console.log(`[Admin] quota_usage_log 清理失败（可忽略）:`, e.message)
      }

      try {
        await client.query(
          'DELETE FROM used_nonces WHERE token IN (SELECT current_token FROM devices WHERE mac = $1)',
          [mac]
        )
        console.log(`[Admin] 已清理 used_nonces`)
      } catch (e) {
        console.log(`[Admin] used_nonces 清理失败（可忽略）:`, e.message)
      }

      try {
        await client.query(
          'DELETE FROM quota_orders WHERE device_mac = $1',
          [mac]
        )
        console.log(`[Admin] 已清理 quota_orders`)
      } catch (e) {
        console.log(`[Admin] quota_orders 清理失败（可忽略）:`, e.message)
      }

      await client.query(
        'DELETE FROM devices WHERE mac = $1 RETURNING mac, created_at',
        [mac]
      )

      await client.query('COMMIT')

      const deletedDevice = deviceResult.rows[0]
      console.log(`[Admin] Deleted device: MAC=${deletedDevice.mac}, createdAt=${deletedDevice.created_at}`)

      res.json({
        success: true,
        data: {
          mac: deletedDevice.mac,
          message: '设备已删除，可以重新激活'
        }
      })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('Delete device error:', error)
    res.status(500).json({ success: false, error: `Failed to delete device: ${error.message}` })
  }
})

app.post('/api/deduct-quota', verifySignature, async (req, res) => {
  try {
    const { imageCount, folderPath } = req.body

    if (!imageCount || imageCount <= 0) {
      return res.status(400).json({ success: false, error: 'imageCount must be positive' })
    }

    const token = req.headers['x-token']
    
    const client = await pool.connect()
    try {
      const deviceResult = await client.query(
        'SELECT * FROM devices WHERE current_token = $1',
        [token]
      )

      if (deviceResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Device not found' })
      }

      const device = deviceResult.rows[0]
      const now = Math.floor(Date.now() / 1000)
      
      // 动态计算当前有效模式：订阅优先，按量兜底
      const hasSubscription = device.expires_at && device.expires_at > now
      const hasQuota = (device.quota_remaining || 0) > 0
      
      // 详细日志：显示关键判断依据
      console.log('💰 扣费请求详情:', {
        mac: device.mac,
        imageCount,
        currentTime: new Date(now * 1000).toISOString(),
        expiresAt: device.expires_at ? new Date(device.expires_at * 1000).toISOString() : null,
        hasSubscription,  // 订阅是否还有效
        hasQuota,          // 是否有剩余额度
        quotaRemaining: device.quota_remaining,
        quotaTotal: device.quota_total
      })
      
      let effectivePlanType
      if (hasSubscription) {
        // ✅ 订阅有效 → 使用订阅模式（不扣费）
        effectivePlanType = 'subscription'
        console.log('💰 结果: 订阅制模式 - 不扣费')
        
        return res.json({
          success: true,
          data: { 
            message: '订阅制模式，不扣费',
            quotaRemaining: null,
            quotaTotal: null
          }
        })
      } else if (hasQuota) {
        // ⚠️ 订阅过期但有额度 → 使用按量模式（扣费）
        effectivePlanType = 'pay_per_use'
        console.log(`💰 结果: 按量付费模式 - 准备扣除 ${imageCount} 张`)
      } else {
        // ❌ 都不可用
        effectivePlanType = 'none'
        console.log('❌ 结果: 无可用额度或订阅')
        
        if ((device.quota_total || 0) > 0) {
          return res.status(403).json({
            success: false,
            error: '订阅已到期且配额已用完',
            code: 'QUOTA_EXHAUSTED'
          })
        } else {
          return res.status(403).json({
            success: false,
            error: '订阅已过期，请续期',
            code: 'SUBSCRIPTION_EXPIRED'
          })
        }
      }

      const remaining = device.quota_remaining || 0
      
      let actualDeduct = imageCount
      if (remaining < imageCount) {
        actualDeduct = remaining
      }
      
      if (actualDeduct <= 0) {
        return res.status(403).json({
          success: false,
          error: '配额已用完，请充值',
          code: 'QUOTA_EXHAUSTED'
        })
      }

      const newRemaining = remaining - actualDeduct

      await client.query('BEGIN')
      try {
        await client.query(
          `INSERT INTO quota_usage_log (id, device_mac, images_count, folder_path)
           VALUES ($1, $2, $3, $4)`,
          [crypto.randomUUID(), device.mac, actualDeduct, folderPath]
        )

        await client.query(
          'UPDATE devices SET quota_remaining = $1, updated_at = NOW() WHERE mac = $2',
          [newRemaining, device.mac]
        )

        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      }

      console.log(`💰 额度扣除: MAC=${device.mac}, -${actualDeduct}, 剩余=${newRemaining}`)

      res.json({
        success: true,
        data: {
          quotaUsed: actualDeduct,
          quotaRequested: imageCount,
          quotaRemaining: newRemaining,
          quotaTotal: device.quota_total
        }
      })
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('Deduct quota error:', error)
    res.status(500).json({ success: false, error: error.message })
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

const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ShopTools API server running on port ${PORT}`)
})