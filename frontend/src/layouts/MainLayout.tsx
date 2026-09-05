import { Layout, Menu, Button, Space, Typography, Tooltip, theme } from 'antd'
import {
  DashboardOutlined,
  ApiOutlined,
  SendOutlined,
  NodeIndexOutlined,
  GlobalOutlined,
  ClusterOutlined,
  MonitorOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SunOutlined,
  LogoutOutlined,
  ThunderboltFilled,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useTheme } from '../theme'
import { clearToken } from '../api/client'

const { Header, Sider, Content, Footer } = Layout
const { Text } = Typography

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/inbounds', icon: <ApiOutlined />, label: '入站管理' },
  { key: '/outbounds', icon: <SendOutlined />, label: '出站管理' },
  { key: '/routing', icon: <NodeIndexOutlined />, label: '路由管理' },
  { key: '/dns', icon: <GlobalOutlined />, label: 'DNS 管理' },
  { key: '/services', icon: <ClusterOutlined />, label: '服务管理' },
  { key: '/runtime', icon: <MonitorOutlined />, label: '运行管理' },
  { key: '/settings', icon: <SettingOutlined />, label: '面板设置' },
]

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const { isDark, toggle } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const { token } = theme.useToken()

  const selected = location.pathname === '/' ? '/' : '/' + location.pathname.split('/')[1]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="light"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={208}
        collapsedWidth={60}
        style={{
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorSplit}`,
        }}
      >
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? 0 : '0 20px',
            gap: 8,
            color: token.colorText,
          }}
        >
          <ThunderboltFilled style={{ fontSize: 18, color: token.colorPrimary }} />
          {!collapsed && (
            <Text strong style={{ fontSize: 14, letterSpacing: 1 }}>
              S-UI Next
            </Text>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            height: 48,
            lineHeight: '48px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorSplit}`,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((v) => !v)}
          />
          <Space>
            <Tooltip title={isDark ? '亮色主题' : '暗色主题'}>
              <Button type="text" icon={isDark ? <SunOutlined /> : <MoonOutlined />} onClick={toggle} />
            </Tooltip>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => {
                clearToken()
                navigate('/login')
              }}
            >
              注销
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
        <Footer style={{ textAlign: 'center', padding: '8px 0' }}>
          <Text type="secondary">s-ui-next · sing-box 管理面板</Text>
        </Footer>
      </Layout>
    </Layout>
  )
}
