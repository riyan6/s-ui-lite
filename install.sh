#!/usr/bin/env bash
#
# s-ui-next 安装/管理脚本
#
# 用法:
#   bash install.sh                       交互菜单（无参数时进入）
#   bash install.sh install [版本|本地二进制路径]   安装面板 + sing-box 核心
#   bash install.sh uninstall [--purge]   卸载（默认保留数据，--purge 全部删除）
#   bash install.sh update [版本|本地二进制路径]   更新面板二进制（自动备份数据库）
#   bash install.sh update-core [版本]    更新 sing-box 核心
#   bash install.sh start|stop|restart|status|log|version|help
#
# 环境变量:
#   GITHUB_REPO        面板 release 所在仓库（默认值请改为你的仓库，格式 user/repo）
#   CORE_VERSION       sing-box 版本（默认 1.13.19）
#
set -euo pipefail

# ========================= 可配置项 =========================
GITHUB_REPO="${GITHUB_REPO:-riyan6/s-ui-lite}"   # 面板 Release 所在仓库
CORE_VERSION="${CORE_VERSION:-1.13.19}"
# ============================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;36m'; PLAIN='\033[0m'
INSTALL_DIR="/usr/local/s-ui-next"
SERVICE="s-ui-next"
BINARY_NAME="s-ui-next"
CORE_BIN="$INSTALL_DIR/bin/sing-box"
CONFIG_FILE="$INSTALL_DIR/config.json"
DB_FILE="$INSTALL_DIR/s-ui-next.db"
CORE_LOG="$INSTALL_DIR/logs/sing-box.log"

info()    { echo -e "${BLUE}[信息]${PLAIN} $1"; }
success() { echo -e "${GREEN}[成功]${PLAIN} $1"; }
warn()    { echo -e "${YELLOW}[警告]${PLAIN} $1"; }
error()   { echo -e "${RED}[错误]${PLAIN} $1"; exit 1; }

confirm() {
    if [[ "$1" == "force" ]]; then return 0; fi
    read -rp "$(echo -e "${YELLOW}$2${PLAIN} [y/N]: ")" answer
    [[ "${answer,,}" == "y" ]] || exit 0
}

check_root() { [[ $EUID -eq 0 ]] || error "请以 root 用户运行此脚本"; }

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)  echo "amd64" ;;
        aarch64|arm64) echo "arm64" ;;
        *) error "不支持的架构: $(uname -m)（当前仅支持 amd64/arm64）" ;;
    esac
}

# download <url> <输出文件>
download() {
    local url="$1" output="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fSL --retry 3 --connect-timeout 15 -o "$output" "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget -q --tries=3 --timeout=15 -O "$output" "$url"
    else
        error "需要 curl 或 wget 来下载文件"
    fi
}

# github_latest_tag  获取面板最新版本号（如 v0.1.0）
github_latest_tag() {
    download "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" "/tmp/suin-release.json" 2>/dev/null || return 1
    grep -oP '"tag_name":\s*"\K[^"]+' /tmp/suin-release.json | head -1
}

# install_panel [版本tag 或 本地二进制文件路径]
install_panel() {
    local version="${1:-}"
    # 本地文件直接安装（无需 GitHub Release）
    if [[ -n "$version" && -f "$version" ]]; then
        info "从本地文件安装面板: $version"
        install -m 755 "$version" "$INSTALL_DIR/${BINARY_NAME}"
        echo "local" > "$INSTALL_DIR/panel.version"
        return
    fi
    if [[ -z "$version" ]]; then
        version="$(github_latest_tag)" || error "无法获取最新版本，请手动指定: bash install.sh install v0.1.0"
    fi
    [[ "$version" == v* ]] || version="v$version"
    local arch; arch="$(detect_arch)"
    local asset="s-ui-next-linux-${arch}.tar.gz"
    local url="https://github.com/${GITHUB_REPO}/releases/download/${version}/${asset}"

    info "下载面板 ${version} (${arch}) ..."
    download "$url" "/tmp/suin-panel.tar.gz"
    tar -xzf /tmp/suin-panel.tar.gz -C /tmp/
    install -m 755 "/tmp/${BINARY_NAME}" "$INSTALL_DIR/${BINARY_NAME}"
    rm -f "/tmp/${BINARY_NAME}" /tmp/suin-panel.tar.gz
    echo "$version" > "$INSTALL_DIR/panel.version"
}

