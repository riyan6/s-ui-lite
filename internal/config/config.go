package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// DefaultPanelPort 面板默认监听端口
const DefaultPanelPort = 2095

// Bootstrap 面板引导配置，保存在二进制同目录的 config.json 中。
// 面板端口等在面板自身可用之前就必须确定的配置放这里，其余配置进数据库 settings 表。
type Bootstrap struct {
	Port    int    `json:"port"`
	DataDir string `json:"data_dir"`
}

// DefaultDataDir Linux 部署默认 /usr/local/s-ui-next，开发环境（Windows/macOS）用 ./data
func DefaultDataDir() string {
	if runtime.GOOS == "linux" {
		return "/usr/local/s-ui-next"
	}
	return "./data"
}

// ExeDir 返回二进制所在目录，用于定位 config.json
func ExeDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

// DefaultConfigPath 默认配置文件路径（二进制同目录 config.json）
func DefaultConfigPath() string {
	return filepath.Join(ExeDir(), "config.json")
}

// Load 加载引导配置，优先级：命令行参数 > 环境变量 > 配置文件 > 默认值
// flagPort/flagDir 为 0/空时表示未通过命令行指定。
func Load(flagPort int, flagDir, flagPath string) (*Bootstrap, string) {
	cfg := &Bootstrap{
		Port:    DefaultPanelPort,
		DataDir: DefaultDataDir(),
	}

	path := flagPath
	if path == "" {
		path = DefaultConfigPath()
	}

	// 配置文件
	if raw, err := os.ReadFile(path); err == nil {
		fileCfg := &Bootstrap{}
		if json.Unmarshal(raw, fileCfg) == nil {
			if fileCfg.Port > 0 {
				cfg.Port = fileCfg.Port
			}
			if fileCfg.DataDir != "" {
				cfg.DataDir = fileCfg.DataDir
			}
		}
	}

	// 环境变量
	if v := os.Getenv("SUI_NEXT_PORT"); v != "" {
		var port int
		if _, err := fmt.Sscanf(v, "%d", &port); err == nil && port > 0 {
			cfg.Port = port
		}
	}
	if v := os.Getenv("SUI_NEXT_DATA_DIR"); v != "" {
		cfg.DataDir = v
	}

	// 命令行参数优先级最高
	if flagPort > 0 {
		cfg.Port = flagPort
	}
	if flagDir != "" {
		cfg.DataDir = flagDir
	}
	return cfg, path
}

// Save 将引导配置写回配置文件（供 UI 修改端口后使用）
func Save(path string, cfg *Bootstrap) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0644)
}
