// Package core 管理 sing-box 子进程：启动/停止/重启、配置校验（sing-box check）、
// 崩溃自动重启（指数退避）、运行日志捕获（内存环形缓冲 + 文件）。
package core

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sync"
	"time"
)

const (
	logRingSize   = 2000   // 内存日志环形缓冲行数
	restartMin    = time.Second
	restartMax    = 30 * time.Second
	stableReset   = 5 * time.Minute // 稳定运行该时长后重置退避计数
	gracefulWait  = 3 * time.Second
)

type State string

const (
	StateStopped  State = "stopped"
	StateStarting State = "starting"
	StateRunning  State = "running"
	StateFailed   State = "failed"
)

type StatusInfo struct {
	State       State     `json:"state"`
	Running     bool      `json:"running"`
	PID         int       `json:"pid"`
	Restarts    int       `json:"restarts"`
	StartedAt   time.Time `json:"started_at"`
	LastError   string    `json:"last_error"`
	CoreVersion string    `json:"core_version"`
	BinaryPath  string    `json:"binary_path"`
}

type Manager struct {
	binPath    string
	configPath string
	logPath    string

	mu         sync.Mutex
	cmd        *exec.Cmd
	state      State
	restarts   int
	startedAt  time.Time
	lastError  string
	manualStop bool
	autoRestart bool
	coreVerOnce sync.Once
	coreVersion string

	ring *logRing
}

func NewManager(binPath, configPath, logDir string) *Manager {
	_ = os.MkdirAll(logDir, 0755)
	return &Manager{
		binPath:     binPath,
		configPath:  configPath,
		logPath:     filepath.Join(logDir, "sing-box.log"),
		state:       StateStopped,
		autoRestart: true,
		ring:        newLogRing(logRingSize),
	}
}

// SetAutoRestart 设置崩溃自动重启开关
func (m *Manager) SetAutoRestart(v bool) {
	m.mu.Lock()
	m.autoRestart = v
	m.mu.Unlock()
}

// resolveBinary 解析 sing-box 可执行文件路径；未找到时返回错误
func (m *Manager) resolveBinary() (string, error) {
	candidates := []string{m.binPath}
	if runtime.GOOS == "windows" && filepath.Ext(m.binPath) == "" {
		candidates = append(candidates, m.binPath+".exe")
	}
	for _, p := range candidates {
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p, nil
		}
	}
	// 回退到 PATH 查找
	name := filepath.Base(m.binPath)
	if p, err := exec.LookPath(name); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("未找到 sing-box 可执行文件（尝试路径: %s）", m.binPath)
}

// Check 用 sing-box check 校验配置文件，返回合并后的错误信息
func (m *Manager) Check(configPath string) error {
	bin, err := m.resolveBinary()
	if err != nil {
		return err
	}
	out, err := exec.Command(bin, "check", "-c", configPath).CombinedOutput()
	if err != nil {
		return fmt.Errorf("sing-box check 未通过: %s", trimOutput(out))
	}
	return nil
}

// Start 启动核心（已运行则先停止）
func (m *Manager) Start() error {
	bin, err := m.resolveBinary()
	if err != nil {
		return err
	}
	if err := m.stopLocked(); err != nil {
		return err
	}

	logFile, err := os.OpenFile(m.logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("打开核心日志文件失败: %w", err)
	}

	// --disable-color：sing-box 的彩色输出在网页日志里是 ANSI 转义乱码，源头关闭
	cmd := exec.Command(bin, "run", "--disable-color", "-c", m.configPath)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	m.mu.Lock()
	m.manualStop = false
	m.state = StateStarting
	m.mu.Unlock()

	if err := cmd.Start(); err != nil {
		logFile.Close()
		m.mu.Lock()
		m.state = StateFailed
		m.lastError = err.Error()
		m.mu.Unlock()
		return fmt.Errorf("启动 sing-box 失败: %w", err)
	}

	m.mu.Lock()
	m.cmd = cmd
	m.state = StateRunning
	m.startedAt = time.Now()
	pid := cmd.Process.Pid
	m.mu.Unlock()

	m.ring.Add(fmt.Sprintf("[s-ui-next] sing-box 已启动 (pid %d, %s)", pid, time.Now().Format(time.RFC3339)))

	go m.pump(stdout, logFile)
	go m.pump(stderr, logFile)
	go m.watch(cmd, logFile)
	return nil
}

// ansiRegexp 兜底剥离 ANSI 转义序列（旧版本核心可能忽略 --disable-color）
var ansiRegexp = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)

// pump 逐行读取核心输出，写入环形缓冲与日志文件
func (m *Manager) pump(r io.Reader, f *os.File) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := ansiRegexp.ReplaceAllString(scanner.Text(), "")
		m.ring.Add(line)
		_, _ = f.WriteString(line + "\n")
	}
	_ = f.Close()
}

