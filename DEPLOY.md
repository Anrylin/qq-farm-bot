# 网站在线更新

管理员进入「设置 → 系统 → 版本与在线更新」，点击检查，查看发布说明后选择在线更新。更新服务先准备镜像，再停止应用、备份账号数据、切换镜像并等待健康检查。新版未能正常启动时，尝试恢复旧镜像和更新前的数据快照。

普通用户和代理不能调用检查、状态和安装接口。应用容器不挂载 Docker socket；只有运行在服务器上的独立更新进程可以控制已配置的 Compose 服务。应用和更新进程通过服务器内部地址与独立密钥通信，不要向公网开放更新进程端口。

## 通用安装（推荐）

适用于**全新部署**：Linux amd64、使用 systemd，已安装 Docker Engine、支持 `--wait-timeout` 的 Docker Compose v2、Node.js 20+ 和 util-linux（`flock`）。镜像内已经包含网站依赖，无需 pnpm 或自行编译。公开 GitHub 仓库和公开 GHCR 镜像无需 GitHub 令牌。

应用源码单独维护；公开更新仓库只提供正式版本和安装工具。部署网站请下载正式 Release 的 `qqfarm-deploy.tar.gz`，不要将公开更新仓库当作应用源码构建。安装包从 `v2026.11.23.4` 开始提供。下载命令：

```bash
mkdir qqfarm-deploy
cd qqfarm-deploy
curl -fL --retry 3 -o qqfarm-deploy.tar.gz \
  https://github.com/Anrylin/qq-farm-bot/releases/latest/download/qqfarm-deploy.tar.gz
tar -xzf qqfarm-deploy.tar.gz
sudo bash install.sh
```

默认网站仅监听 `127.0.0.1:3007`，可用反向代理接入域名。需要通过服务器 IP 直接访问时，在**首次安装**使用：

```bash
sudo bash install.sh --bind 0.0.0.0 --port 3007
```

然后打开 `http://<服务器IP>:3007`，首次使用 `admin / admin` 登录并修改密码。云服务器还需放行网站端口。更新器的 3917 端口无需对公网放行；它只绑定安装器创建的专用 Docker bridge 网关。若主机防火墙拦截容器访问宿主机，应允许该专用网络访问其网关的 TCP 3917，安装器会实际检查连通性。

安装器会：

1. 检查运行环境和资源名称，拒绝覆盖非空目录、同名服务、容器或数据卷。
2. 从 `Anrylin/qq-farm-bot` 获取最新正式版及不可变镜像摘要，下载镜像。
3. 创建专用网络、独立数据卷和随机通信密钥；密钥不显示在命令行或日志里。
4. 启动网站并等待健康检查，登记实际安装版本，配置 systemd 更新服务。
5. 从应用容器内验证更新接口和密钥有效，完成后即可在管理员网页检查和安装后续版本。

支持独立会话的正式版会安装 `app` 与 `session-host` 两个容器，更新器仍是宿主机上的独立进程。应用容器负责网页和自动化业务，会话容器负责游戏连接与心跳。兼容版本更新只重启应用，保持会话容器运行；首次迁移、更换会话容器、服务器重启或游戏端断线仍需重新登录。

参数可以组合使用，例如部署第二个实例：

```bash
sudo bash install.sh \
  --name farm2 --dir /opt/farm2 --port 3018 --bind 0.0.0.0
```

每个实例使用不同的名称、目录和网站端口；安装器独立分配网络网关，所以更新器可在各自网关使用相同的 3917 端口。其他 fork 可以使用 `--repo OWNER/REPO`，镜像地址默认自动对应小写的 `ghcr.io/owner/repo`，也可以显式指定 `--image-prefix`。对应 fork 必须已经发布兼容的镜像和 `farm-update.json`。

安装中途出错时，修复报错原因后继续：

```bash
sudo bash install.sh --dir /opt/qqfarm --resume
```

继续安装会沿用原参数和首次选定的版本，不会重新生成密钥，不会清空数据。成功安装后重复执行会拒绝重装，之后请通过网页更新。同一台服务器同时只能运行一个安装器；退出码 75 表示已有安装正在进行。`--plan` 不连接网络、不写文件、不操作 Docker；`--help` 查看全部参数。

