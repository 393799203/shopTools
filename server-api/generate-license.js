const crypto = require('crypto')

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function generateSegment(length = 4) {
  let result = ''
  const bytes = crypto.randomBytes(length)
  for (let i = 0; i < length; i++) {
    result += CHARSET[bytes[i] % CHARSET.length]
  }
  return result
}

function generateLicenseKey() {
  const segments = [
    'ShopTools',
    generateSegment(4),
    generateSegment(4),
    generateSegment(4),
    generateSegment(4)
  ]
  return segments.join('-')
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === 'gen' || command === 'gen-permanent') {
    const count = parseInt(args[1] || '1', 10)
    const days = command === 'gen-permanent' ? -1 : parseInt(args[2] || '365', 10)

    const apiBase = process.env.API_BASE || 'http://8.217.249.31:3001'
    const isPermanent = command === 'gen-permanent'

    console.log(`\nGenerating ${count} license(s)...`)
    console.log(`API: ${apiBase}`)
    if (isPermanent) {
      console.log(`Type: PERMANENT\n`)
    } else {
      console.log(`Duration: ${days} day(s)\n`)
    }

    for (let i = 0; i < count; i++) {
      const key = generateLicenseKey()

      try {
        const res = await fetch(`${apiBase}/admin/license`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Secret': process.env.ADMIN_SECRET || 'ShopToolsAdmin2024Secure!'
          },
          body: JSON.stringify({
          licenseKey: key,
          durationDays: days,
          isPermanent
        })
        })

        if (res.ok) {
          const data = await res.json()
          console.log(`[${i + 1}] ${key}  ${isPermanent ? '[PERMANENT]' : ''} ✓`)
        } else {
          const error = await res.text()
          console.log(`[${i + 1}] ${key}  ✗ Error: ${error}`)
        }
      } catch (err) {
        console.error(`[${i + 1}] ${key}  ✗ Connection error:`, err.message)
      }
    }

    console.log(`\nDone! Generated ${count} license(s)\n`)

  } else if (command === 'list') {
    const apiBase = process.env.API_BASE || 'http://8.217.249.31:3001'

    try {
      const res = await fetch(`${apiBase}/admin/licenses`, {
        headers: {
          'X-Admin-Secret': process.env.ADMIN_SECRET || 'ShopToolsAdmin2024Secure!'
        }
      })
      if (res.ok) {
        const response = await res.json()
        const data = response.data || []
        console.log('\nLicense Keys:\n')
        if (data.length === 0) {
          console.log('    No licenses found\n')
          return
        }
        data.forEach((row, i) => {
          const status = row.is_active ? '✓ active' : '✗ inactive'
          console.log(`[${i + 1}] ${row.license_key}`)
          console.log(`    Status: ${status} | Duration: ${row.duration_days} day(s)\n`)
        })
      }
    } catch (err) {
      console.error('Error:', err.message)
    }
  } else if (command === 'reset') {
    const licenseKey = args[1]
    if (!licenseKey) {
      console.error('Error: License key required')
      console.log('Usage: node generate-license.js reset <license-key>')
      process.exit(1)
    }

    const apiBase = process.env.API_BASE || 'http://8.217.249.31:3001'

    try {
      const res = await fetch(`${apiBase}/api/admin/reset-license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey,
          adminSecret: process.env.ADMIN_SECRET || 'ShopToolsAdmin2024Secure!'
        })
      })

      if (res.ok) {
        console.log(`\n✅ License reset successfully: ${licenseKey}\n`)
        console.log('This key can now be activated again.\n')
      } else {
        const error = await res.json()
        console.error(`\n❌ Reset failed: ${error.error}\n`)
      }
    } catch (err) {
      console.error('Error:', err.message)
    }
  } else {
    console.log(`
ShopTools License Key Generator (HTTP API Mode)
==============================================

Usage:
  node generate-license.js gen [count] [days]       Generate & insert license(s)
  node generate-license.js gen-permanent [count]   Generate permanent license(s)
  node generate-license.js list                    List all licenses
  node generate-license.js reset <license-key>     Reset license (allow re-activation)

Environment:
  API_BASE     API server URL (default: http://8.217.249.31:3001)

Examples:
  node generate-license.js gen-permanent 3         Generate 3 permanent licenses
  node generate-license.js gen 5                   Generate 5 licenses (365 days)
  node generate-license.js gen 2 30               Generate 2 licenses (30 days)
  node generate-license.js list                   List all licenses
`)
  }
}

main().catch(console.error)