// watch 监视进程退出，必要时自动重启
func (m *Manager) watch(cmd *exec.Cmd, logFile *os.File) {
	err := cmd.Wait()

	m.mu.Lock()
	manual := m.manualStop
	auto := m.autoRestart
	if m.cmd == cmd {
		m.cmd = nil
		if err != nil && !manual {
			m.state = StateFailed
			m.lastError = err.Error()
		} else if manual {
			m.state = StateStopped
		}
	}
	if time.Since(m.startedAt) > stableReset {
		m.restarts = 0
	}
	restarts := m.restarts
	m.mu.Unlock()

	m.ring.Add(fmt.Sprintf("[s-ui-next] sing-box 进程退出: %v (manual=%v)", err, manual))
	if logFile != nil {
		_ = logFile.Close()
	}

	if !manual && auto {
		// 指数退避：1s 2s 4s ... 上限 30s
		delay := restartMin << uint(restarts)
		if delay > restartMax {
			delay = restartMax
		}
		time.Sleep(delay)
		m.mu.Lock()
		m.restarts = restarts + 1
		m.mu.Unlock()
		if err := m.Start(); err != nil {
			m.ring.Add(fmt.Sprintf("[s-ui-next] 自动重启失败: %v", err))
		}
	}
}

// stopLocked 停止当前进程（需持有锁或单线程调用场景）
func (m *Manager) stopLocked() error {
	m.mu.Lock()
	cmd := m.cmd
	if cmd == nil || cmd.Process == nil {
		m.state = StateStopped
		m.mu.Unlock()
		return nil
	}
	m.manualStop = true
	m.mu.Unlock()

	// 优雅退出：SIGTERM → 等待 → 强杀
	_ = cmd.Process.Signal(sigTerm())
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(gracefulWait):
		_ = cmd.Process.Kill()
		<-done
	}

	m.mu.Lock()
	if m.cmd == cmd {
		m.cmd = nil
	}
	m.state = StateStopped
	m.mu.Unlock()
	return nil
}

// Stop 手动停止核心（不自动重启）
func (m *Manager) Stop() error {
	return m.stopLocked()
}

// Restart 重启核心
func (m *Manager) Restart() error {
	if err := m.Stop(); err != nil {
		return err
	}
	m.mu.Lock()
	m.restarts = 0
	m.mu.Unlock()
	return m.Start()
}

// Status 返回核心状态
func (m *Manager) Status() StatusInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	info := StatusInfo{
		State:       m.state,
		Restarts:    m.restarts,
		StartedAt:   m.startedAt,
		LastError:   m.lastError,
		BinaryPath:  m.binPath,
		CoreVersion: m.coreVersion,
	}
	if m.cmd != nil && m.cmd.Process != nil {
		info.Running = true
		info.PID = m.cmd.Process.Pid
	}
	if info.Running {
		info.State = StateRunning
	}
	return info
}

// CoreVersion 获取 sing-box 版本号（缓存）
func (m *Manager) CoreVersion() string {
	m.coreVerOnce.Do(func() {
		bin, err := m.resolveBinary()
		if err != nil {
			return
		}
		out, err := exec.Command(bin, "version").Output()
		if err != nil {
			return
		}
		// 输出形如 "sing-box version 1.13.19 ..."，取第一行
		line := string(out)
		for i, ch := range line {
			if ch == '\n' || ch == '\r' {
				line = line[:i]
				break
			}
		}
		m.coreVersion = line
	})
	return m.coreVersion
}

// InstallPath 核心安装目标路径（在线更新核心时写入此路径）
func (m *Manager) InstallPath() string {
	if runtime.GOOS == "windows" && filepath.Ext(m.binPath) == "" {
		return m.binPath + ".exe"
	}
	return m.binPath
}

// ResetVersionCache 清除版本缓存（核心二进制被更新后调用）
func (m *Manager) ResetVersionCache() {
	m.mu.Lock()
	m.coreVersion = ""
	m.mu.Unlock()
	m.coreVerOnce = sync.Once{}
}

// Logs 返回最近 tail 行日志
func (m *Manager) Logs(tail int) []string {
	if tail <= 0 || tail > logRingSize {
		tail = 200
	}
	return m.ring.Tail(tail)
}

func trimOutput(out []byte) string {
	s := string(out)
	if len(s) > 800 {
		s = s[:800] + " ..."
	}
	return s
}

// ---- 环形日志缓冲 ----

type logRing struct {
	mu     sync.Mutex
	lines  []string
	next   int
	full   bool
}

func newLogRing(size int) *logRing {
	return &logRing{lines: make([]string, size)}
}

func (r *logRing) Add(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lines[r.next] = line
	r.next = (r.next + 1) % len(r.lines)
	if r.next == 0 {
		r.full = true
	}
}

func (r *logRing) Tail(n int) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	size := len(r.lines)
	if !r.full && r.next < n {
		n = r.next
	}
	if n > size {
		n = size
	}
	out := make([]string, 0, n)
	start := (r.next - n + size) % size
	for i := 0; i < n; i++ {
		out = append(out, r.lines[(start+i)%size])
	}
	return out
}
