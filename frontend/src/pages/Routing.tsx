import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Card, Tabs, Table, Button, Space, Switch, Tag, Popconfirm, Modal, Form, Input, InputNumber, Select,
  App as AntdApp, Typography, Alert,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import type { DnsServer, Inbound, Outbound, RouteRule, RouteRuleSet } from '../api/types'
import { parseExtraJSON } from '../utils/format'

const { Text } = Typography

const ACTIONS = ['route', 'reject', 'hijack-dns', 'sniff', 'resolve']

interface RuleFormValues {
  domain?: string[]
  domain_suffix?: string[]
  domain_keyword?: string[]
  domain_regex?: string[]
  ip_cidr?: string[]
  port?: string[]
  source_ip_cidr?: string[]
  inbound?: string[]
  rule_set?: string[]
  network?: string
  protocol?: string[]
  user?: string[]
  action: string
  outbound?: string
  method?: string
  sniffer?: string[]
  server?: string
  strategy?: string
  invert?: boolean
  extra?: string
}

interface RuleSetFormValues {
  tag: string
  enabled: boolean
  type: string
  format: string
  url?: string
  path?: string
  update_interval?: string
  download_detour?: string
}

function ruleSummary(cfg: Record<string, unknown>): string {
  const parts: string[] = []
  const push = (label: string, v: unknown) => {
    if (Array.isArray(v) && v.length > 0) parts.push(`${label}×${v.length}`)
    else if (typeof v === 'string' && v) parts.push(`${label}:${v}`)
  }
  push('domain', cfg.domain)
  push('后缀', cfg.domain_suffix)
  push('关键字', cfg.domain_keyword)
  push('正则', cfg.domain_regex)
  push('IP', cfg.ip_cidr)
  push('端口', cfg.port)
  push('源IP', cfg.source_ip_cidr)
  push('入站', cfg.inbound)
  push('规则集', cfg.rule_set)
  push('网络', cfg.network)
  push('协议', cfg.protocol)
  push('用户', cfg.user)
  if (cfg.type === 'logical') parts.push(`逻辑(${cfg.mode})`)
  return parts.length ? parts.join(' · ') : '（无条件匹配全部）'
}

function ruleTarget(cfg: Record<string, unknown>): string {
  const action = typeof cfg.action === 'string' ? cfg.action : 'route'
  const target = typeof cfg.outbound === 'string' ? cfg.outbound : typeof cfg.server === 'string' ? cfg.server : ''
  return target ? `${action} → ${target}` : action
}

export default function Routing() {
  return (
    <Card title="路由管理">
      <Tabs
        items={[
          { key: 'rules', label: '规则', children: <RulesTab /> },
          { key: 'rule-sets', label: '规则集', children: <RuleSetsTab /> },
          { key: 'settings', label: '全局设置', children: <SettingsTab /> },
        ]}
      />
    </Card>
  )
}

// ==================== 规则 ====================

