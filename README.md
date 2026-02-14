# Azure Glass Panel 💎

> 玻璃拟态风格的 Azure 云资源管理面板，支持虚拟机管理和 AI Foundry 模型部署。

![Node.js](https://img.shields.io/badge/Node.js-20+-green) ![License](https://img.shields.io/badge/License-MIT-blue)

## ✨ 功能

### 虚拟机管理
- **快速部署** — 一键创建 Ubuntu/Debian 虚拟机，自动配置资源组、虚拟网络和安全组
- **IP 轮换** — 一键更换公网 IPv4/IPv6 地址
- **实例控制** — 启动、停止、删除虚拟机
- **本地缓存** — 实例列表 5 分钟缓存，秒开加载

### AI Foundry（Azure OpenAI）
- **资源管理** — 创建/删除 AI Foundry 资源，自动清除软删除释放配额
- **模型部署** — 从配额列表一键部署模型，自动获取最新版本，配额拉满
- **部署详情** — 查看已部署模型、API Endpoint（点击复制）
- **配额查看** — 全局配额（只读）和资源级配额（带部署按钮），按区域筛选
- **密钥管理** — 查看 API Key

### 订阅信息
- **订阅概览** — 显示订阅类型、总额度、到期时间
- **月度消费** — 通过 Cost Management API 查询当月消费
- **一键重置** — 删除所有资源组和资源

### 其他
- **多账户** — 支持添加多个 Azure Service Principal 账户
- **SOCKS5 代理** — 支持通过代理连接 Azure API
- **玻璃拟态 UI** — 深色毛玻璃风格界面

---

## 🚀 一键安装

在服务器终端执行（支持 Ubuntu/Debian/CentOS）：

```bash
bash <(curl -sL https://raw.githubusercontent.com/yuanzhangdck/azure-glass/main/install.sh)
```

脚本自动完成：
1. 安装 Node.js 20、Git、PM2
2. 拉取代码到 `~/azure-glass`
3. 安装依赖并启动服务（端口 3000）
4. 配置开机自启

### 🐳 Docker 安装

```bash
docker run -d \
  --name azure-glass \
  --restart always \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  ghcr.io/yuanzhangdck/azure-glass:latest
```

---

## 🔑 默认信息

| 项目 | 值 |
|------|-----|
| 访问地址 | `http://服务器IP:3000` |
| 默认密码 | `password` |

> ⚠️ 请登录后立即在设置中修改密码

---

## 📋 环境要求

- Node.js >= 20
- 系统：Ubuntu / Debian / CentOS
- 端口：3000（可通过 `PORT` 环境变量修改）

## 🔧 Azure 账户配置

需要创建 Service Principal 并赋予订阅级别的 `Contributor` 角色：

```bash
az ad sp create-for-rbac --role Contributor --scopes /subscriptions/<订阅ID>
```

将返回的 `appId`、`password`、`tenant` 填入面板的账户设置中。

---

## 📁 项目结构

```
azure-glass/
├── server.js          # 后端 Express 服务
├── public/
│   ├── index.html     # 前端页面
│   └── app.js         # 前端逻辑
├── data/
│   └── accounts.json  # 账户数据（自动生成）
├── install.sh         # 一键安装脚本
└── package.json
```

## 📄 License

MIT
