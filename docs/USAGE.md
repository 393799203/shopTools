# ImgGuard 快速使用指南

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

# 查看所有激活码状态
node server-api/generate-license.js list

# 重置激活码（让用户可重新激活）
node server-api/generate-license.js reset ImgGuard-XXXX-XXXX-XXXX-XXXX
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
| **打包Mac** | `npm run build:mac` |
| **打包Win** | `npm run build:win` |
| **查看日志** | `ssh root@8.217.249.31 "docker logs -f picfilter-api"` |

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

**后端异常？**
```bash
ssh root@8.217.249.31 "docker logs -f picfilter-api"
```

---

**最后更新：** 2026-05-31