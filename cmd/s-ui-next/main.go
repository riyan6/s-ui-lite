package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	_ "net/http/pprof"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"s-ui-next/internal/config"
	"s-ui-next/internal/core"
	"s-ui-next/internal/database"
	"s-ui-next/internal/handler"
	"s-ui-next/internal/service"
	"s-ui-next/internal/service/configgen"
)

// Version 构建时通过 -ldflags "-X main.Version=x.y.z" 注入。
// 版本号与适配的 sing-box 核心版本保持一致（如 1.14.0 适配 sing-box 1.14.0）。
var Version = "1.14.0"

func main() {
	showVersion := flag.Bool("version", false, "输出版本号后退出")
	port := flag.Int("port", 0, "面板监听端口（默认 2095）")
	dataDir := flag.String("data-dir", "", "数据目录（默认 /usr/local/s-ui-next）")
	configPath := flag.String("config", "", "引导配置文件路径（默认二进制同目录 config.json）")
	flag.Parse()

	if *showVersion {
		fmt.Println("s-ui-next", Version)
		return
	}

	bootstrap, bootstrapPath := config.Load(*port, *dataDir, *configPath)
	if err := os.MkdirAll(bootstrap.DataDir, 0755); err != nil {
		log.Fatalf("创建数据目录失败: %v", err)
	}

	db, err := database.Init(bootstrap.DataDir)
	if err != nil {
		log.Fatalf("数据库初始化失败: %v", err)
	}
	settings := service.NewSettingService(db)
	if err := settings.Seed(); err != nil {
		log.Fatalf("初始化默认数据失败: %v", err)
	}

	// 核心路径：设置中的路径 > <dataDir>/bin/sing-box
	binPath := settings.GetString(service.KeyCoreBinaryPath, "")
	if binPath == "" {
		binPath = filepath.Join(bootstrap.DataDir, "bin", "sing-box")
	}
	coreMgr := core.NewManager(binPath, filepath.Join(bootstrap.DataDir, "sing-box.json"),
		filepath.Join(bootstrap.DataDir, "logs"))
	coreMgr.SetAutoRestart(settings.GetBool(service.KeyCoreAutoRestart, true))

	h := handler.NewHandler(db, settings, coreMgr, bootstrap, bootstrapPath, bootstrap.DataDir)
	router := h.SetupRouter()

	// 启动时以数据库为准重新生成配置，校验通过后拉起核心
	if raw, genErr := configgen.Generate(db); genErr != nil {
		log.Printf("生成 sing-box 配置失败: %v（核心未启动，请检查面板配置）", genErr)
	} else {
		cfgPath := filepath.Join(bootstrap.DataDir, "sing-box.json")
		if err := os.WriteFile(cfgPath, raw, 0644); err != nil {
			log.Printf("写入配置文件失败: %v", err)
		} else if err := coreMgr.Check(cfgPath); err != nil {
			log.Printf("配置校验失败，核心未自动启动: %v", err)
		} else if err := coreMgr.Start(); err != nil {
			log.Printf("核心启动失败: %v", err)
		}
	}

	// 本地 pprof 调试端口（仅 localhost，用于排查阻塞/内存问题）
	go func() {
		_ = http.ListenAndServe("127.0.0.1:16060", nil)
	}()

	go func() {
		if err := router.Run(fmt.Sprintf(":%d", bootstrap.Port)); err != nil {
			log.Fatalf("面板启动失败: %v", err)
		}
	}()
	log.Printf("s-ui-next %s 已启动，面板端口 %d，数据目录 %s", Version, bootstrap.Port, bootstrap.DataDir)

	// 等待退出信号：先停核心再退出
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh
	log.Println("正在退出...")
	_ = coreMgr.Stop()
}