### 通用部署文件与运维

默认实例的文件：

| 内容 | 路径或名称 |
| --- | --- |
| Compose 配置 | `/opt/qqfarm/compose.json` |
| 当前镜像覆盖 | `/opt/qqfarm/compose.image.json` |
| 应用容器 / 数据卷 | `qqfarm-app` / `qqfarm-data` |
| 会话运行卷 | `qqfarm-runtime`，保存本地通信、进程锁及登录会话 |
| 更新器与配置 | `/opt/qqfarm/updater/agent.cjs`、`config.json` |
| 通信密钥 | `/opt/qqfarm/updater/agent-token`，权限 0600 |
| 版本与任务状态 | `/opt/qqfarm/updater/state.json` |
| 更新前备份 | `/opt/qqfarm/updater/backups/` |
| 更新服务 | `qqfarm-online-update.service` |

手动启动应用时必须同时使用两个 Compose 文件，否则缺少镜像配置：

```bash
sudo docker compose -p qqfarm \
  -f /opt/qqfarm/compose.json -f /opt/qqfarm/compose.image.json up -d --no-deps --no-build app
sudo systemctl status qqfarm-online-update.service
sudo journalctl -u qqfarm-online-update.service -n 100 --no-pager
```

应用版本通过网页更新；宿主机的更新器需单独升级，操作见下节。

### GHCR 容器镜像加速

网页「版本与在线更新」的「检查更新」旁提供「镜像加速」：填写**支持 GHCR 的 HTTPS 镜像仓库前缀**，开启加速后保存。默认关闭加速；默认允许加速失败后回退 GHCR 直连。设置保存在此实例的更新器配置中，重启后保留，仅管理员可以修改。

例如，服务商要求用 `registry.example.com/ghcr.io` 时，发布镜像
`ghcr.io/anrylin/qq-farm-bot@sha256:<摘要>` 会通过
`registry.example.com/ghcr.io/anrylin/qq-farm-bot@sha256:<同一摘要>` 拉取。示例域名仅用于说明，请替换为可用的 GHCR 代理前缀。有些服务商只需填写域名，有些需追加 `/ghcr.io`，请按其规则填写。Docker Hub 镜像源与 GitHub 网页/源码加速地址不能直接替代 GHCR 代理。

更新器保留正式发布清单中的原始镜像和不可变摘要，仅改变下载仓库前缀；下载通过 Docker 摘要校验后才停止应用。镜像代理失败时按设置回退直连，全部下载失败会保留当前应用运行。使用代理安装后的回滚也沿用旧版实际镜像地址。镜像加速只作用于新版应用的 `docker pull`，不改变会话宿主、GitHub Release 检查或安装包下载。更新器从 v2026.11.25.4 起优先通过 GitHub 官方附件 API 下载清单，失败后尝试原附件地址，并校验 GitHub 提供的清单摘要；该修复需升级宿主机更新器后生效，公开发布无需个人令牌。

#### 旧部署升级更新器（仅需一次）

普通网页更新不会替换宿主机上的 `agent.cjs`。旧更新器没有加速能力时，页面会显示升级提示。先从包含此功能的正式 Release 获取新版 `qqfarm-deploy.tar.gz`（或取得最新仓库代码），在**解压的安装包目录**执行：

```bash
sudo bash install.sh --dir /opt/qqfarm --upgrade-updater
```

自定义安装目录请替换 `/opt/qqfarm`。此命令适用于通用安装器创建的实例，要求目录下存在 `updater/config.json`。它拒绝正在执行或曾中断的更新任务，备份原更新器和配置，只停止、替换并启动更新器的 systemd 服务，验证认证接口支持新能力；应用和 QQ 会话容器继续运行。未指定代理时，配置、通信密钥及任务状态保持原样。新版启动失败时尝试恢复旧更新器与配置，备份位于 `updater/backups/*-updater-upgrade/`。

