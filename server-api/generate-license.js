#!/usr/bin/env node

/**
 * ShopTools License Key Generator (HTTP API Mode)
 * =================================================
 * 
 * 用于生成和管理 ShopTools 应用的 License Key。
 * 
 * 功能：
 * - 生成订阅制 License（按天数）
 * - 生成永久 License（特殊用途）
 * - 生成按量付费 License（按图片数量）
 * - 列出所有 License
 * - 重置已使用的 License（允许重新激活）
 * 
 * 使用方式：
 *   node generate-license.js <command> [args...]
 * 
 * 命令说明：
 *   gen [count] [days]           生成订阅制 License
 *   gen-permanent [count]        生成永久 License
 *   gen-quota [count] [amount]   生成按量付费 License
 *   list                        列出所有 License
 *   reset <license-key>         重置指定 License
 * 
 * 环境变量：
 *   API_BASE      远程服务器地址 (默认: http://8.217.249.31:3001)
 *   ADMIN_SECRET  管理员密钥 (默认: ShopToolsAdmin2024Secure!)
 * 
 * 示例：
 *   # 生成 5 个 365 天的订阅 License
 *   node generate-license.js gen 5 365
 *   
 *   # 生成 3 个永久 License
 *   node generate-license.js gen-permanent 3
 *   
 *   # 生成 10 个按量付费 License，每个 10000 张额度
 *   node generate-license.js gen-quota 10 10000
 *   
 *   # 列出所有 License
 *   node generate-license.js list
 *   
 *   # 重置某个 License（使其可以重新激活）
 *   node generate-license.js reset ShopTools-XXXX-XXXX-XXXX-XXXX
 */

const crypto = require('crypto')

// ============================================
// 配置常量
// ============================================

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

// ============================================
// 工具函数
// ============================================

/**
 * 生成随机字符串片段
 * @param {number} length - 片段长度（默认4位）
 * @returns {string} 随机字符串
 */
function generateSegment(length = 4) {
  let result = ''
  const bytes = crypto.randomBytes(length)
  for (let i = 0; i < length; i++) {
    result += CHARSET[bytes[i] % CHARSET.length]
  }
  return result
}

/**
 * 生成完整的 License Key
 * 格式：ShopTools-XXXX-XXXX-XXXX-XXXX
 * 
 * @returns {string} 完整的 License Key
 */
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

/**
 * 获取配置
 * @returns {{ apiBase: string, adminSecret: string }}
 */
function getConfig() {
  return {
    apiBase: process.env.API_BASE || 'http://8.217.249.31:3001',
    adminSecret: process.env.ADMIN_SECRET || 'ShopToolsAdmin2024Secure!'
  }
}

// ============================================
// 命令实现
// ============================================

/**
 * 命令：gen - 生成订阅制 License
 * 
 * 用法: node generate-license.js gen [count] [days]
 * 
 * 参数：
 *   count - 生成数量（默认1）
 *   days  - 有效期天数（默认365）
 * 
 * 示例：
 *   node generate-license.js gen          # 生成1个365天的License
 *   node generate-license.js gen 5 30     # 生成5个30天的License
 * 
 * @param {string[]} args - 命令行参数 [count, days]
 */
async function cmdGen(args) {
  const count = parseInt(args[0] || '1', 10)
  const days = parseInt(args[1] || '365', 10)
  const { apiBase, adminSecret } = getConfig()

  console.log(`\n📦 生成订阅制 License`)
  console.log(`   数量: ${count}`)
  console.log(`   有效期: ${days} 天`)
  console.log(`   服务器: ${apiBase}\n`)

  for (let i = 0; i < count; i++) {
    const key = generateLicenseKey()

    try {
      const res = await fetch(`${apiBase}/admin/license`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': adminSecret
        },
        body: JSON.stringify({
          licenseKey: key,
          durationDays: days,
          licenseType: 'subscription'
        })
      })

      if (res.ok) {
        console.log(`   ✅ [${i + 1}/${count}] ${key} (${days}天)`)
      } else {
        const error = await res.text()
        console.log(`   ❌ [${i + 1}/${count}] ${key} → ${error}`)
      }
    } catch (err) {
      console.error(`   ❌ [${i + 1}/${count}] ${key} → 连接失败: ${err.message}`)
    }
  }

  console.log(`\n✅ 完成！共生成 ${count} 个订阅制 License\n`)
}

/**
 * 命令：gen-permanent - 生成永久 License
 * 
 * ⚠️ 注意：永久 License 仅用于特殊场景（如内部测试、VIP客户等）
 *    正式环境建议使用订阅制或按量付费
 * 
 * 用法: node generate-license.js gen-permanent [count]
 * 
 * 参数：
 *   count - 生成数量（默认1）
 * 
 * @param {string[]} args - 命令行参数 [count]
 */
