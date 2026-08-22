// Package core 在线更新 sing-box 核心：从官方 GitHub Release 下载并安装。
// 面板适配的核心版本线由 AdaptedCoreLine 固定，仅允许更新该系列的稳定版
// （排除 prerelease/draft 与其他版本线，如 1.14.x 预发布）。
package core

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

const (
	// AdaptedCoreLine 面板已适配的 sing-box 版本线（大.小），升级适配时只需改这里。
	// 其他版本线的稳定版仍会列出并标记为“未适配”，由用户自行选择。
	AdaptedCoreLine = "1.13"

	// maxListedVersions 版本列表最多展示的条数
	maxListedVersions = 20

	releasesAPI    = "https://api.github.com/repos/SagerNet/sing-box/releases?per_page=100"
	downloadURLFmt = "https://github.com/SagerNet/sing-box/releases/download/v%s/sing-box-%s-%s-%s%s"
)

// stableVersionRegexp 合法的稳定版 tag（纯 semver，无预发布后缀）
var stableVersionRegexp = regexp.MustCompile(`^v\d+\.\d+\.\d+$`)

// adaptedVersionRegexp 属于适配版本线的 tag：v1.13.x
var adaptedVersionRegexp = regexp.MustCompile(`^v` + strings.ReplaceAll(AdaptedCoreLine, ".", `\.`) + `\.\d+$`)

// CoreRelease 一个可用的核心版本
type CoreRelease struct {
	Tag         string `json:"tag"`
	PublishedAt string `json:"published_at"`
	Adapted     bool   `json:"adapted"` // 是否属于适配版本线
}

func httpClient(timeout time.Duration) *http.Client {
	// 默认 Transport 自动遵循 HTTP_PROXY/HTTPS_PROXY 环境变量
	return &http.Client{Timeout: timeout}
}

// FetchCoreReleases 拉取官方 Release 列表：仅稳定版（排除 draft/prerelease），
// 覆盖所有版本线，标记是否属于适配版本线，最多 maxListedVersions 条（新→旧）
func FetchCoreReleases() ([]CoreRelease, error) {
	req, err := http.NewRequest("GET", releasesAPI, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "s-ui-next")
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := httpClient(30 * time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("访问 GitHub API 失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API 返回 HTTP %d", resp.StatusCode)
	}

	var releases []struct {
		TagName     string `json:"tag_name"`
		PublishedAt string `json:"published_at"`
		Prerelease  bool   `json:"prerelease"`
		Draft       bool   `json:"draft"`
	}
	if err := decodeJSON(resp.Body, &releases); err != nil {
		return nil, fmt.Errorf("解析 Release 列表失败: %w", err)
	}

	result := make([]CoreRelease, 0, maxListedVersions)
	for _, r := range releases {
		if len(result) >= maxListedVersions {
			break
		}
		if r.Draft || r.Prerelease || !stableVersionRegexp.MatchString(r.TagName) {
			continue
		}
		result = append(result, CoreRelease{
			Tag:         r.TagName,
			PublishedAt: r.PublishedAt,
			Adapted:     adaptedVersionRegexp.MatchString(r.TagName),
		})
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("未找到可用的稳定版本")
	}
	return result, nil
}

// LatestAdaptedRelease 最新适配版本（更新接口不带版本号时的默认目标）
func LatestAdaptedRelease() (CoreRelease, error) {
	releases, err := FetchCoreReleases()
	if err != nil {
		return CoreRelease{}, err
	}
	for _, r := range releases {
		if r.Adapted {
			return r, nil
		}
	}
	return CoreRelease{}, fmt.Errorf("未找到 %s.x 系列的稳定版本", AdaptedCoreLine)
}

// ValidAdaptedVersion 校验版本号是否属于适配版本线（接受带/不带 v 前缀）
func ValidAdaptedVersion(version string) bool {
	if !strings.HasPrefix(version, "v") {
		version = "v" + version
	}
	return adaptedVersionRegexp.MatchString(version)
}

