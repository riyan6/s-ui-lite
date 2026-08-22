package service

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"s-ui-next/internal/model"
)

// 设置项 key 常量
const (
	KeyAdminUsername     = "admin_username"      // 管理员用户名
	KeyAdminPassHash     = "admin_pass_hash"     // 管理员密码 bcrypt 哈希
	KeyMustChangePass    = "must_change_password" // 首登强制改密标志
	KeyJwtSecret         = "jwt_secret"          // JWT 签名密钥
	KeyCoreBinaryPath    = "core_binary_path"    // sing-box 二进制路径，空则自动探测
	KeyCoreLogLevel      = "core_log_level"      // panic fatal error warn info debug trace
	KeyCoreAutoRestart   = "core_auto_restart"   // 核心崩溃后是否自动重启
	KeyRouteSettings     = "route_settings"      // 路由全局设置 JSON（final/auto_detect_interface 等）
	KeyDnsSettings       = "dns_settings"        // DNS 全局设置 JSON（strategy/cache 等）

	DefaultAdminUsername = "admin"
	DefaultAdminPassword = "admin"
	DefaultCoreLogLevel  = "info"
)

type SettingService struct {
	db *gorm.DB
}

func NewSettingService(db *gorm.DB) *SettingService {
	return &SettingService{db: db}
}

// Seed 首次启动播种默认设置与默认出站
func (s *SettingService) Seed() error {
	defaults := map[string]any{
		KeyAdminUsername:   DefaultAdminUsername,
		KeyAdminPassHash:   "", // 下方单独生成
		KeyMustChangePass:  true,
		KeyJwtSecret:       randomHex(32),
		KeyCoreBinaryPath:  "",
		KeyCoreLogLevel:    DefaultCoreLogLevel,
		KeyCoreAutoRestart: true,
		KeyRouteSettings:   map[string]any{"final": "direct"},
		KeyDnsSettings:     map[string]any{},
	}
	for key, value := range defaults {
		if key == KeyAdminPassHash {
			hash, err := bcrypt.GenerateFromPassword([]byte(DefaultAdminPassword), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			value = string(hash)
		}
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}
		// 不存在才写入，保留用户已有配置
		s.db.Where("key = ?", key).FirstOrCreate(&model.Setting{Key: key, Value: string(raw)})
	}

	// 默认出站：direct / block（dns 出站已在 sing-box 1.13 移除，改用 hijack-dns 规则动作）
	var count int64
	s.db.Model(&model.Outbound{}).Count(&count)
	if count == 0 {
		defaultOutbounds := []model.Outbound{
			{Tag: "direct", Type: "direct", Enabled: true, Config: "{}"},
			{Tag: "block", Type: "block", Enabled: true, Config: "{}"},
		}
		if err := s.db.Create(&defaultOutbounds).Error; err != nil {
			return err
		}
	}
	return nil
}

// Get 读取设置并反序列化到 dst
func (s *SettingService) Get(key string, dst any) error {
	var setting model.Setting
	if err := s.db.Where("key = ?", key).First(&setting).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil // 未设置则保持 dst 默认值
		}
		return err
	}
	return json.Unmarshal([]byte(setting.Value), dst)
}

// GetString 读取字符串型设置，不存在返回默认值
func (s *SettingService) GetString(key, def string) string {
	var v string
	if err := s.Get(key, &v); err != nil || v == "" {
		return def
	}
	return v
}

// GetBool / GetInt 读取基础类型设置
func (s *SettingService) GetBool(key string, def bool) bool {
	var v bool
	if err := s.Get(key, &v); err != nil {
		return def
	}
	return v
}

// GetJSON 读取对象型设置到 map
func (s *SettingService) GetJSON(key string) map[string]any {
	v := map[string]any{}
	_ = s.Get(key, &v)
	return v
}

// Set 写入设置（事务内使用 tx 以支持保存流水线回滚）
func (s *SettingService) Set(tx *gorm.DB, key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return tx.Where("key = ?", key).Assign(model.Setting{Value: string(raw)}).FirstOrCreate(&model.Setting{Key: key}).Error
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ---- 面板账号相关 ----

func (s *SettingService) AdminUsername() string {
	return s.GetString(KeyAdminUsername, DefaultAdminUsername)
}

func (s *SettingService) MustChangePassword() bool {
	return s.GetBool(KeyMustChangePass, false)
}

// VerifyPassword 校验面板登录密码
func (s *SettingService) VerifyPassword(password string) bool {
	var hash string
	_ = s.Get(KeyAdminPassHash, &hash)
	if hash == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// ChangePassword 修改密码并清除首登强制改密标志
func (s *SettingService) ChangePassword(tx *gorm.DB, username, newPassword string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if err := s.Set(tx, KeyAdminPassHash, string(hash)); err != nil {
		return err
	}
	if err := s.Set(tx, KeyMustChangePass, false); err != nil {
		return err
	}
	if username != "" {
		if err := s.Set(tx, KeyAdminUsername, username); err != nil {
			return err
		}
	}
	return nil
}

func (s *SettingService) JwtSecret() []byte {
	secret := s.GetString(KeyJwtSecret, "")
	if secret == "" {
		secret = randomHex(32)
		_ = s.Set(s.db, KeyJwtSecret, secret)
	}
	return []byte(secret)
}

// JwtExpire JWT 有效期
func (s *SettingService) JwtExpire() time.Duration {
	return 24 * time.Hour
}
