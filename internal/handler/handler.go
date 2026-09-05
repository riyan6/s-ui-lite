package handler

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"s-ui-next/internal/config"
	"s-ui-next/internal/core"
	"s-ui-next/internal/middleware"
	"s-ui-next/internal/serverstatus"
	"s-ui-next/internal/service"
	"s-ui-next/internal/service/configgen"
	"s-ui-next/frontend"
)

// Handler 汇总所有依赖，由 main 构造后注入路由
type Handler struct {
	db            *gorm.DB
	settings      *service.SettingService
	auth          *service.AuthService
	core          *core.Manager
	collector     *serverstatus.Collector
	bootstrap     *config.Bootstrap
	bootstrapPath string
	configPath    string // sing-box.json
	dataDir       string
}

func NewHandler(db *gorm.DB, settings *service.SettingService, coreMgr *core.Manager,
	bootstrap *config.Bootstrap, bootstrapPath, dataDir string) *Handler {
	return &Handler{
		db:            db,
		settings:      settings,
		auth:          service.NewAuthService(settings),
		core:          coreMgr,
		collector:     serverstatus.NewCollector(),
		bootstrap:     bootstrap,
		bootstrapPath: bootstrapPath,
		configPath:    dataDir + "/sing-box.json",
		dataDir:       dataDir,
	}
}

// SetupRouter 注册全部路由
func (h *Handler) SetupRouter() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.GET("/healthz", func(c *gin.Context) {
		ok(c, gin.H{"status": "up"}, "")
	})

	api := r.Group("/api/v1")
	api.POST("/auth/login", h.login)

	authed := api.Group("", middleware.JWT(func() []byte { return h.settings.JwtSecret() }))
	authed.POST("/auth/password", h.changePassword)
	authed.GET("/settings", h.getSettings)
	authed.PUT("/settings", h.putSettings)

	authed.GET("/server/status", h.serverStatus)

	authed.GET("/core/status", h.coreStatus)
	authed.POST("/core/restart", h.coreRestart)
	authed.GET("/core/logs", h.coreLogs)
	authed.GET("/core/config", h.coreConfig)
	authed.GET("/core/versions", h.coreVersions)
	authed.POST("/core/update", h.coreUpdate)

	authed.GET("/tools/uuid", h.toolUUID)
	authed.GET("/tools/ss-key", h.toolSSKey)
	authed.GET("/tools/reality-keypair", h.toolRealityKeypair)
	authed.GET("/tools/reality-pubkey", h.toolRealityPubkey)
	authed.GET("/tools/short-id", h.toolShortID)
	authed.GET("/tools/snell-psk", h.toolSnellPSK)

	authed.GET("/inbounds", h.listInbounds)
	authed.POST("/inbounds", h.createInbound)
	authed.GET("/inbounds/:id", h.getInbound)
	authed.PUT("/inbounds/:id", h.updateInbound)
	authed.DELETE("/inbounds/:id", h.deleteInbound)
	authed.POST("/inbounds/:id/clients", h.createClient)
	authed.PUT("/clients/:id", h.updateClient)
	authed.DELETE("/clients/:id", h.deleteClient)

	authed.GET("/outbounds", h.listOutbounds)
	authed.POST("/outbounds", h.createOutbound)
	authed.PUT("/outbounds/:id", h.updateOutbound)
	authed.DELETE("/outbounds/:id", h.deleteOutbound)

	authed.GET("/route/rules", h.listRouteRules)
	authed.POST("/route/rules", h.createRouteRule)
	authed.PUT("/route/rules/:id", h.updateRouteRule)
	authed.DELETE("/route/rules/:id", h.deleteRouteRule)
	authed.PUT("/route/rules/order", h.orderRouteRules)
	authed.GET("/route/rule-sets", h.listRuleSets)
	authed.POST("/route/rule-sets", h.createRuleSet)
	authed.PUT("/route/rule-sets/:id", h.updateRuleSet)
	authed.DELETE("/route/rule-sets/:id", h.deleteRuleSet)
	authed.GET("/route/settings", h.getRouteSettings)
	authed.PUT("/route/settings", h.putRouteSettings)

	authed.GET("/dns/servers", h.listDnsServers)
	authed.POST("/dns/servers", h.createDnsServer)
	authed.PUT("/dns/servers/:id", h.updateDnsServer)
	authed.DELETE("/dns/servers/:id", h.deleteDnsServer)
	authed.PUT("/dns/servers/order", h.orderDnsServers)
	authed.GET("/dns/rules", h.listDnsRules)
	authed.POST("/dns/rules", h.createDnsRule)
	authed.PUT("/dns/rules/:id", h.updateDnsRule)
	authed.DELETE("/dns/rules/:id", h.deleteDnsRule)
	authed.PUT("/dns/rules/order", h.orderDnsRules)
	authed.GET("/dns/settings", h.getDnsSettings)
	authed.PUT("/dns/settings", h.putDnsSettings)

	authed.GET("/services", h.listServices)
	authed.POST("/services", h.createService)
	authed.PUT("/services/:id", h.updateService)
	authed.DELETE("/services/:id", h.deleteService)

	r.NoRoute(h.serveWeb)
	return r
}

