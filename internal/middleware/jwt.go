package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// JWT 鉴权中间件，secretFn 每次请求动态取密钥（支持设置变更）
func JWT(secretFn func() []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		tokenStr := ""
		if strings.HasPrefix(header, "Bearer ") {
			tokenStr = strings.TrimPrefix(header, "Bearer ")
		}
		if tokenStr == "" {
			// 兼容前端通过 query 传 token 的场景（如下载类接口）
			tokenStr = c.Query("token")
		}
		if tokenStr == "" {
			abortUnauthorized(c, "未登录或令牌缺失")
			return
		}
		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return secretFn(), nil
		}, jwt.WithValidMethods([]string{"HS256"}))
		if err != nil || !token.Valid {
			abortUnauthorized(c, "令牌无效或已过期")
			return
		}
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok || claims["sub"] == nil {
			abortUnauthorized(c, "令牌无效")
			return
		}
		c.Set("username", claims["sub"])
		c.Next()
	}
}

func abortUnauthorized(c *gin.Context, msg string) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
		"success": false,
		"msg":     msg,
		"obj":     nil,
	})
}
