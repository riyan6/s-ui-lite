package configgen

import (
	"fmt"

	"gorm.io/gorm"

	"s-ui-next/internal/model"
)

// supportedServiceTypes 面板支持配置的服务类型。
// api（sing-box API 服务）自 sing-box 1.14 起提供，其余类型待表单支持后逐步放开。
var supportedServiceTypes = map[string]bool{
	"api": true,
}

// buildServices 组装顶层 services 段（sing-box 1.12+，api 类型自 1.14 起提供）。
// 没有任何启用的服务时返回空切片（省略 services 段）。
func buildServices(db *gorm.DB) ([]map[string]any, error) {
	var rows []model.Service
	if err := db.Where("enabled = ?", true).Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}

	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if row.Tag == "" {
			return nil, fmt.Errorf("服务 #%d 缺少 tag", row.ID)
		}
		if !supportedServiceTypes[row.Type] {
			return nil, fmt.Errorf("服务 [%s] 类型 %q 不受支持（当前支持 api）", row.Tag, row.Type)
		}
		cfg, err := parseConfigObject(fmt.Sprintf("服务 [%s]", row.Tag), row.Config)
		if err != nil {
			return nil, err
		}

		// api 服务是 gRPC 监听器，listen_port 必填
		if row.Type == "api" {
			if p, ok := cfg["listen_port"].(float64); !ok || p < 1 || p > 65535 {
				return nil, fmt.Errorf("服务 [%s] 缺少有效的 listen_port", row.Tag)
			}
		}

		svc := map[string]any{"type": row.Type, "tag": row.Tag}
		mergeInto(svc, cfg, "type", "tag")
		result = append(result, svc)
	}
	return result, nil
}