// ---- 响应约定 ----

func ok(c *gin.Context, data any, msg string) {
	c.JSON(200, gin.H{"success": true, "msg": msg, "obj": data})
}

func fail(c *gin.Context, err error) {
	c.JSON(200, gin.H{"success": false, "msg": err.Error(), "obj": nil})
}

func failStr(c *gin.Context, msg string) {
	c.JSON(200, gin.H{"success": false, "msg": msg, "obj": nil})
}

func bindJSON(c *gin.Context, payload any) bool {
	if err := c.ShouldBindJSON(payload); err != nil {
		failStr(c, "请求体解析失败: "+err.Error())
		return false
	}
	return true
}

func idParam(c *gin.Context) (uint, bool) {
	var uri struct {
		ID uint `uri:"id" binding:"required"`
	}
	if err := c.ShouldBindUri(&uri); err != nil {
		failStr(c, "无效的资源 ID")
		return 0, false
	}
	return uri.ID, true
}

func marshalConfig(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

// runPipeline 保存流水线：写库 → 生成配置 → sing-box check → 提交 → 落盘 → 重启核心。
// 任一步失败：写错误响应、整体回滚、返回 false；成功：不写响应、返回 true（重启失败仅记录提示）。
// 误操作永远不会打挂正在运行的核心。
func (h *Handler) runPipeline(c *gin.Context, writeOp func(tx *gorm.DB) error) bool {
	var raw []byte
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := writeOp(tx); err != nil {
			return err
		}
		var genErr error
		raw, genErr = configgen.Generate(tx)
		if genErr != nil {
			return genErr
		}
		tmp := h.configPath + ".tmp"
		if err := os.WriteFile(tmp, raw, 0644); err != nil {
			return fmt.Errorf("写入临时配置失败: %w", err)
		}
		if err := h.core.Check(tmp); err != nil {
			_ = os.Remove(tmp)
			return fmt.Errorf("配置校验未通过，已保留原配置: %v", err)
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return false
	}

	// 事务提交成功，正式落盘（Windows 下 rename 不能覆盖，先删后改名）
	tmp := h.configPath + ".tmp"
	_ = os.WriteFile(tmp, raw, 0644)
	_ = os.Remove(h.configPath)
	if err := os.Rename(tmp, h.configPath); err != nil {
		failStr(c, "配置已保存至数据库，但写入配置文件失败: "+err.Error())
		return false
	}

	if err := h.core.Restart(); err != nil {
		c.Set("restart_error", err.Error())
	}
	return true
}

// withPipeline = runPipeline + 写成功响应，供简单 CRUD handler 使用
func (h *Handler) withPipeline(c *gin.Context, writeOp func(tx *gorm.DB) error) {
	if !h.runPipeline(c, writeOp) {
		return
	}
	if v, exists := c.Get("restart_error"); exists {
		ok(c, gin.H{"restarted": false}, "配置已保存，但核心重启失败: "+v.(string))
		return
	}
	ok(c, gin.H{"restarted": true}, "")
}

// serveWeb 提供内嵌前端静态文件，未命中路径回退 index.html
func (h *Handler) serveWeb(c *gin.Context) {
	if c.Request.Method != "GET" {
		c.Status(404)
		return
	}
	_ = frontend.Serve(c)
}
