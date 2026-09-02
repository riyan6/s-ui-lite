package model

import "time"

// Setting KV 设置表，value 存 JSON 字符串
type Setting struct {
	Key   string `gorm:"primaryKey;size:128"`
	Value string `gorm:"type:text"`
}

// Inbound 入站。Type: shadowsocks / vless
// Config 存协议专属字段的 JSON（不含 type/tag/listen/listen_port），
// 结构与 sing-box 官方文档一一对应，前端表单能填多少存多少，生成时原样合并。
type Inbound struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Tag       string    `gorm:"uniqueIndex;size:128" json:"tag"`
	Type      string    `gorm:"size:32;index" json:"type"`
	Listen    string    `gorm:"size:64" json:"listen"`
	Port      int       `gorm:"uniqueIndex" json:"port"`
	Enabled   bool      `json:"enabled"`
	Config    string    `gorm:"type:text" json:"config"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Client 入站下的客户端凭证（SS 存密码 / VLESS 存 UUID）
// 客户端不提供启用开关：创建后一律启用，仅按 ExpireAt 到期自动从配置中移除。
type Client struct {
	ID         uint       `gorm:"primaryKey" json:"id"`
	InboundID  uint       `gorm:"index" json:"inbound_id"`
	Name       string     `gorm:"size:128" json:"name"`
	Credential string     `gorm:"type:text" json:"credential"`
	ExpireAt   *time.Time `json:"expire_at"`
	Meta       string     `gorm:"type:text" json:"meta"` // JSON 扩展字段，如 vless 单独的 flow
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// Outbound 出站。Type: direct / block / dns / shadowsocks / socks
type Outbound struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Tag       string    `gorm:"uniqueIndex;size:128" json:"tag"`
	Type      string    `gorm:"size:32;index" json:"type"`
	Enabled   bool      `json:"enabled"`
	Config    string    `gorm:"type:text" json:"config"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// RouteRule 路由规则。Config 存完整规则 JSON（条件 + action + 出站等），
// 生成时按 Position 顺序原样输出。
type RouteRule struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Position  int       `gorm:"index" json:"position"`
	Enabled   bool      `json:"enabled"`
	Config    string    `gorm:"type:text" json:"config"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// RouteRuleSet 规则集声明（geosite/geoip 等）。Config 存
// {type, format, url, update_interval, download_detour...}，不含 tag。
type RouteRuleSet struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Tag       string    `gorm:"uniqueIndex;size:128" json:"tag"`
	Enabled   bool      `json:"enabled"`
	Config    string    `gorm:"type:text" json:"config"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// DnsServer DNS 服务器。Type: local / udp / tcp / tls / https / quic / h3 / dhcp / ...
// Config 存除 type/tag 外的字段（server、server_port、detour 等）。
type DnsServer struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Tag       string    `gorm:"uniqueIndex;size:128" json:"tag"`
	Type      string    `gorm:"size:32" json:"type"`
	Position  int       `gorm:"index" json:"position"`
	Enabled   bool      `json:"enabled"`
	Config    string    `gorm:"type:text" json:"config"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// DnsRule DNS 分流规则。Config 存完整规则 JSON（域名条件 + action + server）。
type DnsRule struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Position  int       `gorm:"index" json:"position"`
	Enabled   bool      `json:"enabled"`
	Config    string    `gorm:"type:text" json:"config"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AllModels 返回需要自动迁移的全部模型
func AllModels() []any {
	return []any{
		&Setting{}, &Inbound{}, &Client{}, &Outbound{},
		&RouteRule{}, &RouteRuleSet{}, &DnsServer{}, &DnsRule{},
	}
}
