package configgen

import (
	"encoding/base64"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"s-ui-next/internal/model"
)

const (
	InboundTypeShadowsocks = "shadowsocks"
	InboundTypeVless       = "vless"
)

// ss2022 系加密方式与密钥字节长度对照
var ss2022KeyLengths = map[string]int{
	"2022-blake3-aes-128-gcm":          16,
	"2022-blake3-aes-256-gcm":          32,
	"2022-blake3-chacha20-poly1305":    32,
}

func buildInbounds(db *gorm.DB) ([]map[string]any, error) {
	var rows []model.Inbound
	if err := db.Where("enabled = ?", true).Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}

	usedPorts := map[int]string{}
	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if row.Tag == "" {
			return nil, fmt.Errorf("入站 #%d 缺少 tag", row.ID)
		}
		if row.Port < 1 || row.Port > 65535 {
			return nil, fmt.Errorf("入站 [%s] 端口 %d 无效", row.Tag, row.Port)
		}
		if prev, dup := usedPorts[row.Port]; dup {
			return nil, fmt.Errorf("入站 [%s] 与 [%s] 端口 %d 冲突", row.Tag, prev, row.Port)
		}
		usedPorts[row.Port] = row.Tag

		clients, err := activeClients(db, row.ID)
		if err != nil {
			return nil, err
		}

		var inbound map[string]any
		switch row.Type {
		case InboundTypeShadowsocks:
			inbound, err = buildShadowsocks(&row, clients)
		case InboundTypeVless:
			inbound, err = buildVless(&row, clients)
		default:
			err = fmt.Errorf("入站 [%s] 类型 %q 不受支持（当前支持 shadowsocks / vless）", row.Tag, row.Type)
		}
		if err != nil {
			return nil, err
		}
		result = append(result, inbound)
	}
	return result, nil
}

// activeClients 取启用中且未过期的客户端（到期自动从配置中移除）
func activeClients(db *gorm.DB, inboundID uint) ([]model.Client, error) {
	var clients []model.Client
	if err := db.Where("inbound_id = ? AND enabled = ?", inboundID, true).Order("id").Find(&clients).Error; err != nil {
		return nil, err
	}
	now := time.Now()
	active := make([]model.Client, 0, len(clients))
	for _, c := range clients {
		if c.ExpireAt != nil && c.ExpireAt.Before(now) {
			continue
		}
		active = append(active, c)
	}
	return active, nil
}

func inboundBase(row *model.Inbound) map[string]any {
	listen := row.Listen
	if listen == "" {
		listen = "::"
	}
	return map[string]any{
		"type":        row.Type,
		"tag":         row.Tag,
		"listen":      listen,
		"listen_port": row.Port,
	}
}

func buildShadowsocks(row *model.Inbound, clients []model.Client) (map[string]any, error) {
	cfg, err := parseConfigObject(fmt.Sprintf("入站 [%s]", row.Tag), row.Config)
	if err != nil {
		return nil, err
	}

	method, _ := cfg["method"].(string)
	if method == "" {
		return nil, fmt.Errorf("入站 [%s] 缺少加密方式 method", row.Tag)
	}

	inbound := inboundBase(row)
	keyLen, is2022 := ss2022KeyLengths[method]

	if is2022 {
		// 2022 系：服务端密钥 + 多用户密钥，均为定长 base64
		serverKey, _ := cfg["password"].(string)
		if err := checkSS2022Key(serverKey, keyLen); err != nil {
			return nil, fmt.Errorf("入站 [%s] 服务端密钥无效: %v", row.Tag, err)
		}
		users := make([]map[string]any, 0, len(clients))
		for _, c := range clients {
			if c.Name == "" {
				return nil, fmt.Errorf("入站 [%s] 存在未命名客户端 #%d", row.Tag, c.ID)
			}
			if err := checkSS2022Key(c.Credential, keyLen); err != nil {
				return nil, fmt.Errorf("入站 [%s] 客户端 [%s] 密钥无效: %v", row.Tag, c.Name, err)
			}
			users = append(users, map[string]any{"name": c.Name, "password": c.Credential})
		}
		mergeInto(inbound, cfg, "type", "tag", "listen", "listen_port")
		if len(users) > 0 {
			inbound["users"] = users
		}
		return inbound, nil
	}

	// 传统加密：不支持多用户，客户端凭证即入站密码
	if len(clients) > 1 {
		return nil, fmt.Errorf("入站 [%s] 使用传统加密方式，仅支持单密码（多客户端需要 2022 系加密）", row.Tag)
	}
	if len(clients) == 1 {
		if _, ok := cfg["password"]; !ok {
			cfg["password"] = clients[0].Credential
		}
	}
	if _, ok := cfg["password"]; !ok {
		return nil, fmt.Errorf("入站 [%s] 缺少密码 password", row.Tag)
	}
	mergeInto(inbound, cfg, "type", "tag", "listen", "listen_port")
	return inbound, nil
}

