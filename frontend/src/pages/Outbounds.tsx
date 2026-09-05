import { useCallback, useEffect, useState } from 'react'
import { Card, Table, Button, Space, Switch, Tag, Popconfirm, Modal, Form, Input, InputNumber, Select, App as AntdApp, Typography, Row, Col } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, KeyOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import type { Outbound } from '../api/types'
import { parseExtraJSON } from '../utils/format'
import dayjs from 'dayjs'

const { Text, Paragraph } = Typography

const TYPES = [
  { label: 'direct（直连）', value: 'direct' },
  { label: 'block（阻断）', value: 'block' },
  { label: 'shadowsocks（SS 链式代理）', value: 'shadowsocks' },
  { label: 'socks（SOCKS 链式代理）', value: 'socks' },
  { label: 'snell（Snell 链式代理，1.14+）', value: 'snell' },
]

const SS_METHODS = [
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
]

const typeColor: Record<string, string> = {
  direct: 'green',
  block: 'red',
  shadowsocks: 'blue',
  socks: 'geekblue',
  snell: 'cyan',
}

interface FormValues {
  tag: string
  type: string
  enabled: boolean
  // shadowsocks / socks / snell
  server?: string
  server_port?: number
  method?: string
  password?: string
  version?: string // socks 版本
  snell_version?: number // snell 协议版本
  psk?: string
  mode?: string // snell v6
  obfs_mode?: string // snell v5
  username?: string
  network?: string
  extra?: string
}

