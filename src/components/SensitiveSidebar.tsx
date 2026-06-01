import { useState, useEffect } from 'react'
import { Button, Input, Tag, Popconfirm, Typography, Space, message, Alert, Spin } from 'antd'
import { FolderOpenOutlined, PlusOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons'

const { Text } = Typography

interface SensitiveSidebarProps {
  words: { id: string; word: string }[]
  wordsLoading: boolean
  onAddWord: (word: string) => Promise<boolean>
  onDeleteWord: (id: string) => Promise<void>
  onRefreshWords: () => void
  onScanFolder: (folderPath: string) => void
  currentFolder: string | null
}

const SensitiveSidebar = ({ words, wordsLoading, onAddWord, onDeleteWord, onRefreshWords, onScanFolder, currentFolder }: SensitiveSidebarProps) => {
  const [newWord, setNewWord] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [adding, setAdding] = useState(false)
  const [manualPath, setManualPath] = useState('')
  const [isElectron, setIsElectron] = useState(false)

  useEffect(() => {
    setIsElectron(!!window?.electronAPI?.openFolderDialog)
  }, [])

  const filteredWords = searchKeyword.trim()
    ? words.filter(item => item.word.toLowerCase().includes(searchKeyword.toLowerCase().trim()))
    : words

  const handleAddWord = async () => {
    const wordToAdd = newWord.trim() || searchKeyword.trim()
    if (!wordToAdd) {
      message.warning('请输入敏感词')
      return
    }

    setAdding(true)
    const success = await onAddWord(wordToAdd)
    if (success) {
      setNewWord('')
      setSearchKeyword('')
    }
    setAdding(false)
  }

  const handleSelectFolder = async () => {
    if (isElectron) {
      try {
        const result = await window.electronAPI.openFolderDialog()

        if (!result.canceled && result.filePaths.length > 0) {
          onScanFolder(result.filePaths[0])
        }
      } catch (error) {
        console.error('Failed to open dialog:', error)
        message.error('无法打开文件夹选择窗口')
      }
    } else {
      if (!manualPath.trim()) {
        message.warning('请输入文件夹路径')
        return
      }
      onScanFolder(manualPath.trim())
    }
  }

  return (
    <aside style={{
      height: '100%',
      borderRight: '1px solid #f0f0f0',
      padding: '16px',
      background: '#fff',
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      overflow: 'hidden'
    }}>
      <div style={{ marginBottom: '16px' }}>
        <Text strong style={{ fontSize: '16px', display: 'block', marginBottom: '12px' }}>
          文件夹扫描
        </Text>
        
        {!isElectron && (
          <Alert
            message="浏览器模式"
            description="当前为开发模式，请手动输入文件夹路径。完整功能请使用 npm run electron:dev"
            type="info"
            showIcon
            style={{ marginBottom: '12px' }}
          />
        )}
        
        {!isElectron && (
          <Input
            placeholder="输入文件夹完整路径，如：/Users/xxx/images"
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            onPressEnter={handleSelectFolder}
            prefix={<EditOutlined />}
            style={{ marginBottom: '8px' }}
          />
        )}
        
        <Button
          type="primary"
          icon={<FolderOpenOutlined />}
          onClick={handleSelectFolder}
          block
          size="large"
        >
          {isElectron ? '选择图片文件夹' : '扫描文件夹'}
        </Button>
        {currentFolder && (
          <Text
            type="secondary"
            ellipsis
            style={{ display: 'block', marginTop: '8px', fontSize: '12px' }}
            title={currentFolder}
          >
            当前: {currentFolder}
          </Text>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateRows: 'auto auto 1fr',
        overflow: 'hidden'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <Text strong style={{ fontSize: '16px' }}>
            敏感词管理 ({searchKeyword.trim() ? `${filteredWords.length} / ` : ''}{words.length})
          </Text>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={onRefreshWords}
            title="刷新敏感词列表"
          />
        </div>
        
        <Space.Compact style={{ width: '100%', marginBottom: '8px' }}>
          <Input
            placeholder="搜索或添加敏感词"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onPressEnter={handleAddWord}
            allowClear
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={adding}
            onClick={handleAddWord}
          >
            添加
          </Button>
        </Space.Compact>

        <div style={{
          overflowY: 'auto',
          background: '#fafafa',
          borderRadius: '6px',
          padding: '8px'
        }}>
          {wordsLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Spin />
            </div>
          ) : filteredWords.length === 0 && words.length > 0 ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>无匹配结果</div>
          ) : filteredWords.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>暂无敏感词</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {filteredWords.map((item) => (
                <Popconfirm
                  key={item.id}
                  title="确定删除该敏感词？"
                  onConfirm={() => onDeleteWord(item.id)}
                  okText="确定"
                  cancelText="取消"
                >
                  <Tag color="red" style={{ cursor: 'pointer', position: 'relative' }}>
                    {item.word}
                    <span className="delete-icon" style={{
                      position: 'absolute',
                      top: '-6px',
                      right: '-6px',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      background: 'rgba(0, 0, 0, 0.75)',
                      color: '#fff',
                      fontSize: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0,
                      transition: 'opacity 0.2s',
                      cursor: 'pointer',
                      zIndex: 1
                    }}>
                      ×
                    </span>
                  </Tag>
                </Popconfirm>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

export default SensitiveSidebar