# install_core [版本，空则 $CORE_VERSION]
install_core() {
    local version="${1:-$CORE_VERSION}"
    [[ "$version" == v* ]] && version="${version#v}"
    local arch; arch="$(detect_arch)"
    local pkg="sing-box-${version}-linux-${arch}"
    local url="https://github.com/SagerNet/sing-box/releases/download/v${version}/${pkg}.tar.gz"

    info "下载 sing-box 核心 v${version} (${arch}) ..."
    download "$url" "/tmp/suin-core.tar.gz"
    tar -xzf /tmp/suin-core.tar.gz -C /tmp/ "${pkg}/sing-box"
    install -m 755 "/tmp/${pkg}/sing-box" "$CORE_BIN"
    rm -rf "/tmp/${pkg}" /tmp/suin-core.tar.gz
    echo "$version" > "$INSTALL_DIR/core.version"
    success "sing-box v$version 安装完成: $CORE_BIN"
}

write_service() {
    cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=s-ui-next panel (sing-box management)
After=network.target nss-lookup.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/${BINARY_NAME}
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
}

cmd_install() {
    check_root
    command -v systemctl >/dev/null 2>&1 || error "此脚本需要 systemd"
    local version="${1:-}"

    mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/logs"

    local panel_action="安装"
    if [[ -x "$INSTALL_DIR/${BINARY_NAME}" ]]; then
        panel_action="更新"
        info "检测到已有安装，将保留数据目录"
    fi

    info "${panel_action}面板 ..."
    install_panel "$version"

    if [[ ! -x "$CORE_BIN" ]]; then
        install_core
    else
        info "sing-box 核心已存在，跳过下载（更新核心请执行: bash install.sh update-core）"
    fi

    write_service
    systemctl enable --now "${SERVICE}.service"
    sleep 1
    systemctl is-active --quiet "${SERVICE}.service" || { journalctl -u "$SERVICE" -n 20 --no-pager; error "服务启动失败，请查看上方日志"; }

    local ip
    ip="$(curl -fs4 --connect-timeout 5 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo '服务器IP')"
    echo ""
    success "s-ui-next 安装完成！"
    echo -e "  面板地址: ${GREEN}http://${ip}:2095/${PLAIN}（端口可在面板设置中修改）"
    echo -e "  默认账号: ${GREEN}admin${PLAIN} / ${GREEN}admin${PLAIN}（首次登录会要求修改密码）"
    echo -e "  数据目录: ${INSTALL_DIR}"
    echo -e "  管理命令: bash install.sh help"
}

cmd_uninstall() {
    check_root
    confirm "$1" "确认卸载 s-ui-next？（数据目录默认保留，--purge 彻底删除）"
    systemctl disable --now "${SERVICE}.service" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE}.service"
    systemctl daemon-reload
    if [[ "${1:-}" == "--purge" ]]; then
        rm -rf "$INSTALL_DIR"
        success "已彻底卸载（含全部数据）"
    else
        rm -f "$INSTALL_DIR/${BINARY_NAME}" "$CORE_BIN"
        warn "已卸载，数据目录保留: $INSTALL_DIR（数据库/日志/配置）"
    fi
}

cmd_update() {
    check_root
    local version="${1:-}"
    [[ -z "$version" ]] && version="$(github_latest_tag)" || true
    [[ -z "$version" ]] && error "无法获取最新版本号"
    local current; current="$(cat "$INSTALL_DIR/panel.version" 2>/dev/null || echo unknown)"
    if [[ "$version" == "$current" ]]; then
        info "当前已是最新版本 $version"
        return
    fi
    info "更新面板: $current -> $version"
    if [[ -f "$DB_FILE" ]]; then
        cp "$DB_FILE" "${DB_FILE}.bak.$(date +%Y%m%d%H%M%S)"
        info "数据库已备份"
    fi
    install_panel "$version"
    systemctl restart "${SERVICE}.service"
    success "面板已更新到 $version"
}

cmd_update_core() {
    check_root
    local version="${1:-$CORE_VERSION}"
    [[ -x "$CORE_BIN" ]] || warn "当前未安装核心，将直接安装 v$version"
    systemctl stop "${SERVICE}.service" 2>/dev/null || true
    install_core "$version"
    systemctl start "${SERVICE}.service"
    success "核心已更新并重启面板"
}

show_help() {
    echo "s-ui-next 管理脚本"
    echo ""
    echo "用法:"
    echo "  bash install.sh                直接运行进入交互菜单"
    echo "  bash install.sh <命令> [参数]  命令行模式（便于自动化）"
    echo ""
    echo "命令:"
    echo "  install [版本|本地二进制]   安装/更新面板与核心"
    echo "  update [版本|本地二进制]    更新面板二进制（自动备份数据库）"
    echo "  update-core [版本]          更新 sing-box 核心（默认 ${CORE_VERSION}）"
    echo "  uninstall [--purge]         卸载（--purge 连数据一起删除）"
    echo "  start | stop | restart | status   服务管理"
    echo "  info                        查看面板信息"
    echo "  log [--core]                查看面板日志（--core 查看 sing-box 运行日志）"
    echo "  version                     查看版本"
    echo "  help                        帮助"
}

# ==================== 交互菜单 ====================

