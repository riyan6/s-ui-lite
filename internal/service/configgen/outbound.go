package configgen

import (
	"fmt"

	"gorm.io/gorm"

	"s-ui-next/internal/model"
)

var supportedOutboundTypes = map[string]bool{
	"direct":      true,
	"block":       true,
	"shadowsocks": true,
	"socks":       true,
}

func buildOutbounds(db *gorm.DB) ([]map[string]any, error) {
	var rows []model.Outbound
	if err := db.Where("enabled = ?", true).Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}

	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if row.Tag == "" {
			return nil, fmt.Errorf("出站 #%d 缺少 tag", row.ID)
		}
		if !supportedOutboundTypes[row.Type] {
			return nil, fmt.Errorf("出站 [%s] 类型 %q 不受支持（当前支持 direct/block/shadowsocks/socks；dns 出站已在 sing-box 1.13 移除，改用 hijack-dns 规则动作）", row.Tag, row.Type)
		}
		cfg, err := parseConfigObject(fmt.Sprintf("出站 [%s]", row.Tag), row.Config)
		if err != nil {
			return nil, err
		}

		switch row.Type {
		case "shadowsocks":
			if v, _ := cfg["server"].(string); v == "" {
				return nil, fmt.Errorf("出站 [%s] 缺少 server", row.Tag)
			}
			if p, ok := cfg["server_port"].(float64); !ok || p < 1 || p > 65535 {
				return nil, fmt.Errorf("出站 [%s] 缺少有效的 server_port", row.Tag)
			}
			if m, _ := cfg["method"].(string); m == "" {
				return nil, fmt.Errorf("出站 [%s] 缺少加密方式 method", row.Tag)
			}
			if pw, _ := cfg["password"].(string); pw == "" {
				return nil, fmt.Errorf("出站 [%s] 缺少密码 password", row.Tag)
			}
		case "socks":
			if v, _ := cfg["server"].(string); v == "" {
				return nil, fmt.Errorf("出站 [%s] 缺少 server", row.Tag)
			}
			if p, ok := cfg["server_port"].(float64); !ok || p < 1 || p > 65535 {
				return nil, fmt.Errorf("出站 [%s] 缺少有效的 server_port", row.Tag)
			}
		}

		outbound := map[string]any{"type": row.Type, "tag": row.Tag}
		mergeInto(outbound, cfg, "type", "tag")
		result = append(result, outbound)
	}
	return result, nil
}
