import { useEffect, useState } from 'react'
import { Modal, Form, Input, InputNumber, Select, Space, Switch, Button, Row, Col, App as AntdApp, Typography, Alert } from 'antd'
import { KeyOutlined, PlusOutlined, MinusCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import type { Inbound } from '../api/types'

const { Text } = Typography

const SS_METHODS = [
  { label: '2022-blake3-aes-128-gcm（推荐）', value: '2022-blake3-aes-128-gcm' },
  { label: '2022-blake3-aes-256-gcm（推荐）', value: '2022-blake3-aes-256-gcm' },
  { label: '2022-blake3-chacha20-poly1305', value: '2022-blake3-chacha20-poly1305' },
  { label: 'aes-128-gcm（传统，单密码）', value: 'aes-128-gcm' },
  { label: 'aes-256-gcm（传统，单密码）', value: 'aes-256-gcm' },
  { label: 'chacha20-ietf-poly1305（传统，单密码）', value: 'chacha20-ietf-poly1305' },
]

const SS2022 = new Set(['2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305'])

export interface InboundFormValues {
  tag: string
  type: 'shadowsocks' | 'vless'
  listen: string
  port: number
  enabled: boolean
  // shadowsocks
  method?: string
  password?: string
  network?: string
  // vless
  flow?: string
  server_name?: string
  handshake_server?: string
  handshake_port?: number // 编辑时保留原值，表单不再展示，默认 443
  private_key?: string
  short_id?: string[]
  max_time_difference?: string
  // multiplex
  multiplex?: boolean
  multiplex_padding?: boolean
  // 创建时内联携带的初始客户端
  clients?: Array<{ name: string; credential?: string; enabled?: boolean }>
}

interface Props {
  open: boolean
  editing: Inbound | null
  onClose: () => void
  onSaved: () => void
}

export default function InboundForm({ open, editing, onClose, onSaved }: Props) {
  const { message } = AntdApp.useApp()
  const [form] = Form.useForm<InboundFormValues>()
  const [loading, setLoading] = useState(false)
  const [type, setType] = useState<'shadowsocks' | 'vless'>('shadowsocks')
  const [pubKey, setPubKey] = useState('')

  const privateKey = Form.useWatch('private_key', form)
  const method = Form.useWatch('method', form)
  const multiplex = Form.useWatch('multiplex', form)

  useEffect(() => {
    if (open) {
      setPubKey('')
      if (editing) {
        setType(editing.type)
        const cfg = editing.config
        const tls = cfg.tls as Record<string, unknown> | undefined
        const reality = tls?.reality as Record<string, unknown> | undefined
        const handshake = reality?.handshake as Record<string, unknown> | undefined
        const multiplex = cfg.multiplex as Record<string, unknown> | undefined
        form.setFieldsValue({
          tag: editing.tag,
          type: editing.type,
          listen: editing.listen,
          port: editing.port,
          enabled: editing.enabled,
          method: typeof cfg.method === 'string' ? cfg.method : undefined,
          password: typeof cfg.password === 'string' ? cfg.password : undefined,
          network: typeof cfg.network === 'string' ? cfg.network : undefined,
          flow: typeof cfg.flow === 'string' ? cfg.flow : undefined,
          server_name: typeof tls?.server_name === 'string' ? tls.server_name : undefined,
          handshake_server: typeof handshake?.server === 'string' ? handshake.server : undefined,
          handshake_port: typeof handshake?.server_port === 'number' ? handshake.server_port : undefined,
          private_key: typeof reality?.private_key === 'string' ? reality.private_key : undefined,
          short_id: Array.isArray(reality?.short_id) ? reality?.short_id.map(String) : [],
          max_time_difference:
            typeof reality?.max_time_difference === 'string' ? reality.max_time_difference : undefined,
          multiplex: Boolean(multiplex?.enabled),
          multiplex_padding: Boolean(multiplex?.padding),
        })
      } else {
        setType('shadowsocks')
        form.resetFields()
        form.setFieldsValue({
          type: 'shadowsocks',
          listen: '::',
          enabled: true,
          method: '2022-blake3-aes-256-gcm',
        })
      }
    }
  }, [open, editing, form])

  // 私钥变化时自动推导公钥（仅 VLESS）
  useEffect(() => {
    if (type !== 'vless' || !privateKey) {
      setPubKey('')
      return
    }
    let cancelled = false
    api
      .get<{ public_key: string }>('/tools/reality-pubkey', { private_key: privateKey })
      .then((r) => {
        if (!cancelled) setPubKey(r.public_key)
      })
      .catch(() => {
        if (!cancelled) setPubKey('')
      })
    return () => {
      cancelled = true
    }
  }, [privateKey, type])

  // 创建 VLESS 入站时自动预填一个客户端（VLESS 必须至少一个客户端才能生成有效配置）
  useEffect(() => {
    if (open && !editing && type === 'vless') {
      const cur = form.getFieldValue('clients') as Array<unknown> | undefined
      if (!cur || cur.length === 0) {
        form.setFieldsValue({ clients: [{ name: 'client-1', enabled: true }] })
      }
    }
  }, [open, editing, type, form])

  const genSSKey = async () => {
    if (!method) return
    try {
      const r = await api.get<{ key: string }>('/tools/ss-key', { method })
      form.setFieldsValue({ password: r.key })
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const genKeypair = async () => {
    try {
      const r = await api.get<{ private_key: string }>('/tools/reality-keypair')
      form.setFieldsValue({ private_key: r.private_key }) // 公钥由推导 effect 自动填充
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const genShortID = async () => {
    try {
      const r = await api.get<{ short_id: string }>('/tools/short-id')
      const cur = (form.getFieldValue('short_id') as string[] | undefined) ?? []
      form.setFieldsValue({ short_id: [...cur, r.short_id] })
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const genPort = () => {
    form.setFieldsValue({ port: Math.floor(10000 + Math.random() * 55000) })
  }

  const buildConfig = (v: InboundFormValues): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {}
    if (v.multiplex) {
      cfg.multiplex = { enabled: true, ...(v.multiplex_padding ? { padding: true } : {}) }
    }
    if (v.network) cfg.network = v.network

    if (v.type === 'shadowsocks') {
      cfg.method = v.method
      cfg.password = v.password
    } else {
      if (v.flow) cfg.flow = v.flow
      cfg.tls = {
        enabled: true,
        server_name: v.server_name,
        reality: {
          enabled: true,
          handshake: { server: v.handshake_server, server_port: v.handshake_port ?? 443 },
          private_key: v.private_key,
          short_id: v.short_id ?? [],
          ...(v.max_time_difference ? { max_time_difference: v.max_time_difference } : {}),
        },
      }
    }
    return cfg
  }

  const onFinish = async (v: InboundFormValues) => {
    // 创建模式：整理内联客户端
    const inlineClients = (v.clients ?? []).filter((c) => c && c.name && c.name.trim())
    if (!editing && v.type === 'vless' && inlineClients.length === 0) {
      message.error('VLESS 入站需要至少一个客户端，请在下方添加')
      return
    }

    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        tag: v.tag,
        type: v.type,
        listen: v.listen,
        port: v.port,
        enabled: v.enabled,
        config: buildConfig(v),
      }
      if (!editing && inlineClients.length > 0) {
        body.clients = inlineClients.map((c) => ({
          name: c.name.trim(),
          credential: c.credential || '',
          enabled: c.enabled ?? true,
        }))
      }
      if (editing) {
        await api.put(`/inbounds/${editing.id}`, body)
      } else {
        await api.post('/inbounds', body)
      }
      message.success('已保存并应用')
      onSaved()
      onClose()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={editing ? '编辑入站' : '新建入站'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={loading}
      width={720}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        {/* 基本信息 */}
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item name="tag" label="Tag" rules={[{ required: true }]} style={{ marginRight: 0 }}>
              <Input placeholder="如 vless-in" />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="type" label="协议" rules={[{ required: true }]}>
              <Select
                disabled={!!editing}
                options={[
                  { label: 'Shadowsocks', value: 'shadowsocks' },
                  { label: 'VLESS', value: 'vless' },
                ]}
                onChange={(v) => setType(v)}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="端口" required>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name="port" noStyle rules={[{ required: true }]}>
                  <InputNumber min={1} max={65535} style={{ width: 'calc(100% - 64px)' }} />
                </Form.Item>
                <Button icon={<ReloadOutlined />} onClick={genPort} style={{ width: 64 }}>
                  随机
                </Button>
              </Space.Compact>
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="listen" label="监听" initialValue="::">
              <Input placeholder="::" />
            </Form.Item>
          </Col>
          <Col span={3}>
            <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
              <Switch />
            </Form.Item>
          </Col>
        </Row>

        {/* Shadowsocks */}
        {type === 'shadowsocks' && (
          <>
            <Row gutter={16}>
              <Col span={10}>
                <Form.Item name="method" label="加密方式" rules={[{ required: true }]}>
                  <Select options={SS_METHODS} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="network" label="网络（可选）">
                  <Select allowClear options={[{ label: 'tcp', value: 'tcp' }, { label: 'udp', value: 'udp' }]} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label={SS2022.has(method ?? '') ? '服务端密钥（2022 系必填）' : '密码'} required>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name="password" noStyle rules={[{ required: true, message: '请填写密码/密钥' }]}>
                  <Input style={{ width: 'calc(100% - 76px)' }} placeholder="2022 系需定长 base64 密钥" />
                </Form.Item>
                <Button icon={<KeyOutlined />} onClick={genSSKey} style={{ width: 76 }}>
                  生成
                </Button>
              </Space.Compact>
            </Form.Item>
          </>
        )}

        {/* VLESS Reality */}
        {type === 'vless' && (
          <>
            <Row gutter={16}>
              <Col span={6}>
                <Form.Item name="flow" label="Flow">
                  <Select allowClear placeholder="可选" options={[{ label: 'xtls-rprx-vision', value: 'xtls-rprx-vision' }]} />
                </Form.Item>
              </Col>
              <Col span={9}>
                <Form.Item name="server_name" label="SNI（server_name）" rules={[{ required: true, message: '必填' }]}>
                  <Input placeholder="如 www.microsoft.com" />
                </Form.Item>
              </Col>
              <Col span={9}>
                <Form.Item name="handshake_server" label="握手目标" rules={[{ required: true, message: '必填' }]}>
                  <Input placeholder="如 www.microsoft.com（端口固定 443）" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Private Key" required>
                  <Space.Compact style={{ width: '100%' }}>
                    <Form.Item name="private_key" noStyle rules={[{ required: true, message: '需要 Reality 私钥' }]}>
                      <Input style={{ width: 'calc(100% - 116px)' }} placeholder="X25519 私钥" />
                    </Form.Item>
                    <Button icon={<KeyOutlined />} onClick={genKeypair} style={{ width: 116 }}>
                      生成密钥对
                    </Button>
                  </Space.Compact>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Public Key（客户端用，自动推导）">
                  <Input value={pubKey} readOnly placeholder="由私钥自动推导" suffix={pubKey ? <Text copyable={{ text: pubKey }} /> : undefined} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="short_id" label="Short ID（可多个）" rules={[{ required: true, message: '至少一个 short_id' }]}>
              <Select
                mode="tags"
                open={false}
                placeholder="回车添加，0-8 位十六进制"
                suffixIcon={
                  <Button type="text" size="small" icon={<PlusOutlined />} onClick={genShortID}>
                    随机
                  </Button>
                }
              />
            </Form.Item>
          </>
        )}

        {/* 多路复用 */}
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item name="multiplex" label="多路复用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
          {multiplex && (
            <Col span={6}>
              <Form.Item name="multiplex_padding" label="填充 (padding)" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          )}
        </Row>

        {/* 初始客户端（仅创建模式） */}
        {!editing && (
          <>
            <Typography.Title level={5} style={{ marginTop: 8, marginBottom: 8 }}>
              初始客户端
            </Typography.Title>
            <Form.List name="clients">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Row key={key} gutter={8} align="middle">
                      <Col span={7}>
                        <Form.Item
                          {...restField}
                          name={[name, 'name']}
                          rules={[{ required: true, message: '名称必填' }]}
                          style={{ marginRight: 0 }}
                        >
                          <Input placeholder="客户端名称" />
                        </Form.Item>
                      </Col>
                      <Col span={13}>
                        <Form.Item {...restField} name={[name, 'credential']} style={{ marginRight: 0 }}>
                          <Input placeholder={type === 'vless' ? 'UUID（留空自动生成）' : '密钥（留空自动生成）'} />
                        </Form.Item>
                      </Col>
                      <Col span={3}>
                        <Form.Item {...restField} name={[name, 'enabled']} valuePropName="checked" initialValue={true} style={{ marginRight: 0 }}>
                          <Switch size="small" />
                        </Form.Item>
                      </Col>
                      <Col span={1}>
                        <Button
                          type="text"
                          color="danger"
                          icon={<MinusCircleOutlined />}
                          onClick={() => remove(name)}
                          disabled={type === 'vless' && fields.length === 1}
                        />
                      </Col>
                    </Row>
                  ))}
                  <Button size="small" icon={<PlusOutlined />} onClick={() => add({ name: '', enabled: true })} style={{ marginBottom: 8 }}>
                    添加客户端
                  </Button>
                </>
              )}
            </Form.List>
          </>
        )}
        {editing && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title="客户端管理：保存后回到入站列表，点击行首展开箭头或「客户端」数量即可添加/编辑/分享客户端"
          />
        )}

        <Text type="secondary" style={{ fontSize: 12 }}>
          保存后将自动生成 sing-box 配置并重启核心，校验失败会保留原配置。
        </Text>
      </Form>
    </Modal>
  )
}
