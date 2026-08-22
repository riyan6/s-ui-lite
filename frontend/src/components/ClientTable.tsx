import { useState } from 'react'
import { Table, Button, Space, Switch, Modal, Form, Input, Select, DatePicker, App as AntdApp, Typography, Tag, Popconfirm } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ShareAltOutlined, KeyOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { api } from '../api/client'
import type { Client, Inbound } from '../api/types'
import ShareModal from './ShareModal'

const { Text } = Typography

interface ClientFormValues {
  name: string
  credential?: string
  enabled: boolean
  expire_at?: Dayjs | null
  flow?: string
}

interface Props {
  inbound: Inbound
  onChanged: () => void
}

export default function ClientTable({ inbound, onChanged }: Props) {
  const { message } = AntdApp.useApp()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [loading, setLoading] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareClient, setShareClient] = useState<Client | null>(null)
  const [form] = Form.useForm<ClientFormValues>()

  const clients = inbound.clients ?? []

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ enabled: true })
    setModalOpen(true)
  }

  const openEdit = (c: Client) => {
    setEditing(c)
    let flow: string | undefined
    try {
      if (c.meta) {
        const meta = JSON.parse(c.meta)
        if (typeof meta.flow === 'string') flow = meta.flow
      }
    } catch {
      /* ignore */
    }
    form.setFieldsValue({
      name: c.name,
      credential: c.credential,
      enabled: c.enabled,
      expire_at: c.expire_at ? dayjs(c.expire_at) : null,
      flow,
    })
    setModalOpen(true)
  }

  const genCredential = async () => {
    try {
      if (inbound.type === 'vless') {
        const r = await api.get<{ uuid: string }>('/tools/uuid')
        form.setFieldsValue({ credential: r.uuid })
      } else {
        const method = String(inbound.config.method ?? '')
        const r = await api.get<{ key: string }>('/tools/ss-key', { method })
        form.setFieldsValue({ credential: r.key })
      }
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const onFinish = async (v: ClientFormValues) => {
    setLoading(true)
    try {
      const meta: Record<string, unknown> = {}
      if (inbound.type === 'vless' && v.flow !== undefined && v.flow !== '') meta.flow = v.flow
      const body = {
        name: v.name,
        credential: v.credential || '', // 留空由后端自动生成
        enabled: v.enabled,
        expire_at: v.expire_at ? v.expire_at.toISOString() : null,
        meta,
      }
      if (editing) {
        await api.put(`/clients/${editing.id}`, body)
      } else {
        await api.post(`/inbounds/${inbound.id}/clients`, body)
      }
      message.success('已保存并应用')
      setModalOpen(false)
      onChanged()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const toggleEnabled = async (c: Client, enabled: boolean) => {
    try {
      await api.put(`/clients/${c.id}`, { enabled })
      onChanged()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const remove = async (c: Client) => {
    try {
      await api.del(`/clients/${c.id}`)
      message.success('已删除')
      onChanged()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const expired = (c: Client) => c.expire_at && new Date(c.expire_at).getTime() < Date.now()

  return (
    <div style={{ padding: '8px 24px' }}>
      <Space style={{ marginBottom: 12 }}>
        <Button size="small" color="primary" variant="solid" icon={<PlusOutlined />} onClick={openCreate}>
          添加客户端
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {clients.filter((c) => c.enabled).length}/{clients.length} 启用中
        </Text>
      </Space>
      <Table
        rowKey="id"
        size="small"
        dataSource={clients}
        pagination={false}
        columns={[
          { title: '名称', dataIndex: 'name', width: 160 },
          {
            title: '凭证',
            dataIndex: 'credential',
            render: (v: string) => (
              <Text code copyable style={{ fontSize: 12 }}>
                {v}
              </Text>
            ),
          },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 80,
            render: (v: boolean, c: Client) => <Switch size="small" checked={v} onChange={(nv) => toggleEnabled(c, nv)} />,
          },
          {
            title: '到期时间',
            dataIndex: 'expire_at',
            width: 170,
            render: (v: string | null, c: Client) =>
              v ? (
                <Tag color={expired(c) ? 'red' : 'default'} style={{ margin: 0 }}>
                  {dayjs(v).format('YYYY-MM-DD HH:mm')}
                </Tag>
              ) : (
                <Text type="secondary">永久</Text>
              ),
          },
          {
            title: '操作',
            width: 200,
            render: (_: unknown, c: Client) => (
              <Space size={4}>
                <Button
                  size="small"
                  type="text"
                  color="primary"
                  icon={<ShareAltOutlined />}
                  onClick={() => {
                    setShareClient(c)
                    setShareOpen(true)
                  }}
                >
                  分享
                </Button>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(c)} />
                <Popconfirm title={`删除客户端 ${c.name}？`} onConfirm={() => remove(c)}>
                  <Button size="small" type="text" color="danger" icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `编辑客户端 - ${editing.name}` : `添加客户端 - ${inbound.tag}`}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={loading}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="客户端备注名" />
          </Form.Item>
          <Form.Item label={inbound.type === 'vless' ? 'UUID（留空自动生成）' : '密钥（留空自动生成）'}>
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="credential" noStyle>
                <Input placeholder="留空自动生成" />
              </Form.Item>
              <Button icon={<KeyOutlined />} onClick={genCredential}>
                生成
              </Button>
            </Space.Compact>
          </Form.Item>
          {inbound.type === 'vless' && (
            <Form.Item name="flow" label="Flow 覆盖（留空使用入站默认）">
              <Select
                allowClear
                options={[{ label: 'xtls-rprx-vision', value: 'xtls-rprx-vision' }]}
                placeholder="使用入站默认"
              />
            </Form.Item>
          )}
          <Form.Item name="expire_at" label="到期时间（留空永久；到期自动从配置移除）">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        inbound={inbound}
        client={shareClient}
      />
    </div>
  )
}
