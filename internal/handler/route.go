package handler

import (
	"errors"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"s-ui-next/internal/model"
	"s-ui-next/internal/service"
)

// ---- 路由规则 ----

type rulePayload struct {
	Enabled *bool          `json:"enabled"`
	Config  map[string]any `json:"config"`
}

func (h *Handler) listRouteRules(c *gin.Context) {
	var rules []model.RouteRule
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

func (h *Handler) createRouteRule(c *gin.Context) {
	var payload rulePayload
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
		if err := tx.Model(&model.RouteRule{}).Select("COALESCE(MAX(position), 0)").Scan(&maxPos).Error; err != nil {
			return err
		}
		rule := model.RouteRule{
			Position: maxPos + 1, Enabled: enabled,
			Config: marshalConfig(payload.Config),
		}
		return tx.Create(&rule).Error
	})
}

func (h *Handler) updateRouteRule(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	var payload rulePayload
	if !bindJSON(c, &payload) {
		return
	}

	h.withPipeline(c, func(tx *gorm.DB) error {
		var rule model.RouteRule
		if err := tx.First(&rule, id).Error; err != nil {
			return errors.New("路由规则不存在")
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

func (h *Handler) deleteRouteRule(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		return tx.Delete(&model.RouteRule{}, id).Error
	})
}

type orderPayload struct {
	IDs []uint `json:"ids" binding:"required"`
}

// orderRouteRules 按传入的 id 顺序重排规则
func (h *Handler) orderRouteRules(c *gin.Context) {
	var payload orderPayload
	if !bindJSON(c, &payload) {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		for i, id := range payload.IDs {
			if err := tx.Model(&model.RouteRule{}).Where("id = ?", id).
				Update("position", i+1).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// ---- 规则集 ----

type ruleSetPayload struct {
	Tag     *string        `json:"tag"`
	Enabled *bool          `json:"enabled"`
	Config  map[string]any `json:"config"`
}

func (h *Handler) listRuleSets(c *gin.Context) {
	var sets []model.RouteRuleSet
	if err := h.db.Order("id").Find(&sets).Error; err != nil {
		fail(c, err)
		return
	}
	result := make([]map[string]any, 0, len(sets))
	for _, s := range sets {
		result = append(result, map[string]any{
			"id": s.ID, "tag": s.Tag, "enabled": s.Enabled,
			"config": parseJSONObj(s.Config),
			"created_at": s.CreatedAt, "updated_at": s.UpdatedAt,
		})
	}
	ok(c, result, "")
}

func (h *Handler) createRuleSet(c *gin.Context) {
	var payload ruleSetPayload
	if !bindJSON(c, &payload) {
		return
	}
	if payload.Tag == nil || *payload.Tag == "" {
		failStr(c, "规则集 tag 不能为空")
		return
	}
	enabled := payload.Enabled == nil || *payload.Enabled

	h.withPipeline(c, func(tx *gorm.DB) error {
		set := model.RouteRuleSet{
			Tag: *payload.Tag, Enabled: enabled,
			Config: marshalConfig(orEmptyMap(payload.Config)),
		}
		return tx.Create(&set).Error
	})
}

func (h *Handler) updateRuleSet(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	var payload ruleSetPayload
	if !bindJSON(c, &payload) {
		return
	}

	h.withPipeline(c, func(tx *gorm.DB) error {
		var set model.RouteRuleSet
		if err := tx.First(&set, id).Error; err != nil {
			return errors.New("规则集不存在")
		}
		if payload.Tag != nil {
			if *payload.Tag == "" {
				return errors.New("规则集 tag 不能为空")
			}
			set.Tag = *payload.Tag
		}
		if payload.Enabled != nil {
			set.Enabled = *payload.Enabled
		}
		if payload.Config != nil {
			set.Config = marshalConfig(payload.Config)
		}
		return tx.Save(&set).Error
	})
}

func (h *Handler) deleteRuleSet(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		return tx.Delete(&model.RouteRuleSet{}, id).Error
	})
}

// ---- 路由全局设置 ----

func (h *Handler) getRouteSettings(c *gin.Context) {
	ok(c, h.settings.GetJSON(service.KeyRouteSettings), "")
}

func (h *Handler) putRouteSettings(c *gin.Context) {
	var payload map[string]any
	if !bindJSON(c, &payload) {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		return h.settings.Set(tx, service.KeyRouteSettings, payload)
	})
}
