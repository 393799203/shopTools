#!/bin/bash

set -e

SERVER_IP="8.217.249.31"
SERVER_USER="root"
SERVER_DIR="/opt/picfilter"

echo "🚀 开始部署 ShopTools 后端服务到 ${SERVER_IP}..."

ssh -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_IP} "mkdir -p ${SERVER_DIR}"

echo "📁 上传文件到服务器..."
rsync -avz --exclude='node_modules' --exclude='.git' --exclude='release' --exclude='dist' --exclude='dist-electron' --exclude='.thumbnails' --exclude='*.log' -e ssh ./ ${SERVER_USER}@${SERVER_IP}:${SERVER_DIR}/

echo "🐳 在服务器上启动 Docker 容器..."
ssh ${SERVER_USER}@${SERVER_IP} "cd ${SERVER_DIR} && bash -s" << 'REMOTE_SCRIPT'
    # 检查 Docker 是否安装
    if ! command -v docker &> /dev/null; then
        echo "📦 安装 Docker..."
        curl -fsSL https://get.docker.com | sh
        systemctl start docker
        systemctl enable docker
    fi

    # 停止旧容器（如果存在）
    docker compose down 2>/dev/null || true

    # 构建并启动新容器
    docker compose up -d --build

    # 等待服务启动
    sleep 10

    # 检查容器状态
    docker compose ps

    # 检查 API 健康状态
    echo "🏥 检查 API 健康状态..."
    curl -s http://localhost:3001/health || echo "API 尚未就绪"
REMOTE_SCRIPT

echo "✅ 部署完成!"
echo "📡 API 服务地址: http://${SERVER_IP}:3001"
