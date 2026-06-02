#!/usr/bin/env node

const API_BASE = process.env.API_BASE || 'http://8.217.249.31:3001'
const ADMIN_SECRET = 'ShopToolsAdmin2024Secure!'

async function updateDeviceExpiry(deviceMac, expiresAt) {
  const response = await fetch(`${API_BASE}/api/admin/update-device-expiry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': ADMIN_SECRET
    },
    body: JSON.stringify({ deviceMac, expiresAt })
  })

  const data = await response.json()

  if (!data.success) {
    console.error(`❌ 失败: ${data.error}`)
    process.exit(1)
  }

  console.log(`✅ 成功!`)
  console.log(`   MAC 地址: ${data.data.mac}`)
  console.log(`   过期时间: ${data.data.expiresAtISO}`)
}

async function deleteDevice(deviceMac) {
  const response = await fetch(`${API_BASE}/api/admin/device/${deviceMac}`, {
    method: 'DELETE',
    headers: {
      'x-admin-secret': ADMIN_SECRET
    }
  })

  if (!response.ok) {
    const errorText = await response.text()
    
    if (response.status === 404) {
      console.error(`❌ 设备不存在: ${deviceMac}`)
      process.exit(1)
    }
    
    console.error(`❌ 删除失败 (${response.status}): ${errorText}`)
    process.exit(1)
  }

  const data = await response.json()

  if (!data.success) {
    console.error(`❌ 失败: ${data.error}`)
    process.exit(1)
  }

  console.log(`✅ 设备已删除!`)
  console.log(`   MAC 地址: ${data.data.mac}`)
  console.log(`   提示: ${data.data.message}`)
}

async function listDevices() {
  const response = await fetch(`${API_BASE}/api/admin/devices`, {
    headers: { 'x-admin-secret': ADMIN_SECRET }
  })

  if (!response.ok) {
    // 如果没有列表接口，提示用户
    console.log('ℹ️  设备列表接口暂不可用')
    return
  }

  const data = await response.json()
  
  if (data.success && Array.isArray(data.data)) {
    console.log('\n📋 已注册设备:')
    console.log('─'.repeat(60))
    
    for (const device of data.data) {
      const expiryDate = new Date(device.expires_at * 1000)
      const isExpired = device.expires_at < Date.now() / 1000
      const status = isExpired ? '⛔ 已过期' : '✅ 有效'
      
      console.log(`\n🖥️  MAC: ${device.mac}`)
      console.log(`   状态: ${status}`)
      console.log(`   过期时间: ${expiryDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)
      console.log(`   创建时间: ${new Date(device.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)
    }
  } else {
    console.log(data)
  }
}

function showHelp() {
  console.log(`
🔧 ShopTools 设备管理工具

用法:
  node manage-device.js <命令> [参数]

命令:
  update <MAC> <过期时间>     更新设备过期时间
  delete <MAC>               删除设备（可重新激活）
  list                       列出所有设备
  help                       显示帮助信息

参数:
  <MAC>                      设备 MAC 地址 (如: 8c:85:90:b9:7b:bf)
  <过期时间>                 ISO 格式日期 (如: 2026-06-02T09:50:00+08:00)

示例:
  # 删除设备（重新测试激活流程）
  node manage-device.js delete 8c:85:90:b9:7b:bf

  # 更新设备过期时间到今天 09:50
  node manage-device.js update 8c:85:90:b9:7b:bf "2026-06-02T09:50:00+08:00"

  # 更新设备过期时间到 7 天后
  node manage-device.js update 8c:85:90:b9:7b:bf "$(date -v+7d '+%Y-%m-%dT%H:%M:%S+08:00')"

  # 设置为已过期（昨天）
  node manage-device.js update 8c:85:90:b9:7b:bf "$(date -v-1d '+%Y-%m-%dT%H:%M:%S+08:00')"

环境变量:
  API_BASE       API 服务地址 (默认: http://8.217.249.31:3001)
`)
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  switch (command) {
    case 'update':
      if (args.length < 3) {
        console.error('❌ 缺少参数: node manage-device.js update <MAC> <过期时间>')
        process.exit(1)
      }
      await updateDeviceExpiry(args[1], args[2])
      break

    case 'delete':
    case 'del':
    case 'remove':
      if (args.length < 2) {
        console.error('❌ 缺少参数: node manage-device.js delete <MAC>')
        process.exit(1)
      }
      await deleteDevice(args[1])
      break

    case 'list':
      await listDevices()
      break

    case 'help':
    case '--help':
    case '-h':
      showHelp()
      break

    default:
      if (!command) {
        showHelp()
      } else {
        console.error(`❌ 未知命令: ${command}`)
        console.log('运行 "node manage-device.js help" 查看帮助')
        process.exit(1)
      }
  }
}

main().catch(error => {
  console.error('❌ 错误:', error.message)
  process.exit(1)
})