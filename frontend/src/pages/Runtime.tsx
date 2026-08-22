import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, Space, Select, Switch, Button, Typography, App as AntdApp, Segmented } from 'antd'
import { ReloadOutlined, DownloadOutlined, CopyOutlined, FileTextOutlined, CodeOutlined } from '@ant-design/icons'
import { api } from '../api/client'

const { Text } = Typography

type ViewMode = 'logs' | 'config'

export default function Runtime() {
  const { message } = AntdApp.useApp()
  const [view, setView] = useState<ViewMode>('logs')

  // 日志
  const [logs, setLogs] = useState<string[]>([])
  const [tail, setTail] = useState(200)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const timerRef = useRef<number | undefined>(undefined)
  const boxRef = useRef<HTMLPreElement>(null)

  // 配置
  const [configText, setConfigText] = useState('')
  const [configLoading, setConfigLoading] = useState(false)

  const loadLogs = useCallback(async () => {
    try {
      setLogs(await api.get<string[]>('/core/logs', { tail }))
    } catch {
      // 轮询失败静默处理，下一轮重试
    }
  }, [tail])

  const loadConfig = useCallback(async () => {
    setConfigLoading(true)
    try {
      const r = await api.get<{ config: string }>('/core/config')
      setConfigText(r.config)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setConfigLoading(false)
    }
  }, [message])

  useEffect(() => {
    if (view === 'logs') loadLogs()
    else if (!configText) loadConfig()
  }, [view, loadLogs, loadConfig, configText])

  // 日志自动刷新（仅日志视图）
  useEffect(() => {
    if (view === 'logs' && autoRefresh) {
      timerRef.current = window.setInterval(loadLogs, 2000)
      return () => window.clearInterval(timerRef.current)
    }
  }, [view, autoRefresh, loadLogs])

  // 自动滚动到底部
  useEffect(() => {
    if (boxRef.current && view === 'logs' && autoRefresh) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight
    }
  }, [logs, view, autoRefresh])

  const download = () => {
    const content = view === 'logs' ? logs.join('\n') : configText
    const name =
      view === 'logs'
        ? `sing-box-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`
        : 'sing-box.json'
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card
      title="运行管理"
      extra={
        <Space>
          <Segmented
            value={view}
            onChange={(v) => setView(v as ViewMode)}
            options={[
              { label: '运行日志', value: 'logs', icon: <FileTextOutlined /> },
              { label: '核心配置', value: 'config', icon: <CodeOutlined /> },
            ]}
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => (view === 'logs' ? loadLogs() : loadConfig())}
            loading={view === 'config' && configLoading}
          >
            刷新
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={download}>
            下载
          </Button>
        </Space>
      }
    >
      {view === 'logs' ? (
        <>
          <Space style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              行数
            </Text>
            <Select
              size="small"
              value={tail}
              onChange={setTail}
              style={{ width: 90 }}
              options={[100, 200, 500, 1000, 2000].map((n) => ({ label: String(n), value: n }))}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              自动刷新
            </Text>
            <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
          </Space>
          <pre ref={boxRef} className="log-view">
            {logs.length ? logs.join('\n') : '暂无日志'}
          </pre>
        </>
      ) : (
        <>
          <Space style={{ marginBottom: 12 }}>
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                navigator.clipboard.writeText(configText).then(
                  () => message.success('已复制到剪贴板'),
                  () => message.error('复制失败'),
                )
              }}
            >
              复制
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              核心实际运行的 sing-box.json，由面板根据数据库配置自动生成；手动修改会在下次保存配置时被覆盖
            </Text>
          </Space>
          <pre className="log-view">{configText || '加载中...'}</pre>
        </>
      )}
    </Card>
  )
}