function RulesTab() {
  const { message } = AntdApp.useApp()
  const [rules, setRules] = useState<RouteRule[]>([])
  const [inbounds, setInbounds] = useState<Inbound[]>([])
  const [outbounds, setOutbounds] = useState<Outbound[]>([])
  const [ruleSets, setRuleSets] = useState<RouteRuleSet[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RouteRule | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<RuleFormValues>()
  const action = Form.useWatch('action', form)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, i, o, rs] = await Promise.all([
        api.get<RouteRule[]>('/route/rules'),
        api.get<Inbound[]>('/inbounds'),
        api.get<Outbound[]>('/outbounds'),
        api.get<RouteRuleSet[]>('/route/rule-sets'),
      ])
      setRules(r)
      setInbounds(i)
      setOutbounds(o)
      setRuleSets(rs)
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

  const openEdit = (rule: RouteRule) => {
    setEditing(rule)
    const cfg = rule.config
    const known = new Set([
      'domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'ip_cidr', 'port',
      'source_ip_cidr', 'inbound', 'rule_set', 'network', 'protocol', 'user',
      'action', 'outbound', 'method', 'sniffer', 'server', 'strategy', 'invert',
    ])
    const rest: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cfg)) {
      if (!known.has(k)) rest[k] = v
    }
    form.setFieldsValue({
      domain: cfg.domain as string[] | undefined,
      domain_suffix: cfg.domain_suffix as string[] | undefined,
      domain_keyword: cfg.domain_keyword as string[] | undefined,
      domain_regex: cfg.domain_regex as string[] | undefined,
      ip_cidr: cfg.ip_cidr as string[] | undefined,
      port: Array.isArray(cfg.port) ? cfg.port.map(String) : undefined,
      source_ip_cidr: cfg.source_ip_cidr as string[] | undefined,
      inbound: cfg.inbound as string[] | undefined,
      rule_set: cfg.rule_set as string[] | undefined,
      network: cfg.network as string | undefined,
      protocol: cfg.protocol as string[] | undefined,
      user: cfg.user as string[] | undefined,
      action: typeof cfg.action === 'string' ? cfg.action : 'route',
      outbound: cfg.outbound as string | undefined,
      method: cfg.method as string | undefined,
      sniffer: cfg.sniffer as string[] | undefined,
      server: cfg.server as string | undefined,
      strategy: cfg.strategy as string | undefined,
      invert: Boolean(cfg.invert),
      extra: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : undefined,
    })
    setModalOpen(true)
  }

  const onFinish = async (v: RuleFormValues) => {
    let extra: Record<string, unknown>
    try {
      extra = parseExtraJSON(v.extra)
    } catch (e) {
      message.error((e as Error).message)
      return
    }
    const cfg: Record<string, unknown> = { ...extra }
    const arrays: Array<keyof RuleFormValues> = [
      'domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'ip_cidr',
      'source_ip_cidr', 'inbound', 'rule_set', 'protocol', 'user', 'sniffer',
    ]
    for (const key of arrays) {
      const val = v[key] as string[] | undefined
      if (val && val.length > 0) cfg[key] = val
    }
    if (v.port && v.port.length > 0) {
      const ports = v.port.map((p) => Number(p)).filter((n) => !Number.isNaN(n) && n > 0)
      if (ports.length > 0) cfg.port = ports
    }
    if (v.network) cfg.network = v.network
    if (v.invert) cfg.invert = true
    cfg.action = v.action
    if (v.action === 'route' && v.outbound) cfg.outbound = v.outbound
    if (v.action === 'reject' && v.method) cfg.method = v.method
    if (v.action === 'resolve' && v.server) cfg.server = v.server
    if (v.action === 'resolve' && v.strategy) cfg.strategy = v.strategy

    setSaving(true)
    try {
      if (editing) {
        await api.put(`/route/rules/${editing.id}`, { config: cfg })
      } else {
        await api.post('/route/rules', { config: cfg })
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

  const remove = async (rule: RouteRule) => {
    try {
      await api.del(`/route/rules/${rule.id}`)
      message.success('已删除')
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const toggleEnabled = async (rule: RouteRule, enabled: boolean) => {
    try {
      await api.put(`/route/rules/${rule.id}`, { enabled })
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const move = async (index: number, dir: -1 | 1) => {
    const ids = rules.map((r) => r.id)
    const target = index + dir
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try {
      await api.put('/route/rules/order', { ids })
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
          新建规则
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          规则自上而下匹配，命中即执行动作
        </Text>
      </Space>
      <Table<RouteRule>
        rowKey="id"
        loading={loading}
        dataSource={rules}
        pagination={false}
        size="small"
        columns={[
          {
            title: '#',
            width: 60,
            render: (_: unknown, r: RouteRule) => (
              <Text type="secondary">{rules.findIndex((x) => x.id === r.id) + 1}</Text>
            ),
          },
          {
            title: '条件',
            render: (_, r) => <Text style={{ fontSize: 12 }}>{ruleSummary(r.config)}</Text>,
          },
          {
            title: '动作',
            width: 200,
            render: (_, r) => (
              <Tag color={r.config.action === 'reject' ? 'red' : 'blue'} style={{ margin: 0 }}>
                {ruleTarget(r.config)}
              </Tag>
            ),
          },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 70,
            render: (v: boolean, r: RouteRule) => <Switch size="small" checked={v} onChange={(nv) => toggleEnabled(r, nv)} />,
          },
          {
            title: '排序',
            width: 90,
            render: (_: unknown, r: RouteRule) => {
              const idx = rules.findIndex((x) => x.id === r.id)
              return (
                <Space size={0}>
                  <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => move(idx, -1)} />
                  <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={idx === rules.length - 1} onClick={() => move(idx, 1)} />
                </Space>
              )
            },
          },
          {
            title: '操作',
            width: 100,
            render: (_: unknown, r: RouteRule) => (
              <Space size={4}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                <Popconfirm title="删除该规则？" onConfirm={() => remove(r)}>
                  <Button size="small" type="text" color="danger" icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑路由规则' : '新建路由规则'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        width={720}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          title="同类域名条件之间是“或”关系，不同类条件之间是“且”关系（与 sing-box 规则语义一致）"
          style={{ marginBottom: 16 }}
        />
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="domain" label="域名（完整匹配）" style={{ width: 300 }}>
              <Select mode="tags" open={false} placeholder="回车添加" />
            </Form.Item>
            <Form.Item name="domain_suffix" label="域名后缀" style={{ width: 300 }}>
              <Select mode="tags" open={false} placeholder="如 .cn" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="domain_keyword" label="域名关键字" style={{ width: 300 }}>
              <Select mode="tags" open={false} placeholder="回车添加" />
            </Form.Item>
            <Form.Item name="domain_regex" label="域名正则" style={{ width: 300 }}>
              <Select mode="tags" open={false} placeholder="回车添加" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="ip_cidr" label="目标 IP (CIDR)" style={{ width: 300 }}>
              <Select mode="tags" open={false} placeholder="如 10.0.0.0/8" />
            </Form.Item>
            <Form.Item name="source_ip_cidr" label="来源 IP (CIDR)" style={{ width: 300 }}>
              <Select mode="tags" open={false} placeholder="回车添加" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="port" label="目标端口" style={{ width: 200 }}>
              <Select mode="tags" open={false} placeholder="如 80、443" />
            </Form.Item>
            <Form.Item name="network" label="网络" style={{ width: 140 }}>
              <Select allowClear options={['tcp', 'udp', 'icmp'].map((v) => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="protocol" label="嗅探协议" style={{ width: 240 }}>
              <Select mode="multiple" allowClear options={['http', 'tls', 'quic', 'dns', 'stun'].map((v) => ({ label: v, value: v }))} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="inbound" label="来源入站" style={{ width: 300 }}>
              <Select mode="multiple" allowClear options={inbounds.map((i) => ({ label: i.tag, value: i.tag }))} />
            </Form.Item>
            <Form.Item name="rule_set" label="规则集" style={{ width: 300 }}>
              <Select mode="multiple" allowClear options={ruleSets.filter((rs) => rs.enabled).map((rs) => ({ label: rs.tag, value: rs.tag }))} />
            </Form.Item>
          </Space>
          <Form.Item name="user" label="匹配入站客户端用户名" style={{ width: 400 }}>
            <Select mode="tags" open={false} placeholder="回车添加（匹配 SS/VLESS 客户端 name）" />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="action" label="动作" rules={[{ required: true }]} style={{ width: 180 }}>
              <Select options={ACTIONS.map((a) => ({ label: a, value: a }))} />
            </Form.Item>
            {action === 'route' && (
              <Form.Item name="outbound" label="目标出站" style={{ width: 260 }}>
                <Select allowClear options={outbounds.filter((o) => o.enabled).map((o) => ({ label: o.tag, value: o.tag }))} />
              </Form.Item>
            )}
            {action === 'reject' && (
              <Form.Item name="method" label="拒绝方式" style={{ width: 200 }}>
                <Select allowClear options={[{ label: 'default（拒绝）', value: 'default' }, { label: 'drop（丢弃）', value: 'drop' }]} />
              </Form.Item>
            )}
            {action === 'resolve' && (
              <>
                <Form.Item name="server" label="DNS 服务器" style={{ width: 200 }}>
                  <Input placeholder="服务器 tag（可选）" />
                </Form.Item>
                <Form.Item name="strategy" label="解析策略" style={{ width: 160 }}>
                  <Select allowClear options={['prefer_ipv4', 'prefer_ipv6', 'ipv4_only', 'ipv6_only'].map((v) => ({ label: v, value: v }))} />
                </Form.Item>
              </>
            )}
          </Space>

          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item name="invert" label="条件取反 (invert)" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item name="extra" label="额外字段（JSON 对象，直接合并进规则，支持逻辑规则等高级用法）">
            <Input.TextArea rows={3} placeholder='如 {"type":"logical","mode":"or","rules":[...]}' />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ==================== 规则集 ====================

function RuleSetsTab() {
  const { message } = AntdApp.useApp()
  const [list, setList] = useState<RouteRuleSet[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RouteRuleSet | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<RuleSetFormValues>()
  const type = Form.useWatch('type', form)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(await api.get<RouteRuleSet[]>('/route/rule-sets'))
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
    form.setFieldsValue({ type: 'remote', format: 'binary', enabled: true })
    setModalOpen(true)
  }

  const openEdit = (rs: RouteRuleSet) => {
    setEditing(rs)
    form.setFieldsValue({
      tag: rs.tag,
      enabled: rs.enabled,
      type: String(rs.config.type ?? 'remote'),
      format: String(rs.config.format ?? 'binary'),
      url: typeof rs.config.url === 'string' ? rs.config.url : undefined,
      path: typeof rs.config.path === 'string' ? rs.config.path : undefined,
      update_interval: typeof rs.config.update_interval === 'string' ? rs.config.update_interval : undefined,
      download_detour: typeof rs.config.download_detour === 'string' ? rs.config.download_detour : undefined,
    })
    setModalOpen(true)
  }

  const onFinish = async (v: RuleSetFormValues) => {
    const config: Record<string, unknown> = { type: v.type, format: v.format }
    if (v.type === 'remote') {
      if (!v.url) {
        message.error('远端规则集需要 URL')
        return
      }
      config.url = v.url
      if (v.update_interval) config.update_interval = v.update_interval
      if (v.download_detour) config.download_detour = v.download_detour
    } else if (v.type === 'local') {
      if (!v.path) {
        message.error('本地规则集需要文件路径')
        return
      }
      config.path = v.path
    }
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/route/rule-sets/${editing.id}`, { tag: v.tag, enabled: v.enabled, config })
      } else {
        await api.post('/route/rule-sets', { tag: v.tag, enabled: v.enabled, config })
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

  const remove = async (rs: RouteRuleSet) => {
    try {
      await api.del(`/route/rule-sets/${rs.id}`)
      message.success('已删除')
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const toggleEnabled = async (rs: RouteRuleSet, enabled: boolean) => {
    try {
      await api.put(`/route/rule-sets/${rs.id}`, { enabled })
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
          新建规则集
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          geosite/geoip 通过远端规则集（.srs）引用
        </Text>
      </Space>
      <Table<RouteRuleSet>
        rowKey="id"
        loading={loading}
        dataSource={list}
        pagination={false}
        size="small"
        columns={[
          { title: 'Tag', dataIndex: 'tag', width: 200 },
          {
            title: '类型/格式',
            width: 140,
            render: (_, rs) => (
              <Tag style={{ margin: 0 }}>
                {String(rs.config.type)}/{String(rs.config.format)}
              </Tag>
            ),
          },
          {
            title: '来源',
            render: (_, rs) => (
              <Text code copyable style={{ fontSize: 12 }}>
                {String(rs.config.url ?? rs.config.path ?? '-')}
              </Text>
            ),
          },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 70,
            render: (v: boolean, r: RouteRuleSet) => <Switch size="small" checked={v} onChange={(nv) => toggleEnabled(r, nv)} />,
          },
          {
            title: '操作',
            width: 100,
            render: (_: unknown, r: RouteRuleSet) => (
              <Space size={4}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                <Popconfirm title="删除该规则集？" onConfirm={() => remove(r)}>
                  <Button size="small" type="text" color="danger" icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `编辑规则集 - ${editing.tag}` : '新建规则集'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="tag" label="Tag" rules={[{ required: true }]}>
            <Input placeholder="如 geosite-cn" />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item name="type" label="类型" rules={[{ required: true }]} style={{ width: 160 }}>
              <Select
                options={[
                  { label: 'remote（远端）', value: 'remote' },
                  { label: 'local（本地）', value: 'local' },
                ]}
              />
            </Form.Item>
            <Form.Item name="format" label="格式" style={{ width: 160 }}>
              <Select
                options={[
                  { label: 'binary（.srs）', value: 'binary' },
                  { label: 'source（.json）', value: 'source' },
                ]}
              />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          {type === 'remote' && (
            <>
              <Form.Item name="url" label="下载 URL" rules={[{ required: true }]}>
                <Input placeholder="https://raw.githubusercontent.com/.../geosite-cn.srs" />
              </Form.Item>
              <Space size={16} style={{ display: 'flex' }}>
                <Form.Item name="update_interval" label="更新间隔（可选）" style={{ width: 200 }}>
                  <Input placeholder="默认 1d" />
                </Form.Item>
                <Form.Item name="download_detour" label="下载经由出站（可选）" style={{ width: 220 }}>
                  <Input placeholder="出站 tag" />
                </Form.Item>
              </Space>
            </>
          )}
          {type === 'local' && (
            <Form.Item name="path" label="本地文件路径" rules={[{ required: true }]}>
              <Input placeholder="/path/to/rule-set.srs" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  )
}

// ==================== 全局设置 ====================

interface RouteSettingsValues {
  final?: string
  auto_detect_interface?: boolean
  default_domain_resolver?: string
  default_mark?: number
  extra?: string
}

function SettingsTab() {
  const { message } = AntdApp.useApp()
  const [outbounds, setOutbounds] = useState<Outbound[]>([])
  const [dnsServers, setDnsServers] = useState<DnsServer[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<RouteSettingsValues>()

  useEffect(() => {
    Promise.all([
      api.get<Record<string, unknown>>('/route/settings'),
      api.get<Outbound[]>('/outbounds'),
      api.get<DnsServer[]>('/dns/servers'),
    ])
      .then(([settings, obs, dns]) => {
        setOutbounds(obs)
        setDnsServers(dns)
        const known = new Set(['final', 'auto_detect_interface', 'default_domain_resolver', 'default_mark'])
        const rest: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(settings)) {
          if (!known.has(k)) rest[k] = v
        }
        form.setFieldsValue({
          final: typeof settings.final === 'string' ? settings.final : undefined,
          auto_detect_interface: Boolean(settings.auto_detect_interface),
          default_domain_resolver:
            typeof settings.default_domain_resolver === 'string' ? settings.default_domain_resolver : undefined,
          default_mark: typeof settings.default_mark === 'number' ? settings.default_mark : undefined,
          extra: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : undefined,
        })
      })
      .catch((e) => message.error((e as Error).message))
  }, [form, message])

  const onFinish = async (v: RouteSettingsValues) => {
    let extra: Record<string, unknown>
    try {
      extra = parseExtraJSON(v.extra)
    } catch (e) {
      message.error((e as Error).message)
      return
    }
    const settings: Record<string, unknown> = { ...extra }
    if (v.final) settings.final = v.final
    if (v.auto_detect_interface) settings.auto_detect_interface = true
    if (v.default_domain_resolver) settings.default_domain_resolver = v.default_domain_resolver
    if (v.default_mark !== undefined && v.default_mark !== null) settings.default_mark = v.default_mark

    setSaving(true)
    try {
      await api.put('/route/settings', settings)
      message.success('路由全局设置已应用')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const resolverTip = useMemo(
    () => '配置 DNS 服务器后未手动指定时，面板会自动填入第一个 DNS 服务器',
    [],
  )

  return (
    <Form form={form} layout="vertical" onFinish={onFinish} style={{ maxWidth: 560 }}>
      <Form.Item name="final" label="默认出站 (final)" extra="无规则命中时使用的出站；留空使用第一个出站">
        <Select allowClear showSearch options={outbounds.filter((o) => o.enabled).map((o) => ({ label: o.tag, value: o.tag }))} />
      </Form.Item>
      <Form.Item
        name="default_domain_resolver"
        label="默认域名解析器 (default_domain_resolver)"
        extra={resolverTip}
      >
        <Select allowClear showSearch options={dnsServers.filter((d) => d.enabled).map((d) => ({ label: d.tag, value: d.tag }))} />
      </Form.Item>
      <Space size={16} style={{ display: 'flex' }}>
        <Form.Item name="auto_detect_interface" label="自动绑定默认网卡" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="default_mark" label="路由标记 (default_mark，Linux)">
          <InputNumber min={0} style={{ width: 140 }} />
        </Form.Item>
      </Space>
      <Form.Item name="extra" label="额外字段（JSON 对象，合并进 route 段）">
        <Input.TextArea rows={3} placeholder='如 {"default_interface": "eth0"}' />
      </Form.Item>
      <Button color="primary" variant="solid" htmlType="submit" loading={saving}>
        保存并应用
      </Button>
    </Form>
  )
}
