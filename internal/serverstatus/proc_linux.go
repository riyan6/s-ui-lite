//go:build linux

package serverstatus

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"syscall"
)

// readCPU 读取 /proc/stat 的全部 CPU 时间（单位: jiffies）
func readCPU() cpuSample {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return cpuSample{}
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 5 && fields[0] == "cpu" {
			var total, idle uint64
			for i, v := range fields[1:] {
				n, _ := strconv.ParseUint(v, 10, 64)
				total += n
				if i == 3 || i == 4 { // idle + iowait
					idle += n
				}
			}
			return cpuSample{total: total, idle: idle}
		}
	}
	return cpuSample{}
}

// readNet 汇总 /proc/net/dev 除 lo 外所有网卡的收发字节
func readNet() netSample {
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return netSample{}
	}
	defer f.Close()
	var s netSample
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		idx := strings.Index(line, ":")
		if idx < 0 {
			continue
		}
		name := strings.TrimSpace(line[:idx])
		if name == "lo" {
			continue
		}
		fields := strings.Fields(line[idx+1:])
		if len(fields) < 9 {
			continue
		}
		down, _ := strconv.ParseUint(fields[0], 10, 64)
		up, _ := strconv.ParseUint(fields[8], 10, 64)
		s.down += down
		s.up += up
	}
	return s
}

// readMemory 读取 /proc/meminfo
func readMemory() (memTotal, memUsed, swapTotal, swapUsed uint64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return
	}
	defer f.Close()
	var memFree, buffers, cached, swapFree uint64
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		v, _ := strconv.ParseUint(fields[1], 10, 64)
		switch fields[0] {
		case "MemTotal:":
			memTotal = v * 1024
		case "MemFree:":
			memFree = v * 1024
		case "Buffers:":
			buffers = v * 1024
		case "Cached:":
			cached = v * 1024
		case "SwapTotal:":
			swapTotal = v * 1024
		case "SwapFree:":
			swapFree = v * 1024
		}
	}
	memUsed = memTotal - memFree - buffers - cached
	swapUsed = swapTotal - swapFree
	return
}

// readLoad 读取 /proc/loadavg
func readLoad() (l1, l5, l15 float64) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return
	}
	fields := strings.Fields(string(data))
	if len(fields) >= 3 {
		l1, _ = strconv.ParseFloat(fields[0], 64)
		l5, _ = strconv.ParseFloat(fields[1], 64)
		l15, _ = strconv.ParseFloat(fields[2], 64)
	}
	return
}

// readUptime 读取 /proc/uptime
func readUptime() uint64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) >= 1 {
		v, _ := strconv.ParseFloat(fields[0], 64)
		return uint64(v)
	}
	return 0
}

// readDisk statfs 读取数据目录所在分区容量
func readDisk(path string) (total, free uint64) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0
	}
	total = uint64(st.Blocks) * uint64(st.Bsize)
	free = uint64(st.Bavail) * uint64(st.Bsize)
	return
}
