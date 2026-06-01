import { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from 'react'
import { message, Statistic, Row, Col, Card as AntCard, Tag, Button } from 'antd'
import {
  ClockCircleOutlined,
  FileImageOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  ArrowUpOutlined
} from '@ant-design/icons'
import SensitiveSidebar from '../components/SensitiveSidebar'
import ImageGrid from '../components/ImageGrid'
import Toolbar from '../components/Toolbar'
import { api } from '../services/api'
import { MatchedImage } from '../types'

interface ScanStats {
  totalFiles: number
  matchedFiles: number
  totalTime: number
  scanTime: number
  thumbnailTime: number
  algorithm: string
  wordsCount: number
}

function SensitiveWordPage() {
  const [images, setImages] = useState<MatchedImage[]>([])

  // 使用 ref 追踪最新的 images，避免闭包陷阱
  const imagesRef = useRef<MatchedImage[]>([])

  // 选中状态独立管理（Set 查找 O(1)，不污染 images 数组）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectedIdsRef = useRef<Set<string>>(new Set())

  // 同步 ref
  useEffect(() => {
    selectedIdsRef.current = selectedIds
  }, [selectedIds])

  const deferredSelectedIds = useDeferredValue(selectedIds)

  const [loading, setLoading] = useState(false)
  const [currentFolder, setCurrentFolder] = useState<string | null>(null)
  const [stats, setStats] = useState<ScanStats | undefined>()

  // 分批渲染控制：初始只显示前 50 个，避免一次性渲染 990 个组件
  const [visibleCount, setVisibleCount] = useState(50)
  const BATCH_SIZE = 50 // 每批增加的数量
  const gridRef = useRef<HTMLDivElement>(null)

  // 返回顶部按钮控制
  const [showBackToTop, setShowBackToTop] = useState(false)
  const SCROLL_THRESHOLD = 300 // 滚动超过这个距离显示按钮

  // 监听滚动，动态加载更多 + 控制返回顶部按钮（使用 ref 避免反复 bind/unbind）
  const visibleCountRef = useRef(visibleCount)
  visibleCountRef.current = visibleCount

  useEffect(() => {
    const gridElement = gridRef.current
    if (!gridElement) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = gridElement

      if (scrollHeight - scrollTop - clientHeight < 500 && visibleCountRef.current < imagesRef.current.length) {
        setVisibleCount(prev => Math.min(prev + BATCH_SIZE, imagesRef.current.length))
      }

      setShowBackToTop(scrollTop > SCROLL_THRESHOLD)
    }

    gridElement.addEventListener('scroll', handleScroll)
    return () => gridElement.removeEventListener('scroll', handleScroll)
  }, [])

  // 返回顶部函数
  const scrollToTop = () => {
    if (gridRef.current) {
      gridRef.current.scrollTo({
        top: 0,
        behavior: 'smooth' // 平滑滚动
      })
    }
  }

  const [words, setWords] = useState<{ id: string; word: string }[]>([])
  const [wordsLoading, setWordsLoading] = useState(true)

  useEffect(() => {
    loadWords()
  }, [])

  const loadWords = async () => {
    setWordsLoading(true)
    try {
      const result = await api.getWords()
      if (result.success) {
        setWords(result.data)
      }
    } catch (error) {
      message.error('加载敏感词失败')
    } finally {
      setWordsLoading(false)
    }
  }

  const handleAddWord = useCallback(async (word: string) => {
    try {
      const result = await api.addWord(word)
      if (result.success) {
        setWords(prev => [result.data, ...prev])
        message.success(`敏感词 "${word}" 添加成功`)
        return true
      } else {
        message.error(result.error || '添加失败')
        return false
      }
    } catch (error) {
      message.error('添加失败')
      return false
    }
  }, [])

  const handleDeleteWord = useCallback(async (id: string) => {
    try {
      const result = await api.deleteWord(id)
      if (result.success) {
        setWords(prev => prev.filter(w => w.id !== id))
        message.success('删除成功')
      }
    } catch (error) {
      message.error('删除失败')
    }
  }, [])

  const handleRefreshWords = useCallback(async () => {
    setWordsLoading(true)
    try {
      const result = await api.getWords()
      if (result.success) {
        setWords(result.data)
        message.success(`已刷新，共 ${result.data.length} 个敏感词`)
      }
    } catch (error) {
      message.error('刷新失败')
    } finally {
      setWordsLoading(false)
    }
  }, [])

  const handleScanFolder = async (folderPath: string) => {
    const scanStartTime = performance.now()
    console.log('🎯 [页面] 开始扫描文件夹:', folderPath)
    imagesRef.current = []
    setVisibleCount(50)
    setSelectedIds(new Set())
    setLoading(true)
    setImages([])
    setStats(undefined)

    try {
      const apiCallStart = performance.now()
      console.log('📡 [页面] 调用流式 API...')
      const result = await api.scanFolder(folderPath, (event) => {
        const eventTime = performance.now()
        console.log(`📥 [页面] 收到事件: ${event.type} (耗时: ${(eventTime - scanStartTime).toFixed(0)}ms)`)

        if (event.type === 'start') {
          console.log('✅ [页面] 扫描已开始')
        } else if (event.type === 'data' && Array.isArray(event.data)) {
          // 实时添加新数据 - 使用 ref 追踪最新状态
          const newImages = event.data
          const beforeUpdate = performance.now()
          imagesRef.current = [...imagesRef.current, ...newImages]

          console.log(`🖼️ [页面] 新增 ${newImages.length} 张图片，总计: ${imagesRef.current.length} 张`)

          // 只在必要时更新 state（减少渲染次数）
          if (imagesRef.current.length <= 100 || imagesRef.current.length % 100 === 0) {
            const renderStart = performance.now()
            setImages(imagesRef.current)
            setSelectedIds(new Set(imagesRef.current.map(img => img.id)))
            setLoading(false)
            // 使用 requestAnimationFrame 测量实际渲染时间
            requestAnimationFrame(() => {
              const renderEnd = performance.now()
              console.log(`⚡ [渲染] 更新 ${imagesRef.current.length} 个组件耗时: ${(renderEnd - renderStart).toFixed(0)}ms`)
            })
          }
        } else if (event.type === 'end') {
          // 扫描完成 - 强制更新最终状态
          console.log('🏁 [页面] 扫描完成，统计:', event.stats)
          const finalRenderStart = performance.now()
          setImages(imagesRef.current)
          setSelectedIds(new Set(imagesRef.current.map(img => img.id)))
          setLoading(false)
          setCurrentFolder(folderPath)
          setStats(event.stats)
          requestAnimationFrame(() => {
            const finalRenderEnd = performance.now()
            const totalTime = (finalRenderEnd - scanStartTime).toFixed(0)
            console.log(`🎉 [总耗时] 完整流程耗时: ${totalTime}ms`)
            console.log(`⚡ [最终渲染] 渲染 ${imagesRef.current.length} 个组件耗时: ${(finalRenderEnd - finalRenderStart).toFixed(0)}ms`)
          })
        }
      })

      // 最终结果（兼容非流式情况）
      if (result.success && Array.isArray(result.data) && result.data.length > 0 && imagesRef.current.length === 0) {
        console.log('📊 [页面] 使用最终结果:', result.data.length, '张')
        imagesRef.current = result.data
        setImages(result.data)
        setSelectedIds(new Set(result.data.map(img => img.id)))
        setLoading(false)
        setCurrentFolder(folderPath)
        setStats(result.stats)
        message.success(`找到 ${result.data.length} 张匹配的图片`)
      }

      const totalImages = imagesRef.current.length
      if (totalImages === 0 && !loading) {
        message.info('未找到匹配的图片')
      }

    } catch (error) {
      console.error('❌ [页面] 扫描失败:', error)
      message.error('扫描失败')
      setLoading(false)
    }
  }

  const handleRescan = async () => {
    if (!currentFolder) {
      message.warning('请先选择文件夹')
      return
    }

    await handleScanFolder(currentFolder)
  }

  const handleToggleSelect = useCallback((imageId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(imageId)) {
        next.delete(imageId)
      } else {
        next.add(imageId)
      }
      return next
    })
  }, [])

  // 全选/取消全选：选中所有图片（包括未显示的）
  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      setSelectedIds(new Set(images.map(img => img.id)))
      message.success(`已选中全部 ${images.length} 张图片`)
    } else {
      setSelectedIds(new Set())
    }
  }

  // 删除所有选中的图片（全量删除）
  const handleDeleteSelected = async () => {
    const allSelectedImages = images.filter(img => selectedIds.has(img.id))

    if (allSelectedImages.length === 0) {
      message.warning('请先选择要删除的图片')
      return
    }

    const totalCount = allSelectedImages.length
    const visibleSelectedImages = images.slice(0, visibleCount).filter(img => selectedIds.has(img.id))
    const visibleSelectedCount = visibleSelectedImages.length

    if (visibleCount < images.length && visibleSelectedCount > 0 && visibleSelectedCount < totalCount) {
      const { Modal, Button: MButton } = await import('antd')
      Modal.confirm({
        title: '⚠️ 批量删除确认',
        width: 480,
        icon: null,
        content: (
          <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 12, color: '#333', fontSize: '14px', lineHeight: '1.6' }}>
              确定要删除 {totalCount} 张图片吗？
            </div>
            <div style={{ color: '#666', fontSize: '13px', lineHeight: '1.8' }}>
              📊 操作详情：<br />
              &nbsp;&nbsp;• 总共选中：<strong style={{ color: '#cf1322' }}>{totalCount}</strong> 张<br />
              &nbsp;&nbsp;• 当前显示区域：<strong>{visibleSelectedCount}</strong> 张<br />
              &nbsp;&nbsp;• 未显示区域：<strong>{totalCount - visibleSelectedCount}</strong> 张<br />
              <span style={{ color: '#faad14' }}>⚠️ 将删除所有匹配的图片（包括未在当前视图中显示的）</span>
            </div>
          </div>
        ),
        footer: (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            {visibleSelectedCount > 0 && (
              <MButton danger onClick={async () => {
                try {
                  const result = await api.deleteImages(visibleSelectedImages.map(img => img.path))
                  if (result.success) {
                    message.success(`成功删除 ${result.data.deletedCount} 张图片`)
                    const deletedIds = new Set(visibleSelectedImages.map(img => img.id))
                    imagesRef.current = imagesRef.current.filter(img => !deletedIds.has(img.id))
                    setImages(prev => prev.filter(img => !deletedIds.has(img.id)))
                    setSelectedIds(prev => {
                      const next = new Set(prev)
                      deletedIds.forEach(id => next.delete(id))
                      return next
                    })
                  }
                } catch { message.error('删除失败') }
                Modal.destroyAll()
              }}>
                仅删除显示区域 ({visibleSelectedCount}张)
              </MButton>
            )}
            <MButton type="primary" danger onClick={async () => {
              try {
                const result = await api.deleteImages(allSelectedImages.map(img => img.path))
                if (result.success) {
                  message.success(`成功删除 ${result.data.deletedCount} 张图片，失败 ${result.data.failedCount} 张`)
                  const deletedIds = new Set(allSelectedImages.map(img => img.id))
                  imagesRef.current = imagesRef.current.filter(img => !deletedIds.has(img.id))
                  setImages(prev => prev.filter(img => !deletedIds.has(img.id)))
                  setSelectedIds(prev => {
                    const next = new Set(prev)
                    deletedIds.forEach(id => next.delete(id))
                    return next
                  })
                }
              } catch { message.error('删除失败') }
              Modal.destroyAll()
            }}>
              删除全部 ({totalCount}张)
            </MButton>
          </div>
        ),
        closable: true,
        maskClosable: true,
      })
      return
    }

    let confirmMessage = `确定要删除 ${totalCount} 张图片吗？\n\n`
    confirmMessage += `📊 操作详情：\n`
    confirmMessage += `• 总共选中：${totalCount} 张\n`

    if (visibleCount < images.length) {
      confirmMessage += `• 当前显示区域：${visibleSelectedCount} 张\n`
      confirmMessage += `• 未显示区域：${totalCount - visibleSelectedCount} 张\n`
      confirmMessage += `\n⚠️ 将删除所有匹配的图片（包括未在当前视图中显示的）`
    }

    const { Modal } = await import('antd')
    Modal.confirm({
      title: '⚠️ 批量删除确认',
      content: confirmMessage,
      okText: `确定删除 (${totalCount}张)`,
      okType: 'danger',
      cancelText: '取消',
      width: 480,
      onOk: async () => {
        try {
          const result = await api.deleteImages(allSelectedImages.map(img => img.path))
          if (result.success) {
            message.success(`成功删除 ${result.data.deletedCount} 张图片，失败 ${result.data.failedCount} 张`)

            const deletedIds = new Set(allSelectedImages.map(img => img.id))
            imagesRef.current = imagesRef.current.filter(img => !deletedIds.has(img.id))
            setImages(prev => prev.filter(img => !deletedIds.has(img.id)))
            setSelectedIds(prev => {
              const next = new Set(prev)
              deletedIds.forEach(id => next.delete(id))
              return next
            })
          }
        } catch (error) {
          message.error('删除失败')
        }
      }
    })
  }

  const selectedCount = selectedIds.size
  const allSelected = images.length > 0 && selectedIds.size === images.length

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatThumbnailTime = (ms: number) => {
    if (ms === 0) return '异步'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const getThroughput = () => {
    if (!stats) return 0
    const { totalFiles, totalTime } = stats
    if (totalTime === 0) return 0
    return Math.round(totalFiles / (totalTime / 1000))
  }

  const PerformanceStats = () => {
    if (!stats) return null

    return (
      <AntCard 
        size="small" 
        style={{ marginBottom: 12, background: '#f6ffed', borderColor: '#b7eb8f' }}
        styles={{ body: { padding: '8px 12px' } }}
        title={
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 12 }}>
            <span>
              <ThunderboltOutlined style={{ color: '#52c41a', marginRight: 6 }} />
              <strong style={{ fontSize: '13px' }}>性能统计</strong>
              <Tag color="green" style={{ marginLeft: 8, fontSize: '11px', padding: '0 6px', lineHeight: '18px' }}>{stats.algorithm}</Tag>
            </span>
            <span>
              <Tag color="blue" style={{ fontSize: '11px', padding: '0 6px', lineHeight: '18px' }}>敏感词: {stats.wordsCount} 个</Tag>
              <Tag color="purple" style={{ fontSize: '11px', padding: '0 6px', lineHeight: '18px' }}>匹配率: {((stats.matchedFiles / stats.totalFiles) * 100).toFixed(2)}%</Tag>
            </span>
          </span>
        }
      >
        <Row gutter={12}>
          <Col span={4}>
            <Statistic title="扫描文件" value={stats.totalFiles} prefix={<FileImageOutlined />} suffix="张" valueStyle={{ fontSize: '14px' }} />
          </Col>
          <Col span={4}>
            <Statistic title="匹配文件" value={stats.matchedFiles} prefix={<CheckCircleOutlined />} suffix="张" valueStyle={{ fontSize: '14px', color: '#cf1322' }} />
          </Col>
          <Col span={4}>
            <Statistic title="总耗时" value={formatTime(stats.totalTime)} prefix={<ClockCircleOutlined />} valueStyle={{ fontSize: '14px' }} />
          </Col>
          <Col span={4}>
            <Statistic title="扫描耗时" value={formatTime(stats.scanTime)} prefix={<ClockCircleOutlined />} valueStyle={{ fontSize: '14px' }} />
          </Col>
          <Col span={4}>
            <Statistic title="缩略图生成" value={formatThumbnailTime(stats.thumbnailTime)} prefix={<ClockCircleOutlined />} valueStyle={{ fontSize: '14px', color: stats.thumbnailTime === 0 ? '#1890ff' : undefined }} />
          </Col>
          <Col span={4}>
            <Statistic title="处理速度" value={getThroughput()} prefix={<ThunderboltOutlined />} suffix="张/秒" valueStyle={{ fontSize: '14px', color: '#1890ff' }} />
          </Col>
        </Row>
        <style>{`.ant-statistic-title { font-size: 11px !important; margin-bottom: 2px !important; }`}</style>
      </AntCard>
    )
  }

  const visibleImages = useMemo(() => {
    return images.slice(0, visibleCount)
  }, [images, visibleCount])

  return (
    <>
      <SensitiveSidebar
        words={words}
        wordsLoading={wordsLoading}
        onAddWord={handleAddWord}
        onDeleteWord={handleDeleteWord}
        onRefreshWords={handleRefreshWords}
        onScanFolder={handleScanFolder}
        currentFolder={currentFolder}
      />
      <main style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Toolbar
          totalImages={images.length}
          visibleCount={visibleCount} // 传入当前可见数量
          selectedCount={selectedCount}
          allSelected={allSelected}
          onSelectAll={handleSelectAll}
          onDeleteSelected={handleDeleteSelected}
          onRescan={handleRescan}
          loading={loading}
          hasFolder={!!currentFolder}
        />
        <div ref={gridRef} style={{ flex: 1, overflow: 'auto', padding: '16px', position: 'relative' }}>
          <PerformanceStats />
          <ImageGrid
            images={visibleImages}
            totalImages={images.length}
            loading={loading}
            selectedIds={deferredSelectedIds}
            onToggleSelect={handleToggleSelect}
            onDeleteSelected={handleDeleteSelected}
          />
          {visibleCount < images.length && (
            <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
              已显示 {visibleCount} / {images.length} 张图片，向下滚动加载更多...
            </div>
          )}

          {/* 返回顶部按钮 - 数据超过200条时显示 */}
          {showBackToTop && images.length > 200 && (
            <Button
              type="primary"
              icon={<ArrowUpOutlined style={{ fontSize: '24px', fontWeight: 'bold', strokeWidth: '3px' }} />}
              size="large"
              onClick={scrollToTop}
              style={{
                position: 'fixed',
                right: '40px',
                bottom: '40px',
                zIndex: 1000,
                width: '48px',
                height: '48px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                border: 'none',
                boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)',
                transition: 'all 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onMouseEnter={(e) => {
                const target = e.currentTarget
                target.style.transform = 'translateY(-2px) scale(1.05)'
                target.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)'
              }}
              onMouseLeave={(e) => {
                const target = e.currentTarget
                target.style.transform = 'translateY(0) scale(1)'
                target.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)'
              }}
              title="返回顶部"
            />
          )}
        </div>
      </main>
    </>
  )
}

export default SensitiveWordPage