export default function Outbounds() {
  const { message } = AntdApp.useApp()
  const [list, setList] = useState<Outbound[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Outbound | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<FormValues>()
  const type = Form.useWatch('type', form)
  const snellVersion = Form.useWatch('snell_version', form)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(await api.get<Outbound[]>('/outbounds'))
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
      type: 'shadowsocks',
      enabled: true,
      method: '2022-blake3-aes-256-gcm',
      version: '5',
      network: undefined,
    })
    setModalOpen(true)
  }

  const openEdit = (ob: Outbound) => {
    setEditing(ob)
    const cfg = ob.config
    // 把已知字段抽出来，剩余的放进 extra JSON
    const known = new Set([
      'server', 'server_port', 'method', 'password', 'version', 'username', 'network', 'psk', 'mode', 'obfs_mode',
    ])
    const rest: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cfg)) {
      if (!known.has(k)) rest[k] = v
    }
    form.setFieldsValue({
      tag: ob.tag,
      type: ob.type,
      enabled: ob.enabled,
      server: typeof cfg.server === 'string' ? cfg.server : undefined,
      server_port: typeof cfg.server_port === 'number' ? cfg.server_port : undefined,
      method: typeof cfg.method === 'string' ? cfg.method : undefined,
      password: typeof cfg.password === 'string' ? cfg.password : undefined,
      version: typeof cfg.version === 'string' ? cfg.version : undefined,
      snell_version: typeof cfg.version === 'number' ? cfg.version : undefined,
      psk: typeof cfg.psk === 'string' ? cfg.psk : undefined,
      mode: typeof cfg.mode === 'string' ? cfg.mode : undefined,
      obfs_mode: typeof cfg.obfs_mode === 'string' ? cfg.obfs_mode : undefined,
      username: typeof cfg.username === 'string' ? cfg.username : undefined,
      network: typeof cfg.network === 'string' ? cfg.network : undefined,
      extra: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : undefined,
    })
    setModalOpen(true)
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
    if (v.type === 'shadowsocks') {
      config.server = v.server
      config.server_port = v.server_port
      config.method = v.method
      config.password = v.password
    } else if (v.type === 'socks') {
      config.server = v.server
      config.server_port = v.server_port
      if (v.version) config.version = v.version
      if (v.username) config.username = v.username
      if (v.password) config.password = v.password
    } else if (v.type === 'snell') {
      config.server = v.server
      config.server_port = v.server_port
      config.version = v.snell_version
      config.psk = v.psk
      if (v.snell_version === 5) {
        if (v.obfs_mode) config.obfs_mode = v.obfs_mode
      } else if (v.mode) {
        config.mode = v.mode
      }
    }
    if (v.network) config.network = v.network

    setSaving(true)
    try {
      const body = { tag: v.tag, type: v.type, enabled: v.enabled, config }
      if (editing) {
        await api.put(`/outbounds/${editing.id}`, body)
      } else {
        await api.post('/outbounds', body)
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

  const remove = async (ob: Outbound) => {
    try {
      await api.del(`/outbounds/${ob.id}`)
      message.success('已删除')
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const toggleEnabled = async (ob: Outbound, enabled: boolean) => {
    try {
      await api.put(`/outbounds/${ob.id}`, { enabled })
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const summary = (ob: Outbound) => {
    const cfg = ob.config
    if (ob.type === 'direct' || ob.type === 'block') return '-'
    const parts: string[] = []
    if (typeof cfg.server === 'string') parts.push(cfg.server)
    if (typeof cfg.server_port === 'number') parts.push(String(cfg.server_port))
    if (typeof cfg.method === 'string') parts.push(cfg.method)
    if (typeof cfg.version === 'string') parts.push('v' + cfg.version)
    if (typeof cfg.version === 'number') parts.push('v' + cfg.version)
    return parts.join(' : ')
  }

  const genSnellPSK = async () => {
    try {
      const r = await api.get<{ psk: string }>('/tools/snell-psk')
      form.setFieldsValue({ psk: r.psk })
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  return (
    <Card
      title="出站管理"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} size="small">
            刷新
          </Button>
          <Button color="primary" variant="solid" icon={<PlusOutlined />} size="small" onClick={openCreate}>
            新建出站
          </Button>
        </Space>
      }
    >
      <Table<Outbound>
        rowKey="id"
        loading={loading}
        dataSource={list}
        pagination={false}
        columns={[
          { title: 'Tag', dataIndex: 'tag', width: 180 },
          {
            title: '类型',
            dataIndex: 'type',
            width: 140,
            render: (v: string) => (
              <Tag color={typeColor[v] ?? 'default'} style={{ margin: 0 }}>
                {v}
              </Tag>
            ),
          },
          {
            title: '概要',
            render: (_, ob) => <Text style={{ fontSize: 12 }}>{summary(ob)}</Text>,
          },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 80,
            render: (v: boolean, r: Outbound) => <Switch size="small" checked={v} onChange={(nv) => toggleEnabled(r, nv)} />,
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
            render: (_: unknown, r: Outbound) => (
              <Space size={4}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                <Popconfirm title={`删除出站 ${r.tag}？`} onConfirm={() => remove(r)}>
                  <Button size="small" type="text" color="danger" icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `编辑出站 - ${editing.tag}` : '新建出站'}
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
                <Input placeholder="如 chain-socks" allowClear />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                <Select
                  options={TYPES}
                  disabled={!!editing}
                  onChange={(v) => {
                    if (v === 'snell') form.setFieldsValue({ snell_version: 6, mode: undefined, obfs_mode: undefined })
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          {(type === 'shadowsocks' || type === 'socks' || type === 'snell') && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="server" label="服务器地址" rules={[{ required: true, message: '请输入服务器地址' }]}>
                    <Input placeholder="上游代理地址" allowClear />
                  </Form.Item>
                </Col>
                <Col span={type === 'snell' ? 12 : 6}>
                  <Form.Item name="server_port" label="端口" rules={[{ required: true, message: '请输入端口' }]}>
                    <InputNumber min={1} max={65535} controls={false} style={{ width: '100%' }} placeholder="端口" />
                  </Form.Item>
                </Col>
                {type !== 'snell' && (
                  <Col span={6}>
                    <Form.Item name="network" label="网络（可选）">
                      <Select
                        allowClear
                        placeholder="默认"
                        options={[
                          { label: 'TCP', value: 'tcp' },
                          { label: 'UDP', value: 'udp' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                )}
              </Row>
              {type === 'shadowsocks' && (
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="method" label="加密方式" rules={[{ required: true, message: '请选择加密方式' }]}>
                      <Select options={SS_METHODS.map((m) => ({ label: m, value: m }))} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                      <Input.Password placeholder="密码" allowClear />
                    </Form.Item>
                  </Col>
                </Row>
              )}
              {type === 'socks' && (
                <Row gutter={16}>
                  <Col span={6}>
                    <Form.Item name="version" label="SOCKS 版本">
                      <Select
                        allowClear
                        placeholder="v5"
                        options={['5', '4a', '4'].map((v) => ({ label: 'v' + v, value: v }))}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={9}>
                    <Form.Item name="username" label="用户名（可选）">
                      <Input placeholder="用户名" allowClear />
                    </Form.Item>
                  </Col>
                  <Col span={9}>
                    <Form.Item name="password" label="密码（可选）">
                      <Input.Password placeholder="密码" allowClear />
                    </Form.Item>
                  </Col>
                </Row>
              )}
              {type === 'snell' && (
                <Row gutter={16}>
                  <Col span={6}>
                    <Form.Item name="snell_version" label="协议版本" rules={[{ required: true, message: '请选择版本' }]}>
                      <Select
                        options={[
                          { label: 'v6', value: 6 },
                          { label: 'v5', value: 5 },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={18}>
                    <Form.Item
                      name={snellVersion === 5 ? 'obfs_mode' : 'mode'}
                      label={snellVersion === 5 ? '混淆模式 obfs_mode' : '流量整形 mode'}
                    >
                      <Select
                        allowClear
                        placeholder={snellVersion === 5 ? '默认 none' : '默认 default'}
                        options={
                          snellVersion === 5
                            ? [
                                { label: 'none', value: 'none' },
                                { label: 'http', value: 'http' },
                              ]
                            : [
                                { label: 'default', value: 'default' },
                                { label: 'unshaped', value: 'unshaped' },
                                { label: 'unsafe-raw', value: 'unsafe-raw' },
                              ]
                        }
                      />
                    </Form.Item>
                  </Col>
                </Row>
              )}
              {type === 'snell' && (
                <Form.Item
                  name="psk"
                  label="预共享密钥 PSK"
                  rules={[{ required: true, message: '请输入 PSK' }]}
                >
                  <Input.Password
                    placeholder="服务端 psk 或用户 userkey"
                    allowClear
                    suffix={<Button type="text" size="small" icon={<KeyOutlined />} onClick={genSnellPSK} />}
                  />
                </Form.Item>
              )}
              <Form.Item name="extra" label="额外字段（JSON 对象，合并进配置，可选）">
                <Input.TextArea rows={3} placeholder='如 {"udp_over_tcp": true}' />
              </Form.Item>
            </>
          )}
          {(type === 'direct' || type === 'block') && (
            <Paragraph type="secondary" style={{ marginTop: 8 }}>
              {type === 'direct' ? '直连出站，无额外配置。' : '阻断出站，无额外配置。'}
            </Paragraph>
          )}
        </Form>
      </Modal>
    </Card>
  )
}
