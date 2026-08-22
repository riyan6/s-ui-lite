import { useCallback, useEffect, useState } from 'react'
import {
  Card, Tabs, Table, Button, Space, Switch, Tag, Popconfirm, Modal, Form, Input, InputNumber, Select,
  App as AntdApp, Typography,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import type { DnsRule, DnsServer } from '../api/types'
import { parseExtraJSON } from '../utils/format'

const { Text } = Typography

const DNS_TYPES = ['local', 'udp', 'tcp', 'tls', 'https', 'quic', 'h3', 'dhcp', 'hosts', 'fakeip']

const defaultPort: Record<string, number | undefined> = {
  udp: 53, tcp: 53, tls: 853, quic: 853, https: 443, h3: 443,
}

export default function Dns() {
  return (
    <Card title="DNS 管理">
      <Tabs
        items={[
          { key: 'servers', label: 'DNS 服务器', children: <ServersTab /> },
          { key: 'rules', label: '分流规则', children: <RulesTab /> },
          { key: 'settings', label: '全局设置', children: <SettingsTab /> },
        ]}
      />
    </Card>
  )
}

// ==================== DNS 服务器 ====================

interface ServerFormValues {
  tag: string
  type: string
  enabled: boolean
  server?: string
  server_port?: number
  extra?: string
}

function ServersTab() {
  const { message } = AntdApp.useApp()
  const [list, setList] = useState<DnsServer[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<DnsServer | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<ServerFormValues>()
  const type = Form.useWatch('type', form)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(await api.get<DnsServer[]>('/dns/servers'))
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
    form.setFieldsValue({ type: 'https', enabled: true })
    setModalOpen(true)
  }

  const openEdit = (s: DnsServer) => {
    setEditing(s)
    const known = new Set(['server', 'server_port'])
    const rest: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s.config)) {
      if (!known.has(k)) rest[k] = v
    }
    form.setFieldsValue({
      tag: s.tag,
      type: s.type,
      enabled: s.enabled,
      server: typeof s.config.server === 'string' ? s.config.server : undefined,
      server_port: typeof s.config.server_port === 'number' ? s.config.server_port : undefined,
      extra: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : undefined,
    })
    setModalOpen(true)
  }

  const onFinish = async (v: ServerFormValues) => {
    let extra: Record<string, unknown>
    try {
      extra = parseExtraJSON(v.extra)
    } catch (e) {
      message.error((e as Error).message)
      return
    }
    const config: Record<string, unknown> = { ...extra }
    if (v.server) config.server = v.server
    if (v.server_port) config.server_port = v.server_port

    setSaving(true)
    try {
      if (editing) {
        await api.put(`/dns/servers/${editing.id}`, { tag: v.tag, type: v.type, enabled: v.enabled, config })
      } else {
        await api.post('/dns/servers', { tag: v.tag, type: v.type, enabled: v.enabled, config })
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

  const remove = async (s: DnsServer) => {
    try {
      await api.del(`/dns/servers/${s.id}`)
      message.success('已删除')
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const toggleEnabled = async (s: DnsServer, enabled: boolean) => {
    try {
      await api.put(`/dns/servers/${s.id}`, { enabled })
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const move = async (index: number, dir: -1 | 1) => {
    const ids = list.map((s) => s.id)
    const target = index + dir
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try {
      await api.put('/dns/servers/order', { ids })
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load} size="small">
          刷新
        </Button>
        <Button color="primary" variant="solid" icon={<PlusOutlined />} size="small" onClick={openCreate}>
          新建 DNS 服务器
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          第一个服务器为默认服务器（final 未指定时）
        </Text>
      </Space>
      <Table<DnsServer>
        rowKey="id"
        loading={loading}
        dataSource={list}
        pagination={false}
        size="small"
        columns={[
          {
            title: '#',
            width: 50,
            render: (_: unknown, s: DnsServer) => <Text type="secondary">{list.findIndex((x) => x.id === s.id) + 1}</Text>,
          },
          { title: 'Tag', dataIndex: 'tag', width: 180 },
          {
            title: '类型',
            dataIndex: 'type',
            width: 100,
            render: (v: string) => (
              <Tag style={{ margin: 0 }} color={v === 'local' ? 'green' : 'blue'}>
                {v}
              </Tag>
            ),
          },
          {
            title: '地址',
            render: (_, s) => (
              <Text style={{ fontSize: 12 }}>
                {String(s.config.server ?? '-')}
                {s.config.server_port ? ` : ${s.config.server_port}` : ''}
              </Text>
            ),
          },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 70,
            render: (v: boolean, r: DnsServer) => <Switch size="small" checked={v} onChange={(nv) => toggleEnabled(r, nv)} />,
          },
          {
            title: '排序',
            width: 90,
            render: (_: unknown, s: DnsServer) => {
              const idx = list.findIndex((x) => x.id === s.id)
              return (
                <Space size={0}>
                  <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => move(idx, -1)} />
                  <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={idx === list.length - 1} onClick={() => move(idx, 1)} />
                </Space>
              )
            },
          },
          {
            title: '操作',
            width: 100,
            render: (_: unknown, r: DnsServer) => (
              <Space size={4}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                <Popconfirm title="删除该 DNS 服务器？" onConfirm={() => remove(r)}>
                  <Button size="small" type="text" color="danger" icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `编辑 DNS 服务器 - ${editing.tag}` : '新建 DNS 服务器'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="tag" label="Tag" rules={[{ required: true }]}>
            <Input placeholder="如 remote-dns" />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item name="type" label="类型" rules={[{ required: true }]} style={{ width: 180 }}>
              <Select options={DNS_TYPES.map((t) => ({ label: t, value: t }))} disabled={!!editing} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          {type !== 'local' && type !== 'dhcp' && type !== 'hosts' && type !== 'fakeip' && (
            <Space size={16} style={{ display: 'flex' }} align="start">
              <Form.Item name="server" label="服务器地址" style={{ width: 300 }} rules={[{ required: true }]}>
                <Input placeholder={type === 'https' ? '8.8.8.8 或 dns.google' : '223.5.5.5'} />
              </Form.Item>
              <Form.Item
                name="server_port"
                label="端口"
                style={{ width: 140 }}
                extra={defaultPort[type] ? `默认 ${defaultPort[type]}` : undefined}
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder={String(defaultPort[type] ?? '')} />
              </Form.Item>
            </Space>
          )}
          <Form.Item name="extra" label="额外字段（JSON 对象，可选）">
            <Input.TextArea rows={3} placeholder='如 {"detour": "direct"}' />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ==================== DNS 分流规则 ====================

interface DnsRuleFormValues {
  domain?: string[]
  domain_suffix?: string[]
  domain_keyword?: string[]
  domain_regex?: string[]
  action: string
  server?: string
  invert?: boolean
  extra?: string
}

function RulesTab() {
  const { message } = AntdApp.useApp()
  const [rules, setRules] = useState<DnsRule[]>([])
  const [servers, setServers] = useState<DnsServer[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<DnsRule | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<DnsRuleFormValues>()
  const action = Form.useWatch('action', form)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, s] = await Promise.all([api.get<DnsRule[]>('/dns/rules'), api.get<DnsServer[]>('/dns/servers')])
      setRules(r)
      setServers(s)
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
    form.setFieldsValue({ action: 'route' })
    setModalOpen(true)
  }

  const openEdit = (rule: DnsRule) => {
    setEditing(rule)
    const cfg = rule.config
    const known = new Set(['domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'action', 'server', 'invert'])
    const rest: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cfg)) {
      if (!known.has(k)) rest[k] = v
    }
    form.setFieldsValue({
      domain: cfg.domain as string[] | undefined,
      domain_suffix: cfg.domain_suffix as string[] | undefined,
      domain_keyword: cfg.domain_keyword as string[] | undefined,
      domain_regex: cfg.domain_regex as string[] | undefined,
      action: typeof cfg.action === 'string' ? cfg.action : 'route',
      server: cfg.server as string | undefined,
      invert: Boolean(cfg.invert),
      extra: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : undefined,
    })
    setModalOpen(true)
  }

  const onFinish = async (v: DnsRuleFormValues) => {
    let extra: Record<string, unknown>
    try {
      extra = parseExtraJSON(v.extra)
    } catch (e) {
      message.error((e as Error).message)
      return
    }
    const cfg: Record<string, unknown> = { ...extra }
    const arrays = ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex'] as const
    for (const key of arrays) {
      const val = v[key]
      if (val && val.length > 0) cfg[key] = val
    }
    cfg.action = v.action
    if (v.action === 'route' && v.server) cfg.server = v.server
    if (v.invert) cfg.invert = true

    setSaving(true)
    try {
      if (editing) {
        await api.put(`/dns/rules/${editing.id}`, { config: cfg })
      } else {
        await api.post('/dns/rules', { config: cfg })
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

  const remove = async (rule: DnsRule) => {
    try {
      await api.del(`/dns/rules/${rule.id}`)
      message.success('已删除')
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const toggleEnabled = async (rule: DnsRule, enabled: boolean) => {
    try {
      await api.put(`/dns/rules/${rule.id}`, { enabled })
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const summary = (cfg: Record<string, unknown>) => {
    const parts: string[] = []
    if (Array.isArray(cfg.domain_suffix) && cfg.domain_suffix.length) parts.push(`后缀×${cfg.domain_suffix.length}`)
    if (Array.isArray(cfg.domain) && cfg.domain.length) parts.push(`域名×${cfg.domain.length}`)
    if (Array.isArray(cfg.domain_keyword) && cfg.domain_keyword.length) parts.push(`关键字×${cfg.domain_keyword.length}`)
    if (Array.isArray(cfg.domain_regex) && cfg.domain_regex.length) parts.push(`正则×${cfg.domain_regex.length}`)
    return parts.length ? parts.join(' · ') : '（无条件匹配全部）'
  }

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load} size="small">
          刷新
        </Button>
        <Button color="primary" variant="solid" icon={<PlusOutlined />} size="small" onClick={openCreate}>
          新建 DNS 规则
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          命中条件的域名走指定服务器，未命中走默认服务器
        </Text>
      </Space>
      <Table<DnsRule>
        rowKey="id"
        loading={loading}
        dataSource={rules}
        pagination={false}
        size="small"
        columns={[
          {
            title: '#',
            width: 50,
            render: (_: unknown, r: DnsRule) => <Text type="secondary">{rules.findIndex((x) => x.id === r.id) + 1}</Text>,
          },
          { title: '条件', render: (_, r) => <Text style={{ fontSize: 12 }}>{summary(r.config)}</Text> },
          {
            title: '动作',
            width: 220,
            render: (_, r) => (
              <Tag style={{ margin: 0 }} color={r.config.action === 'reject' ? 'red' : 'blue'}>
                {String(r.config.action ?? 'route')} → {String(r.config.server ?? '-')}
              </Tag>
            ),
          },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 70,
            render: (v: boolean, r: DnsRule) => <Switch size="small" checked={v} onChange={(nv) => toggleEnabled(r, nv)} />,
          },
          {
            title: '操作',
            width: 100,
            render: (_: unknown, r: DnsRule) => (
              <Space size={4}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                <Popconfirm title="删除该 DNS 规则？" onConfirm={() => remove(r)}>
                  <Button size="small" type="text" color="danger" icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑 DNS 规则' : '新建 DNS 规则'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="domain_suffix" label="域名后缀">
            <Select mode="tags" open={false} placeholder="如 .cn（回车添加）" />
          </Form.Item>
          <Form.Item name="domain" label="域名（完整匹配）">
            <Select mode="tags" open={false} placeholder="回车添加" />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="domain_keyword" label="关键字" style={{ width: 240 }}>
              <Select mode="tags" open={false} placeholder="回车添加" />
            </Form.Item>
            <Form.Item name="domain_regex" label="正则" style={{ width: 240 }}>
              <Select mode="tags" open={false} placeholder="回车添加" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="action" label="动作" rules={[{ required: true }]} style={{ width: 160 }}>
              <Select
                options={[
                  { label: 'route（转发）', value: 'route' },
                  { label: 'reject（拒绝）', value: 'reject' },
                  { label: 'predefined（预定义）', value: 'predefined' },
                ]}
              />
            </Form.Item>
            {action === 'route' && (
              <Form.Item name="server" label="目标 DNS 服务器" style={{ width: 240 }}>
                <Select showSearch allowClear options={servers.filter((s) => s.enabled).map((s) => ({ label: s.tag, value: s.tag }))} />
              </Form.Item>
            )}
          </Space>
          <Form.Item name="invert" label="条件取反 (invert)" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="extra" label="额外字段（JSON 对象，可选）">
            <Input.TextArea rows={3} placeholder='如 {"clash_mode": "Direct"}' />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ==================== 全局设置 ====================

interface DnsSettingsValues {
  final?: string
  strategy?: string
  disable_cache?: boolean
  cache_capacity?: number
  reverse_mapping?: boolean
  client_subnet?: string
  extra?: string
}

function SettingsTab() {
  const { message } = AntdApp.useApp()
  const [servers, setServers] = useState<DnsServer[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<DnsSettingsValues>()

  useEffect(() => {
    Promise.all([api.get<Record<string, unknown>>('/dns/settings'), api.get<DnsServer[]>('/dns/servers')])
      .then(([settings, ss]) => {
        setServers(ss)
        const known = new Set(['final', 'strategy', 'disable_cache', 'cache_capacity', 'reverse_mapping', 'client_subnet'])
        const rest: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(settings)) {
          if (!known.has(k)) rest[k] = v
        }
        form.setFieldsValue({
          final: typeof settings.final === 'string' ? settings.final : undefined,
          strategy: typeof settings.strategy === 'string' ? settings.strategy : undefined,
          disable_cache: Boolean(settings.disable_cache),
          cache_capacity: typeof settings.cache_capacity === 'number' ? settings.cache_capacity : undefined,
          reverse_mapping: Boolean(settings.reverse_mapping),
          client_subnet: typeof settings.client_subnet === 'string' ? settings.client_subnet : undefined,
          extra: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : undefined,
        })
      })
      .catch((e) => message.error((e as Error).message))
  }, [form, message])

  const onFinish = async (v: DnsSettingsValues) => {
    let extra: Record<string, unknown>
    try {
      extra = parseExtraJSON(v.extra)
    } catch (e) {
      message.error((e as Error).message)
      return
    }
    const settings: Record<string, unknown> = { ...extra }
    if (v.final) settings.final = v.final
    if (v.strategy) settings.strategy = v.strategy
    if (v.disable_cache) settings.disable_cache = true
    if (v.cache_capacity) settings.cache_capacity = v.cache_capacity
    if (v.reverse_mapping) settings.reverse_mapping = true
    if (v.client_subnet) settings.client_subnet = v.client_subnet

    setSaving(true)
    try {
      await api.put('/dns/settings', settings)
      message.success('DNS 全局设置已应用')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Form form={form} layout="vertical" onFinish={onFinish} style={{ maxWidth: 560 }}>
      <Space size={16} style={{ display: 'flex' }} align="start">
        <Form.Item name="final" label="默认服务器 (final)" style={{ width: 240 }} extra="留空使用第一个服务器">
          <Select allowClear showSearch options={servers.filter((s) => s.enabled).map((s) => ({ label: s.tag, value: s.tag }))} />
        </Form.Item>
        <Form.Item name="strategy" label="解析策略" style={{ width: 200 }}>
          <Select
            allowClear
            options={['prefer_ipv4', 'prefer_ipv6', 'ipv4_only', 'ipv6_only'].map((v) => ({ label: v, value: v }))}
          />
        </Form.Item>
      </Space>
      <Space size={16} style={{ display: 'flex' }}>
        <Form.Item name="disable_cache" label="禁用缓存" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="reverse_mapping" label="反向映射 (IP→域名)" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="cache_capacity" label="缓存容量">
          <InputNumber min={0} step={1024} style={{ width: 140 }} placeholder="≥1024 生效" />
        </Form.Item>
      </Space>
      <Form.Item name="client_subnet" label="EDNS Client Subnet（可选）">
        <Input placeholder="如 1.1.1.1/32" />
      </Form.Item>
      <Form.Item name="extra" label="额外字段（JSON 对象，合并进 dns 段）">
        <Input.TextArea rows={3} />
      </Form.Item>
      <Button color="primary" variant="solid" htmlType="submit" loading={saving}>
        保存并应用
      </Button>
    </Form>
  )
}
