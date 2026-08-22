package database

import (
	"fmt"
	"path/filepath"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"s-ui-next/internal/model"
)

// Init 打开 SQLite 数据库并执行自动迁移。种子数据由 service 层完成。
func Init(dataDir string) (*gorm.DB, error) {
	path := filepath.Join(dataDir, "s-ui-next.db")
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("打开数据库失败: %w", err)
	}
	if err := db.AutoMigrate(model.AllModels()...); err != nil {
		return nil, fmt.Errorf("数据库迁移失败: %w", err)
	}
	return db, nil
}
