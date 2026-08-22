package service

import (
	"errors"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type AuthService struct {
	settings *SettingService
}

func NewAuthService(settings *SettingService) *AuthService {
	return &AuthService{settings: settings}
}

// Login 校验账号密码，返回 JWT
func (s *AuthService) Login(username, password string) (string, bool, error) {
	if username != s.settings.AdminUsername() || !s.settings.VerifyPassword(password) {
		return "", false, errors.New("用户名或密码错误")
	}
	token, err := s.newToken(username)
	if err != nil {
		return "", false, err
	}
	return token, s.settings.MustChangePassword(), nil
}

func (s *AuthService) newToken(username string) (string, error) {
	claims := jwt.MapClaims{
		"sub": username,
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(s.settings.JwtExpire()).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.settings.JwtSecret())
}

// ChangePassword 旧密码校验 + 修改
func (s *AuthService) ChangePassword(username, oldPassword, newPassword string) error {
	if !s.settings.VerifyPassword(oldPassword) {
		return errors.New("旧密码错误")
	}
	return s.settings.ChangePassword(s.settings.db, username, newPassword)
}

// ---- 登录失败限速（按 IP） ----

type loginThrottle struct {
	mu      sync.Mutex
	records map[string]*loginRecord
}

type loginRecord struct {
	fails     int
	blockedTo time.Time
	lastFail  time.Time
}

const (
	maxLoginFails   = 5
	loginBlockDur   = 10 * time.Minute
	loginFailWindow = 10 * time.Minute
)

var throttle = &loginThrottle{records: map[string]*loginRecord{}}

// LoginAllowed 检查该 IP 是否被临时封禁；失败计数超过阈值后封锁一段时间
func LoginAllowed(ip string) (bool, time.Duration) {
	throttle.mu.Lock()
	defer throttle.mu.Unlock()
	r, ok := throttle.records[ip]
	if !ok {
		return true, 0
	}
	if r.blockedTo.After(time.Now()) {
		return false, time.Until(r.blockedTo)
	}
	return true, 0
}

func RecordLoginFail(ip string) {
	throttle.mu.Lock()
	defer throttle.mu.Unlock()
	r, ok := throttle.records[ip]
	if !ok {
		r = &loginRecord{}
		throttle.records[ip] = r
	}
	// 超过时间窗的旧失败不再累计
	if time.Since(r.lastFail) > loginFailWindow {
		r.fails = 0
	}
	r.fails++
	r.lastFail = time.Now()
	if r.fails >= maxLoginFails {
		r.blockedTo = time.Now().Add(loginBlockDur)
		r.fails = 0
	}
}

func RecordLoginSuccess(ip string) {
	throttle.mu.Lock()
	defer throttle.mu.Unlock()
	delete(throttle.records, ip)
}
