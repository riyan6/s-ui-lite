// Package configgen 从数据库生成完整的 sing-box 配置。
// 面板是 sing-box 配置的唯一可信来源：入站/出站/路由/DNS/日志全部结构化存库，
// 每次变更后重新生成、经 sing-box check 校验通过后才落盘并重启核心。
package configgen

import (
	"encoding/json"
	"fmt"

	"gorm.io/gorm"

	"s-ui-next/internal/model"
)

// Generate 从给定数据库连接（支持事务内调用）生成完整 sing-box 配置
func Generate(db *gorm.DB) ([]byte, error) {
	cfg := map[string]any{}

	// log
	level, err := getSettingString(db, "core_log_level", "info")
	if err != nil {
		return nil, err
	}
	cfg["log"] = map[string]any{"level": level, "timestamp": true}

	// inbounds
	inbounds, err := buildInbounds(db)
	if err != nil {
		return nil, err
	}
	if len(inbounds) > 0 {
		cfg["inbounds"] = inbounds
	}

	// outbounds
	outbounds, err := buildOutbounds(db)
	if err != nil {
		return nil, err
	}
	if len(outbounds) > 0 {
		cfg["outbounds"] = outbounds
	}
	outboundTags := make([]string, 0, len(outbounds))
	for _, ob := range outbounds {
		if tag, ok := ob["tag"].(string); ok {
			outboundTags = append(outboundTags, tag)
		}
	}

	// dns
	dns, err := buildDns(db)
	if err != nil {
		return nil, err
	}
	if dns != nil {
		cfg["dns"] = dns
	}

	// route
	// sing-box 1.12+ 要求 DNS 模块启用时必须设置 route.default_domain_resolver，
	// 面板默认取第一个 DNS 服务器，用户可在路由全局设置中覆盖。
	defaultResolver := ""
	if dns != nil {
		if servers, ok := dns["servers"].([]map[string]any); ok && len(servers) > 0 {
			if tag, ok := servers[0]["tag"].(string); ok {
				defaultResolver = tag
			}
		}
	}
	route, err := buildRoute(db, defaultResolver, outboundTags)
	if err != nil {
		return nil, err
	}
	if route != nil {
		cfg["route"] = route
	}

	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, err
	}
	return raw, nil
}

// ---- 通用工具 ----

func jsonUnmarshalStr(raw string, dst any) error {
	return json.Unmarshal([]byte(raw), dst)
}

// parseConfigObject 解析实体 Config 列为 JSON 对象，invalidJSON 报可读错误
func parseConfigObject(owner string, raw string) (map[string]any, error) {
	obj := map[string]any{}
	if raw == "" {
		return obj, nil
	}
	if err := json.Unmarshal([]byte(raw), &obj); err != nil {
		return nil, fmt.Errorf("%s 的 config 不是合法的 JSON 对象: %v", owner, err)
	}
	return obj, nil
}

// mergeInto 将 config 对象合并到目标（跳过面板保留字段），后写覆盖
func mergeInto(dst map[string]any, src map[string]any, reserved ...string) {
	blocked := map[string]bool{}
	for _, k := range reserved {
		blocked[k] = true
	}
	for k, v := range src {
		if blocked[k] {
			continue
		}
		dst[k] = v
	}
}

func getSettingString(db *gorm.DB, key, def string) (string, error) {
	var setting model.Setting
	err := db.Where("key = ?", key).First(&setting).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return def, nil
		}
		return "", err
	}
	var v string
	if json.Unmarshal([]byte(setting.Value), &v) != nil || v == "" {
		return def, nil
	}
	return v, nil
}

func getSettingMap(db *gorm.DB, key string) (map[string]any, error) {
	var setting model.Setting
	err := db.Where("key = ?", key).First(&setting).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return map[string]any{}, nil
		}
		return nil, err
	}
	v := map[string]any{}
	if setting.Value != "" {
		if err := json.Unmarshal([]byte(setting.Value), &v); err != nil {
			return nil, fmt.Errorf("设置 %s 的值不是合法 JSON: %v", key, err)
		}
	}
	return v, nil
}
