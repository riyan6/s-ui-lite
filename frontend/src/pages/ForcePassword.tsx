import { Card, Form, Input, Button, Typography, App as AntdApp, Alert, theme } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { api } from '../api/client'

const { Title, Text } = Typography

interface FormValues {
  old_password: string
  new_password: string
  confirm: string
}

export default function ForcePassword() {
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const { token } = theme.useToken()
  const [loading, setLoading] = useState(false)

  const onFinish = async (values: FormValues) => {
    setLoading(true)
    try {
      await api.post('/auth/password', {
        old_password: values.old_password,
        new_password: values.new_password,
      })
      message.success('密码已修改')
      navigate('/')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: token.colorBgLayout,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Card style={{ width: 380 }}>
        <Title level={4} style={{ textAlign: 'center', marginBottom: 16 }}>
          修改初始密码
        </Title>
        <Alert
          type="warning"
          showIcon
          title="当前使用默认密码，为安全起见请先设置新密码（至少 6 位）"
          style={{ marginBottom: 20 }}
        />
        <Form<FormValues> onFinish={onFinish} layout="vertical">
          <Form.Item name="old_password" label="当前密码" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} autoFocus />
          </Form.Item>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[{ required: true }, { min: 6, message: '至少 6 位' }]}
          >
            <Input.Password prefix={<LockOutlined />} />
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
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Button color="primary" variant="solid" block loading={loading} htmlType="submit">
            确认修改
          </Button>
        </Form>
        <Text type="secondary" style={{ display: 'block', marginTop: 12, textAlign: 'center' }}>
          修改成功后将进入面板
        </Text>
      </Card>
    </div>
  )
}
