# QQ 农场多账号挂机 + Web 面板

这里提供 QQ 农场助手的正式发布版和安装包。应用源码单独维护，此仓库不包含应用源码，也不需要部署者提供个人 GitHub 令牌。

当前正式版本：**v2026.11.25.13** · [版本与更新记录](https://github.com/Anrylin/qq-farm-bot/releases)

公开发布只展示版本号及通用发布提示，详细更新记录由私有源码仓库维护。

## 当前界面

以下为测试站当前页面截图，账号名称、头像及日志中的隐私信息已做遮挡。

| 登录页（桌面） | 农场概览（桌面） |
| --- | --- |
| ![桌面登录页](docs/images/login-desktop.png) | ![桌面农场概览](docs/images/overview-desktop.png) |

![活动中心](docs/images/activity-desktop.png)

<details>
<summary>手机端截图</summary>

| 登录页 | 农场概览 |
| --- | --- |
| <img src="docs/images/login-mobile.png" alt="手机登录页" width="320"> | <img src="docs/images/overview-mobile.png" alt="手机农场概览" width="320"> |

</details>

## 安装与更新

需要 Linux amd64、systemd、Docker Engine、Docker Compose v2、Node.js 20+ 和 util-linux。全新部署下载本仓库 Release 的安装包：

```bash
mkdir qqfarm-deploy
cd qqfarm-deploy
curl -fL --retry 3 -o qqfarm-deploy.tar.gz \
  https://github.com/Anrylin/qq-farm-bot/releases/latest/download/qqfarm-deploy.tar.gz
tar -xzf qqfarm-deploy.tar.gz
sudo bash install.sh --plan
sudo bash install.sh --bind 0.0.0.0 --port 3007
```

默认安装目录 `/opt/qqfarm`。首次登录为 `admin / admin`，请修改密码。已有实例请勿重复安装，进入「设置 → 系统 → 版本与在线更新」检查新版即可。

更新源保持 `Anrylin/qq-farm-bot`，镜像保持 `ghcr.io/anrylin/qq-farm-bot`；旧通用部署沿用原地址。源码仓库调整不会要求部署者登录 GitHub。

- [完整安装与维护说明](DEPLOY.md)
- [正式版下载](https://github.com/Anrylin/qq-farm-bot/releases/latest)
- [版本发布信息](RELEASE_NOTES.md)

本仓库只发布更新清单、安装工具、界面截图与预构建镜像地址。GitHub 自动生成的 Source code 压缩包也只包含这些发布文件，请部署网站时使用 `qqfarm-deploy.tar.gz`。
