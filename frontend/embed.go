// Package frontend 内嵌前端静态资源（React + antd + Vite 构建产物，位于 dist/）。
// 开发时在 frontend/ 目录执行 pnpm dev（5173 端口，API 代理到本地后端）；
// 发布前执行 pnpm build 生成 dist 后再编译 Go 二进制。
package frontend

import (
	"embed"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed all:dist
var distFS embed.FS

// Serve 处理静态资源请求；未命中的路径回退到 index.html（SPA 前端路由）
func Serve(c *gin.Context) bool {
	p := strings.TrimPrefix(c.Request.URL.Path, "/")
	if p == "" {
		p = "index.html"
	}
	f, err := distFS.ReadFile("dist/" + p)
	if err != nil {
		// 回退 index.html（SPA 前端路由）
		if f, err = distFS.ReadFile("dist/index.html"); err != nil {
			c.String(http.StatusNotFound, "not found")
			return false
		}
		p = "index.html"
	}
	c.Data(http.StatusOK, contentType(p), f)
	return true
}

func contentType(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".js", ".mjs":
		return "application/javascript; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".ico":
		return "image/x-icon"
	case ".woff2":
		return "font/woff2"
	default:
		return "application/octet-stream"
	}
}
