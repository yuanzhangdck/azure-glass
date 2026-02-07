# Azure Glass Panel 💎

> A futuristic, deep dark glass-morphism UI for managing Azure VMs.

## ✨ Features

- **🎨 Deep Dark Glass UI**: Premium visual design with frosted glass effects.
- **⚡ Quick Deploy**: Launch VMs (Ubuntu/Debian) in seconds with pre-sets.
- **🔄 IP Swap**: One-click Public IP rotation (IPv4 & IPv6).
- **🚀 Turbo Cache**: Instant loading of instance lists (5-min local cache).
- **🛡️ Auto Network**: Automatically creates Resource Groups, VNets, and NSGs.
- **📦 Native Node.js**: Lightweight deployment with PM2.

---

## 🇬🇧 English

### 🚀 One-Click Install

Run this command on your server (Ubuntu/Debian/CentOS):

```bash
bash <(curl -sL https://raw.githubusercontent.com/yuanzhangdck/azure-glass/main/install.sh)
```

**What this script does:**
1. Installs **Node.js 20**, **Git**, and **PM2**.
2. Clones the repository to `~/azure-glass`.
3. Installs dependencies and starts the server on port **3000**.
4. Configures **PM2** to auto-start on boot.

### 🔑 Default Credentials

- **URL**: `http://YOUR_IP:3000`
- **Password**: `password` (Change it in Settings)

---

## 🇨🇳 中文说明

### 🚀 一键安装

在您的服务器终端执行以下命令：

```bash
bash <(curl -sL https://raw.githubusercontent.com/yuanzhangdck/azure-glass/main/install.sh)
```

**脚本功能：**
1. 自动检测并安装 **Node.js 20**、**Git** 和 **PM2**。
2. 拉取代码到 `~/azure-glass` 目录。
3. 安装依赖并启动服务（默认端口 **3000**）。
4. 配置开机自启和崩溃重启保护。

### 🔑 默认信息

- **访问地址**: `http://服务器IP:3000`
- **默认密码**: `password` (请登录后在设置中修改)

## 📄 License

MIT
