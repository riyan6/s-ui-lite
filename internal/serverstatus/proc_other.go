//go:build !linux && !windows

package serverstatus

// 其他平台返回零值（Windows 有独立实现，见 proc_windows.go）

func readCPU() cpuSample            { return cpuSample{} }
func readNet() netSample            { return netSample{} }
func readMemory() (uint64, uint64, uint64, uint64) { return 0, 0, 0, 0 }
func readLoad() (float64, float64, float64)        { return 0, 0, 0 }
func readUptime() uint64            { return 0 }
func readDisk(string) (uint64, uint64)             { return 0, 0 }
