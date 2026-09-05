package handler

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"s-ui-next/internal/model"
	"s-ui-next/internal/service/configgen"
)

type inboundPayload struct {
	Tag     *string        `json:"tag"`
	Type    *string        `json:"type"`
	Listen  *string        `json:"listen"`
	Port    *int           `json:"port"`
	Enabled *bool          `json:"enabled"`
	Config  map[string]any `json:"config"`
	Clients *[]clientPayload `json:"clients"` // 创建入站时可同时携带客户端（VLESS 必需）
}

var validInboundTypes = map[string]bool{
	configgen.InboundTypeShadowsocks: true,
	configgen.InboundTypeVless:       true,
	configgen.InboundTypeSnell:       true,
	configgen.InboundTypeCloudflared: true,
}

// listInbounds 返回入站列表（含各自的客户端）
func (h *Handler) listInbounds(c *gin.Context) {
	var inbounds []model.Inbound
	if err := h.db.Order("id").Find(&inbounds).Error; err != nil {
		fail(c, err)
		return
	}
	var clients []model.Client
	if err := h.db.Order("id").Find(&clients).Error; err != nil {
		fail(c, err)
		return
	}
	byInbound := map[uint][]model.Client{}
	for _, cl := range clients {
		byInbound[cl.InboundID] = append(byInbound[cl.InboundID], cl)
	}
	result := make([]map[string]any, 0, len(inbounds))
	for _, in := range inbounds {
		item := map[string]any{
			"id": in.ID, "tag": in.Tag, "type": in.Type, "listen": in.Listen,
			"port": in.Port, "enabled": in.Enabled, "config": parseJSONObj(in.Config),
			"created_at": in.CreatedAt, "updated_at": in.UpdatedAt,
			"clients": byInbound[in.ID],
		}
		result = append(result, item)
	}
	ok(c, result, "")
}

func (h *Handler) getInbound(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	var inbound model.Inbound
	if err := h.db.First(&inbound, id).Error; err != nil {
		fail(c, err)
		return
	}
	var clients []model.Client
	h.db.Where("inbound_id = ?", id).Order("id").Find(&clients)
	ok(c, gin.H{
		"id": inbound.ID, "tag": inbound.Tag, "type": inbound.Type, "listen": inbound.Listen,
		"port": inbound.Port, "enabled": inbound.Enabled, "config": parseJSONObj(inbound.Config),
		"created_at": inbound.CreatedAt, "updated_at": inbound.UpdatedAt,
		"clients": clients,
	}, "")
}

func (h *Handler) createInbound(c *gin.Context) {
	var payload inboundPayload
	if !bindJSON(c, &payload) {
		return
	}
	if payload.Tag == nil || *payload.Tag == "" {
		failStr(c, "入站 tag 不能为空")
		return
	}
	if payload.Type == nil || !validInboundTypes[*payload.Type] {
		failStr(c, "入站类型无效（当前支持 shadowsocks / vless / snell / cloudflared）")
		return
	}
	isTunnel := *payload.Type == configgen.InboundTypeCloudflared
	if !isTunnel && (payload.Port == nil || *payload.Port < 1 || *payload.Port > 65535) {
		failStr(c, "入站端口无效")
		return
	}
	enabled := payload.Enabled == nil || *payload.Enabled
	listen := "::"
	if payload.Listen != nil && *payload.Listen != "" {
		listen = *payload.Listen
	}

	h.withPipeline(c, func(tx *gorm.DB) error {
		// cloudflared 无端口监听，且因端口列存 0（唯一索引），面板限定单实例
		if isTunnel {
			var count int64
			if err := tx.Model(&model.Inbound{}).Where("type = ?", configgen.InboundTypeCloudflared).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return errors.New("cloudflared 隧道入站仅支持创建一个")
			}
		}
		port := 0
		if !isTunnel && payload.Port != nil {
			port = *payload.Port
		}
		inbound := model.Inbound{
			Tag: *payload.Tag, Type: *payload.Type, Listen: listen,
			Port: port, Enabled: enabled,
			Config: marshalConfig(orEmptyMap(payload.Config)),
		}
		if err := tx.Create(&inbound).Error; err != nil {
			return err
		}
		return createClientsFor(tx, &inbound, payload.Clients)
	})
}

// createClientsFor 为入站批量创建客户端（创建入站时内联携带）
func createClientsFor(tx *gorm.DB, inbound *model.Inbound, clients *[]clientPayload) error {
	if clients == nil {
		return nil
	}
	for i := range *clients {
		cp := &(*clients)[i]
		if cp.Name == nil || *cp.Name == "" {
			return errors.New("客户端名称不能为空")
		}
		credential := ""
		if cp.Credential != nil {
			credential = *cp.Credential
		}
		if credential == "" {
			var err error
			credential, err = generateCredential(inbound.Type, inbound.Config)
			if err != nil {
				return err
			}
		}
		client := model.Client{
			InboundID: inbound.ID, Name: *cp.Name, Credential: credential,
			ExpireAt: cp.ExpireAt,
			Meta: marshalConfig(orEmptyMap(cp.Meta)),
		}
		if err := tx.Create(&client).Error; err != nil {
			return err
		}
	}
	return nil
}

