// 与后端 API 对应的数据类型

export interface Client {
  id: number
  inbound_id: number
  name: string
  credential: string
  enabled: boolean
  expire_at: string | null
  meta: string
  created_at: string
  updated_at: string
}

export interface Inbound {
  id: number
  tag: string
  type: 'shadowsocks' | 'vless'
  listen: string
  port: number
  enabled: boolean
  config: Record<string, unknown>
  clients?: Client[]
  created_at: string
  updated_at: string
}

export interface Outbound {
  id: number
  tag: string
  type: 'direct' | 'block' | 'shadowsocks' | 'socks'
  enabled: boolean
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface RouteRule {
  id: number
  position: number
  enabled: boolean
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface RouteRuleSet {
  id: number
  tag: string
  enabled: boolean
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface DnsServer {
  id: number
  tag: string
  type: string
  position: number
  enabled: boolean
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface DnsRule {
  id: number
  position: number
  enabled: boolean
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface NetSpeed {
  upload: number
  download: number
}

export interface ServerStatus {
  os: string
  arch: string
  cpu_percent: number
  cpu_core_count: number
  mem_total: number
  mem_used: number
  mem_percent: number
  swap_total: number
  swap_used: number
  net: NetSpeed
  net_total_up: number
  net_total_down: number
  disk_total: number
  disk_free: number
  load_1: number
  load_5: number
  load_15: number
  uptime_seconds: number
  panel_uptime_seconds: number
}

export interface CoreStatus {
  state: string
  running: boolean
  pid: number
  restarts: number
  started_at: string
  last_error: string
  core_version: string
  binary_path: string
}

export interface PanelSettings {
  admin_username: string
  must_change_password: boolean
  core_binary_path: string
  core_log_level: string
  core_auto_restart: boolean
  route_settings: Record<string, unknown>
  dns_settings: Record<string, unknown>
  panel_port: number
}
