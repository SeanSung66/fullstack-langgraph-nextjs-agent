# Docker Compose 部署指南

本文档介绍如何使用 Docker Compose 一键部署 LangGraph.js AI Agent 应用。

## 前置条件

- Docker Engine 24.0+
- Docker Compose v2.20+
- 至少 4GB 可用内存
- 至少 10GB 可用磁盘空间

### 检查 Docker 版本

```bash
docker --version
docker compose version
```

## 快速部署

### 1. 克隆项目

```bash
git clone <repository-url>
cd fullstack-langgraph-nextjs-agent
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，配置必要的 API 密钥
# 至少需要配置一个 LLM API 密钥：
# - OPENAI_API_KEY
# - GOOGLE_API_KEY
# - DEEPSEEK_API_KEY
```

### 3. 一键部署

```bash
# 构建并启动所有服务
docker compose up -d --build

# 查看服务状态
docker compose ps
```

### 4. 访问应用

- 应用地址: http://localhost:3000
- 默认端口可通过 `APP_PORT` 环境变量修改

## 环境变量配置

### 必需配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI API 密钥 | - |
| `GOOGLE_API_KEY` | Google AI API 密钥 | - |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | - |

> 至少需要配置一个 LLM API 密钥

### 可选配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_PORT` | 应用对外端口 | 3000 |
| `POSTGRES_USER` | 数据库用户名 | user |
| `POSTGRES_PASSWORD` | 数据库密码 | password |
| `POSTGRES_DB` | 数据库名称 | mydb |
| `MINIO_ROOT_USER` | MinIO 用户名 | minioadmin |
| `MINIO_ROOT_PASSWORD` | MinIO 密码 | minioadmin |
| `S3_BUCKET_NAME` | S3 存储桶名称 | uploads |

## 服务架构

```
┌─────────────────────────────────────────────────────┐
│                   Docker Host                        │
│  ┌─────────────────────────────────────────────┐    │
│  │              app-network                     │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │    │
│  │  │   app   │  │   db    │  │    minio    │  │    │
│  │  │  :3000  │  │  :5432  │  │ :9000/:9001 │  │    │
│  │  └────┬────┘  └─────────┘  └─────────────┘  │    │
│  └───────┼─────────────────────────────────────┘    │
│          │                                           │
└──────────┼───────────────────────────────────────────┘
           │
    http://localhost:3000
```

| 服务 | 说明 | 内部端口 |
|------|------|----------|
| app | Next.js 应用 (前端 + API) | 3000 |
| db | PostgreSQL 数据库 | 5432 |
| minio | MinIO 对象存储 | 9000/9001 |
| createbuckets | 初始化存储桶 (一次性任务) | - |


## 常用命令

### 服务管理

```bash
# 启动所有服务
docker compose up -d

# 停止所有服务
docker compose down

# 重启服务
docker compose restart

# 重新构建并启动
docker compose up -d --build

# 查看服务状态
docker compose ps

# 查看所有日志
docker compose logs

# 查看特定服务日志
docker compose logs app
docker compose logs -f app  # 实时跟踪
```

### 数据管理

```bash
# 停止服务但保留数据
docker compose down

# 停止服务并删除数据卷（⚠️ 会丢失所有数据）
docker compose down -v

# 备份数据库
docker compose exec db pg_dump -U user mydb > backup.sql

# 恢复数据库
cat backup.sql | docker compose exec -T db psql -U user mydb
```

## 健康检查

### 检查服务状态

```bash
# 查看所有服务状态
docker compose ps

# 预期输出：所有服务状态为 "healthy" 或 "running"
NAME          STATUS                   PORTS
app           Up (healthy)             0.0.0.0:3000->3000/tcp
db            Up (healthy)             5432/tcp
minio         Up (healthy)             9000/tcp, 9001/tcp
```

### 检查应用响应

```bash
# 检查应用是否正常响应
curl -I http://localhost:3000

# 预期输出：HTTP/1.1 200 OK
```

### 检查数据库连接

```bash
# 进入数据库容器
docker compose exec db psql -U user -d mydb -c "SELECT 1"

# 预期输出：1
```

## 常见问题排查

### 1. 应用启动失败

**症状**: `docker compose ps` 显示 app 服务状态为 "Restarting" 或 "Exit"

**排查步骤**:
```bash
# 查看应用日志
docker compose logs app

# 常见原因：
# - 数据库连接失败：检查 db 服务是否健康
# - API 密钥未配置：检查 .env 文件
# - 端口被占用：修改 APP_PORT 环境变量
```

### 2. 数据库连接失败

**症状**: 日志显示 "Connection refused" 或 "ECONNREFUSED"

**解决方案**:
```bash
# 检查数据库服务状态
docker compose ps db

# 重启数据库服务
docker compose restart db

# 等待数据库就绪后重启应用
docker compose restart app
```

### 3. 文件上传失败

**症状**: 上传文件时报错

**排查步骤**:
```bash
# 检查 MinIO 服务状态
docker compose ps minio

# 检查存储桶是否创建成功
docker compose logs createbuckets

# 手动创建存储桶
docker compose exec minio mc mb /data/uploads --ignore-existing
```

### 4. 端口冲突

**症状**: "port is already allocated" 错误

**解决方案**:
```bash
# 修改 .env 文件中的端口配置
APP_PORT=3001  # 改为其他未使用的端口

# 重新启动
docker compose up -d
```

### 5. 内存不足

**症状**: 构建或运行时出现 OOM (Out of Memory) 错误

**解决方案**:
- 增加 Docker 可用内存（Docker Desktop 设置中调整）
- 关闭其他占用内存的应用
- 使用 `docker system prune` 清理未使用的资源

## 生产环境建议

### 安全配置

1. **修改默认密码**:
   ```bash
   POSTGRES_PASSWORD=<strong-password>
   MINIO_ROOT_USER=<custom-user>
   MINIO_ROOT_PASSWORD=<strong-password>
   ```

2. **使用 HTTPS**: 在应用前部署反向代理（如 Nginx、Traefik）

3. **限制网络访问**: 使用防火墙限制端口访问

### 性能优化

1. **资源限制**: 在 compose.yaml 中添加资源限制
   ```yaml
   services:
     app:
       deploy:
         resources:
           limits:
             cpus: '2'
             memory: 2G
   ```

2. **日志管理**: 配置日志轮转
   ```yaml
   services:
     app:
       logging:
         driver: "json-file"
         options:
           max-size: "10m"
           max-file: "3"
   ```

### 备份策略

建议定期备份数据库和文件存储：

```bash
# 创建备份脚本
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker compose exec -T db pg_dump -U user mydb > backup_${DATE}.sql
```

## 更新部署

```bash
# 拉取最新代码
git pull

# 重新构建并部署
docker compose up -d --build

# 查看更新后的状态
docker compose ps
```
