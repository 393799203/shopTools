import { Button, Space, Typography, Checkbox, Tooltip } from 'antd'
import { DeleteOutlined, ReloadOutlined, InfoCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

interface ToolbarProps {
  totalImages: number
  visibleCount?: number // 当前可见的图片数量（用于提示）
  selectedCount: number
  allSelected: boolean
  onSelectAll: (selected: boolean) => void
  onDeleteSelected: () => void
  onRescan: () => void
  loading: boolean
  hasFolder: boolean
}

const Toolbar: React.FC<ToolbarProps> = ({
  totalImages,
  visibleCount,
  selectedCount,
  allSelected,
  onSelectAll,
  onDeleteSelected,
  onRescan,
  loading,
  hasFolder
}) => {
  const hasMore = visibleCount && visibleCount < totalImages

  return (
    <div style={{
      padding: '12px 16px',
      background: '#fff',
      borderBottom: '1px solid #f0f0f0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <Space>
        <Text type="secondary">
          共 {totalImages} 张图片，
          已选择 <Text strong>{selectedCount}</Text> 张
          {hasMore && (
            <Tooltip title={`当前显示前 ${visibleCount} 张，滚动查看更多\n全选和删除操作将作用于全部 ${totalImages} 张图片`}>
              <InfoCircleOutlined style={{ marginLeft: 4, color: '#faad14' }} />
            </Tooltip>
          )}
        </Text>

        {totalImages > 0 && (
          <Checkbox
            checked={allSelected}
            indeterminate={selectedCount > 0 && !allSelected}
            onChange={(e) => onSelectAll(e.target.checked)}
          >
            全选
            {hasMore && (
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
                (全部{totalImages}张)
              </Text>
            )}
          </Checkbox>
        )}
      </Space>

      <Space>
        <Button
          icon={<ReloadOutlined />}
          onClick={onRescan}
          disabled={!hasFolder || loading}
          loading={loading}
        >
          重新匹配
        </Button>
        <Button
          type="primary"
          danger
          icon={<DeleteOutlined />}
          onClick={onDeleteSelected}
          disabled={selectedCount === 0 || loading}
          loading={loading}
        >
          删除选中 ({selectedCount})
        </Button>
      </Space>
    </div>
  )
}

export default Toolbar