async function cmdGenPermanent(args) {
  const count = parseInt(args[0] || '1', 10)
  const { apiBase, adminSecret } = getConfig()

  console.log(`\n🔑 生成永久 License`)
  console.log(`   数量: ${count}`)
  console.log(`   服务器: ${apiBase}\n`)

  for (let i = 0; i < count; i++) {
    const key = generateLicenseKey()

    try {
      const res = await fetch(`${apiBase}/admin/license`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': adminSecret
        },
        body: JSON.stringify({
          licenseKey: key,
          durationDays: 99999,  // 约273年，相当于永久
          licenseType: 'subscription'
        })
      })

      if (res.ok) {
        console.log(`   ✅ [${i + 1}/${count}] ${key} [永久]`)
      } else {
        const error = await res.text()
        console.log(`   ❌ [${i + 1}/${count}] ${key} → ${error}`)
      }
    } catch (err) {
      console.error(`   ❌ [${i + 1}/${count}] ${key} → 连接失败: ${err.message}`)
    }
  }

  console.log(`\n✅ 完成！共生成 ${count} 个永久 License\n`)
}

/**
 * 命令：gen-quota - 生成按量付费 License
 * 
 * 按量付费 License 适用于：
 * - 轻度用户（不想购买长期订阅）
 * - 试用体验
 * - 按需使用场景
 * 
 * 用户激活后获得指定数量的图片扫描额度，
 * 额度用完后需再次充值或激活新的 License
 * 
 * 用法: node generate-license.js gen-quota [count] [amount]
 * 
 * 参数：
 *   count  - 生成数量（默认1）
 *   amount - 每个License包含的图片额度（默认10000）
 * 
 * 示例：
 *   node generate-license.js gen-quota              # 1个10000张的License
 *   node generate-license.js gen-quota 5 5000       # 5个5000张的License
 *   node generate-license.js gen-quota 1 100        # 1个100张的试用License
 * 
 * @param {string[]} args - 命令行参数 [count, amount]
 */
async function cmdGenQuota(args) {
  const count = parseInt(args[0] || '1', 10)
  const amount = parseInt(args[1] || '10000', 10)
  const { apiBase, adminSecret } = getConfig()

  console.log(`\n💰 生成按量付费 License`)
  console.log(`   数量: ${count}`)
  console.log(`   额度: ${amount} 张图片/License`)
  console.log(`   服务器: ${apiBase}\n`)

  for (let i = 0; i < count; i++) {
    const key = generateLicenseKey()

    try {
      const res = await fetch(`${apiBase}/admin/license`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': adminSecret
        },
        body: JSON.stringify({
          licenseKey: key,
          durationDays: 0,
          licenseType: 'pay_per_use',
          quotaAmount: amount
        })
      })

      if (res.ok) {
        console.log(`   ✅ [${i + 1}/${count}] ${key} [${amount}张]`)
      } else {
        const error = await res.text()
        console.log(`   ❌ [${i + 1}/${count}] ${key} → ${error}`)
      }
    } catch (err) {
      console.error(`   ❌ [${i + 1}/${count}] ${key} → 连接失败: ${err.message}`)
    }
  }

  console.log(`\n✅ 完成！共生成 ${count} 个按量付费 License\n`)
}

/**
 * 命令：list - 列出所有 License
 * 
 * 显示所有已创建的 License 及其状态：
 * - ✓ active: 可用于激活
 * - ✗ inactive: 已被使用，需要 reset 后才能重新激活
 * 
 * 用法: node generate-license.js list
 */
async function cmdList() {
  const { apiBase, adminSecret } = getConfig()

  console.log('\n📋 License 列表\n')

  try {
    const res = await fetch(`${apiBase}/admin/licenses`, {
      headers: { 'X-Admin-Secret': adminSecret }
    })

    if (res.ok) {
      const response = await res.json()
      const data = response.data || []

      if (data.length === 0) {
        console.log('   暂无 License\n')
        return
      }

      let activeCount = 0
      data.forEach((row, i) => {
        const status = row.is_active ? '✓ 可用' : '✗ 已使用'
        if (row.is_active) activeCount++
        
        console.log(`   [${i + 1}] ${row.license_key}`)
        console.log(`       状态: ${status} | 时长: ${row.duration_days}天 | 创建: ${row.created_at?.slice(0, 10)}\n`)
      })

      console.log(`   ──────────────────────────`)
      console.log(`   总计: ${data.length} 个 (可用: ${activeCount}, 已用: ${data.length - activeCount})\n`)
    } else {
      console.error('   ❌ 获取列表失败\n')
    }
  } catch (err) {
    console.error(`   ❌ 连接错误: ${err.message}\n`)
  }
}

