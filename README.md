# s-ui-next

轻量级 sing-box 管理面板。单二进制、内嵌 SQLite、面向低配置 VPS，仅管理你需要的核心配置，没有多余功能。

> 仓库：https://github.com/riyan6/s-ui-lite

## 特性

- **单文件部署**：Go 编译的单二进制（前端嵌入），数据全部存本地 SQLite 文件
- **完整配置管理**：入站 / 出站 / 路由（规则 + 规则集 + 全局）/ DNS（服务器 + 分流）/ 日志级别 / 服务（sing-box API）
- **协议支持**（跟随 sing-box 1.14.x）：
  - 入站：Shadowsocks（2022 系加密，多用户）、VLESS + Reality + Vision、Snell（v5/v6）、Cloudflared 隧道
  - 出站：direct / block / Shadowsocks / SOCKS（链式代理）/ Snell（链式代理）
- **sing-box API 服务**：可视化配置顶层 `services`（gRPC API 服务，可托管 sing-box Dashboard，配合图形客户端远程管理）
- **入站多客户端**：每个入站挂多个客户端凭证，支持单独启停与到期时间（到期自动从配置移除）
- **保存流水线**：所有变更先 `sing-box check` 校验再落盘重启，误操作不会打挂正在运行的核心
- **核心子进程管理**：崩溃自动重启（指数退避）、运行日志面板可查
- **服务器状态**：CPU / 内存 / 网络 / 磁盘 / 负载 / 运行时长（读 /proc，零依赖）
- **JWT 认证**：登录失败限速、首登强制改密
- **一键脚本**：install.sh 支持安装 / 卸载 / 更新面板 / 更新核心 / 服务管理

## 部署

```bash
# 安装（默认装最新 release + sing-box 核心，注册 systemd 服务）
bash <(curl -fsSL https://raw.githubusercontent.com/riyan6/s-ui-lite/main/install.sh)

# 或安装指定版本
bash <(curl -fsSL https://raw.githubusercontent.com/riyan6/s-ui-lite/main/install.sh) install v1.14.0

# 管理命令
bash install.sh update            # 更新面板
bash install.sh update-core 1.14.0
bash install.sh status / log / restart ...
bash install.sh uninstall --purge # 彻底卸载
```

- 默认地址：`http://服务器IP:2095`，默认账号 `admin / admin`（首登强制改密）
- 目录布局：`/usr/local/s-ui-next/`（`s-ui-next.db`、`sing-box.json`、`bin/sing-box`、`logs/`、`config.json`）

## 开发

```bash
# 后端（数据在 ./data，Windows 可跑，服务器状态返回零值）
go run ./cmd/s-ui-next

# 前端（frontend/，React 19 + antd v6 + Vite；开发端口 5173，API 自动代理到 2095）
cd frontend && pnpm install && pnpm dev

# 联调发布构建：先 pnpm build 生成 dist（嵌入二进制），再交叉编译
./build.sh 1.14.0

# 检查（antd 官方 CLI，检测废弃 API）
cd frontend && pnpm exec antd lint ./src
go vet ./...
```

结构：

```
cmd/s-ui-next          入口（版本号、信号处理、启动编排）
internal/config        面板引导配置（config.json：端口、数据目录）
internal/database      GORM + 纯 Go SQLite 驱动（无 CGO，交叉编译零负担）
internal/model         Setting / Inbound / Client / Outbound / RouteRule / RouteRuleSet / DnsServer / DnsRule
internal/service       设置、认证（JWT + 登录限速）
internal/service/configgen  sing-box 配置生成器（字段与官方 1.14 文档一一对应）+ 密钥工具
internal/core          sing-box 子进程管理（check / 重启退避 / 日志环形缓冲）
internal/serverstatus  /proc 服务器状态采集
internal/handler       REST API（Gin）
frontend/              前端源码（React + antd v6 + Vite）+ embed.go（构建产物嵌入二进制）
```

## API 一览（`/api/v1`，JWT Bearer 认证）

