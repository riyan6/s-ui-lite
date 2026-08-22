//go:build windows

package core

import "syscall"

// sigTerm Windows 下没有 SIGTERM；Signal(SIGKILL) 等效于强制终止，
// Windows 上 os.Process 仅支持这一种信号。
func sigTerm() syscall.Signal {
	return syscall.SIGKILL
}
