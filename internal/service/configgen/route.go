package configgen

import (
	"fmt"

	"gorm.io/gorm"

	"s-ui-next/internal/model"
)

// buildRoute 组装 route 段：rules（按 position 排序）、rule_set、全局设置。
// defaultResolver 非空且用户未配置 default_domain_resolver 时自动填充（sing-box 1.12+ 要求）。
// outboundTags 用于校验规则引用的出站是否存在（sing-box check 不做此校验，运行时才报错）。
func buildRoute(db *gorm.DB, defaultResolver string, outboundTags []string) (map[string]any, error) {
	var rules []model.RouteRule
	if err := db.Where("enabled = ?", true).Order("position").Order("id").Find(&rules).Error; err != nil {
		return nil, err
	}
	var ruleSets []model.RouteRuleSet
	if err := db.Where("enabled = ?", true).Order("id").Find(&ruleSets).Error; err != nil {
		return nil, err
	}
	settings, err := getSettingMap(db, "route_settings")
	if err != nil {
		return nil, err
	}

	if len(rules) == 0 && len(ruleSets) == 0 && len(settings) == 0 && defaultResolver == "" {
		return nil, nil
	}

	route := map[string]any{}
	for k, v := range settings {
		route[k] = v
	}
	delete(route, "rules")
	delete(route, "rule_set")

	if defaultResolver != "" {
		if _, exists := route["default_domain_resolver"]; !exists {
			route["default_domain_resolver"] = defaultResolver
		}
	}

	ruleList := make([]map[string]any, 0, len(rules))
	rsTagSet := map[string]bool{}
	for _, row := range ruleSets {
		rsTagSet[row.Tag] = true
	}
	outboundSet := map[string]bool{}
	for _, tag := range outboundTags {
		outboundSet[tag] = true
	}
	for _, row := range rules {
		cfg, err := parseConfigObject(fmt.Sprintf("路由规则 #%d", row.ID), row.Config)
		if err != nil {
			return nil, err
		}
		if err := validateRuleRefs(cfg, rsTagSet, outboundSet, fmt.Sprintf("路由规则 #%d", row.ID)); err != nil {
			return nil, err
		}
		ruleList = append(ruleList, cfg)
	}
	if len(ruleList) > 0 {
		route["rules"] = ruleList
	}

	ruleSetList := make([]map[string]any, 0, len(ruleSets))
	for _, row := range ruleSets {
		if row.Tag == "" {
			return nil, fmt.Errorf("规则集 #%d 缺少 tag", row.ID)
		}
		cfg, err := parseConfigObject(fmt.Sprintf("规则集 [%s]", row.Tag), row.Config)
		if err != nil {
			return nil, err
		}
		rs := map[string]any{"tag": row.Tag}
		mergeInto(rs, cfg, "tag")
		if _, ok := rs["type"]; !ok {
			return nil, fmt.Errorf("规则集 [%s] 缺少 type（local/remote/inline）", row.Tag)
		}
		ruleSetList = append(ruleSetList, rs)
	}
	if len(ruleSetList) > 0 {
		route["rule_set"] = ruleSetList
	}

	return route, nil
}

// validateRuleRefs 校验规则（含 logical 嵌套）引用的规则集与出站是否存在，
// sing-box check 不做交叉引用校验，运行时才失败，面板提前拦截。
func validateRuleRefs(rule map[string]any, ruleSetTags, outboundTags map[string]bool, owner string) error {
	if refs, ok := rule["rule_set"].([]any); ok {
		for _, ref := range refs {
			if tag, isStr := ref.(string); isStr && !ruleSetTags[tag] {
				return fmt.Errorf("%s 引用了不存在的规则集 %q（未创建或已禁用）", owner, tag)
			}
		}
	}
	if ob, ok := rule["outbound"].(string); ok && ob != "" && !outboundTags[ob] {
		return fmt.Errorf("%s 引用了不存在的出站 %q（未创建或已禁用）", owner, ob)
	}
	// logical 规则递归校验子规则
	if sub, ok := rule["rules"].([]any); ok {
		for _, item := range sub {
			if subRule, isMap := item.(map[string]any); isMap {
				if err := validateRuleRefs(subRule, ruleSetTags, outboundTags, owner+" (logical)"); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