// generateCredential 按入站类型生成客户端凭证（VLESS → UUID；SS 2022 → 定长密钥；Snell → PSK）
func generateCredential(inboundType, inboundConfigJSON string) (string, error) {
	switch inboundType {
	case configgen.InboundTypeVless:
		return configgen.GenUUID(), nil
	case configgen.InboundTypeShadowsocks:
		method := ""
		if m, ok := parseJSONObj(inboundConfigJSON)["method"].(string); ok {
			method = m
		}
		return configgen.GenSSKey(method)
	case configgen.InboundTypeSnell:
		return configgen.GenSnellPSK(), nil
	}
	return "", errors.New("无法为该入站类型自动生成凭证")
}

func (h *Handler) updateInbound(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	var payload inboundPayload
	if !bindJSON(c, &payload) {
		return
	}

	h.withPipeline(c, func(tx *gorm.DB) error {
		var inbound model.Inbound
		if err := tx.First(&inbound, id).Error; err != nil {
			return err
		}
		if payload.Tag != nil {
			if *payload.Tag == "" {
				return errors.New("入站 tag 不能为空")
			}
			inbound.Tag = *payload.Tag
		}
		if payload.Type != nil {
			if !validInboundTypes[*payload.Type] {
				return errors.New("入站类型无效")
			}
			if *payload.Type != inbound.Type && *payload.Type == configgen.InboundTypeCloudflared {
				// 改成 cloudflared 时同样受单实例限制
				var count int64
				if err := tx.Model(&model.Inbound{}).
					Where("type = ? AND id <> ?", configgen.InboundTypeCloudflared, id).
					Count(&count).Error; err != nil {
					return err
				}
				if count > 0 {
					return errors.New("cloudflared 隧道入站仅支持创建一个")
				}
			}
			inbound.Type = *payload.Type
		}
		if payload.Listen != nil {
			inbound.Listen = *payload.Listen
		}
		if payload.Port != nil {
			if *payload.Port < 1 || *payload.Port > 65535 {
				return errors.New("入站端口无效")
			}
			inbound.Port = *payload.Port
		}
		if payload.Enabled != nil {
			inbound.Enabled = *payload.Enabled
		}
		if payload.Config != nil {
			inbound.Config = marshalConfig(payload.Config)
		}
		return tx.Save(&inbound).Error
	})
}

func (h *Handler) deleteInbound(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		if err := tx.Where("inbound_id = ?", id).Delete(&model.Client{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.Inbound{}, id).Error
	})
}

// ---- 客户端 ----

type clientPayload struct {
	Name       *string        `json:"name"`
	Credential *string        `json:"credential"`
	ExpireAt   *time.Time     `json:"expire_at"`
	Meta       map[string]any `json:"meta"`
}

func (h *Handler) createClient(c *gin.Context) {
	inboundID, valid := idParam(c)
	if !valid {
		return
	}
	var payload clientPayload
	if !bindJSON(c, &payload) {
		return
	}
	if payload.Name == nil || *payload.Name == "" {
		failStr(c, "客户端名称不能为空")
		return
	}

	h.withPipeline(c, func(tx *gorm.DB) error {
		var inbound model.Inbound
		if err := tx.First(&inbound, inboundID).Error; err != nil {
			return errors.New("入站不存在")
		}
		if inbound.Type == configgen.InboundTypeCloudflared {
			return errors.New("cloudflared 隧道入站没有客户端")
		}

		credential := ""
		if payload.Credential != nil {
			credential = *payload.Credential
		}
		// 凭证留空时按入站类型自动生成（VLESS → UUID；SS 2022 → 定长密钥）
		if credential == "" {
			var err error
			credential, err = generateCredential(inbound.Type, inbound.Config)
			if err != nil {
				return err
			}
		}

		client := model.Client{
			InboundID: inboundID, Name: *payload.Name, Credential: credential,
			ExpireAt: payload.ExpireAt,
			Meta: marshalConfig(orEmptyMap(payload.Meta)),
		}
		return tx.Create(&client).Error
	})
}

func (h *Handler) updateClient(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	var payload clientPayload
	if !bindJSON(c, &payload) {
		return
	}

	h.withPipeline(c, func(tx *gorm.DB) error {
		var client model.Client
		if err := tx.First(&client, id).Error; err != nil {
			return errors.New("客户端不存在")
		}
		if payload.Name != nil {
			if *payload.Name == "" {
				return errors.New("客户端名称不能为空")
			}
			client.Name = *payload.Name
		}
		if payload.Credential != nil {
			client.Credential = *payload.Credential
		}
		if payload.ExpireAt != nil {
			client.ExpireAt = payload.ExpireAt
		}
		if payload.Meta != nil {
			client.Meta = marshalConfig(payload.Meta)
		}
		return tx.Save(&client).Error
	})
}

func (h *Handler) deleteClient(c *gin.Context) {
	id, valid := idParam(c)
	if !valid {
		return
	}
	h.withPipeline(c, func(tx *gorm.DB) error {
		return tx.Delete(&model.Client{}, id).Error
	})
}

// ---- 小工具 ----

func parseJSONObj(raw string) map[string]any {
	obj := map[string]any{}
	_ = json.Unmarshal([]byte(raw), &obj)
	return obj
}

func orEmptyMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}
