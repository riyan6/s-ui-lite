#!/usr/bin/env bash
# 本地构建：前端（React+antd+Vite）→ 交叉编译 linux amd64/arm64 + 当前平台调试版
set -euo pipefail

VERSION="${1:-dev}"
OUT_DIR="release"
LDFLAGS="-s -w -X main.Version=${VERSION}"

# 前端构建（无 pnpm/node 时跳过，仅构建后端）
if command -v pnpm >/dev/null 2>&1; then
  echo "构建前端..."
  (cd frontend && pnpm install --prefer-offline && pnpm run build)
else
  echo "警告: 未安装 pnpm，跳过前端构建（将使用已有/占位 dist）"
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

build() {
    local os="$1"
    local arch="$2"
    local name="s-ui-next-${os}-${arch}"
    [[ "$os" == "windows" ]] && name="${name}.exe"
    CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags "$LDFLAGS" \
        -o "$OUT_DIR/$name" ./cmd/s-ui-next
    echo "已构建: $OUT_DIR/$name"
}

build linux amd64
build linux arm64
build "$(go env GOOS)" "$(go env GOARCH)"

# 打包发布物（包内二进制统一命名为 s-ui-next，与 install.sh 解压逻辑一致）
for arch in amd64 arm64; do
    cp "$OUT_DIR/s-ui-next-linux-$arch" "$OUT_DIR/s-ui-next"
    cp install.sh "$OUT_DIR/"
    tar -czf "$OUT_DIR/s-ui-next-linux-${arch}.tar.gz" -C "$OUT_DIR" s-ui-next install.sh
done
echo "完成，产物位于 $OUT_DIR/"
