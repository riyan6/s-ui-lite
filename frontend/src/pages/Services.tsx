import { useCallback, useEffect, useState } from 'react'
import {
  Card, Table, Button, Space, Switch, Tag, Popconfirm, Modal, Form, Input, InputNumber, Select,
  App as AntdApp, Typography, Row, Col, Divider,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, KeyOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import type { Service } from '../api/types'
import { parseExtraJSON } from '../utils/format'
import dayjs from 'dayjs'

const { Text, Paragraph } = Typography

// 面板当前提供表单的服务类型（sing-box 1.14+ 提供 api 服务）
const TYPES = [{ label: 'api（sing-box API 服务）', value: 'api' }]

const typeColor: Record<string, string> = { api: 'purple' }

interface FormValues {
  tag: string
  type: string
  enabled: boolean
  listen?: string
  listen_port?: number
  secret?: string
  allow_origins?: string[]
  allow_private_network?: boolean
  dashboard_enabled?: boolean
  dashboard_path?: string
  dashboard_download_url?: string
  dashboard_update_interval?: string
  extra?: string
}

export default function Services() {
  const { message } = AntdApp.useApp()
  const [list, setList] = useState<Service[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<FormValues>()
  const dashboardEnabled = Form.useWatch('dashboard_enabled', form)
  const type = Form.useWatch('type', form)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(await api.get<Service[]>('/services'))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      type: 'api',
      enabled: true,
      listen: '::',
      dashboard_enabled: false,
    })
    setModalOpen(true)
  }

  const openEdit = (sv: Service) => {
    setEditing(sv)
    const cfg = sv.config
    const dash = (cfg.dashboard ?? {}) as Record<string, unknown>
    const known = new Set([
      'listen', 'listen_port', 'secret', 'access_control_allow_origin',
      'access_control_allow_private_network', 'dashboard',
    ])
    const rest: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cfg)) {
      if (!known.has(k)) rest[k] = v
    }
    form.setFieldsValue({
      tag: sv.tag,
      type: sv.type,
      enabled: sv.enabled,
      listen: typeof cfg.listen === 'string' ? cfg.listen : undefined,
      listen_port: typeof cfg.listen_port === 'number' ? cfg.listen_port : undefined,
      secret: typeof cfg.secret === 'string' ? cfg.secret : undefined,
      allow_origins: Array.isArray(cfg.access_control_allow_origin)
        ? cfg.access_control_allow_origin.map(String)
        : undefined,
      allow_private_network: Boolean(cfg.access_control_allow_private_network),
      dashboard_enabled: Boolean(dash.enabled),
      dashboard_path: typeof dash.path === 'string' ? dash.path : undefined,
      dashboard_download_url: typeof dash.download_url === 'string' ? dash.download_url : undefined,
      dashboard_update_interval: typeof dash.update_interval === 'string' ? dash.update_interval : undefined,
      extra: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : undefined,
    })
    setModalOpen(true)
  }

  const genSecret = async () => {
    try {
      const r = await api.get<{ psk: string }>('/tools/snell-psk')
      form.setFieldsValue({ secret: r.psk })
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const onFinish = async (v: FormValues) => {
    let extra: Record<string, unknown>
    try {
      extra = parseExtraJSON(v.extra)
    } catch (e) {
      message.error((e as Error).message)
      return
    }
    const config: Record<string, unknown> = { ...extra }
    if (v.listen) config.listen = v.listen
    config.listen_port = v.listen_port
    if (v.secret) config.secret = v.secret
    if (v.allow_origins && v.allow_origins.length > 0) config.access_control_allow_origin = v.allow_origins
    if (v.allow_private_network) config.access_control_allow_private_network = true
    if (v.dashboard_enabled) {
      const dash: Record<string, unknown> = { enabled: true }
      if (v.dashboard_path) dash.path = v.dashboard_path
      if (v.dashboard_download_url) dash.download_url = v.dashboard_download_url
      if (v.dashboard_update_interval) dash.update_interval = v.dashboard_update_interval
      config.dashboard = dash
    }

    setSaving(true)
    try {
      const body = { tag: v.tag, type: v.type, enabled: v.enabled, config }
      if (editing) {
        await api.put(`/services/${editing.id}`, body)
      } else {
        await api.post('/services', body)
      }
      message.success('已保存并应用')
      setModalOpen(false)
      load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (sv: Service) => {
    try {
      await api.del(`/services/${sv.id}`)
      message.success('已删除')
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const toggleEnabled = async (sv: Service, enabled: boolean) => {
    try {
      await api.put(`/services/${sv.id}`, { enabled })
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const summary = (sv: Service) => {
    const cfg = sv.config
    const parts: string[] = []
    if (typeof cfg.listen === 'string' && cfg.listen) parts.push(cfg.listen)
    if (typeof cfg.listen_port === 'number') parts.push(String(cfg.listen_port))
    const dash = cfg.dashboard as Record<string, unknown> | undefined
    if (dash && dash.enabled) parts.push('Dashboard')
    return parts.length ? parts.join(' : ') : '-'
  }

  return (
    <Card
      title="服务管理"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} size="small">
            刷新
          </Button>
          <Button color="primary" variant="solid" icon={<PlusOutlined />} size="small" onClick={openCreate}>
            新建服务
          </Button>
        </Space>
      }
    >
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        sing-box 服务（顶层 <Text code>services</Text>）。sing-box 1.14 起提供 gRPC API 服务，
        可配合 sing-box Dashboard 或图形客户端远程查看状态、日志与连接。
      </Paragraph>
      <Table<Service>
        rowKey="id"
        loading={loading}
        dataSource={list}
        pagination={false}
        columns={[
          { title: 'Tag', dataIndex: 'tag', width: 180 },
          {
            title: '类型',
            dataIndex: 'type',
            width: 120,
            render: (v: string) => (
              <Tag color={typeColor[v] ?? 'default'} style={{ margin: 0 }}>
                {v}
              </Tag>
            ),
          },
          { title: '概要', render: (_, sv) => <Text style={{ fontSize: 12 }}>{summary(sv)}</Text> },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 80,
            render: (v: boolean, r: Service) => <Switch size="small" checked={v} onChange={(nv) => toggleEnabled(r, nv)} />,
          },
          {
            title: '更新时间',
            dataIndex: 'updated_at',
            width: 160,
            render: (v: string) => <Text type="secondary">{dayjs(v).format('MM-DD HH:mm')}</Text>,
          },
          {
            title: '操作',
            width: 130,
            render: (_: unknown, r: Service) => (
              <Space size={4}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                <Popconfirm title={`删除服务 ${r.tag}？`} onConfirm={() => remove(r)}>
                  <Button size="small" type="text" color="danger" icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `编辑服务 - ${editing.tag}` : '新建服务'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Row gutter={16}>
            <Col span={10}>
              <Form.Item name="tag" label="Tag" rules={[{ required: true, message: '请输入 Tag' }]}>
                <Input placeholder="如 sing-box-api" allowClear />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                <Select options={TYPES} disabled={!!editing} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          {type === 'api' && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="listen" label="监听地址" tooltip="默认 :: 表示同时监听 IPv4 与 IPv6">
                    <Input placeholder="::" allowClear />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="listen_port"
                    label="监听端口"
                    rules={[{ required: true, message: '请输入端口' }]}
                    tooltip="gRPC / gRPC-Web 监听端口，注意不要与面板端口冲突"
                  >
                    <InputNumber min={1} max={65535} controls={false} style={{ width: '100%' }} placeholder="如 9090" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="API 密钥（可选）" tooltip="客户端通过 Authorization: Bearer <secret> 认证；留空则无需认证">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="secret" noStyle>
                    <Input.Password placeholder="留空无需认证" allowClear />
                  </Form.Item>
                  <Button icon={<KeyOutlined />} onClick={genSecret}>
                    生成
                  </Button>
                </Space.Compact>
              </Form.Item>
              <Row gutter={16}>
                <Col span={14}>
                  <Form.Item
                    name="allow_origins"
                    label="CORS 允许来源（可选）"
                    tooltip="回车添加；留空默认允许所有来源（*）"
                  >
                    <Select mode="tags" open={false} placeholder="如 https://dashboard.example.com" />
                  </Form.Item>
                </Col>
                <Col span={10}>
                  <Form.Item
                    name="allow_private_network"
                    label="允许私有网络访问"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Col>
              </Row>

              <Divider style={{ margin: '8px 0 16px' }} titlePlacement="left">
                <Space size={8}>
                  <span style={{ fontSize: 13 }}>Dashboard 托管</span>
                  <Form.Item name="dashboard_enabled" valuePropName="checked" noStyle>
                    <Switch size="small" />
                  </Form.Item>
                </Space>
              </Divider>
              {dashboardEnabled && (
                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item
                      name="dashboard_path"
                      label="文件目录（可选）"
                      tooltip="存放 Dashboard 静态文件的目录，留空使用工作目录下的 dashboard/"
                    >
                      <Input placeholder="dashboard" allowClear />
                    </Form.Item>
                  </Col>
                  <Col span={9}>
                    <Form.Item name="dashboard_download_url" label="下载地址（可选）" tooltip="Dashboard zip 包地址">
                      <Input placeholder="官方 gh-pages" allowClear />
                    </Form.Item>
                  </Col>
                  <Col span={7}>
                    <Form.Item name="dashboard_update_interval" label="更新间隔（可选）">
                      <Input placeholder="1d" allowClear />
                    </Form.Item>
                  </Col>
                </Row>
              )}

              <Form.Item name="extra" label="额外字段（JSON 对象，合并进配置，可选）">
                <Input.TextArea rows={3} placeholder='如 {"tls": {...}}' />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Card>
  )
}
