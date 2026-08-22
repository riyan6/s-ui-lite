package configgen

import (
	"fmt"

	"gorm.io/gorm"

	"s-ui-next/internal/model"
)

var supportedDnsServerTypes = map[string]bool{
	"local": true, "hosts": true, "tcp": true, "udp": true, "tls": true,
	"https": true, "quic": true, "h3": true, "dhcp": true, "fakeip": true,
}

// buildDns 组装 dns 段：servers / rules（按 position 排序）/ 全局设置。
// 没有任何启用的 DNS 服务器时返回 nil（省略 dns 段）。
func buildDns(db *gorm.DB) (map[string]any, error) {
	var servers []model.DnsServer
	if err := db.Where("enabled = ?", true).Order("position").Order("id").Find(&servers).Error; err != nil {
		return nil, err
	}
	if len(servers) == 0 {
		return nil, nil
	}

	var rules []model.DnsRule
	if err := db.Where("enabled = ?", true).Order("position").Order("id").Find(&rules).Error; err != nil {
		return nil, err
	}
	settings, err := getSettingMap(db, "dns_settings")
	if err != nil {
		return nil, err
	}

	dns := map[string]any{}
	for k, v := range settings {
		dns[k] = v
	}
	delete(dns, "servers")
	delete(dns, "rules")

	serverList := make([]map[string]any, 0, len(servers))
	for _, row := range servers {
		if row.Tag == "" {
			return nil, fmt.Errorf("DNS 服务器 #%d 缺少 tag", row.ID)
		}
		if !supportedDnsServerTypes[row.Type] {
			return nil, fmt.Errorf("DNS 服务器 [%s] 类型 %q 不受支持", row.Tag, row.Type)
		}
		cfg, err := parseConfigObject(fmt.Sprintf("DNS 服务器 [%s]", row.Tag), row.Config)
		if err != nil {
			return nil, err
		}
		server := map[string]any{"type": row.Type, "tag": row.Tag}
		mergeInto(server, cfg, "type", "tag")
		serverList = append(serverList, server)
	}
	dns["servers"] = serverList

	if len(rules) > 0 {
		serverTags := map[string]bool{}
		for _, row := range servers {
			serverTags[row.Tag] = true
		}
		ruleList := make([]map[string]any, 0, len(rules))
		for _, row := range rules {
			cfg, err := parseConfigObject(fmt.Sprintf("DNS 规则 #%d", row.ID), row.Config)
			if err != nil {
				return nil, err
			}
			// 校验 route 动作引用的 DNS 服务器是否存在
			action, _ := cfg["action"].(string)
			if action == "" {
				action = "route"
			}
			if server, ok := cfg["server"].(string); ok && action == "route" && !serverTags[server] {
				return nil, fmt.Errorf("DNS 规则 #%d 引用了不存在的 DNS 服务器 %q", row.ID, server)
			}
			ruleList = append(ruleList, cfg)
		}
		dns["rules"] = ruleList
	}

	return dns, nil
}
