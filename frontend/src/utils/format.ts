// 格式化辅助

export function formatBytes(n: number, digits = 1): string {
  if (!n || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(digits)} ${units[i]}`
}

export function formatSpeed(bytesPerSec: number): string {
  return formatBytes(bytesPerSec) + '/s'
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '-'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (d > 0) return `${d} 天 ${h} 小时`
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${s} 秒`
  return `${s} 秒`
}

export function formatSpeedBits(bytesPerSec: number): string {
  // 网卡速率换算为常用带宽单位
  return formatSpeed(bytesPerSec)
}

// 解析/序列化「额外字段 JSON」文本框内容；空串返回空对象
export function parseExtraJSON(text: string | undefined): Record<string, unknown> {
  if (!text || !text.trim()) return {}
  const obj = JSON.parse(text)
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new Error('额外字段必须是 JSON 对象')
  }
  return obj as Record<string, unknown>
}
