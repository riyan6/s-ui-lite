import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { App as AntdApp, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'

dayjs.locale('zh-cn')

interface ThemeCtxValue {
  isDark: boolean
  toggle: () => void
}

const ThemeCtx = createContext<ThemeCtxValue>({ isDark: true, toggle: () => {} })

export function useTheme() {
  return useContext(ThemeCtx)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(() => localStorage.getItem('sui-theme') !== 'light')

  useEffect(() => {
    localStorage.setItem('sui-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  return (
    <ThemeCtx.Provider value={{ isDark, toggle: () => setIsDark((v) => !v) }}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: { borderRadius: 6 },
        }}
      >
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeCtx.Provider>
  )
}
