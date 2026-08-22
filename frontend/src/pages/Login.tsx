import { Card, Form, Input, Button, Typography, theme, App as AntdApp } from 'antd'
import { UserOutlined, LockOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '../api/client'

const { Title, Text } = Typography

interface LoginForm {
  username: string
  password: string
}

export default function Login() {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const { message } = AntdApp.useApp()

  const onFinish = async (values: LoginForm) => {
    try {
      const obj = await api.post<{ token: string; must_change_password: boolean }>('/auth/login', values)
      setToken(obj.token)
      navigate(obj.must_change_password ? '/force-password' : '/')
    } catch (e) {
      message.error((e as Error).message)
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
      <Card style={{ width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <ThunderboltOutlined style={{ fontSize: 32, color: token.colorPrimary }} />
          <Title level={4} style={{ marginTop: 8, marginBottom: 4 }}>
            s-ui-next
          </Title>
          <Text type="secondary">sing-box 管理面板</Text>
        </div>
        <Form<LoginForm> onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" autoFocus />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block>
              登 录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}