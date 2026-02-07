#!/bin/bash
# Azure Glass Panel - One-Click Installer
# Usage: bash <(curl -sL https://raw.githubusercontent.com/yuanzhangdck/azure-glass/main/install.sh)

set -e

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${BLUE}💎 Azure Glass Panel Installer${NC}"

# 1. Install Node.js (if missing)
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    if [ -x "$(command -v apt-get)" ]; then apt-get install -y nodejs; fi
    if [ -x "$(command -v yum)" ]; then yum install -y nodejs; fi
fi

# 2. Install Git & PM2
if ! command -v git &> /dev/null; then
    echo "🔧 Installing Git..."
    if [ -x "$(command -v apt-get)" ]; then apt-get update && apt-get install -y git; fi
    if [ -x "$(command -v yum)" ]; then yum install -y git; fi
fi

if ! command -v pm2 &> /dev/null; then
    echo "🚀 Installing PM2..."
    npm install -g pm2
fi

# 3. Clone/Update Repo
WORK_DIR="$HOME/azure-glass"
if [ -d "$WORK_DIR" ]; then
    echo "📂 Updating existing repo..."
    cd "$WORK_DIR"
    git pull
else
    echo "📂 Cloning repository..."
    git clone https://github.com/yuanzhangdck/azure-glass.git "$WORK_DIR"
    cd "$WORK_DIR"
fi

# 4. Install Dependencies
echo "📥 Installing NPM packages..."
npm install --production

# 5. Start with PM2
echo "🔥 Starting Server..."
pm2 delete azure-glass 2>/dev/null || true
PORT=3000 pm2 start server.js --name azure-glass

# 6. Auto Startup
pm2 startup | bash 2>/dev/null || true
pm2 save

# 7. Info
IP=$(curl -s ifconfig.me || echo "YOUR_IP")
echo ""
echo -e "${GREEN}✅ Deployed Successfully!${NC}"
echo -e "👉 URL: http://$IP:3000"
echo -e "🔑 Password: password"
