//go:build !windows

package core

import "syscall"

// sigTerm 返回优雅终止信号（unix 用 SIGTERM）
func sigTerm() syscall.Signal {
	return syscall.SIGTERM
}
