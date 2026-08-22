package handler

import (
	"fmt"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"s-ui-next/internal/config"
	"s-ui-next/internal/service"
)

var validLogLevels = map[string]bool{
	"panic": true, "fatal": true, "error": true,
	"warn": true, "info": true, "debug": true, "trace": true,
}

func (h *Handler) getSettings(c *gin.Context) {
	ok(c, gin.H{
		"admin_username":       h.settings.AdminUsername(),
		"must_change_password": h.settings.MustChangePassword(),
		"core_binary_path":     h.settings.GetString(service.KeyCoreBinaryPath, ""),
		"core_log_level":       h.settings.GetString(service.KeyCoreLogLevel, service.DefaultCoreLogLevel),
		"core_auto_restart":    h.settings.GetBool(service.KeyCoreAutoRestart, true),
		"route_settings":       h.settings.GetJSON(service.KeyRouteSettings),
		"dns_settings":         h.settings.GetJSON(service.KeyDnsSettings),
		"panel_port":           h.bootstrap.Port,
	}, "")
}

type settingsPayload struct {
	AdminUsername   *string        `json:"admin_username"`
	CoreBinaryPath  *string        `json:"core_binary_path"`
	CoreLogLevel    *string        `json:"core_log_level"`
	CoreAutoRestart *bool          `json:"core_auto_restart"`
	RouteSettings   map[string]any `json:"route_settings"`
	DnsSettings     map[string]any `json:"dns_settings"`
	PanelPort       *int           `json:"panel_port"`
}

func (h *Handler) putSettings(c *gin.Context) {
	var payload settingsPayload
	if !bindJSON(c, &payload) {
		return
	}

	if payload.CoreLogLevel != nil && !validLogLevels[*payload.CoreLogLevel] {
		failStr(c, "无效的日志级别（panic/fatal/error/warn/info/debug/trace）")
		return
	}
	if payload.PanelPort != nil && (*payload.PanelPort < 1 || *payload.PanelPort > 65535) {
		failStr(c, "无效的面板端口")
		return
	}

	// 不影响核心配置的设置项直接写
	if payload.AdminUsername != nil && *payload.AdminUsername != "" {
		if err := h.settings.Set(h.db, service.KeyAdminUsername, *payload.AdminUsername); err != nil {
			fail(c, err)
			return
		}
	}
	if payload.CoreAutoRestart != nil {
		if err := h.settings.Set(h.db, service.KeyCoreAutoRestart, *payload.CoreAutoRestart); err != nil {
			fail(c, err)
			return
		}
		h.core.SetAutoRestart(*payload.CoreAutoRestart)
	}
	if payload.CoreBinaryPath != nil {
		if err := h.settings.Set(h.db, service.KeyCoreBinaryPath, *payload.CoreBinaryPath); err != nil {
			fail(c, err)
			return
		}
	}

	// 影响生成配置的设置项走保存流水线（失败即返回，已写响应）
	affectsCore := payload.CoreLogLevel != nil || payload.RouteSettings != nil || payload.DnsSettings != nil
	if affectsCore {
		if !h.runPipeline(c, func(tx *gorm.DB) error {
			if payload.CoreLogLevel != nil {
				if err := h.settings.Set(tx, service.KeyCoreLogLevel, *payload.CoreLogLevel); err != nil {
					return err
				}
			}
			if payload.RouteSettings != nil {
				if err := h.settings.Set(tx, service.KeyRouteSettings, payload.RouteSettings); err != nil {
					return err
				}
			}
			if payload.DnsSettings != nil {
				if err := h.settings.Set(tx, service.KeyDnsSettings, payload.DnsSettings); err != nil {
					return err
				}
			}
			return nil
		}) {
			return
		}
	}

	// 修改面板端口：写引导配置后进程退出，systemd Restart=always 会以新端口拉起
	if payload.PanelPort != nil && *payload.PanelPort != h.bootstrap.Port {
		h.bootstrap.Port = *payload.PanelPort
		if err := config.Save(h.bootstrapPath, h.bootstrap); err != nil {
			failStr(c, "端口已保存但写入配置文件失败: "+err.Error())
			return
		}
		ok(c, gin.H{"restarting": true}, fmt.Sprintf("面板将以端口 %d 重启", *payload.PanelPort))
		go func() {
			time.Sleep(500 * time.Millisecond)
			_ = h.core.Stop()
			os.Exit(0)
		}()
		return
	}

	// 汇总响应
	if v, exists := c.Get("restart_error"); exists {
		ok(c, gin.H{"restarted": false}, "设置已保存，但核心重启失败: "+v.(string))
		return
	}
	if affectsCore {
		ok(c, gin.H{"restarted": true}, "")
	} else {
		ok(c, nil, "")
	}
}
