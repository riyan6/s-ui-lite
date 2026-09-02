import { useEffect, useState, type ReactNode } from 'react'
import { Modal, Form, Input, InputNumber, Select, Space, Switch, Button, Row, Col, App as AntdApp, Typography, Tooltip, Tag, Alert } from 'antd'
import {
  KeyOutlined,
  PlusOutlined,
  MinusCircleOutlined,
  ThunderboltOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
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
  // 创建时内联携带的初始客户端（客户端一律启用，无启用开关）
  clients?: Array<{ name: string; credential?: string }>
}

interface Props {
  open: boolean
  editing: Inbound | null
  onClose: () => void
  onSaved: () => void
}

/** 统一的分组标题：左侧色块 + 文字 */
function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        margin: '4px 0 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            width: 3,
            height: 14,
            background: 'var(--ant-color-primary)',
            borderRadius: 2,
            marginRight: 8,
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{children}</span>
      </div>
      {extra && <div>{extra}</div>}
    </div>
  )
}

/**
 * 内嵌在输入框内部的后缀图标按钮。
 * 统一用于「随机端口 / 生成密钥对 / 随机 Short ID」，点击后直接把结果填回所在输入框。
 */
function SuffixAction({ title, icon, onClick }: { title: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip title={title}>
      <span
        role="button"
        tabIndex={0}
        aria-label={title}
        onClick={(e) => {
          // 阻止冒泡，避免触发 Select 等控件的下拉展开
          e.preventDefault()
          e.stopPropagation()
          onClick()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: 4,
          cursor: 'pointer',
          color: 'var(--ant-color-text-tertiary)',
          // Select 的箭头容器默认 pointer-events: none，需显式开启才可被点击
          pointerEvents: 'auto',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--ant-color-primary)'
          e.currentTarget.style.background = 'var(--ant-color-fill-secondary)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--ant-color-text-tertiary)'
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {icon}
      </span>
    </Tooltip>
  )
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
        form.setFieldsValue({ clients: [{ name: 'client-1' }] })
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

  const isSS2022 = SS2022.has(method ?? '')

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
        {/* ============== 基本信息 ============== */}
        <SectionTitle>基本信息</SectionTitle>
        <Row gutter={16}>
          <Col span={10}>
            <Form.Item name="tag" label="Tag" rules={[{ required: true, message: '请输入 Tag' }]}>
              <Input placeholder="如 vless-in" allowClear />
            </Form.Item>
          </Col>
          <Col span={8}>
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
            <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
              <Switch />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={10}>
            <Form.Item name="listen" label="监听地址" initialValue="::" tooltip="默认 :: 表示同时监听 IPv4 与 IPv6">
              <Input placeholder="::" allowClear />
            </Form.Item>
          </Col>
          <Col span={14}>
            <Form.Item
              name="port"
              label="监听端口"
              rules={[{ required: true, message: '请输入端口' }]}
              tooltip="1 - 65535，点击输入框内右侧图标可随机生成"
            >
              <InputNumber
                min={1}
                max={65535}
                style={{ width: '100%' }}
                placeholder="10000 - 65535"
                suffix={<SuffixAction title="随机生成端口" icon={<ThunderboltOutlined />} onClick={genPort} />}
              />
            </Form.Item>
          </Col>
        </Row>

        {/* ============== 协议配置 ============== */}
        <SectionTitle>{type === 'shadowsocks' ? 'Shadowsocks 配置' : 'VLESS Reality 配置'}</SectionTitle>

        {type === 'shadowsocks' ? (
          <>
            <Row gutter={16}>
              <Col span={14}>
                <Form.Item
                  name="method"
                  label="加密方式"
                  rules={[{ required: true, message: '请选择加密方式' }]}
                  tooltip="推荐使用 2022 系列，更安全且抗审计"
                >
                  <Select options={SS_METHODS} />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name="network" label="传输网络" tooltip="留空则同时使用 TCP 与 UDP">
                  <Select
                    allowClear
                    placeholder="默认 TCP + UDP"
                    options={[
                      { label: 'TCP', value: 'tcp' },
                      { label: 'UDP', value: 'udp' },
                    ]}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="password"
              label={isSS2022 ? '服务端密钥（2022 系必填）' : '密码'}
              rules={[{ required: true, message: '请填写密钥/密码' }]}
              tooltip={
                isSS2022
                  ? '2022 系密钥为定长 base64，点击输入框内右侧图标可随机生成'
                  : '客户端连接所需的密码，点击输入框内右侧图标可随机生成'
              }
            >
              <Input
                placeholder={isSS2022 ? '定长 base64 密钥' : '任意字符串'}
                allowClear
                suffix={<SuffixAction title="随机生成密钥" icon={<KeyOutlined />} onClick={genSSKey} />}
              />
            </Form.Item>
          </>
        ) : (
          <>
            <Row gutter={16}>
              <Col span={6}>
                <Form.Item name="flow" label="Flow" tooltip="推荐 xtls-rprx-vision，开启后支持多路复用">
                  <Select
                    allowClear
                    placeholder="可选"
                    options={[{ label: 'xtls-rprx-vision', value: 'xtls-rprx-vision' }]}
                  />
                </Form.Item>
              </Col>
              <Col span={9}>
                <Form.Item
                  name="server_name"
                  label="SNI"
                  rules={[{ required: true, message: '请输入 SNI' }]}
                  tooltip="TLS 握手时使用的域名，需是握手目标支持的合法证书域"
                >
                  <Input placeholder="如 www.microsoft.com" allowClear />
                </Form.Item>
              </Col>
              <Col span={9}>
                <Form.Item
                  name="handshake_server"
                  label="握手目标"
                  rules={[{ required: true, message: '请输入握手目标' }]}
                  tooltip="用于 TLS 握手转发的目标域名，端口固定 443"
                >
                  <Input
                    placeholder="如 www.microsoft.com"
                    allowClear
                    suffix={
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        :443
                      </Text>
                    }
                  />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="private_key"
                  label="Private Key（Reality 私钥）"
                  rules={[{ required: true, message: '需要 Reality 私钥' }]}
                  tooltip="X25519 私钥，与客户端的 Public Key 配对使用；点击输入框内右侧图标可随机生成密钥对"
                >
                  <Input
                    placeholder="X25519 私钥"
                    allowClear
                    suffix={
                      <SuffixAction title="随机生成密钥对" icon={<KeyOutlined />} onClick={genKeypair} />
                    }
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Public Key" tooltip="由私钥自动推导，供客户端配置使用">
                  <Input
                    value={pubKey}
                    readOnly
                    placeholder={privateKey ? '推导中…' : '填写私钥后自动生成'}
                    status={pubKey ? undefined : privateKey ? 'warning' : undefined}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="short_id"
              label={
                <Space size={6}>
                  <span>Short ID</span>
                  <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                    回车添加，0-8 位十六进制
                  </Text>
                </Space>
              }
              rules={[{ required: true, message: '至少一个 Short ID' }]}
            >
              <Select
                mode="tags"
                open={false}
                placeholder="回车输入 Hex 短 ID"
                suffixIcon={
                  <SuffixAction
                    title="随机生成一个 Short ID"
                    icon={<PlusOutlined />}
                    onClick={genShortID}
                  />
                }
                tagRender={(props) => {
                  const { label, closable, onClose } = props
                  return (
                    <Tag
                      closable={closable}
                      onClose={onClose}
                      style={{ marginInlineEnd: 4, fontFamily: 'monospace' }}
                    >
                      {label}
                    </Tag>
                  )
                }}
              />
            </Form.Item>
          </>
        )}

        {/* ============== 多路复用 ============== */}
        <SectionTitle
          extra={
            <Form.Item name="multiplex" valuePropName="checked" noStyle>
              <Switch size="small" />
            </Form.Item>
          }
        >
          <Space size={8}>
            <span>多路复用</span>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
              在单条 TCP 连接上并发传输多条数据流
            </Text>
          </Space>
        </SectionTitle>
        {multiplex && (
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="multiplex_padding"
                label="启用填充 (padding)"
                valuePropName="checked"
                tooltip="为每个数据包填充随机字节以混淆流量特征"
              >
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        )}

        {/* ============== 初始客户端 ============== */}
        {!editing && (
          <>
            <SectionTitle extra={<Text type="secondary" style={{ fontSize: 12 }}>保存后将随入站一并创建</Text>}>
              初始客户端
            </SectionTitle>
            <div
              style={{
                padding: 12,
                background: 'var(--ant-color-fill-quaternary)',
                borderRadius: 6,
                border: '1px dashed var(--ant-color-border-secondary)',
              }}
            >
              <Form.List name="clients">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <Row key={key} gutter={12} align="middle" style={{ marginBottom: 10 }}>
                        <Col span={11}>
                          <Form.Item
                            {...restField}
                            name={[name, 'name']}
                            rules={[{ required: true, message: '名称必填' }]}
                            noStyle
                          >
                            <Input placeholder="客户端名称" />
                          </Form.Item>
                        </Col>
                        <Col span={11}>
                          <Form.Item {...restField} name={[name, 'credential']} noStyle>
                            <Input
                              placeholder={
                                type === 'vless' ? 'UUID（留空自动生成）' : '密钥（留空自动生成）'
                              }
                            />
                          </Form.Item>
                        </Col>
                        <Col span={2} style={{ textAlign: 'center' }}>
                          <Tooltip
                            title={
                              type === 'vless' && fields.length === 1
                                ? 'VLESS 入站至少保留一个客户端'
                                : '删除该客户端'
                            }
                          >
                            <Button
                              type="text"
                              danger
                              icon={<MinusCircleOutlined />}
                              onClick={() => remove(name)}
                              disabled={type === 'vless' && fields.length === 1}
                            />
                          </Tooltip>
                        </Col>
                      </Row>
                    ))}
                    {fields.length === 0 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        暂无客户端，点击下方按钮添加（留空凭证将由后端自动生成）
                      </Text>
                    )}
                    <Button
                      size="small"
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={() => add({ name: '' })}
                      block
                      style={{ marginTop: 4 }}
                    >
                      添加客户端
                    </Button>
                  </>
                )}
              </Form.List>
            </div>
          </>
        )}

        {editing && (
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginTop: 8, marginBottom: 4 }}
            message="客户端在列表中管理"
            description="保存后回到入站列表，点击行首展开箭头或「客户端」数量即可添加、编辑、分享或删除客户端。"
          />
        )}

        {/* ============== 底部提示 ============== */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 20,
            padding: '8px 12px',
            background: 'var(--ant-color-fill-quaternary)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <InfoCircleOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />
          <Text type="secondary">
            保存后将自动生成 sing-box 配置并重启核心，校验失败将保留原配置。
          </Text>
        </div>
      </Form>
    </Modal>
  )
}