如果当前旧版网页已经无法直连拉取新版，可在升级更新器时**同时预设代理**，然后直接在旧网页重新检查并安装新版，无需先成功下载新版镜像：

```bash
sudo bash install.sh --dir /opt/qqfarm --upgrade-updater \
  --image-mirror registry.example.com/ghcr.io
```

将示例前缀替换为自己的可用 GHCR 代理；该参数开启加速和失败直连回退。升级应用后可在网页修改或关闭。不要使用 `--resume`、`--enable-sessions` 代替 `--upgrade-updater`。

源码部署在源码更新卡片旁也提供「镜像加速」，使用支持 Git 协议的 GitHub HTTPS 代理前缀。它临时拉取当前远程分支并仅允许快进合并，不改写仓库的远程地址；凭据写在远程 URL 中时不会发送到代理。该设置与上述容器镜像代理独立。

### 已有容器与数据迁移

本安装器不会自动接管原始 Compose、`docker run`、宝塔或测试站部署。请勿将旧数据目录直接当作 `--dir` 传入，也不要让两套应用同时登录相同的游戏账号。

建议先停止旧应用并完整备份，再用不同名称、目录和端口完成新实例安装。停止新实例，将旧应用的完整 `/app/core/data` 迁入新实例的数据卷后再启动。旧版将日志独立挂载到 `qq-farm-logs` 时，也需将该卷内容迁入新卷的 `logs` 子目录。迁移应先在副本验证，保留旧部署及备份以便恢复；首次迁移可能需要重新获取游戏登录 Code。

`config.example.json` 仅用于手工接入参考：其中网关必须替换为实际 Docker 网络网关，不能照搬示例 IP；容器名、数据卷、Compose 文件和已安装版本均需与实际部署一致。安装器会自动生成这些内容。

### 从旧的单容器通用安装迁移

先在网页升级到包含独立会话代码的新正式版，再下载该版最新安装包，解压后执行：

```bash
sudo bash install.sh --dir /opt/qqfarm --enable-sessions
```

此命令只支持本安装器创建的实例：先停止应用并备份数据、Compose 和更新器配置，再添加独立会话容器及运行卷，更新宿主机更新器。此次迁移会断开现有游戏连接，需要重新扫码一次；之后兼容版本更新不再停止会话容器。普通网页更新不会自动改动旧部署拓扑，因此旧用户仍可先升级应用，再自行安排迁移时间。

会话容器固定使用迁移时的镜像；发布清单中的 `sessionProtocol` 指纹由游戏连接相关代码生成。指纹变化时，更新器在拉取镜像或停止应用之前拒绝更新，管理员应安排会话宿主维护升级。不要手工跳过检查或直接重启会话容器来实现保活。

迁移命令失败时会尝试恢复原配置。若断电等导致迁移中断，请查看 `session-migration.json` 中的 `backup`：停止此实例的更新服务，停止应用，使用该备份的 `compose.json`、`config.json`、`agent.cjs` 恢复安装目录和 `updater/` 下对应文件，再按原 Compose 配置启动应用和更新服务。`data/` 为迁移前完整数据备份，仅在需要时恢复。确认恢复后由管理员检查会话容器和 `<实例名>-runtime` 卷是否仍存在，清理未使用资源后将迁移记录标记为 `failed` 才可重新迁移；不要在状态不明时并行启动两套账号。

### QQ 扫码多人排队

网站按用户排队，并等待外部服务确认注销后才放行下一位。成功取码、关闭弹窗、取消和二维码过期都会由服务器清理本实例的任务；遗留清理记录保存在数据目录的 `qq-login-cleanup.json`，重启后下次扫码会重试。不要删除记录来强行跳过注销。

遇到 `LOGOUT_REQUIRED` 时会按顺序自动重试，持续一分钟仍失败则显示外部服务原因。此时需管理员检查配套的 `qq-miniapp-auth` 与 NapCat worker 是否能真正注销 QQ；网站不会注销其他部署创建的未知任务，也无法修复外部服务的注销能力。建议一个独立部署使用一个专用的 QQ 登录服务。