func checkSS2022Key(key string, length int) error {
	if key == "" {
		return fmt.Errorf("不能为空（需要 %d 字节 base64 密钥）", length)
	}
	raw, err := base64.StdEncoding.DecodeString(key)
	if err != nil {
		return fmt.Errorf("不是合法的 base64 字符串")
	}
	if len(raw) != length {
		return fmt.Errorf("解码后为 %d 字节，需要 %d 字节", len(raw), length)
	}
	return nil
}

func buildVless(row *model.Inbound, clients []model.Client) (map[string]any, error) {
	cfg, err := parseConfigObject(fmt.Sprintf("入站 [%s]", row.Tag), row.Config)
	if err != nil {
		return nil, err
	}

	if len(clients) == 0 {
		return nil, fmt.Errorf("VLESS 入站 [%s] 至少需要一个启用中的客户端", row.Tag)
	}

	// 面板扩展字段 flow：入站级默认 flow，客户端 meta.flow 可覆盖
	defaultFlow, _ := cfg["flow"].(string)
	delete(cfg, "flow")

	// Reality 常见配置错误的前置校验（最终以 sing-box check 为准）
	if tls, ok := cfg["tls"].(map[string]any); ok {
		if reality, ok := tls["reality"].(map[string]any); ok {
			if enabled, _ := reality["enabled"].(bool); enabled {
				if pk, _ := reality["private_key"].(string); pk == "" {
					return nil, fmt.Errorf("入站 [%s] Reality 缺少 private_key", row.Tag)
				}
				if hs, ok := reality["handshake"].(map[string]any); ok {
					if server, _ := hs["server"].(string); server == "" {
						return nil, fmt.Errorf("入站 [%s] Reality handshake 缺少 server", row.Tag)
					}
				} else {
					return nil, fmt.Errorf("入站 [%s] Reality 缺少 handshake 配置", row.Tag)
				}
			}
		}
	}

	users := make([]map[string]any, 0, len(clients))
	for _, c := range clients {
		if c.Name == "" {
			return nil, fmt.Errorf("入站 [%s] 存在未命名客户端 #%d", row.Tag, c.ID)
		}
		if _, err := uuid.Parse(c.Credential); err != nil {
			return nil, fmt.Errorf("入站 [%s] 客户端 [%s] 的 UUID 无效", row.Tag, c.Name)
		}
		user := map[string]any{"name": c.Name, "uuid": c.Credential}
		flow := defaultFlow
		if meta := parseMeta(c.Meta); meta != nil {
			if f, ok := meta["flow"].(string); ok {
				flow = f
			}
		}
		if flow != "" {
			user["flow"] = flow
		}
		users = append(users, user)
	}

	inbound := inboundBase(row)
	mergeInto(inbound, cfg, "type", "tag", "listen", "listen_port")
	inbound["users"] = users
	return inbound, nil
}

func parseMeta(raw string) map[string]any {
	if raw == "" {
		return nil
	}
	meta := map[string]any{}
	if jsonUnmarshalStr(raw, &meta) != nil {
		return nil
	}
	return meta
}
