# ShopTools 快速使用指南

## 🚀 三条命令搞定一切

### 1️⃣ 部署后端

```bash
# 方式1：使用部署脚本（推荐 ✅）
./scripts/deploy-server.sh

# 方式2：手动两步
# 步骤1: 上传代码
rsync -avz --exclude 'node_modules' ./server-api/ root@8.217.249.31:/opt/picfilter/server-api/
# 步骤2: 重启服务
ssh root@8.217.249.31 "cd /opt/picfilter && docker compose down && docker compose up -d --build"
```

### 2️⃣ 生成激活码

```bash
# 生成5个1天有效期的激活码
node server-api/generate-license.js gen 5 1

# 生成3个30天的
node server-api/generate-license.js gen 3 30

# 生成永久激活码
node server-api/generate-license.js gen-permanent 2

# 生成1个配额10000的激活码
node server-api/generate-license.js gen-quota 1 10000

# 查看所有激活码状态
node server-api/generate-license.js list

# 重置激活码（让用户可重新激活）
node server-api/generate-license.js reset ShopTools-XXXX-XXXX-XXXX-XXXX
```

### 3️⃣ 打包客户端

```bash
# Mac 版本（默认公司 default）
npm run build:mac

# Windows 版本
npm run build:win

# 指定公司ID打包
VITE_COMPANY_ID=company_a npm run build:mac
VITE_COMPANY_ID=company_b npm run build:win
```

**输出位置：** `release/` 目录

---

## 📋 常用操作速查

| 操作 | 命令 |
|------|------|
| **本地开发** | `npm run electron:dev` |
| **部署后端** | `./scripts/deploy-server.sh` |
| **生成5个1天key** | `node server-api/generate-license.js gen 5 1` |
| **生成永久key** | `node server-api/generate-license.js gen-permanent 2` |
| **查看所有key** | `node server-api/generate-license.js list` |
| **重置key** | `node server-api/generate-license.js reset <KEY>` |
| **更新设备过期时间** | `node server-api/manage-device.js update <MAC> <时间>` |
| **删除设备（重新测试）** | `node server-api/manage-device.js delete <MAC>` |
| **打包Mac** | `npm run build:mac` |
| **打包Win** | `npm run build:win` |
| **查看日志** | `ssh root@8.217.249.31 "docker logs -f picfilter-api"` |

---

## 🔧 设备管理（Admin）

### 删除设备（重新测试）

完全删除设备记录，使设备可以像新设备一样重新激活。

> ⚠️ **不可逆操作！** 会清除设备信息、激活历史、额度记录等所有数据。

```bash
# 基本用法
node server-api/manage-device.js delete <MAC地址>

# 示例：删除指定设备
node server-api/manage-device.js delete 8c:85:90:b9:7b:bf

# 也支持别名
node server-api/manage-device.js del 8c:85:90:b9:7b:bf
node server-api/manage-device.js remove 8c:85:90:b9:7b:bf
```

**使用场景：**
- 需要完整重新测试激活流程
- 设备数据异常需要重置
- 用户要求彻底注销

**删除后操作：**
1. 重启 Electron 应用（或 Cmd+R）
2. 应用会显示"未激活"状态
3. 输入新的 License Key 重新激活

### 更新设备过期时间

用于测试过期场景或手动调整用户订阅时间。

```bash
# 基本用法
node server-api/manage-device.js update <MAC地址> <ISO格式时间>

# 示例：设置过期时间为今天 09:50
node server-api/manage-device.js update 8c:85:90:b9:7b:bf "2026-06-02T09:50:00+08:00"

# 设置为已过期（昨天）
node server-api/manage-device.js update 8c:85:90:b9:7b:bf "$(date -v-1d '+%Y-%m-%dT%H:%M:%S+08:00')"

# 延长 7 天
node server-api/manage-device.js update 8c:85:90:b9:7b:bf "$(date -v+7d '+%Y-%m-%dT%H:%M:%S+08:00')"

# 延长 30 天
node server-api/manage-device.js update 8c:85:90:b9:7b:bf "$(date -v+30d '+%Y-%m-%dT%H:%M:%S+08:00')"
```

### 查看帮助

```bash
node server-api/manage-device.js help
```

### API 接口（供程序调用）

```bash
curl -X POST http://8.217.249.31:3001/api/admin/update-device-expiry \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: ShopToolsAdmin2024Secure!" \
  -d '{"deviceMac": "8c:85:90:b9:7b:bf", "expiresAt": "2026-06-02T09:50:00+08:00"}'
```

---

## 🔧 多公司配置

修改 `.env` 文件：

```env
VITE_COMPANY_ID=your_company_name
```

然后打包即可，不同公司的数据完全隔离。

---

## ⚠️ 注意事项

1. **激活码一次性使用**：每个Key只能激活一次设备
2. **MAC地址绑定**：激活后绑定到当前设备的MAC地址，不可转移
3. **延期累加**：延期是在原到期时间基础上加天数，不是重置
4. **换设备处理**：需要管理员先 `reset` Key，用户才能在新设备重新激活

---

## 📞 问题排查

**激活失败？**
```bash
# 1. 检查Key状态
node server-api/generate-license.js list

# 2. 如果已使用，重置它
node server-api/generate-license.js reset <KEY>

# 3. 用户重新激活
```

**需要重新测试激活流程？**
```bash
# 删除旧设备数据（不可逆！）
node server-api/manage-device.js delete <MAC地址>

# 然后重启应用，重新激活
```

**删除设备失败？**
```bash
# 1. 检查服务器是否部署了最新代码
# 2. 查看 MAC 地址是否正确
ifconfig en0 | grep ether | awk '{print $2}'  # macOS

# 3. 验证设备是否存在
curl "http://8.217.249.31:3001/api/device-status?mac=<MAC>"

# 4. 如果还是失败，查看服务器日志
ssh root@8.217.249.31 "docker logs -f picfilter-api"
```

**后端异常？**
```bash
ssh root@8.217.249.31 "docker logs -f picfilter-api"
```

---

**最后更新：** 2026-06-02
