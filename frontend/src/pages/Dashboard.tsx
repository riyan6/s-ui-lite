import { useEffect, useRef, useState } from 'react'
import { Card, Col, Row, Progress, Statistic, Tag, Button, Space, Popconfirm, Typography, App as AntdApp } from 'antd'
import {
  CloudUploadOutlined,
  CloudDownloadOutlined,
  HddOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  CaretRightOutlined,
} from '@ant-design/icons'
import { api } from '../api/client'
import type { CoreStatus, ServerStatus } from '../api/types'
import { formatBytes, formatDuration, formatSpeed } from '../utils/format'

const { Text } = Typography

const stateColor: Record<string, string> = {
  running: 'green',
  stopped: 'default',
  failed: 'red',
  starting: 'blue',
}

export default function Dashboard() {
  const { message } = AntdApp.useApp()
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [core, setCore] = useState<CoreStatus | null>(null)
  const [restarting, setRestarting] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  const load = async () => {
    try {
      const [s, c] = await Promise.all([api.get<ServerStatus>('/server/status'), api.get<CoreStatus>('/core/status')])
      setStatus(s)
      setCore(c)
    } catch {
      // 轮询失败静默处理，下一轮重试
    }
  }

  useEffect(() => {
    load()
    timerRef.current = window.setInterval(load, 3000)
    return () => window.clearInterval(timerRef.current)
  }, [])

  const restartCore = async () => {
    setRestarting(true)
    try {
      await api.post('/core/restart')
      message.success('核心已重启')
      load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setRestarting(false)
    }
  }

  if (!status || !core) {
    return <Card loading style={{ minHeight: 300 }} />
  }

  const diskPercent = status.disk_total > 0 ? ((status.disk_total - status.disk_free) / status.disk_total) * 100 : 0

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {/* sing-box 核心 */}
      <Card
        title="sing-box 核心"
        extra={
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={load}>
              刷新
            </Button>
            <Popconfirm title="确认重启核心？现有连接会短暂中断" onConfirm={restartCore}>
              <Button size="small" color="primary" variant="solid" icon={<CaretRightOutlined />} loading={restarting}>
                重启核心
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={6}>
            <Statistic
              title="状态"
              valueRender={() => (
                <Tag color={stateColor[core.state] ?? 'default'} variant="solid" style={{ margin: 0 }}>
                  {core.state}
                </Tag>
              )}
            />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic title="核心版本" value={core.core_version || '-'} styles={{ content: { fontSize: 16 } }} />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic title="重启次数" value={core.restarts} />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic
              title="运行时长"
              value={core.running ? formatDuration((Date.now() - new Date(core.started_at).getTime()) / 1000) : '-'}
              styles={{ content: { fontSize: 16 } }}
            />
          </Col>
        </Row>
        {core.last_error && (
          <Text type="danger" style={{ fontSize: 12 }}>
            最近错误：{core.last_error}
          </Text>
        )}
      </Card>

      {/* CPU / 内存 / 磁盘 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card title="CPU">
            <div style={{ textAlign: 'center' }}>
              <Progress type="dashboard" percent={Math.round(status.cpu_percent)} size={160} />
            </div>
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <Text type="secondary">
                {status.cpu_core_count} 核 · {status.os}/{status.arch} · 负载 {status.load_1.toFixed(2)} /{' '}
                {status.load_5.toFixed(2)} / {status.load_15.toFixed(2)}
              </Text>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card title="内存">
            <div style={{ textAlign: 'center' }}>
              <Progress type="dashboard" percent={Math.round(status.mem_percent)} size={160} />
            </div>
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <Text type="secondary">
                {formatBytes(status.mem_used)} / {formatBytes(status.mem_total)}
                {status.swap_total > 0 && ` · Swap ${formatBytes(status.swap_used)}/${formatBytes(status.swap_total)}`}
              </Text>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card title="磁盘（数据目录）">
            <div style={{ textAlign: 'center' }}>
              <Progress type="dashboard" percent={Math.round(diskPercent)} size={160} />
            </div>
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <Text type="secondary">
                <HddOutlined /> 可用 {formatBytes(status.disk_free)} / {formatBytes(status.disk_total)}
              </Text>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 网络 / 运行时长 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12}>
          <Card>
            <Statistic
              title="上传速度"
              value={formatSpeed(status.net.upload)}
              prefix={<CloudUploadOutlined />}
              styles={{ content: { fontSize: 18 } }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              累计 {formatBytes(status.net_total_up)}
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card>
            <Statistic
              title="下载速度"
              value={formatSpeed(status.net.download)}
              prefix={<CloudDownloadOutlined />}
              styles={{ content: { fontSize: 18 } }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              累计 {formatBytes(status.net_total_down)}
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card>
            <Statistic
              title="系统运行时长"
              value={formatDuration(status.uptime_seconds)}
              prefix={<ClockCircleOutlined />}
              styles={{ content: { fontSize: 18 } }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card>
            <Statistic
              title="面板运行时长"
              value={formatDuration(status.panel_uptime_seconds)}
              prefix={<ClockCircleOutlined />}
              styles={{ content: { fontSize: 18 } }}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
