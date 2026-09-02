import { useCallback, useEffect, useState, type Key } from 'react'
import { Card, Table, Button, Space, Switch, Tag, Popconfirm, App as AntdApp, Typography } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import type { Inbound } from '../api/types'
import InboundForm from '../components/InboundForm'
import ClientTable from '../components/ClientTable'
import dayjs from 'dayjs'

const { Text } = Typography

const typeColor: Record<string, string> = {
  shadowsocks: 'blue',
  vless: 'purple',
}

export default function Inbounds() {
  const { message } = AntdApp.useApp()
  const [list, setList] = useState<Inbound[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Inbound | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<readonly Key[]>([])

  const toggleExpand = (id: number) => {
    setExpandedKeys((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]))
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(await api.get<Inbound[]>('/inbounds'))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    load()
  }, [load])

  const toggleEnabled = async (inbound: Inbound, enabled: boolean) => {
    try {
      await api.put(`/inbounds/${inbound.id}`, { enabled })
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const remove = async (inbound: Inbound) => {
    try {
      await api.del(`/inbounds/${inbound.id}`)
      message.success('已删除')
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  return (
    <Card
      title="入站管理"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} size="small">
            刷新
          </Button>
          <Button
            color="primary"
            variant="solid"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => {
              setEditing(null)
              setModalOpen(true)
            }}
          >
            新建入站
          </Button>
        </Space>
      }
    >
      <Table<Inbound>
        rowKey="id"
        loading={loading}
        dataSource={list}
        pagination={false}
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: setExpandedKeys,
          expandedRowRender: (record) => <ClientTable inbound={record} onChanged={load} />,
          rowExpandable: () => true,
        }}
        columns={[
          { title: 'Tag', dataIndex: 'tag', width: 180 },
          {
            title: '协议',
            dataIndex: 'type',
            width: 130,
            render: (v: string) => (
              <Tag color={typeColor[v] ?? 'default'} style={{ margin: 0 }}>
                {v === 'vless' ? 'VLESS-Reality' : v}
              </Tag>
            ),
          },
          {
            title: '监听',
            width: 200,
            render: (_, r) => (
              <Text code>
                {r.listen || '::'}:{r.port}
              </Text>
            ),
          },
          {
            title: '客户端',
            width: 120,
            render: (_, r) => {
              const cs = r.clients ?? []
              return (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => toggleExpand(r.id)}>
                  {cs.length} 个
                </Button>
              )
            },
          },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 80,
            render: (v: boolean, r: Inbound) => <Switch size="small" checked={v} onChange={(nv) => toggleEnabled(r, nv)} />,
          },
          {
            title: '更新时间',
            dataIndex: 'updated_at',
            width: 170,
            render: (v: string) => <Text type="secondary">{dayjs(v).format('YYYY-MM-DD HH:mm')}</Text>,
          },
          {
            title: '操作',
            width: 130,
            render: (_: unknown, r: Inbound) => (
              <Space size={4}>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(r)
                    setModalOpen(true)
                  }}
                />
                <Popconfirm title={`删除入站 ${r.tag} 及其全部客户端？`} onConfirm={() => remove(r)}>
                  <Button size="small" type="text" color="danger" icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <InboundForm open={modalOpen} editing={editing} onClose={() => setModalOpen(false)} onSaved={load} />
    </Card>
  )
}