/**
 * 命令：reset - 重置已使用的 License
 * 
 * 当某个 License 已被激活但需要重新使用时，
 * 可以通过此命令将其状态重置为 active。
 * 
 * 典型使用场景：
 * - 用户换电脑了，需要在新设备上激活
 * - 测试时重复使用同一个 License
 * - License 输入错误，需要重新激活
 * 
 * ⚠️ 安全提示：
 *    重置后原设备将无法继续使用该 License
 *    （因为本地存储的 token 会失效）
 * 
 * 用法: node generate-license.js reset <license-key>
 * 
 * @param {string[]} args - 命令行参数 [licenseKey]
 */
async function cmdReset(args) {
  const licenseKey = args[0]

  if (!licenseKey) {
    console.error('\n❌ 错误: 请提供 License Key')
    console.log('\n   用法: node generate-license.js reset <license-key>')
    console.log('   示例: node generate-license.js reset ShopTools-ABCD-EFGH-IJKL-MNOP\n')
    process.exit(1)
  }

  const { apiBase, adminSecret } = getConfig()

  console.log(`\n🔄 重置 License: ${licenseKey}`)

  try {
    const res = await fetch(`${apiBase}/api/admin/reset-license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey })
    })

    if (res.ok) {
      console.log(`\n   ✅ 重置成功!`)
      console.log(`   该 License 现在可以在新设备上激活了。\n`)
    } else {
      const error = await res.json()
      console.error(`\n   ❌ 重置失败: ${error.error}\n`)
    }
  } catch (err) {
    console.error(`   ❌ 连接错误: ${err.message}\n`)
  }
}

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║     ShopTools License Key Generator v2.0             ║
║     License 密钥生成与管理工具                        ║
╚══════════════════════════════════════════════════════╝

📖 使用方法:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  📦 订阅制（按时长）:
     node generate-license.js gen [数量] [天数]
     
     示例:
       node generate-license.js gen              # 1个, 365天
       node generate-license.js gen 5            # 5个, 365天
       node generate-license.js gen 2 30        # 2个, 30天
       node generate-license.js gen 1 730       # 1个, 2年

  🔑 永久 License（特殊用途）:
     node generate-license.js gen-permanent [数量]
     
     示例:
       node generate-license.js gen-permanent    # 1个永久
       node generate-license.js gen-permanent 3  # 3个永久

  💰 按量付费（按图片数）:
     node generate-license.js gen-quota [数量] [额度]
     
     示例:
       node generate-license.js gen-quota              # 1个, 10000张
       node generate-license.js gen-quota 5 5000       # 5个, 5000张
       node generate-license.js gen-quota 1 100        # 1个试用版, 100张

  📋 查看 License 列表:
     node generate-license.js list

  🔄 重置已使用的 License:
     node generate-license.js reset <License-Key>
     
     示例:
       node generate-license.js reset ShopTools-ABCD-1234-EFGH-5678

⚙️  环境变量:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  API_BASE      远程服务器地址
                默认: http://8.217.249.31:3001
                
  ADMIN_SECRET  管理员密钥
                默认: ShopToolsAdmin2024Secure!

📝 设置环境变量示例:
  export API_BASE=http://your-server:3001
  export ADMIN_SECRET=your-secret-key
  
  # Windows (PowerShell):
  $env:API_BASE="http://your-server:3001"
  $env:ADMIN_SECRET="your-secret-key"

🎯 License 类型对比:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  类型          适用场景                    特点
  ────────────────────────────────────────────────
  subscription  正式用户、长期使用            按时间计费，到期续费
  pay_per_use   试用、轻度用户、临时需求    按图片数量计费，用完再充
  permanent     内部测试、VIP客户           无限期（谨慎使用）

💡 推荐方案:
  - 新用户试用: gen-quota 1 100 (100张试用)
  - 正式用户: gen 1 365 (1年订阅)
  - 大客户: gen-permanent (永久授权)

───────────────────────────────────────────────────
`)
}

// ============================================
// 主程序入口
// ============================================

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  switch (command) {
    case 'gen':
      await cmdGen(args.slice(1))
      break

    case 'gen-permanent':
      await cmdGenPermanent(args.slice(1))
      break

    case 'gen-quota':
      await cmdGenQuota(args.slice(1))
      break

    case 'list':
      await cmdList()
      break

    case 'reset':
      await cmdReset(args.slice(1))
      break

    default:
      if (!command || command === '--help' || command === '-h') {
        showHelp()
      } else {
        console.error(`\n❌ 未知命令: ${command}\n`)
        console.log('   使用 "node generate-license.js --help" 查看帮助\n')
        process.exit(1)
      }
  }
}

main().catch(err => {
  console.error('\n💥 发生错误:', err.message)
  process.exit(1)
})
