package handler

import (
	"errors"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"s-ui-next/internal/model"
)

type servicePayload struct {
	Tag     *string        `json:"tag"`
	Type    *string        `json:"type"`
	Enabled *bool          `json:"enabled"`
	Config  map[string]any `json:"config"`
}

func (h *Handler) listServices(c *gin.Context) {
	var services []model.Service
	if err := h.db.Order("id").Find(&services).Error; err != nil {
		fail(c, err)
		return
	}
	result := make([]map[string]any, 0, len(services))
	for _, sv := range services {
		result = append(result, map[string]any{
			"id": sv.ID, "tag": sv.Tag, "type": sv.Type, "enabled": sv.Enabled,
			"config": parseJSONObj(sv.Config),
			"created_at": sv.CreatedAt, "updated_at": sv.UpdatedAt,
		})
	}
	ok(c, result, "")
}

func (h *Handler) createService(c *gin.Context) {
	var payload servicePayload
	if !bindJSON(c, &payload) {
		return
	}
	if payload.Tag == nil || *payload.Tag == "" {
		failStr(c, "服务 tag 不能为空")
		return
	}
	if payload.Type == nil || *payload.Type == "" {
		failStr(c, "服务类型不能为空（当前支持 api）")
		return
	}
	enabled := payload.Enabled == nil || *payload.Enabled

	h.withPipeline(c, func(tx *gorm.DB) error {
		svc := model.Service{
			Tag: *payload.Tag, Type: *payload.Type, Enabled: enabled,
			Config: marshalConfig(orEmptyMap(payload.Config)),
		}
		return tx.Create(&svc).Error
	})
}

func (h *Handler) updateService(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	var payload servicePayload
	if !bindJSON(c, &payload) {
		return
	}

	h.withPipeline(c, func(tx *gorm.DB) error {
		var svc model.Service
		if err := tx.First(&svc, id).Error; err != nil {
			return errors.New("服务不存在")
		}
		if payload.Tag != nil {
			if *payload.Tag == "" {
				return errors.New("服务 tag 不能为空")
			}
			svc.Tag = *payload.Tag
		}
		if payload.Type != nil {
			if *payload.Type == "" {
				return errors.New("服务类型不能为空")
			}
			svc.Type = *payload.Type
		}
		if payload.Enabled != nil {
			svc.Enabled = *payload.Enabled
		}
		if payload.Config != nil {
			svc.Config = marshalConfig(payload.Config)
		}
		return tx.Save(&svc).Error
	})
}

func (h *Handler) deleteService(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		return tx.Delete(&model.Service{}, id).Error
	})
}
