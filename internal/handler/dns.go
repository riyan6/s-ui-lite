package handler

import (
	"errors"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"s-ui-next/internal/model"
	"s-ui-next/internal/service"
)

// ---- DNS 服务器 ----

type dnsServerPayload struct {
	Tag     *string        `json:"tag"`
	Type    *string        `json:"type"`
	Enabled *bool          `json:"enabled"`
	Config  map[string]any `json:"config"`
}

func (h *Handler) listDnsServers(c *gin.Context) {
	var servers []model.DnsServer
	if err := h.db.Order("position").Order("id").Find(&servers).Error; err != nil {
		fail(c, err)
		return
	}
	result := make([]map[string]any, 0, len(servers))
	for _, s := range servers {
		result = append(result, map[string]any{
			"id": s.ID, "tag": s.Tag, "type": s.Type, "position": s.Position,
			"enabled": s.Enabled, "config": parseJSONObj(s.Config),
			"created_at": s.CreatedAt, "updated_at": s.UpdatedAt,
		})
	}
	ok(c, result, "")
}

func (h *Handler) createDnsServer(c *gin.Context) {
	var payload dnsServerPayload
	if !bindJSON(c, &payload) {
		return
	}
	if payload.Tag == nil || *payload.Tag == "" {
		failStr(c, "DNS 服务器 tag 不能为空")
		return
	}
	if payload.Type == nil || *payload.Type == "" {
		failStr(c, "DNS 服务器类型不能为空（local/udp/tcp/tls/https/quic/h3/dhcp...）")
		return
	}
	enabled := payload.Enabled == nil || *payload.Enabled

	h.withPipeline(c, func(tx *gorm.DB) error {
		var maxPos int
		if err := tx.Model(&model.DnsServer{}).Select("COALESCE(MAX(position), 0)").Scan(&maxPos).Error; err != nil {
			return err
		}
		server := model.DnsServer{
			Tag: *payload.Tag, Type: *payload.Type, Enabled: enabled,
			Position: maxPos + 1, Config: marshalConfig(orEmptyMap(payload.Config)),
		}
		return tx.Create(&server).Error
	})
}

func (h *Handler) updateDnsServer(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	var payload dnsServerPayload
	if !bindJSON(c, &payload) {
		return
	}

	h.withPipeline(c, func(tx *gorm.DB) error {
		var server model.DnsServer
		if err := tx.First(&server, id).Error; err != nil {
			return errors.New("DNS 服务器不存在")
		}
		if payload.Tag != nil {
			if *payload.Tag == "" {
				return errors.New("tag 不能为空")
			}
			server.Tag = *payload.Tag
		}
		if payload.Type != nil {
			if *payload.Type == "" {
				return errors.New("类型不能为空")
			}
			server.Type = *payload.Type
		}
		if payload.Enabled != nil {
			server.Enabled = *payload.Enabled
		}
		if payload.Config != nil {
			server.Config = marshalConfig(payload.Config)
		}
		return tx.Save(&server).Error
	})
}

func (h *Handler) deleteDnsServer(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		return tx.Delete(&model.DnsServer{}, id).Error
	})
}

func (h *Handler) orderDnsServers(c *gin.Context) {
	var payload orderPayload
	if !bindJSON(c, &payload) {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		for i, id := range payload.IDs {
			if err := tx.Model(&model.DnsServer{}).Where("id = ?", id).
				Update("position", i+1).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// ---- DNS 分流规则 ----

type dnsRulePayload struct {
	Enabled *bool          `json:"enabled"`
	Config  map[string]any `json:"config"`
}

func (h *Handler) listDnsRules(c *gin.Context) {
	var rules []model.DnsRule
	if err := h.db.Order("position").Order("id").Find(&rules).Error; err != nil {
		fail(c, err)
		return
	}
	result := make([]map[string]any, 0, len(rules))
	for _, r := range rules {
		result = append(result, map[string]any{
			"id": r.ID, "position": r.Position, "enabled": r.Enabled,
			"config": parseJSONObj(r.Config),
			"created_at": r.CreatedAt, "updated_at": r.UpdatedAt,
		})
	}
	ok(c, result, "")
}

func (h *Handler) createDnsRule(c *gin.Context) {
	var payload dnsRulePayload
	if !bindJSON(c, &payload) {
		return
	}
	if payload.Config == nil {
		failStr(c, "规则内容 config 不能为空")
		return
	}
	enabled := payload.Enabled == nil || *payload.Enabled

	h.withPipeline(c, func(tx *gorm.DB) error {
		var maxPos int
		if err := tx.Model(&model.DnsRule{}).Select("COALESCE(MAX(position), 0)").Scan(&maxPos).Error; err != nil {
			return err
		}
		rule := model.DnsRule{
			Position: maxPos + 1, Enabled: enabled,
			Config: marshalConfig(payload.Config),
		}
		return tx.Create(&rule).Error
	})
}

func (h *Handler) updateDnsRule(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	var payload dnsRulePayload
	if !bindJSON(c, &payload) {
		return
	}

	h.withPipeline(c, func(tx *gorm.DB) error {
		var rule model.DnsRule
		if err := tx.First(&rule, id).Error; err != nil {
			return errors.New("DNS 规则不存在")
		}
		if payload.Enabled != nil {
			rule.Enabled = *payload.Enabled
		}
		if payload.Config != nil {
			rule.Config = marshalConfig(payload.Config)
		}
		return tx.Save(&rule).Error
	})
}

func (h *Handler) deleteDnsRule(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		return tx.Delete(&model.DnsRule{}, id).Error
	})
}

func (h *Handler) orderDnsRules(c *gin.Context) {
	var payload orderPayload
	if !bindJSON(c, &payload) {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		for i, id := range payload.IDs {
			if err := tx.Model(&model.DnsRule{}).Where("id = ?", id).
				Update("position", i+1).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// ---- DNS 全局设置 ----

func (h *Handler) getDnsSettings(c *gin.Context) {
	ok(c, h.settings.GetJSON(service.KeyDnsSettings), "")
}

func (h *Handler) putDnsSettings(c *gin.Context) {
	var payload map[string]any
	if !bindJSON(c, &payload) {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		return h.settings.Set(tx, service.KeyDnsSettings, payload)
	})
}
