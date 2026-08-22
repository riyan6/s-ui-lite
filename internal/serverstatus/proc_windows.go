//go:build windows

package serverstatus

import (
	"syscall"
	"unsafe"
)

// Windows 开发环境实现：CPU（GetSystemTimes）、内存（GlobalMemoryStatusEx）、
// 磁盘（GetDiskFreeSpaceExW）、运行时长（GetTickCount64）。
// 网卡速率与 loadavg Windows 无对应轻量接口，保持零值。

var (
	kernel32                = syscall.NewLazyDLL("kernel32.dll")
	procGetSystemTimes      = kernel32.NewProc("GetSystemTimes")
	procGlobalMemoryStatus  = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetDiskFreeSpaceEx  = kernel32.NewProc("GetDiskFreeSpaceExW")
	procGetTickCount64      = kernel32.NewProc("GetTickCount64")
)

// readCPU 通过 GetSystemTimes 获取 CPU 时间（100ns 单位）。
// 注意：kernel 时间包含 idle，与 /proc/stat 的口径一致。
func readCPU() cpuSample {
	var idle, kernel, user syscall.Filetime
	ret, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idle)),
		uintptr(unsafe.Pointer(&kernel)),
		uintptr(unsafe.Pointer(&user)),
	)
	if ret == 0 {
		return cpuSample{}
	}
	toUint64 := func(ft syscall.Filetime) uint64 {
		return uint64(ft.HighDateTime)<<32 | uint64(ft.LowDateTime)
	}
	return cpuSample{
		total: toUint64(kernel) + toUint64(user),
		idle:  toUint64(idle),
	}
}

func readNet() netSample { return netSample{} }

// memoryStatusEx 对应 MEMORYSTATUSEX（仅用到物理内存字段）
type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

func readMemory() (memTotal, memUsed, swapTotal, swapUsed uint64) {
	var ms memoryStatusEx
	ms.Length = uint32(unsafe.Sizeof(ms))
	ret, _, _ := procGlobalMemoryStatus.Call(uintptr(unsafe.Pointer(&ms)))
	if ret == 0 {
		return 0, 0, 0, 0
	}
	memTotal = ms.TotalPhys
	memUsed = memTotal - ms.AvailPhys
	return memTotal, memUsed, 0, 0
}

func readLoad() (float64, float64, float64) { return 0, 0, 0 }

func readUptime() uint64 {
	ret, _, _ := procGetTickCount64.Call()
	return uint64(ret) / 1000
}

func readDisk(path string) (total, free uint64) {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0
	}
	var freeAvail, totalBytes, totalFree uint64
	ret, _, _ := procGetDiskFreeSpaceEx.Call(
		uintptr(unsafe.Pointer(p)),
		uintptr(unsafe.Pointer(&freeAvail)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFree)),
	)
	if ret == 0 {
		return 0, 0
	}
	return totalBytes, freeAvail
}
