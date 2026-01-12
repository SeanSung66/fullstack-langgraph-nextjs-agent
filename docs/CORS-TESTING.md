# 外部 API 访问测试指南

本文档介绍如何测试 CORS 跨域配置是否正确工作。

## 前置条件

### 1. 配置允许的源

在 `.env` 文件中配置 `CORS_ALLOWED_ORIGINS`：

```bash
# 开发环境 - 允许所有源
CORS_ALLOWED_ORIGINS=*

# 或指定特定源（多个用逗号分隔）
CORS_ALLOWED_ORIGINS=http://localhost:3001,http://localhost:5173
```

### 2. 启动项目

```bash
pnpm dev
```

## 测试方法

### 方法 1: 使用 curl 测试

#### 测试 CORS 响应头

```bash
# 模拟来自 localhost:3001 的请求
curl -i -H "Origin: http://localhost:3001" http://localhost:3000/api/agent/threads
```

预期响应头包含：

```
Access-Control-Allow-Origin: http://localhost:3001
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
```

#### 测试 OPTIONS 预检请求

```bash
curl -i -X OPTIONS \
  -H "Origin: http://localhost:3001" \
  -H "Access-Control-Request-Method: POST" \
  http://localhost:3000/api/agent/threads
```

预期返回 `204 No Content` 状态码和 CORS 头。

#### 测试创建线程

```bash
curl -X POST \
  -H "Origin: http://localhost:3001" \
  http://localhost:3000/api/agent/threads
```

### 方法 2: 浏览器控制台测试

在另一个端口（如 `http://localhost:3001`）的页面控制台执行：

```javascript
// 测试获取线程列表
fetch('http://localhost:3000/api/agent/threads', {
  credentials: 'include'
})
.then(res => res.json())
.then(data => console.log('线程列表:', data))
.catch(err => console.error('CORS 错误:', err));

// 测试创建新线程
fetch('http://localhost:3000/api/agent/threads', {
  method: 'POST',
  credentials: 'include'
})
.then(res => res.json())
.then(data => console.log('新线程:', data));

// 测试获取 MCP 工具列表
fetch('http://localhost:3000/api/mcp-tools')
.then(res => res.json())
.then(data => console.log('MCP 工具:', data));
```

### 方法 3: 创建测试页面

创建 `test-cors.html` 文件：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CORS 测试</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
    button { padding: 10px 20px; margin: 5px; cursor: pointer; }
    pre { background: #f5f5f5; padding: 15px; overflow-x: auto; border-radius: 4px; }
    .success { color: green; }
    .error { color: red; }
  </style>
</head>
<body>
  <h1>外部 API 访问测试</h1>
  <p>当前页面源: <code id="origin"></code></p>
  <p>目标 API: <code>http://localhost:3000</code></p>
  
  <h2>测试操作</h2>
  <button onclick="testGetThreads()">获取线程列表</button>
  <button onclick="testCreateThread()">创建新线程</button>
  <button onclick="testGetMCPTools()">获取 MCP 工具</button>
  <button onclick="testGetMCPServers()">获取 MCP 服务器</button>
  
  <h2>测试结果</h2>
  <pre id="result">点击上方按钮开始测试...</pre>

  <script>
    const API_BASE = 'http://localhost:3000';
    document.getElementById('origin').textContent = window.location.origin;

    function showResult(title, data, isError = false) {
      const el = document.getElementById('result');
      const className = isError ? 'error' : 'success';
      el.innerHTML = `<span class="${className}">${title}</span>\n\n${JSON.stringify(data, null, 2)}`;
    }

    async function testGetThreads() {
      try {
        const res = await fetch(`${API_BASE}/api/agent/threads`);
        const data = await res.json();
        showResult('✅ 获取线程列表成功', data);
      } catch (e) {
        showResult('❌ CORS 错误', { message: e.message }, true);
      }
    }

    async function testCreateThread() {
      try {
        const res = await fetch(`${API_BASE}/api/agent/threads`, { method: 'POST' });
        const data = await res.json();
        showResult('✅ 创建线程成功', data);
      } catch (e) {
        showResult('❌ CORS 错误', { message: e.message }, true);
      }
    }

    async function testGetMCPTools() {
      try {
        const res = await fetch(`${API_BASE}/api/mcp-tools`);
        const data = await res.json();
        showResult('✅ 获取 MCP 工具成功', data);
      } catch (e) {
        showResult('❌ CORS 错误', { message: e.message }, true);
      }
    }

    async function testGetMCPServers() {
      try {
        const res = await fetch(`${API_BASE}/api/mcp-servers`);
        const data = await res.json();
        showResult('✅ 获取 MCP 服务器成功', data);
      } catch (e) {
        showResult('❌ CORS 错误', { message: e.message }, true);
      }
    }
  </script>
</body>
</html>
```

使用另一个端口启动测试页面：

```bash
# 方式 1: 使用 npx serve
npx serve -p 3001 .

# 方式 2: 使用 Python
python -m http.server 3001
```

然后访问 `http://localhost:3001/test-cors.html` 进行测试。

## 常见问题

### CORS 错误排查

| 错误信息 | 可能原因 | 解决方案 |
|---------|---------|---------|
| `No 'Access-Control-Allow-Origin' header` | Origin 不在允许列表中 | 检查 `CORS_ALLOWED_ORIGINS` 配置 |
| `Credentials flag is true, but...` | 使用了 `*` 但请求带凭证 | 指定具体的 Origin 或移除 `credentials: 'include'` |
| `Method not allowed` | 请求方法不在允许列表中 | 检查中间件的 `allowedMethods` |

### 配置说明

| 配置值 | 效果 |
|-------|------|
| `CORS_ALLOWED_ORIGINS=*` | 允许所有源（仅开发环境） |
| `CORS_ALLOWED_ORIGINS=http://localhost:3001` | 只允许指定源 |
| `CORS_ALLOWED_ORIGINS=` 或未设置 | 拒绝所有跨域请求 |

## 生产环境建议

```bash
# 生产环境应明确指定允许的源
CORS_ALLOWED_ORIGINS=https://my-app.example.com,https://admin.example.com
```

**不要在生产环境使用 `*` 通配符**，这会带来安全风险。
