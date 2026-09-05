import { useEffect, useMemo, useState } from 'react'
import { Modal, Form, Input, InputNumber, Typography, App as AntdApp, Alert } from 'antd'
import { QRCodeCanvas } from 'qrcode.react'
import { api } from '../api/client'
import type { Client, Inbound } from '../api/types'

const { Paragraph, Text } = Typography

function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function clientFlow(inbound: Inbound, client: Client): string {
  try {
    if (client.meta) {
      const meta = JSON.parse(client.meta)
      if (typeof meta.flow === 'string') return meta.flow
    }
  } catch {
    /* ignore */
  }
  const flow = inbound.config.flow
  return typeof flow === 'string' ? flow : ''
}

interface Props {
  open: boolean
  onClose: () => void
  inbound: Inbound | null
  client: Client | null
}

export default function ShareModal({ open, onClose, inbound, client }: Props) {
  const { message } = AntdApp.useApp()
  const [host, setHost] = useState('')
  const [port, setPort] = useState<number>(0)
  const [uri, setUri] = useState('')
  const [snippet, setSnippet] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && inbound && client) {
      setHost(window.location.hostname)
      setPort(inbound.port)
      setError('')
    }
  }, [open, inbound, client])

  // VLESS Reality 分享链接需要公钥（面板接口从私钥推导）
  const [pubKey, setPubKey] = useState('')
  useEffect(() => {
    if (!open || !inbound || !client || inbound.type !== 'vless') {
      setPubKey('')
      return
    }
    const tls = inbound.config.tls as Record<string, unknown> | undefined
    const reality = tls?.reality as Record<string, unknown> | undefined
    const priv = reality?.private_key
    if (typeof priv !== 'string' || !priv) {
      setError('该入站未配置 Reality 私钥，无法生成分享链接')
      setPubKey('')
      return
    }
    api
      .get<{ public_key: string }>('/tools/reality-pubkey', { private_key: priv })
      .then((r) => {
        setPubKey(r.public_key)
        setError('')
      })
      .catch((e) => setError((e as Error).message))
  }, [open, inbound, client])

  useEffect(() => {
    if (!inbound || !client || !host || !port) {
      setUri('')
      setSnippet('')
      return
    }
    if (inbound.type === 'shadowsocks') {
      setSnippet('')
      const method = String(inbound.config.method ?? '')
      setUri(`ss://${b64url(`${method}:${client.credential}`)}@${host}:${port}#${encodeURIComponent(client.name)}`)
    } else if (inbound.type === 'snell') {
      // Snell 无统一 URI 分享格式，输出 sing-box 客户端出站配置片段
      setUri('')
      const cfg = inbound.config
      const outbound: Record<string, unknown> = {
        type: 'snell',
        tag: client.name,
        server: host,
        server_port: port,
        version: typeof cfg.version === 'number' ? cfg.version : 6,
        psk: client.credential,
      }
      if (typeof cfg.mode === 'string' && cfg.mode) outbound.mode = cfg.mode
      if (typeof cfg.obfs_mode === 'string' && cfg.obfs_mode) outbound.obfs_mode = cfg.obfs_mode
      setSnippet(JSON.stringify(outbound, null, 2))
    } else {
      if (!pubKey) {
        setUri('')
        return
      }
      const tls = inbound.config.tls as Record<string, unknown> | undefined
      const reality = tls?.reality as Record<string, unknown> | undefined
      const handshake = reality?.handshake as Record<string, unknown> | undefined
      const sni = String(tls?.server_name || handshake?.server || '')
      const shortIds = reality?.short_id
      const sid = Array.isArray(shortIds) && shortIds.length > 0 ? String(shortIds[0]) : ''
      const flow = clientFlow(inbound, client)
      const params = new URLSearchParams({
        encryption: 'none',
        security: 'reality',
        sni,
        fp: 'chrome',
        pbk: pubKey,
        type: 'tcp',
      })
      if (sid) params.set('sid', sid)
      if (flow) params.set('flow', flow)
      setUri(`vless://${client.credential}@${host}:${port}?${params.toString()}#${encodeURIComponent(client.name)}`)
    }
  }, [inbound, client, host, port, pubKey])

  const qr = useMemo(() => (uri ? <QRCodeCanvas value={uri} size={200} includeMargin /> : null), [uri])

  return (
    <Modal
      title={`分享链接 - ${client?.name ?? ''}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={460}
      destroyOnHidden
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form layout="vertical">
        <Form.Item label="服务器地址">
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="客户端连接使用的地址" />
        </Form.Item>
        <Form.Item label="端口">
          <InputNumber value={port} min={1} max={65535} onChange={(v) => setPort(v ?? 0)} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
      {uri && (
        <>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>{qr}</div>
          <Paragraph copyable={{ text: uri }} style={{ marginBottom: 4 }}>
            <Text type="secondary">点击复制链接：</Text>
          </Paragraph>
          <Paragraph style={{ wordBreak: 'break-all', fontSize: 12 }}>
            <Text code>{uri}</Text>
          </Paragraph>
        </>
      )}
      {!uri && snippet && (
        <>
          <Paragraph copyable={{ text: snippet }} style={{ marginBottom: 4 }}>
            <Text type="secondary">Snell 无统一分享链接，复制以下 sing-box 客户端出站配置：</Text>
          </Paragraph>
          <Paragraph style={{ margin: 0 }}>
            <pre
              style={{
                margin: 0,
                padding: 10,
                borderRadius: 6,
                fontSize: 12,
                background: 'var(--ant-color-fill-quaternary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {snippet}
            </pre>
          </Paragraph>
        </>
      )}
    </Modal>
  )
}
