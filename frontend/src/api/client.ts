// 统一 API 客户端：自动携带 JWT，统一处理 { success, msg, obj } 响应约定
export interface ApiResp<T = unknown> {
  success: boolean
  msg: string
  obj: T
}

const TOKEN_KEY = 'sui-token'

export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? ''
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

export async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  let url = '/api/v1' + path
  if (query) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') qs.set(k, String(v))
    }
    const s = qs.toString()
    if (s) url += '?' + s
  }

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + getToken(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('无法连接到服务器，请确认面板服务正在运行')
  }

  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('登录已过期')
  }

  // 空响应体 / 非 JSON（如反向代理返回的 HTML 错误页）都给出可读提示
  let data: ApiResp<T>
  try {
    const text = await res.text()
    if (!text) throw new Error('empty')
    data = JSON.parse(text) as ApiResp<T>
  } catch {
    throw new Error(`服务器响应异常（HTTP ${res.status}），请稍后重试`)
  }
  if (!data.success) {
    throw new Error(data.msg || '请求失败')
  }
  return data.obj
}

export const api = {
  get: <T = unknown>(path: string, query?: Record<string, string | number | undefined>) =>
    request<T>('GET', path, undefined, query),
  post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T = unknown>(path: string) => request<T>('DELETE', path),
}
