#!/bin/bash
# Azure Glass Panel - 一键安装脚本
# 用法: bash <(curl -sL https://raw.githubusercontent.com/yuanzhangdck/azure-glass/main/install.sh)

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}💎 Azure Glass Panel 安装程序${NC}"

# 检测包管理器
if [ -x "$(command -v apt-get)" ]; then
    PKG="apt"
elif [ -x "$(command -v yum)" ]; then
    PKG="yum"
else
    echo -e "${RED}❌ 不支持的系统，需要 apt 或 yum${NC}"; exit 1
fi

# 1. 安装 Node.js
if ! command -v node &> /dev/null; then
    echo "📦 安装 Node.js 20..."
    if [ "$PKG" = "apt" ]; then
        apt-get update -y && apt-get install -y curl
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    else
        yum install -y curl
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        yum install -y nodejs
    fi
fi

# 2. 安装 Git
if ! command -v git &> /dev/null; then
    echo "🔧 安装 Git..."
    $PKG install -y git
fi

# 3. 安装 PM2
if ! command -v pm2 &> /dev/null; then
    echo "🚀 安装 PM2..."
    npm install -g pm2
fi

# 4. 拉取/更新代码
WORK_DIR="$HOME/azure-glass"
if [ -d "$WORK_DIR" ]; then
    echo "📂 更新代码..."
    cd "$WORK_DIR" && git pull
else
    echo "📂 拉取代码..."
    git clone https://github.com/yuanzhangdck/azure-glass.git "$WORK_DIR"
    cd "$WORK_DIR"
fi

# 5. 安装依赖
echo "📥 安装依赖..."
npm install --production

# 6. 启动服务
echo "🔥 启动服务..."
pm2 delete azure-glass 2>/dev/null || true
PORT=3000 pm2 start server.js --name azure-glass

# 7. 开机自启
pm2 startup 2>/dev/null | tail -1 | bash 2>/dev/null || true
pm2 save 2>/dev/null || true

# 8. 完成
IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_IP")
echo ""
echo -e "${GREEN}✅ 安装完成！${NC}"
echo -e "👉 访问地址: http://$IP:3000"
echo -e "🔑 默认密码: password"
echo -e "⚠️  请登录后立即修改密码"