// ValidateCoreVersion 校验目标版本是否为官方稳定版（列表内存在），接受带/不带 v 前缀
func ValidateCoreVersion(version string) error {
	if !strings.HasPrefix(version, "v") {
		version = "v" + version
	}
	releases, err := FetchCoreReleases()
	if err != nil {
		return err
	}
	for _, r := range releases {
		if r.Tag == version {
			return nil
		}
	}
	return fmt.Errorf("版本 %s 不是官方稳定版（预发布版本不受支持）", version)
}

// DownloadCoreToTmp 下载指定版本核心并解压到安装路径旁的临时文件（不影响运行中的核心）。
// version 不带 v 前缀；版本合法性由调用方（handler）校验。
// 返回临时二进制路径，供 InstallCore 完成替换。
func DownloadCoreToTmp(version, installPath string) (string, error) {
	version = strings.TrimPrefix(version, "v")

	ext := ".tar.gz"
	binaryName := "sing-box"
	if runtime.GOOS == "windows" {
		ext = ".zip"
		binaryName = "sing-box.exe"
	}
	assetName := fmt.Sprintf("sing-box-%s-%s-%s", version, runtime.GOOS, runtime.GOARCH)
	url := fmt.Sprintf(downloadURLFmt, version, version, runtime.GOOS, runtime.GOARCH, ext)

	// 下载到临时文件
	tmpArchive := filepath.Join(os.TempDir(), assetName+ext)
	if err := downloadFile(url, tmpArchive); err != nil {
		return "", err
	}
	defer os.Remove(tmpArchive)

	// 从压缩包提取核心二进制
	if err := os.MkdirAll(filepath.Dir(installPath), 0755); err != nil {
		return "", err
	}
	tmpBinary := installPath + ".download"
	if err := extractBinary(tmpArchive, assetName+"/"+binaryName, tmpBinary); err != nil {
		os.Remove(tmpBinary)
		return "", err
	}
	return tmpBinary, nil
}

// InstallCore 用临时文件替换核心二进制。Windows 不允许替换运行中的 exe，
// 调用前必须先停止核心。旧文件先改名备份，替换失败自动回滚。
func InstallCore(tmpPath, installPath string) error {
	bak := installPath + ".bak"
	_ = os.Remove(bak)
	if _, err := os.Stat(installPath); err == nil {
		if err := os.Rename(installPath, bak); err != nil {
			return fmt.Errorf("备份旧核心失败: %w", err)
		}
	}
	if err := os.Rename(tmpPath, installPath); err != nil {
		// 回滚旧版本
		if _, statErr := os.Stat(bak); statErr == nil {
			_ = os.Rename(bak, installPath)
		}
		return fmt.Errorf("替换核心二进制失败: %w", err)
	}
	_ = os.Remove(bak)
	if runtime.GOOS != "windows" {
		_ = os.Chmod(installPath, 0755)
	}
	return nil
}

func downloadFile(url, dest string) error {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "s-ui-next")
	resp, err := httpClient(10 * time.Minute).Do(req)
	if err != nil {
		return fmt.Errorf("下载失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("下载失败: HTTP %d（%s）", resp.StatusCode, url)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}

// extractBinary 从 tar.gz / zip 中提取指定名称的文件
func extractBinary(archivePath, entryName, dest string) error {
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()

	if strings.HasSuffix(archivePath, ".zip") {
		zr, err := zip.OpenReader(archivePath)
		if err != nil {
			return fmt.Errorf("打开 zip 失败: %w", err)
		}
		defer zr.Close()
		for _, zf := range zr.File {
			if zf.Name == entryName {
				rc, err := zf.Open()
				if err != nil {
					return err
				}
				defer rc.Close()
				_, err = io.Copy(f, rc)
				return err
			}
		}
		return fmt.Errorf("压缩包中未找到 %s", entryName)
	}

	af, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer af.Close()
	gz, err := gzip.NewReader(af)
	if err != nil {
		return fmt.Errorf("解压 gzip 失败: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("读取 tar 失败: %w", err)
		}
		if hdr.Typeflag == tar.TypeReg && hdr.Name == entryName {
			_, err = io.Copy(f, tr)
			return err
		}
	}
	return fmt.Errorf("压缩包中未找到 %s", entryName)
}

func decodeJSON(r io.Reader, v any) error {
	return json.NewDecoder(r).Decode(v)
}