is_installed() {
    [[ -x "$INSTALL_DIR/${BINARY_NAME}" ]] || return 1
    [[ -f "/etc/systemd/system/${SERVICE}.service" ]]
}

svc_action() {
    check_root
    is_installed || { warn "面板未安装"; return 1; }
    systemctl "$1" "${SERVICE}.service"
}

show_info() {
    if ! is_installed; then
        warn "面板未安装"
        return 1
    fi
    local state ver core_ver port ip
    state="$(systemctl is-active "${SERVICE}.service" 2>/dev/null || echo unknown)"
    ver="$(cat "$INSTALL_DIR/panel.version" 2>/dev/null || echo unknown)"
    core_ver="$(cat "$INSTALL_DIR/core.version" 2>/dev/null || echo 未安装)"
    port="$(grep -oP '"port":\s*\K[0-9]+' "$CONFIG_FILE" 2>/dev/null || echo 2095)"
    ip="$(curl -fs4 --connect-timeout 5 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo '服务器IP')"
    echo "----------------------------------------"
    echo " 服务状态:  ${state}"
    echo " 面板版本:  ${ver}"
    echo " 核心版本:  ${core_ver}"
    echo " 面板地址:  http://${ip}:${port}"
    echo " 数据目录:  ${INSTALL_DIR}"
    echo "----------------------------------------"
    systemctl status "${SERVICE}.service" --no-pager -l 2>/dev/null | head -n 8
}

show_log() {
    check_root
    is_installed || { warn "面板未安装"; return 1; }
    # trap 屏蔽 Ctrl+C 对脚本的终止，退出 tail/journalctl 后回到菜单
    trap ':' INT
    if [[ "${1:-}" == "--core" ]]; then
        [[ -f "$CORE_LOG" ]] || { warn "核心日志不存在: $CORE_LOG"; trap - INT; return 1; }
        echo "核心日志（最近 50 行并持续输出，Ctrl+C 返回）"
        tail -n 50 -f "$CORE_LOG"
    else
        echo "面板日志（最近 50 行并持续输出，Ctrl+C 返回）"
        journalctl -u "${SERVICE}.service" -n 50 --no-pager -f
    fi
    trap - INT
}

show_menu() {
    while true; do
        echo ""
        echo "========================================"
        echo "           s-ui-next 管理脚本"
        echo "========================================"
        if is_installed; then
            local state ver
            state="$(systemctl is-active "${SERVICE}.service" 2>/dev/null || echo unknown)"
            ver="$(cat "$INSTALL_DIR/panel.version" 2>/dev/null || echo unknown)"
            echo "  面板版本: ${ver}    服务状态: ${state}"
        else
            echo "  面板尚未安装"
        fi
        echo "----------------------------------------"
        echo "   1. 安装面板"
        echo "   2. 更新面板"
        echo "   3. 更新 sing-box 核心"
        echo "   4. 启动服务"
        echo "   5. 停止服务"
        echo "   6. 重启服务"
        echo "   7. 查看信息"
        echo "   8. 查看面板日志"
        echo "   9. 查看核心日志"
        echo "  10. 卸载面板"
        echo "   0. 退出"
        echo "========================================"
        read -rp " 请输入选择 [0-10]: " choice
        case "$choice" in
            1)  cmd_install "" ;;
            2)  cmd_update "" ;;
            3)  read -rp " 核心版本（回车默认 ${CORE_VERSION}）: " v
                cmd_update_core "${v:-}" ;;
            4)  svc_action start ;;
            5)  svc_action stop ;;
            6)  svc_action restart ;;
            7)  show_info ;;
            8)  show_log ;;
            9)  show_log --core ;;
            10) cmd_uninstall "" ;;
            0|q|Q) exit 0 ;;
            *)  warn "无效选择: $choice" ;;
        esac
        echo ""
        read -rp " 按回车返回菜单..." _
    done
}

main() {
    # 无参数时进入交互菜单
    if [[ $# -eq 0 ]]; then
        show_menu
        return
    fi

    local cmd="$1"
    shift || true
    case "$cmd" in
        install)      cmd_install "${1:-}" ;;
        uninstall)    cmd_uninstall "${1:-}" ;;
        update)       cmd_update "${1:-}" ;;
        update-core)  cmd_update_core "${1:-}" ;;
        start|stop|restart|status)
            svc_action "$cmd" ;;
        log)          show_log "${1:-}" ;;
        info)         show_info ;;
        version)
            "$INSTALL_DIR/${BINARY_NAME}" -version 2>/dev/null || true
            echo "核心: $(cat "$INSTALL_DIR/core.version" 2>/dev/null || echo 未安装)" ;;
        menu)         show_menu ;;
        help|-h|--help) show_help ;;
        *) error "未知命令: $cmd（查看帮助: bash install.sh help）" ;;
    esac
}

main "$@"
