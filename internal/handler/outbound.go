package handler

import (
	"errors"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"s-ui-next/internal/model"
)

type outboundPayload struct {
	Tag     *string        `json:"tag"`
	Type    *string        `json:"type"`
	Enabled *bool          `json:"enabled"`
	Config  map[string]any `json:"config"`
}

func (h *Handler) listOutbounds(c *gin.Context) {
	var outbounds []model.Outbound
	if err := h.db.Order("id").Find(&outbounds).Error; err != nil {
		fail(c, err)
		return
	}
	result := make([]map[string]any, 0, len(outbounds))
	for _, ob := range outbounds {
		result = append(result, map[string]any{
			"id": ob.ID, "tag": ob.Tag, "type": ob.Type, "enabled": ob.Enabled,
			"config": parseJSONObj(ob.Config),
			"created_at": ob.CreatedAt, "updated_at": ob.UpdatedAt,
		})
	}
	ok(c, result, "")
}

func (h *Handler) createOutbound(c *gin.Context) {
	var payload outboundPayload
	if !bindJSON(c, &payload) {
		return
	}
	if payload.Tag == nil || *payload.Tag == "" {
		failStr(c, "出站 tag 不能为空")
		return
	}
	if payload.Type == nil || *payload.Type == "" {
		failStr(c, "出站类型不能为空（direct/block/shadowsocks/socks）")
		return
	}
	enabled := payload.Enabled == nil || *payload.Enabled

	h.withPipeline(c, func(tx *gorm.DB) error {
		outbound := model.Outbound{
			Tag: *payload.Tag, Type: *payload.Type, Enabled: enabled,
			Config: marshalConfig(orEmptyMap(payload.Config)),
		}
		return tx.Create(&outbound).Error
	})
}

func (h *Handler) updateOutbound(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	var payload outboundPayload
	if !bindJSON(c, &payload) {
		return
	}

	h.withPipeline(c, func(tx *gorm.DB) error {
		var outbound model.Outbound
		if err := tx.First(&outbound, id).Error; err != nil {
			return errors.New("出站不存在")
		}
		if payload.Tag != nil {
			if *payload.Tag == "" {
				return errors.New("出站 tag 不能为空")
			}
			outbound.Tag = *payload.Tag
		}
		if payload.Type != nil {
			if *payload.Type == "" {
				return errors.New("出站类型不能为空")
			}
			outbound.Type = *payload.Type
		}
		if payload.Enabled != nil {
			outbound.Enabled = *payload.Enabled
		}
		if payload.Config != nil {
			outbound.Config = marshalConfig(payload.Config)
		}
		return tx.Save(&outbound).Error
	})
}

func (h *Handler) deleteOutbound(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		return tx.Delete(&model.Outbound{}, id).Error
	})
}
