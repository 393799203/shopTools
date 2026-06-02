const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { v4: uuidv4 } = require('uuid')
const sharp = require('sharp')

let mainWindow = null
let serverPort = 3001
let staticServer = null

// 远程 API 配置
const REMOTE_API_URL = process.env.REMOTE_API_URL || 'http://8.217.249.31:3001'

// 获取用户数据目录（打包后也能正常获取）
const userDataPath = app.isPackaged ? app.getPath('userData') : process.cwd()

// 日志文件
const logFile = path.join(userDataPath, 'picfilter.log')
const originalConsoleLog = console.log
const originalConsoleError = console.error
function logToFile(...args) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${msg}\n`
  fs.appendFileSync(logFile, line)
  originalConsoleLog(...args)
}

// 覆盖 console.log 在打包模式下写入文件
if (app.isPackaged) {
  console.log = logToFile
  console.error = (...args) => {
    logToFile(...args)
  }
}

let syncPromise = null

// ============================================
// 📦 通用工具函数
// ============================================

function getCompanyId(req) {
  return req.headers['x-company-id'] || 'default'
}

function getForwardHeaders(req) {
  const headers = { ...req.headers }
  delete headers.host
  delete headers.connection
  return headers
}

// ============================================
// 🔐 签名工具函数（后端版本）
// ============================================
function generateNonce() {
  return crypto.randomBytes(16).toString('hex')
}

async function sha256(message) {
  return crypto.createHash('sha256').update(message).digest('hex')
}

async function hmacSha256(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest('hex')
}

async function generateSignature(secret, method, path, body = null) {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = generateNonce()
  const bodyHash = body ? await sha256(JSON.stringify(body)) : ''

  const signMessage = `${timestamp}:${nonce}:${method}:${path}:${bodyHash}`
  const signature = await hmacSha256(secret, signMessage)

  return { timestamp, nonce, signature }
}

function applySignatureToHeaders(headers, timestamp, nonce, signature) {
  return {
    ...headers,
    'X-Timestamp': timestamp.toString(),
    'X-Nonce': nonce,
    'X-Signature': signature
  }
}

// ============================================
// 🔐 后端认证中间件（统一验证设备状态 + 缓存优化）
// ============================================
let authCache = null
let authCacheTime = 0
const AUTH_CACHE_TTL = 5 * 60 * 1000 // 5分钟缓存

async function verifyDeviceAuth() {
  try {
    // 检查缓存（5分钟内有效）
    if (authCache && (Date.now() - authCacheTime) < AUTH_CACHE_TTL) {
      console.log('[Auth] 使用缓存的认证结果')
      return authCache
    }
    
    const mac = getRealMac()
    if (!mac || mac === 'unknown') {
      return { authorized: false, error: '无法获取设备MAC地址', statusCode: 500 }
    }

    const deviceStatusUrl = new URL(`${REMOTE_API_URL}/api/device-status`)
    deviceStatusUrl.searchParams.set('mac', mac)
    
    const statusResponse = await fetch(deviceStatusUrl.toString())
    const statusData = await statusResponse.json()

    if (!statusData.success || !statusData.data) {
      return { authorized: false, error: '设备验证失败', statusCode: 401 }
    }

    if (!statusData.data.activated) {
      return { authorized: false, error: '设备未激活，请先激活设备', statusCode: 403 }
    }

    if (statusData.data.expired) {
      return { authorized: false, error: '订阅已过期，请重新激活', statusCode: 403 }
    }

    // 构建认证结果并缓存
    const result = { 
      authorized: true, 
      token: statusData.data.token,
      secret: statusData.data.secret
    }
    
    // 只缓存成功的认证结果（失败的不缓存）
    authCache = result
    authCacheTime = Date.now()
    
    console.log('[Auth] 认证成功，已缓存结果')
    return result
  } catch (error) {
    console.error('[Auth] 验证失败:', error.message)
    return { authorized: false, error: '验证服务不可用', statusCode: 503 }
  }
}

// 清除认证缓存（用于激活/续期后强制刷新）
function clearAuthCache() {
  authCache = null
  authCacheTime = 0
  console.log('[Auth] 认证缓存已清除')
}

async function requireAuth(req, res, next) {
  const authResult = await verifyDeviceAuth()
  
  if (!authResult.authorized) {
    return res.status(authResult.statusCode).json({ 
      success: false, 
      error: authResult.error 
    })
  }
  
  // 将凭证挂载到 req 上，供后续使用
  req.deviceAuth = authResult
  
  if (next) next()
}

async function proxyToRemote(req, res, options = {}) {
  const { 
    method = req.method, 
    path = req.originalUrl,
    onSuccess
  } = options

  try {
    const response = await fetch(`${REMOTE_API_URL}${path}`, {
      method,
      headers: getForwardHeaders(req),
      body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    })
    
    const data = await response.json()
    
    if (onSuccess) {
      await onSuccess(data, getCompanyId(req))
    }
    
    return res.status(response.status).json(data)
  } catch (error) {
    console.error(`Proxy error [${method} ${path}]:`, error.message)
    return res.status(500).json({ success: false, error: error.message })
  }
}

// 缩略图目录
const thumbnailDir = path.join(userDataPath, '.thumbnails')

// ============================================
// 🎯 核心优化 1: Aho-Corasick 多模式匹配算法
// ============================================
class AhoCorasick {
  constructor() {
    this.goto = new Map()
    this.fail = new Map()
    this.output = new Map()
    this.stateCount = 0
  }

  // 构建状态机
  build(patterns) {
    const newState = () => ++this.stateCount
    
    // 初始化根状态
    const rootState = 0
    this.goto.set(rootState, new Map())
    this.output.set(rootState, [])
    
    // 构建 trie 树和 goto 函数
    for (const pattern of patterns) {
      let state = rootState
      let patternLower = pattern.toLowerCase()
      
      for (const char of patternLower) {
        if (!this.goto.get(state)?.has(char)) {
          if (!this.goto.has(state)) {
            this.goto.set(state, new Map())
          }
          this.goto.get(state).set(char, newState())
          if (!this.output.has(this.goto.get(state).get(char))) {
            this.output.set(this.goto.get(state).get(char), [])
          }
        }
        state = this.goto.get(state).get(char)
      }
      
      this.output.get(state).push({
        word: pattern,
        length: pattern.length,
        endPos: patternLower.length
      })
    }

    // 构建 fail 函数（BFS）
    const queue = []
    const rootGoto = this.goto.get(rootState) || new Map()
    
    // 第一层节点的 fail 都指向根节点
    for (const [char, nextState] of rootGoto) {
      this.fail.set(nextState, rootState)
      queue.push(nextState)
    }

    // BFS 构建其余节点的 fail 函数
    while (queue.length > 0) {
      const currentState = queue.shift()
      const currentGoto = this.goto.get(currentState) || new Map()

      for (const [char, nextState] of currentGoto) {
        queue.push(nextState)

        let failState = this.fail.get(currentState)
        
        while (failState !== undefined && !(this.goto.get(failState) || new Map()).has(char)) {
          failState = this.fail.get(failState)
        }

        this.fail.set(
          nextState, 
          (this.goto.get(failState) || new Map()).get(char) ?? rootState
        )

        // 合并 output
        const failOutput = this.output.get(this.fail.get(nextState)) || []
        this.output.set(nextState, [
          ...this.output.get(nextState),
          ...failOutput
        ])
      }
    }
  }

  // 搜索文本，返回所有匹配
  search(text) {
    const textLower = text.toLowerCase()
    let state = 0
    const matches = []

    for (let i = 0; i < textLower.length; i++) {
      const char = textLower[i]

      while (
        state !== 0 && 
        !(this.goto.get(state) || new Map()).has(char)
      ) {
        state = this.fail.get(state) || 0
      }

      state = (this.goto.get(state) || new Map()).get(char) || 0

      const outputs = this.output.get(state) || []
      for (const output of outputs) {
        matches.push(output.word)
      }
    }

    return [...new Set(matches)] // 去重
  }
}

// 全局 AC 自动机实例（复用）
let acAutomaton = null
let lastWordsHash = null

// 缩略图生成队列（防止重复生成）
const thumbnailGenerationQueue = new Map()

// 异步批量生成缩略图
async function generateThumbnailsAsync(images) {
  if (!images || images.length === 0) return

  console.log(`\n🖼️  [异步] 开始后台生成缩略图 (${images.length} 张)...`)
  const startTime = Date.now()
  const CONCURRENCY_LIMIT = Math.min(os.cpus().length, 8)

  let cacheHits = 0
  let cacheMisses = 0
  let generatedCount = 0

  const generateThumbnail = async (img) => {
    try {
      const thumbnailHash = crypto.createHash('md5').update(img.path).digest('hex')
      const thumbnailPath = path.join(thumbnailDir, `${thumbnailHash}.jpg`)

      if (thumbnailGenerationQueue.has(thumbnailHash)) {
        return thumbnailGenerationQueue.get(thumbnailHash)
      }

      if (fs.existsSync(thumbnailPath)) {
        cacheHits++
        img.thumbnailUrl = `http://localhost:${serverPort}/thumbnails/${thumbnailHash}.jpg`
        return
      }

      cacheMisses++

      const generatePromise = (async () => {
        const imgBuffer = fs.readFileSync(img.path)
        await sharp(imgBuffer)
          .resize(300, 300, { fit: 'inside' })
          .jpeg({ quality: 80 })
          .toFile(thumbnailPath)
        img.thumbnailUrl = `http://localhost:${serverPort}/thumbnails/${thumbnailHash}.jpg`
        generatedCount++
      })()

      thumbnailGenerationQueue.set(thumbnailHash, generatePromise)

      await generatePromise

      setTimeout(() => {
        thumbnailGenerationQueue.delete(thumbnailHash)
      }, 5000)
    } catch (error) {
      img.thumbnailUrl = null
    }
  }

  for (let i = 0; i < images.length; i += CONCURRENCY_LIMIT) {
    const batch = images.slice(i, i + CONCURRENCY_LIMIT)
    await Promise.all(batch.map(generateThumbnail))
  }

  const totalTime = Date.now() - startTime
  console.log(`✅ [异步] 缩略图生成完成:`)
  console.log(`   总耗时: ${totalTime}ms`)
  console.log(`   平均速度: ${(images.length / (totalTime / 1000)).toFixed(0)} 张/秒`)
  console.log(`   🎯 缓存命中: ${cacheHits} 张`)
  console.log(`   🆕 新生成: ${cacheMisses} 张`)
}

