package handler

import (
	"os"
	"strconv"

	"github.com/gin-gonic/gin"

	"s-ui-next/internal/core"
	"s-ui-next/internal/service/configgen"
)

// ---- 服务器状态 ----

func (h *Handler) serverStatus(c *gin.Context) {
	status := h.collector.Collect(h.dataDir)
	status.MemPercent = percent(status.MemUsed, status.MemTotal)
	ok(c, status, "")
}

func percent(used, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) / float64(total) * 100
}

// ---- 核心管理 ----

func (h *Handler) coreStatus(c *gin.Context) {
	info := h.core.Status()
	info.CoreVersion = h.core.CoreVersion()
	ok(c, info, "")
}

func (h *Handler) coreRestart(c *gin.Context) {
	if err := h.core.Restart(); err != nil {
		fail(c, err)
		return
	}
	ok(c, nil, "核心已重启")
}

// ---- 核心在线更新（仅适配版本线的稳定版） ----

// coreVersions 拉取可用的核心版本列表（官方稳定版，覆盖所有版本线并标记是否适配）
func (h *Handler) coreVersions(c *gin.Context) {
	releases, err := core.FetchCoreReleases()
	if err != nil {
		failStr(c, "获取版本列表失败: "+err.Error())
		return
	}
	latestAdapted := ""
	for _, r := range releases {
		if r.Adapted {
			latestAdapted = r.Tag
			break
		}
	}
	ok(c, gin.H{
		"current":         h.core.CoreVersion(),
		"adapted_line":    core.AdaptedCoreLine,
		"latest_adapted":  latestAdapted,
		"versions":        releases,
	}, "")
}

type coreUpdatePayload struct {
	Version string `json:"version"`
}

// coreUpdate 下载并安装指定版本核心（默认最新适配版本），完成后重启核心。
// 允许安装任何官方稳定版；预发布与非稳定 tag 一律拒绝。
func (h *Handler) coreUpdate(c *gin.Context) {
	var payload coreUpdatePayload
	_ = c.ShouldBindJSON(&payload) // 空 body 时使用最新适配版本
	version := payload.Version
	if version == "" {
		latest, err := core.LatestAdaptedRelease()
		if err != nil {
			failStr(c, "获取最新版本失败: "+err.Error())
			return
		}
		version = latest.Tag
	}
	if err := core.ValidateCoreVersion(version); err != nil {
		fail(c, err)
		return
	}

	installPath := h.core.InstallPath()
	// 先下载解压（核心继续运行，不影响现有连接）
	tmpBinary, err := core.DownloadCoreToTmp(version, installPath)
	if err != nil {
		fail(c, err)
		return
	}
	// Windows 不允许替换运行中的 exe：先停核心再替换，失败自动回滚
	_ = h.core.Stop()
	if err := core.InstallCore(tmpBinary, installPath); err != nil {
		// 替换失败回滚后尝试拉起旧核心
		if startErr := h.core.Start(); startErr != nil {
			failStr(c, err.Error()+";且重启旧核心失败: "+startErr.Error())
			return
		}
		fail(c, err)
		return
	}
	h.core.ResetVersionCache()
	if err := h.core.Start(); err != nil {
		ok(c, gin.H{"restarted": false, "version": version},
			"核心已更新到 "+version+"，但启动失败: "+err.Error())
		return
	}
	ok(c, gin.H{"restarted": true, "version": version}, "核心已更新到 "+version)
}

func (h *Handler) coreLogs(c *gin.Context) {
	tail := 200
	if v := c.Query("tail"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			tail = n
		}
	}
	ok(c, h.core.Logs(tail), "")
}

// coreConfig 返回核心实际运行的配置文件内容（面板生成的 sing-box.json）
func (h *Handler) coreConfig(c *gin.Context) {
	raw, err := os.ReadFile(h.configPath)
	if err != nil {
		failStr(c, "读取配置文件失败: "+err.Error())
		return
	}
	ok(c, gin.H{"config": string(raw)}, "")
}

// ---- 密钥工具（供前端表单的“随机生成”按钮调用） ----

func (h *Handler) toolUUID(c *gin.Context) {
	ok(c, gin.H{"uuid": configgen.GenUUID()}, "")
}

func (h *Handler) toolSSKey(c *gin.Context) {
	method := c.DefaultQuery("method", "2022-blake3-aes-256-gcm")
	key, err := configgen.GenSSKey(method)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"key": key, "method": method}, "")
}

func (h *Handler) toolRealityKeypair(c *gin.Context) {
	priv, pub, err := configgen.GenRealityKeypair()
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"private_key": priv, "public_key": pub}, "")
}

// toolRealityPubkey 从私钥推导公钥（客户端分享链接需要）
func (h *Handler) toolRealityPubkey(c *gin.Context) {
	privKey := c.Query("private_key")
	if privKey == "" {
		failStr(c, "缺少 private_key 参数")
		return
	}
	pub, err := configgen.RealityPublicKey(privKey)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"public_key": pub}, "")
}

func (h *Handler) toolShortID(c *gin.Context) {
	ok(c, gin.H{"short_id": configgen.GenShortID()}, "")
}