响应统一为 `{ success, msg, obj }`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/login` | 登录 → `{token, must_change_password}` |
| POST | `/auth/password` | 修改密码 |
| GET / PUT | `/settings` | 面板设置（日志级别、核心路径、自动重启、面板端口等） |
| GET / POST | `/inbounds` | 入站列表（含客户端）/ 创建 |
| GET / PUT / DELETE | `/inbounds/:id` | 入站详情 / 更新 / 删除 |
| POST | `/inbounds/:id/clients` | 添加客户端（凭证留空自动生成 UUID / SS 密钥） |
| PUT / DELETE | `/clients/:id` | 客户端更新 / 删除 |
| GET / POST | `/outbounds`，`PUT/DELETE /outbounds/:id` | 出站 CRUD |
| GET / POST | `/route/rules`，`PUT/DELETE /route/rules/:id`，`PUT /route/rules/order` | 路由规则 CRUD + 排序 |
| GET / POST | `/route/rule-sets`，`PUT/DELETE /route/rule-sets/:id` | 规则集 CRUD |
| GET / PUT | `/route/settings` | 路由全局设置（final、auto_detect_interface…） |
| GET / POST | `/dns/servers`，`PUT/DELETE /dns/servers/:id`，`PUT /dns/servers/order` | DNS 服务器 CRUD + 排序 |
| GET / POST | `/dns/rules`，`PUT/DELETE /dns/rules/:id`，`PUT /dns/rules/order` | DNS 分流规则 CRUD + 排序 |
| GET / PUT | `/dns/settings` | DNS 全局设置（strategy、cache…） |
| GET / POST | `/services`，`PUT/DELETE /services/:id` | sing-box 服务 CRUD（顶层 `services`，当前支持 api 类型） |
| GET | `/server/status` | 服务器状态 |
| GET / POST | `/core/status`、`/core/restart`、`/core/logs?tail=` | 核心状态 / 重启 / 日志 |
| GET | `/core/versions` | 可更新的核心版本列表（仅适配版本线 1.14.x 稳定版） |
| POST | `/core/update` | 在线下载并更新核心（自动停核心→替换→重启，失败回滚） |
| GET | `/tools/uuid`、`/tools/ss-key?method=`、`/tools/reality-keypair`、`/tools/short-id`、`/tools/snell-psk` | 密钥生成 |
| GET | `/healthz` | 健康检查（无鉴权） |

### 配置存储约定

各实体的 `config` 字段是 JSON 对象，与 sing-box 官方文档字段一一对应（能透传就透传）：

- 入站 `config` 不含 `type/tag/listen/listen_port`（由列字段生成）；VLESS 的 `flow` 为入站级默认，客户端 `meta.flow` 可覆盖；Snell 客户端凭证即多用户 `userkey`；Cloudflared 为隧道入站（无监听端口，单实例）
- 服务 `config` 不含 `type/tag`（由列字段生成），字段与服务文档一一对应（listen、secret、dashboard 等）
- 路由/DNS 规则的 `config` 即完整规则对象（条件 + `action` + 出站/服务器）
- 配置了 DNS 服务器且未手动指定时，`route.default_domain_resolver` 自动取第一个 DNS 服务器（sing-box 1.12+ 要求，可在路由全局设置中覆盖）
- 写操作生效流程：写库 → 生成完整配置 → `sing-box check` → 通过则重启核心，失败则回滚

## 路线图

- [x] 后端 API + 核心管理 + 安装脚本
- [x] React + antd v6 前端（登录 / 仪表盘 / 入站+客户端+分享链接 / 出站 / 路由 / DNS / 日志 / 设置）
- [x] 适配 sing-box 1.14.x（Snell 入站/出站、Cloudflared 入站、sing-box API 服务）
- [ ] AnyTLS 入站、更多链式出站（vmess/vless/trojan/hysteria2/tuic）
- [ ] 订阅链接、TLS 证书管理与 ACME、流量统计
- [ ] 更多服务类型表单（derp / hysteria-realm / usbip 等）

## 许可

待定