// 按需生成单张缩略图
async function generateSingleThumbnail(imagePath) {
  try {
    const thumbnailHash = crypto.createHash('md5').update(imagePath).digest('hex')
    const thumbnailPath = path.join(thumbnailDir, `${thumbnailHash}.jpg`)

    if (fs.existsSync(thumbnailPath)) {
      return { success: true, url: `http://localhost:${serverPort}/thumbnails/${thumbnailHash}.jpg` }
    }

    if (thumbnailGenerationQueue.has(thumbnailHash)) {
      await thumbnailGenerationQueue.get(thumbnailHash)
      return { success: true, url: `http://localhost:${serverPort}/thumbnails/${thumbnailHash}.jpg` }
    }

    const generatePromise = (async () => {
      const imgBuffer = fs.readFileSync(imagePath)
      await sharp(imgBuffer)
        .resize(300, 300, { fit: 'inside' })
        .jpeg({ quality: 80 })
        .toFile(thumbnailPath)
    })()

    thumbnailGenerationQueue.set(thumbnailHash, generatePromise)
    await generatePromise

    setTimeout(() => {
      thumbnailGenerationQueue.delete(thumbnailHash)
    }, 5000)

    return { success: true, url: `http://localhost:${serverPort}/thumbnails/${thumbnailHash}.jpg` }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

const VIRTUAL_MAC_PREFIXES = ['ac:de:48:', '00:ff:', '02:42:']

function getRealMac() {
  const interfaces = os.networkInterfaces()
  for (const [name, nets] of Object.entries(interfaces)) {
    if (name.startsWith('veth') || name.startsWith('docker') || name.startsWith('br-') || name.startsWith('virbr')) continue
    for (const net of nets) {
      if (net.mac && net.mac !== '00:00:00:00:00:00' && !net.internal) {
        if (VIRTUAL_MAC_PREFIXES.some(p => net.mac.startsWith(p))) continue
        return net.mac
      }
    }
  }
  return 'unknown'
}

// 创建 API 服务器
function createApiServer() {
  const apiApp = express()
  apiApp.use(cors())
  apiApp.use(express.json({ limit: '50mb' }))

  // 确保缩略图目录存在
  if (!fs.existsSync(thumbnailDir)) {
    fs.mkdirSync(thumbnailDir, { recursive: true })
  }

  apiApp.get('/api/device-info', (req, res) => {
    const interfaces = os.networkInterfaces()
    const all = {}
    for (const [name, nets] of Object.entries(interfaces)) {
      all[name] = nets.map(n => ({ mac: n.mac, internal: n.internal, cidr: n.cidr }))
    }
    res.json({ success: true, data: { mac: getRealMac(), allInterfaces: all } })
  })

  // 设备状态查询 - 代理到远程服务器
  apiApp.get('/api/device-status', async (req, res) => {
    try {
      const mac = getRealMac()
      if (!mac || mac === 'unknown') {
        return res.status(500).json({ success: false, error: '无法获取设备MAC地址' })
      }
      const url = new URL(`${REMOTE_API_URL}/api/device-status`)
      url.searchParams.set('mac', mac)
      console.log(`[Device-Status] 查询设备状态, MAC: ${mac}`)
      const response = await fetch(url.toString())
      const data = await response.json()
      res.status(response.status).json(data)
    } catch (error) {
      console.error('Device status proxy error:', error)
      res.status(500).json({ success: false, error: '无法连接服务器' })
    }
  })

  // 激活接口 - 代理到远程服务器（后端自动获取当前凭证）
  apiApp.post('/api/activate', async (req, res) => {
    try {
      const realMac = getRealMac()
      console.log('[Activate] 前端请求体:', JSON.stringify(req.body))
      console.log('[Activate] 本地真实MAC:', realMac)
      
      // 自动从 device-status 获取当前凭证（如果已激活）
      let currentToken = null
      let currentExpiresAt = null
      
      try {
        const deviceStatusUrl = new URL(`${REMOTE_API_URL}/api/device-status`)
        deviceStatusUrl.searchParams.set('mac', realMac)
        
        const statusResponse = await fetch(deviceStatusUrl.toString())
        const statusData = await statusResponse.json()
        
        if (statusData.success && statusData.data?.activated && !statusData.data?.expired) {
          currentToken = statusData.data.token
          currentExpiresAt = statusData.data.expiresAt
          console.log('[Activate] 自动获取当前凭证:', { currentToken: currentToken?.substring(0, 10) + '...', currentExpiresAt })
        }
      } catch (error) {
        console.log('[Activate] 获取当前凭证失败，继续无凭证激活:', error.message)
      }
      
      const requestBody = { 
        ...req.body, 
        deviceMac: realMac,
        currentToken,
        currentExpiresAt
      }
      
      console.log('[Activate] 发送给远程的数据:', JSON.stringify({
        ...requestBody,
        currentToken: requestBody.currentToken?.substring(0, 10) + '...'
      }))
      
      const response = await fetch(`${REMOTE_API_URL}/api/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })
      const data = await response.json()
      console.log('[Activate] 远程服务器返回:', JSON.stringify(data))
      
      // 激活成功后清除认证缓存，强制下次请求重新验证
      if (data.success) {
        clearAuthCache()
      }
      
      res.status(response.status).json(data)
    } catch (error) {
      console.error('Activate proxy error:', error)
      res.status(500).json({ success: false, error: '激活服务不可用' })
    }
  })

  // ============================================
  // 🔐 需要认证的 API 接口（使用 authMiddleware 统一验证）
  // ============================================
  
  // 敏感词相关接口（需要签名请求远程服务器）
  apiApp.get('/api/words', requireAuth, async (req, res) => {
    try {
      const { token, secret } = req.deviceAuth
      const wordsPath = '/api/words'
      const { timestamp, nonce, signature } = await generateSignature(secret, 'GET', wordsPath)
      
      const headers = applySignatureToHeaders({
        'Content-Type': 'application/json',
        'X-Token': token,
        'X-Company-ID': getCompanyId(req)
      }, timestamp, nonce, signature)

      console.log(`[Words] GET 使用后端凭证获取敏感词列表`)
      const response = await fetch(`${REMOTE_API_URL}${wordsPath}`, {
        method: 'GET',
        headers
      })
      
      const data = await response.json()
      return res.status(response.status).json(data)
    } catch (error) {
      console.error('[Words] GET 失败:', error.message)
      return res.status(500).json({ success: false, error: error.message })
    }
  })

  apiApp.post('/api/words', requireAuth, async (req, res) => {
    try {
      const { token, secret } = req.deviceAuth
      const wordsPath = '/api/words'
      const { timestamp, nonce, signature } = await generateSignature(secret, 'POST', wordsPath, req.body)
      
      const headers = applySignatureToHeaders({
        'Content-Type': 'application/json',
        'X-Token': token,
        'X-Company-ID': getCompanyId(req)
      }, timestamp, nonce, signature)

      console.log('[Words] POST 使用后端凭证添加敏感词')
      const response = await fetch(`${REMOTE_API_URL}${wordsPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body)
      })
      
      const data = await response.json()
      return res.status(response.status).json(data)
    } catch (error) {
      console.error('[Words] POST 失败:', error.message)
      return res.status(500).json({ success: false, error: error.message })
    }
  })

  apiApp.delete('/api/words/:id', requireAuth, async (req, res) => {
    try {
      const { token, secret } = req.deviceAuth
      const wordsPath = `/api/words/${req.params.id}`
      const { timestamp, nonce, signature } = await generateSignature(secret, 'DELETE', wordsPath)
      
      const headers = applySignatureToHeaders({
        'Content-Type': 'application/json',
        'X-Token': token,
        'X-Company-ID': getCompanyId(req)
      }, timestamp, nonce, signature)

      console.log(`[Words] DELETE 使用后端凭证删除敏感词 ID: ${req.params.id}`)
      const response = await fetch(`${REMOTE_API_URL}${wordsPath}`, {
        method: 'DELETE',
        headers
      })
      
      const data = await response.json()
      return res.status(response.status).json(data)
    } catch (error) {
      console.error('[Words] DELETE 失败:', error.message)
      return res.status(500).json({ success: false, error: error.message })
    }
  })

  // ============================================
  // 🚀 核心优化 2: 高性能扫描引擎（流式版本）
  // ============================================
  apiApp.post('/api/scan', requireAuth, async (req, res) => {
    const startTime = Date.now()

    try {
      const { folderPath, batchSize = 50 } = req.body

      if (!folderPath || !fs.existsSync(folderPath)) {
        return res.status(400).json({ success: false, error: '文件夹路径无效' })
      }

      // 从中间件获取已验证的凭证
      const { token, secret } = req.deviceAuth
      
      // 用后端的凭证生成签名请求敏感词
      let words = []
      try {
        const wordsPath = '/api/words'
        const { timestamp, nonce, signature } = await generateSignature(secret, 'GET', wordsPath)
        
        const headers = applySignatureToHeaders({
          'Content-Type': 'application/json',
          'X-Token': token
        }, timestamp, nonce, signature)

        console.log(`[Scan] 使用后端凭证获取敏感词列表`)
        const wordsResponse = await fetch(`${REMOTE_API_URL}/api/words`, {
          method: 'GET',
          headers
        })
        
        if (!wordsResponse.ok) {
          console.error(`[Scan] 获取敏感词失败: ${wordsResponse.status}`)
          return res.status(wordsResponse.status).json({
            success: false,
            error: `获取敏感词失败 (${wordsResponse.status})`,
            data: [],
            stats: { totalFiles: 0, matchedFiles: 0, totalTime: Date.now() - startTime, algorithm: 'none' }
          })
        }
        
        const wordsData = await wordsResponse.json()
        if (wordsData.success && wordsData.data) {
          words = wordsData.data.map(item => item.word)
          console.log(`[Scan] 成功获取 ${words.length} 个敏感词`)
        }
      } catch (error) {
        console.error('获取敏感词失败:', error.message)
      }

      if (words.length === 0) {
        console.error('⚠️ [Scan] 无法获取敏感词列表，请检查订阅状态')
        return res.status(403).json({
          success: false,
          error: '无法获取敏感词列表，请检查订阅是否过期',
          data: [],
          stats: {
            totalFiles: 0,
            matchedFiles: 0,
            totalTime: Date.now() - startTime,
            algorithm: 'none'
          }
        })
      }

      console.log(`\n🎯 流式扫描模式启动`)
      console.log(`📊 敏感词数量: ${words.length}`)
      console.log(`📂 扫描目录: ${folderPath}`)

      // 🎯 优化点 1: 复用 AC 自动机（避免重复构建）
      const currentWordsHash = words.join('|')
      if (!acAutomaton || lastWordsHash !== currentWordsHash) {
        console.log(`🔧 构建 Aho-Corasick 自动机...`)
        const buildStart = Date.now()

        acAutomaton = new AhoCorasick()
        acAutomaton.build(words)
        lastWordsHash = currentWordsHash

        console.log(`✅ 自动机构建完成 (${Date.now() - buildStart}ms)`)
        console.log(`   状态数: ${acAutomaton.stateCount}`)
      } else {
        console.log(`♻️  复用已有自动机`)
      }

      // 设置流式响应头
      console.log('🚀 [后端] 设置流式响应头...')
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      // 发送开始标记
      console.log('📤 [后端] 发送 start 事件...')
      res.write(JSON.stringify({ type: 'start', stats: { wordsCount: words.length, startTime } }) + '\n')

      const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])
      let totalFilesScanned = 0
      let matchedCount = 0
      let batchImages = []

      const flushBatch = () => {
        if (batchImages.length > 0) {
          console.log(`📦 [后端] 发送数据批次: ${batchImages.length} 张图片 (累计: ${matchedCount + batchImages.length} 张)`)
          res.write(JSON.stringify({
            type: 'data',
            data: batchImages,
            count: batchImages.length
          }) + '\n')
          matchedCount += batchImages.length
          batchImages = []
        }
      }

      // 同步递归遍历
      function scanDirectorySync(dirPath) {
        let entries
        try {
          entries = fs.readdirSync(dirPath, { withFileTypes: true })
        } catch (error) {
          return
        }

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name)

          try {
            if (entry.isDirectory()) {
              if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                scanDirectorySync(fullPath)
              }
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase()

              if (imageExtensions.has(ext)) {
                totalFilesScanned++

                const fileNameNoExt = path.parse(entry.name).name
                const matchedWords = acAutomaton.search(fileNameNoExt)

                if (matchedWords.length > 0) {
                  batchImages.push({
                    id: uuidv4(),
                    path: fullPath,
                    name: entry.name,
                    matchedWords
                  })

                  // 达到批次大小就发送
                  if (batchImages.length >= batchSize) {
                    flushBatch()
                  }
                }
              }
            }
          } catch (error) {
            // 忽略单个文件错误
          }
        }
      }

      console.log(`\n📂 开始流式扫描...`)

      scanDirectorySync(folderPath)

      // 发送最后一批数据
      flushBatch()

      const scanTime = Date.now() - startTime

      console.log(`\n✅ 流式扫描完成:`)
      console.log(`   总文件数: ${totalFilesScanned}`)
      console.log(`   匹配文件: ${matchedCount}`)
      console.log(`   扫描耗时: ${scanTime}ms`)
      console.log(`   平均速度: ${(totalFilesScanned / (scanTime / 1000)).toFixed(0)} 文件/秒\n`)

      // 发送完成标记和统计信息
      res.write(JSON.stringify({
        type: 'end',
        stats: {
          totalFiles: totalFilesScanned,
          matchedFiles: matchedCount,
          totalTime: scanTime,
          scanTime,
          thumbnailTime: 0,
          algorithm: 'aho-corasick',
          wordsCount: words.length,
          asyncThumbnails: true
        }
      }) + '\n')

      res.end()

      // 后台异步生成缩略图（收集所有图片）
      const allMatchedImages = []
      // 注意：这里需要从已发送的数据中重建，或者改为在发送时同时保存
      // 为了简单起见，我们在这里不生成，让前端按需请求即可

    } catch (error) {
      console.error('Error scanning folder:', error)

      // 如果还没发送任何数据，返回错误 JSON
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message })
      } else {
        // 如果已经开始流式传输，发送错误事件
        try {
          res.write(JSON.stringify({ type: 'error', error: error.message }) + '\n')
          res.end()
        } catch (e) {
          // 忽略写入错误
        }
      }
    }
  })

  // ============================================
  // 📁 本地文件操作接口（需要认证，无需签名）
  // ============================================
  
  // 删除图片
  apiApp.delete('/api/images', requireAuth, async (req, res) => {
    try {
      const { paths } = req.body
      
      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ success: false, error: '请选择要删除的图片' })
      }
      
      let deletedCount = 0
      let failedCount = 0
      const failedPaths = []
      
      for (const filePath of paths) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath)
            deletedCount++
          }
        } catch (error) {
          failedCount++
          failedPaths.push(filePath)
        }
      }
      
      res.json({
        success: true,
        data: { deletedCount, failedCount, failedPaths }
      })
    } catch (error) {
      console.error('Error deleting images:', error)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  // 大图预览 API
  apiApp.get('/api/images/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params
      const imagePath = req.query.path || req.body?.path
      
      if (!imagePath || !fs.existsSync(imagePath)) {
        return res.status(404).json({ success: false, error: '图片不存在' })
      }
      
      const ext = path.extname(imagePath).toLowerCase()
      const contentTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp'
      }
      
      const contentType = contentTypes[ext] || 'application/octet-stream'
      
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'public, max-age=3600')
      
      const fileStream = fs.createReadStream(imagePath)
      fileStream.pipe(res)
      
      fileStream.on('error', (error) => {
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: '读取图片失败' })
        }
      })
    } catch (error) {
      res.status(500).json({ success: false, error: error.message })
    }
  })

  // 缩略图生成 API
  apiApp.get('/api/thumbnail', requireAuth, async (req, res) => {
    try {
      const { path: imagePath } = req.query

      if (!imagePath || !fs.existsSync(imagePath)) {
        return res.status(404).json({ success: false, error: '图片不存在' })
      }

      const result = await generateSingleThumbnail(imagePath)

      if (result.success) {
        res.json({ success: true, data: { thumbnailUrl: result.url } })
      } else {
        res.status(500).json({ success: false, error: result.error })
      }
    } catch (error) {
      console.error('Error generating thumbnail:', error)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  // 静态文件服务 - 缩略图
  apiApp.use('/thumbnails', express.static(thumbnailDir))

  return apiApp
}

// 启动后端服务
async function startBackend() {
  const apiApp = createApiServer()
  
  return new Promise((resolve) => {
    const server = apiApp.listen(serverPort, () => {
      console.log(`\n🚀 API Server running on http://localhost:${serverPort}`)
      console.log(`☁️  Remote API: ${REMOTE_API_URL}`)
      console.log(`🖼️  Thumbnails: ${thumbnailDir}`)
      console.log(`⚡ Performance Mode: ENABLED (Aho-Corasick Algorithm)\n`)
      resolve(serverPort)
    })
  })
}

// 创建窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'ShopTools - 电商图片工具'
  })

  if (app.isPackaged) {
    const distPath = path.join(__dirname, '../dist')
    
    const staticApp = express()
    staticApp.use(express.static(distPath))
    
    // SPA 路由回退：所有未匹配的路由都返回 index.html
    staticApp.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
    
    staticServer = staticApp.listen(5173, () => {
      console.log('Static file server started on port 5173')
      mainWindow.loadURL('http://localhost:5173')
    })
  } else {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// 应用就绪
app.whenReady().then(async () => {
  try {
    await startBackend()
    createWindow()
  } catch (error) {
    console.error('Failed to start:', error)
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  ipcMain.handle('get-server-port', () => {
    return serverPort
  })

  ipcMain.handle('open-folder-dialog', async () => {
    if (!mainWindow) return { canceled: true, filePaths: [] }
    
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '选择要扫描的图片文件夹'
    })
    
    return result
  })

  ipcMain.handle('get-device-mac', () => {
    return getRealMac()
  })
})

// 清理缩略图缓存
function cleanThumbnails() {
  try {
    if (fs.existsSync(thumbnailDir)) {
      const files = fs.readdirSync(thumbnailDir)
      for (const file of files) {
        fs.unlinkSync(path.join(thumbnailDir, file))
      }
      console.log(`🧹 已清理缩略图缓存: ${thumbnailDir} (${files.length} 个文件)`)
    }
  } catch (error) {
    console.error('清理缩略图失败:', error)
  }
}

app.on('window-all-closed', () => {
  cleanThumbnails()
  if (staticServer) {
    staticServer.close()
  }
  if (process.platform !== 'darwin') {
    app.quit()
    process.exit(0)
  }
})

app.on('before-quit', () => {
  cleanThumbnails()
})
