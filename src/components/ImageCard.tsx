import React, { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { Card, Checkbox, Tag, Typography, Tooltip, Modal, Image, Spin } from 'antd'
import { FileImageOutlined, ZoomInOutlined, LoadingOutlined } from '@ant-design/icons'
import { MatchedImage } from '../types'
import { API_BASE } from '../services/api'

const { Text } = Typography

interface ImageCardProps {
  image: MatchedImage
  selected: boolean
  onToggleSelect: (imageId: string) => void
}

// 全局并发控制：最多同时加载 6 个缩略图
const MAX_CONCURRENT_LOADS = 6
let currentLoadingCount = 0
const loadingQueue: Array<() => void> = []

function enqueueThumbnailLoad(loadFn: () => void) {
  if (currentLoadingCount < MAX_CONCURRENT_LOADS) {
    currentLoadingCount++
    loadFn()
  } else {
    loadingQueue.push(loadFn)
  }
}

function dequeueThumbnailLoad() {
  currentLoadingCount--
  if (loadingQueue.length > 0 && currentLoadingCount < MAX_CONCURRENT_LOADS) {
    currentLoadingCount++
    const nextLoad = loadingQueue.shift()
    nextLoad?.()
  }
}

const highlightText = (text: string, words: string[]): React.ReactNode => {
  if (!words || words.length === 0) return text

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  const lowerText = text.toLowerCase()

  const matches: { start: number; end: number; word: string }[] = []

  words.forEach(word => {
    const lowerWord = word.toLowerCase()
    let startIndex = 0
    while ((startIndex = lowerText.indexOf(lowerWord, startIndex)) !== -1) {
      matches.push({
        start: startIndex,
        end: startIndex + word.length,
        word: text.slice(startIndex, startIndex + word.length)
      })
      startIndex += word.length
    }
  })

  matches.sort((a, b) => a.start - b.start)

  matches.forEach((match, index) => {
    if (match.start > lastIndex) {
      parts.push(text.slice(lastIndex, match.start))
    }
    parts.push(
      <Text key={index} strong style={{ color: '#ff4d4f', backgroundColor: '#fff1f0', padding: '0 2px' }}>
        {match.word}
      </Text>
    )
    lastIndex = match.end
  })

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

// 使用 React.memo 优化性能，只在 props 变化时重新渲染
const ImageCardComponent: React.FC<ImageCardProps> = ({ image, selected, onToggleSelect }) => {
  const [imgError, setImgError] = useState(false)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(image.thumbnailUrl || null)
  const [loading, setLoading] = useState(false)

  const fileName = useMemo(() => image.name.replace(/\.[^/.]+$/, ''), [image.name])
  const highlightedName = useMemo(() => highlightText(fileName, image.matchedWords), [fileName, image.matchedWords])

  useEffect(() => {
    if (image.thumbnailUrl) {
      setThumbnailUrl(image.thumbnailUrl)
      return
    }

    if (!image.path) return

    const loadThumbnail = async () => {
      try {
        setLoading(true)
        const response = await fetch(`${API_BASE}/thumbnail?path=${encodeURIComponent(image.path)}`)
        const result = await response.json()

        if (result.success && result.data?.thumbnailUrl) {
          setThumbnailUrl(result.data.thumbnailUrl)
        }
      } catch (error) {
        console.error('Failed to load thumbnail:', error)
      } finally {
        setLoading(false)
        dequeueThumbnailLoad()
      }
    }

    // 延迟执行，确保首屏先渲染出来
    const timer = setTimeout(() => {
      enqueueThumbnailLoad(loadThumbnail)
    }, Math.random() * 100) // 随机延迟 0-100ms，避免所有请求同时发出

    return () => clearTimeout(timer)
  }, [image.path, image.thumbnailUrl])

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation()

    Modal.info({
      title: highlightedName,
      content: (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <Image
            src={`${API_BASE}/images/${image.id}?path=${encodeURIComponent(image.path)}`}
            alt={image.name}
            style={{ maxWidth: '100%', maxHeight: '70vh' }}
            preview={false}
            fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMTgiIGZpbGw9IiNjY2MiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj7nu4/ku7zlvZXlj5HnjrA8L3RleHQ+PC9zdmc+"
          />
          <div style={{ marginTop: '16px' }}>
            <Text type="secondary" copyable={{ text: image.path }}>
              路径: {image.path}
            </Text>
          </div>
          <div style={{ marginTop: '12px' }}>
            {image.matchedWords.map((word, index) => (
              <Tag key={index} color="red" style={{ margin: '2px' }}>
                {word}
              </Tag>
            ))}
          </div>
        </div>
      ),
      width: '90vw',
      centered: true,
      closable: true,
      footer: null,
      icon: null
    })
  }

  return (
    <Card
      hoverable
      style={{
        height: '100%',
        border: selected ? '2px solid #1890ff' : '1px solid #f0f0f0',
        position: 'relative',
        overflow: 'hidden'
      }}
      styles={{ body: { padding: '12px' } }}
      onClick={() => onToggleSelect(image.id)}
    >
      <div style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 10 }}>
        <Checkbox checked={selected} style={{ transition: 'none' }} />
      </div>

      <div
        style={{
          width: '100%',
          height: '180px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fafafa',
          borderRadius: '6px',
          marginBottom: '12px',
          overflow: 'hidden',
          cursor: 'pointer',
          position: 'relative'
        }}
        onClick={handleImageClick}
      >
        {!imgError && thumbnailUrl ? (
          <>
            <img
              src={thumbnailUrl}
              alt={image.name}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain'
              }}
              onError={() => setImgError(true)}
            />
            <div
              style={{
                position: 'absolute',
                bottom: '8px',
                right: '8px',
                background: 'rgba(0, 0, 0, 0.6)',
                color: '#fff',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                opacity: 0,
                transition: 'opacity 0.3s'
              }}
              className="zoom-hint"
            >
              <ZoomInOutlined /> 点击放大
            </div>
          </>
        ) : loading ? (
          <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />
        ) : (
          <FileImageOutlined style={{ fontSize: '48px', color: '#ccc' }} />
        )}
      </div>

      <Tooltip title={image.name}>
        <Text
          ellipsis
          style={{
            display: 'block',
            fontSize: '13px',
            marginBottom: '8px',
            minHeight: '20px'
          }}
        >
          {highlightedName}
        </Text>
      </Tooltip>

      <div>
        {image.matchedWords.map((word, index) => (
          <Tag key={index} color="red" style={{ margin: '2px' }}>
            {word}
          </Tag>
        ))}
      </div>

      <style>{`
        .ant-card:hover .zoom-hint {
          opacity: 1;
        }
        .ant-checkbox-inner {
          transition: none !important;
        }
      `}</style>
    </Card>
  )
}

// 自定义比较函数：只在关键 props 变化时重新渲染
function areEqual(prevProps: ImageCardProps, nextProps: ImageCardProps): boolean {
  return (
    prevProps.selected === nextProps.selected &&
    prevProps.image.id === nextProps.image.id &&
    prevProps.image.path === nextProps.image.path &&
    prevProps.image.name === nextProps.image.name &&
    JSON.stringify(prevProps.image.matchedWords) === JSON.stringify(nextProps.image.matchedWords)
  )
}

export default memo(ImageCardComponent, areEqual)