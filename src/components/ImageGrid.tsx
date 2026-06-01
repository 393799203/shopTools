import React from 'react'
import { Spin, Empty, Grid } from 'antd'
import ImageCard from './ImageCard'
import { MatchedImage } from '../types'

interface ImageGridProps {
  images: MatchedImage[]
  totalImages?: number
  loading: boolean
  selectedIds: Set<string>
  onToggleSelect: (imageId: string) => void
  onDeleteSelected: () => void
}

const { useBreakpoint } = Grid

const ImageGrid: React.FC<ImageGridProps> = ({
  images,
  totalImages,
  loading,
  selectedIds,
  onToggleSelect
}) => {
  const screens = useBreakpoint()

  const getColumnCount = () => {
    if (screens.xxl) return 6
    if (screens.xl) return 5
    if (screens.lg) return 4
    if (screens.md) return 3
    if (screens.sm) return 2
    return 1
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '400px',
        gap: '16px'
      }}>
        <Spin size="large" />
        <div style={{ color: '#1890ff', fontSize: '14px' }}>正在扫描图片...</div>
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <Empty
        description="暂无匹配的图片"
        style={{ marginTop: '100px' }}
      />
    )
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${getColumnCount()}, 1fr)`,
      gap: '16px'
    }}>
      {images.map((image) => (
        <ImageCard
          key={image.id}
          image={image}
          selected={selectedIds.has(image.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  )
}

export default ImageGrid
