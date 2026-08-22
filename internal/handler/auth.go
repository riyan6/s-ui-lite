package handler

import (
	"time"

	"github.com/gin-gonic/gin"

	"s-ui-next/internal/service"
)

type loginPayload struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func (h *Handler) login(c *gin.Context) {
	var payload loginPayload
	if !bindJSON(c, &payload) {
		return
	}
	ip := c.ClientIP()
	if allowed, wait := service.LoginAllowed(ip); !allowed {
		failStr(c, "登录失败次数过多，请 "+time.Until(time.Now().Add(wait)).Round(time.Second).String()+" 后再试")
		return
	}
	token, mustChange, err := h.auth.Login(payload.Username, payload.Password)
	if err != nil {
		service.RecordLoginFail(ip)
		fail(c, err)
		return
	}
	service.RecordLoginSuccess(ip)
	ok(c, gin.H{"token": token, "must_change_password": mustChange}, "")
}

type changePasswordPayload struct {
	Username    string `json:"username"`
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required,min=6"`
}

func (h *Handler) changePassword(c *gin.Context) {
	var payload changePasswordPayload
	if !bindJSON(c, &payload) {
		return
	}
	if payload.Username == "" {
		payload.Username = h.settings.AdminUsername()
	}
	if err := h.auth.ChangePassword(payload.Username, payload.OldPassword, payload.NewPassword); err != nil {
		fail(c, err)
		return
	}
	ok(c, nil, "密码已修改")
}
