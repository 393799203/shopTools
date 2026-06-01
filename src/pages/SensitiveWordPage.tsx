import { useState, useEffect, useRef, useCallback } from 'react'
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

interface ImageState {
  images: MatchedImage[]
  loading: boolean
  currentFolder: string | null
  stats?: ScanStats
}

function SensitiveWordPage() {
  const [imageState, setImageState] = useState<ImageState>({
    images: [],
    loading: false,
    currentFolder: null
  })

  // 返回顶部按钮控制
  const [showBackToTop, setShowBackToTop] = useState(false)
  const SCROLL_THRESHOLD = 300
  const gridRef = useRef<HTMLDivElement>(null)

  // 监听滚动，控制返回顶部按钮
  useEffect(() => {
    const gridElement = gridRef.current
    if (!gridElement) return

    const handleScroll = () => {
      const { scrollTop } = gridElement
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
        behavior: 'smooth'
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
    console.log('🎯 [页面] 开始扫描文件夹:', folderPath)
    setImageState(prev => ({ ...prev, loading: true, images: [], stats: undefined }))

    try {
      console.log('📡 [页面] 调用同步 API...')
      const result = await api.scanFolder(folderPath)

      if (result.success) {
        console.log(`📊 [页面] 扫描完成，找到 ${result.data.length} 张匹配图片`)
        const imagesWithSelection = result.data.map(img => ({ ...img, selected: true }))
        setImageState({
          images: imagesWithSelection,
          loading: false,
          currentFolder: folderPath,
          stats: result.stats
        })

        if (result.data.length > 0) {
          message.success(`找到 ${result.data.length} 张匹配的图片（已自动全选）`)
        } else {
          message.info('未找到匹配的图片')
        }
      } else {
        throw new Error('扫描失败')
      }

    } catch (error) {
      console.error('❌ [页面] 扫描失败:', error)
      message.error('扫描失败')
      setImageState(prev => ({ ...prev, loading: false }))
    }
  }

  const handleRescan = async () => {
    if (!imageState.currentFolder) {
      message.warning('请先选择文件夹')
      return
    }

    await handleScanFolder(imageState.currentFolder)
  }

  const handleToggleSelect = useCallback((imageId: string) => {
    setImageState(prev => ({
      ...prev,
      images: prev.images.map(img =>
        img.id === imageId ? { ...img, selected: !img.selected } : img
      )
    }))
  }, [])

  // 全选/取消全选：选中所有图片（包括未显示的）
  const handleSelectAll = (selected: boolean) => {
    setImageState(prev => ({
      ...prev,
      images: prev.images.map(img => ({ ...img, selected }))
    }))

    if (selected) {
      message.success(`已选中全部 ${imageState.images.length} 张图片`)
    }
  }

  // 删除所有选中的图片（全量删除）
  const handleDeleteSelected = async () => {
    const allSelectedImages = imageState.images.filter(img => img.selected)

    if (allSelectedImages.length === 0) {
      message.warning('请先选择要删除的图片')
      return
    }

    const totalCount = allSelectedImages.length

    let confirmMessage = `确定要删除 ${totalCount} 张图片吗？\n\n`
    confirmMessage += `📊 操作详情：\n`
    confirmMessage += `• 总共选中：${totalCount} 张\n`

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
            setImageState(prev => ({
              ...prev,
              images: prev.images.filter(img => !deletedIds.has(img.id))
            }))
          }
        } catch (error) {
          message.error('删除失败')
        }
      }
    })
  }

  // 计算总选中数量（用于 Toolbar 显示）
  const selectedCount = imageState.images.filter(img => img.selected).length
  const allSelected = imageState.images.length > 0 && imageState.images.every(img => img.selected)

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
    if (!imageState.stats) return 0
    const { totalFiles, totalTime } = imageState.stats
    if (totalTime === 0) return 0
    return Math.round(totalFiles / (totalTime / 1000))
  }

  const PerformanceStats = () => {
    if (!imageState.stats) return null

    const { stats } = imageState

    return (
      <AntCard 
        size="small" 
        style={{ marginBottom: 16, background: '#f6ffed', borderColor: '#b7eb8f' }}
        title={
          <span>
            <ThunderboltOutlined style={{ color: '#52c41a', marginRight: 8 }} />
            <strong>性能统计</strong>
            <Tag color="green" style={{ marginLeft: 12 }}>{stats.algorithm}</Tag>
          </span>
        }
      >
        <Row gutter={16}>
          <Col span={4}>
            <Statistic title="扫描文件" value={stats.totalFiles} prefix={<FileImageOutlined />} suffix="张" valueStyle={{ fontSize: '16px' }} />
          </Col>
          <Col span={4}>
            <Statistic title="匹配文件" value={stats.matchedFiles} prefix={<CheckCircleOutlined />} suffix="张" valueStyle={{ fontSize: '16px', color: '#cf1322' }} />
          </Col>
          <Col span={4}>
            <Statistic title="总耗时" value={formatTime(stats.totalTime)} prefix={<ClockCircleOutlined />} valueStyle={{ fontSize: '16px' }} />
          </Col>
          <Col span={4}>
            <Statistic title="扫描耗时" value={formatTime(stats.scanTime)} prefix={<ClockCircleOutlined />} valueStyle={{ fontSize: '16px' }} />
          </Col>
          <Col span={4}>
            <Statistic title="缩略图生成" value={formatThumbnailTime(stats.thumbnailTime)} prefix={<ClockCircleOutlined />} valueStyle={{ fontSize: '16px', color: stats.thumbnailTime === 0 ? '#1890ff' : undefined }} />
          </Col>
          <Col span={4}>
            <Statistic title="处理速度" value={getThroughput()} prefix={<ThunderboltOutlined />} suffix="张/秒" valueStyle={{ fontSize: '16px', color: '#1890ff' }} />
          </Col>
        </Row>
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <Tag color="blue">敏感词: {stats.wordsCount} 个</Tag>
          <Tag color="purple">匹配率: {((stats.matchedFiles / stats.totalFiles) * 100).toFixed(2)}%</Tag>
        </div>
      </AntCard>
    )
  }

  return (
    <>
      <SensitiveSidebar
        words={words}
        wordsLoading={wordsLoading}
        onAddWord={handleAddWord}
        onDeleteWord={handleDeleteWord}
        onRefreshWords={handleRefreshWords}
        onScanFolder={handleScanFolder}
        currentFolder={imageState.currentFolder}
      />
      <main style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Toolbar
          totalImages={imageState.images.length}
          selectedCount={selectedCount}
          allSelected={allSelected}
          onSelectAll={handleSelectAll}
          onDeleteSelected={handleDeleteSelected}
          onRescan={handleRescan}
          loading={imageState.loading}
          hasFolder={!!imageState.currentFolder}
        />
        <div ref={gridRef} style={{ flex: 1, overflow: 'auto', padding: '16px', position: 'relative' }}>
          <PerformanceStats />
          <ImageGrid
            images={imageState.images}
            totalImages={imageState.images.length}
            loading={imageState.loading}
            onToggleSelect={handleToggleSelect}
            onDeleteSelected={handleDeleteSelected}
          />

          {/* 返回顶部按钮 - 数据超过200条时显示 */}
          {showBackToTop && imageState.images.length > 200 && (
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
