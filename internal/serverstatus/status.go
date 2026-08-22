// Package serverstatus 采集服务器状态（CPU/内存/网络/磁盘/负载/运行时长）。
// Linux 通过 /proc 与 statfs 实现；其他平台返回零值保证开发环境可运行。
package serverstatus

import (
	"runtime"
	"sync"
	"time"
)

type NetSpeed struct {
	Upload   float64 `json:"upload"`   // bytes/s
	Download float64 `json:"download"` // bytes/s
}

type Status struct {
	OS            string    `json:"os"`
	Arch          string    `json:"arch"`
	CPUPercent    float64   `json:"cpu_percent"`
	CPUCoreCount  int       `json:"cpu_core_count"`
	MemTotal      uint64    `json:"mem_total"` // bytes
	MemUsed       uint64    `json:"mem_used"`
	MemPercent    float64   `json:"mem_percent"`
	SwapTotal     uint64    `json:"swap_total"`
	SwapUsed      uint64    `json:"swap_used"`
	Net           NetSpeed  `json:"net"`
	NetTotalUp    uint64    `json:"net_total_up"`    // bytes 累计
	NetTotalDown  uint64    `json:"net_total_down"`  // bytes 累计
	DiskTotal     uint64    `json:"disk_total"`      // 数据目录所在分区
	DiskFree      uint64    `json:"disk_free"`
	Load1         float64   `json:"load_1"`
	Load5         float64   `json:"load_5"`
	Load15        float64   `json:"load_15"`
	UptimeSeconds uint64    `json:"uptime_seconds"`
	PanelUptime   uint64    `json:"panel_uptime_seconds"`
	Timestamp     time.Time `json:"timestamp"`
}

// Collector 基于上次采样差值计算 CPU/网络速率，前端轮询调用即可获得实时数据
type Collector struct {
	mu       sync.Mutex
	lastCPU  cpuSample
	lastNet  netSample
	lastTime time.Time
}

type cpuSample struct {
	total uint64
	idle  uint64
}

type netSample struct {
	up   uint64
	down uint64
}

func NewCollector() *Collector {
	return &Collector{}
}

// Collect 采集一次状态。dataDir 用于磁盘统计。
func (c *Collector) Collect(dataDir string) Status {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	status := Status{
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		CPUCoreCount: runtime.NumCPU(),
		Timestamp:    now,
	}

	cpu := readCPU()
	net := readNet()
	status.MemTotal, status.MemUsed, status.SwapTotal, status.SwapUsed = readMemory()
	status.NetTotalUp, status.NetTotalDown = net.up, net.down
	status.Load1, status.Load5, status.Load15 = readLoad()
	status.UptimeSeconds = readUptime()
	status.DiskTotal, status.DiskFree = readDisk(dataDir)
	status.PanelUptime = uint64(time.Since(startTime).Seconds())

	if !c.lastTime.IsZero() {
		dt := now.Sub(c.lastTime).Seconds()
		if dt > 0.1 {
			totalDelta := cpu.total - c.lastCPU.total
			idleDelta := cpu.idle - c.lastCPU.idle
			if totalDelta > 0 {
				status.CPUPercent = float64(totalDelta-idleDelta) / float64(totalDelta) * 100
				if status.CPUPercent < 0 {
					status.CPUPercent = 0
				}
			}
			status.Net.Upload = float64(net.up-c.lastNet.up) / dt
			status.Net.Download = float64(net.down-c.lastNet.down) / dt
		}
	}
	c.lastCPU = cpu
	c.lastNet = net
	c.lastTime = now
	return status
}

var startTime = time.Now()
