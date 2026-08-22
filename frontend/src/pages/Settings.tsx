import { useEffect, useMemo, useState } from 'react'
import { Card, Col, Row, Form, Input, InputNumber, Select, Space, Switch, Tag, Button, Popconfirm, App as AntdApp, Typography, Alert } from 'antd'
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../api/client'
import type { PanelSettings } from '../api/types'

const { Text } = Typography

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic']

interface PanelFormValues {
  panel_port?: number
  core_binary_path?: string
  core_log_level: string
  core_auto_restart: boolean
}

interface PasswordFormValues {
  old_password: string
  new_password: string
  confirm: string
}

interface CoreVersionInfo {
  current: string
  adapted_line: string
  latest_adapted: string
  versions: Array<{ tag: string; published_at: string; adapted: boolean }>
}

export default function Settings() {
  const { message } = AntdApp.useApp()
  const [panelForm] = Form.useForm<PanelFormValues>()
  const [pwdForm] = Form.useForm<PasswordFormValues>()
  const [savingPanel, setSavingPanel] = useState(false)
  const [savingPwd, setSavingPwd] = useState(false)
  const [mustChange, setMustChange] = useState(false)
  const [username, setUsername] = useState('')
  const [coreInfo, setCoreInfo] = useState<CoreVersionInfo | null>(null)
  const [coreVersionsLoading, setCoreVersionsLoading] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<string | undefined>()
  const [updatingCore, setUpdatingCore] = useState(false)

  const loadCoreVersions = async () => {
    setCoreVersionsLoading(true)
    try {
      const info = await api.get<CoreVersionInfo>('/core/versions')
      setCoreInfo(info)
      setSelectedVersion(info.latest_adapted || info.versions[0]?.tag)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setCoreVersionsLoading(false)
    }
  }

  const selectedIsAdapted = useMemo(
    () => coreInfo?.versions.find((v) => v.tag === selectedVersion)?.adapted ?? true,
    [coreInfo, selectedVersion],
  )

  const updateCore = async () => {
    if (!selectedVersion) return
    setUpdatingCore(true)
    try {
      const r = await api.post<{ version: string }>('/core/update', { version: selectedVersion })
      message.success(`核心已更新到 ${r.version}`)
      loadCoreVersions()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setUpdatingCore(false)
    }
  }

  useEffect(() => {
    api
      .get<PanelSettings>('/settings')
      .then((s) => {
        setMustChange(s.must_change_password)
        setUsername(s.admin_username)
        panelForm.setFieldsValue({
          panel_port: s.panel_port,
          core_binary_path: s.core_binary_path,
          core_log_level: s.core_log_level,
          core_auto_restart: s.core_auto_restart,
        })
      })
      .catch((e) => message.error((e as Error).message))
  }, [panelForm, message])

  useEffect(() => {
    loadCoreVersions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const savePanel = async (v: PanelFormValues) => {
    setSavingPanel(true)
    try {
      const body: Record<string, unknown> = {
        core_log_level: v.core_log_level,
        core_auto_restart: v.core_auto_restart,
        core_binary_path: v.core_binary_path ?? '',
      }
      if (v.panel_port) body.panel_port = v.panel_port
      const r = await api.put<{ restarting?: boolean }>('/settings', body)
      if (r?.restarting) {
        message.warning('面板端口已修改，服务即将自动重启，请稍后用新端口访问')
        setTimeout(() => window.location.reload(), 1500)
      } else {
        message.success('设置已保存')
      }
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSavingPanel(false)
    }
  }

  const changePassword = async (v: PasswordFormValues) => {
    setSavingPwd(true)
    try {
      await api.post('/auth/password', {
        old_password: v.old_password,
        new_password: v.new_password,
      })
      message.success('密码已修改')
      pwdForm.resetFields()
      setMustChange(false)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSavingPwd(false)
    }
  }

  return (
    <Row gutter={[16, 16]}>
      {mustChange && (
        <Col span={24}>
          <Alert
            type="warning"
            showIcon
            title="当前仍在使用默认密码，建议立即修改"
            closable={{ onClose: () => setMustChange(false) }}
          />
        </Col>
      )}

      <Col xs={24} lg={12}>
        <Card title="面板设置">
          <Form form={panelForm} layout="vertical" onFinish={savePanel}>
            <Form.Item name="panel_port" label="面板端口" extra="保存后面板自动重启生效">
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
            <Space size={16} style={{ display: 'flex' }} align="start">
              <Form.Item name="core_log_level" label="核心日志级别" style={{ width: 200 }}>
                <Select options={LOG_LEVELS.map((l) => ({ label: l, value: l }))} />
              </Form.Item>
              <Form.Item name="core_auto_restart" label="核心崩溃自动重启" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Space>
            <Form.Item name="core_binary_path" label="sing-box 二进制路径" extra="留空使用 <数据目录>/bin/sing-box">
              <Input placeholder="/usr/local/s-ui-next/bin/sing-box" />
            </Form.Item>
            <Button color="primary" variant="solid" htmlType="submit" loading={savingPanel}>
              保存设置
            </Button>
          </Form>
        </Card>
      </Col>

      <Col xs={24} lg={12}>
        <Card title="修改密码" extra={<Text type="secondary">当前账号：{username || '-'}</Text>}>
          <Form form={pwdForm} layout="vertical" onFinish={changePassword}>
            <Form.Item name="old_password" label="当前密码" rules={[{ required: true }]}>
              <Input.Password />
            </Form.Item>
            <Form.Item name="new_password" label="新密码" rules={[{ required: true }, { min: 6, message: '至少 6 位' }]}>
              <Input.Password />
            </Form.Item>
            <Form.Item
              name="confirm"
              label="确认新密码"
              dependencies={['new_password']}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator(_, v) {
                    if (!v || v === getFieldValue('new_password')) return Promise.resolve()
                    return Promise.reject(new Error('两次输入不一致'))
                  },
                }),
              ]}
            >
              <Input.Password />
            </Form.Item>
            <Button color="primary" variant="solid" htmlType="submit" loading={savingPwd}>
              修改密码
            </Button>
          </Form>
        </Card>
      </Col>

      <Col span={24}>
        <Card
          title="sing-box 核心"
          extra={
            <Button size="small" icon={<ReloadOutlined />} onClick={loadCoreVersions} loading={coreVersionsLoading}>
              刷新版本
            </Button>
          }
        >
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Space size={24} wrap>
              <Text>
                当前版本：
                <Text code>{coreInfo?.current?.match(/\d+\.\d+\.\d+/)?.[0] ?? '未安装'}</Text>
              </Text>
              <Text>
                已适配版本线：
                <Text code>{coreInfo?.adapted_line ?? '1.13'}.x</Text>
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                仅列出官方稳定版（排除预发布）；非适配版本线请自行确认兼容性
              </Text>
            </Space>
            <Space size={12} wrap>
              <Select
                style={{ width: 320 }}
                placeholder="选择版本"
                value={selectedVersion}
                onChange={setSelectedVersion}
                loading={coreVersionsLoading}
                options={(coreInfo?.versions ?? []).map((v) => ({
                  value: v.tag,
                  label: (
                    <Space size={8}>
                      <span>{v.tag}</span>
                      {v.published_at && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {dayjs(v.published_at).format('YYYY-MM-DD')}
                        </Text>
                      )}
                      {!v.adapted && (
                        <Tag color="warning" style={{ margin: 0 }}>
                          未适配
                        </Tag>
                      )}
                    </Space>
                  ),
                }))}
              />
              <Popconfirm
                title={`确认下载并更新核心到 ${selectedVersion ?? ''}？`}
                description={
                  selectedIsAdapted
                    ? '更新期间代理会短暂中断'
                    : '该版本不在已适配版本线内，可能存在配置不兼容导致核心无法启动的风险'
                }
                onConfirm={updateCore}
              >
                <Button
                  color="primary"
                  variant="solid"
                  icon={<CloudDownloadOutlined />}
                  loading={updatingCore}
                  disabled={!selectedVersion}
                >
                  下载并更新
                </Button>
              </Popconfirm>
            </Space>
          </Space>
        </Card>
      </Col>

      <Col span={24}>
        <Text type="secondary">
          提示：路由全局设置（final / 默认解析器等）与 DNS 全局设置（策略 / 缓存等）请在对应的「路由管理」「DNS
          管理」页面中修改。
        </Text>
      </Col>
    </Row>
  )
}
