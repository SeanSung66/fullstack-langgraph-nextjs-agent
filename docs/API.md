# API 参考文档

## 概述

本文档描述了 LangGraph.js AI Agent 后端服务提供的所有 API 端点。这些 API 支持 AI 对话、线程管理、文件上传和 MCP 服务器配置等功能。

### 基础 URL

```
http://localhost:3000/api
```

生产环境中，请将 `localhost:3000` 替换为实际的服务器地址。

### 认证

当前版本的 API 不需要认证。所有端点都是公开可访问的。

> **注意**: 在生产环境中部署时，建议添加适当的认证机制。

### 通用响应格式

#### 成功响应

成功的 API 调用将返回 HTTP 状态码 `200`（成功）或 `201`（已创建），响应体为 JSON 格式。

#### 错误响应

错误响应遵循统一格式：

```typescript
interface ErrorResponse {
  error: string;      // 错误描述信息
  field?: string;     // 出错的字段名（可选）
}
```

示例：

```json
{
  "error": "Thread id required",
  "field": "id"
}
```

### HTTP 状态码

| 状态码 | 含义 | 说明 |
|--------|------|------|
| 200 | OK | 请求成功 |
| 201 | Created | 资源创建成功 |
| 400 | Bad Request | 请求参数无效 |
| 404 | Not Found | 资源不存在 |
| 409 | Conflict | 资源冲突（如名称重复） |
| 500 | Internal Server Error | 服务器内部错误 |

---

## 数据类型定义


### Thread（对话线程）

```typescript
interface Thread {
  id: string;           // UUID，线程唯一标识符
  title: string;        // 线程标题
  createdAt: string;    // ISO 8601 格式的创建时间
  updatedAt: string;    // ISO 8601 格式的更新时间
}
```

示例：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "New thread",
  "createdAt": "2025-01-12T10:30:00.000Z",
  "updatedAt": "2025-01-12T10:30:00.000Z"
}
```

### FileAttachment（文件附件）

```typescript
interface FileAttachment {
  url: string;      // 文件访问 URL
  key: string;      // S3/MinIO 存储键
  name: string;     // 原始文件名
  type: string;     // MIME 类型
  size: number;     // 文件大小（字节）
}
```

示例：

```json
{
  "url": "http://localhost:9000/uploads/abc123.png",
  "key": "abc123.png",
  "name": "screenshot.png",
  "type": "image/png",
  "size": 102400
}
```

### MessageResponse（消息响应）

```typescript
interface MessageResponse {
  type: "human" | "ai" | "tool" | "error";
  data: BasicMessageData | AIMessageData | ToolMessageData;
}
```

#### BasicMessageData（基础消息数据）

用于 `human` 类型消息：

```typescript
interface BasicMessageData {
  id: string;                       // 消息唯一标识符
  content: string;                  // 消息文本内容
  attachments?: FileAttachment[];   // 文件附件列表（可选）
}
```

#### AIMessageData（AI 消息数据）

用于 `ai` 类型消息：

```typescript
interface AIMessageData {
  id: string;
  content: string | ContentItem[];              // 文本内容或内容项数组
  tool_calls?: ToolCall[];                      // 工具调用列表（可选）
  tool_call_chunks?: ToolCallChunk[];           // 工具调用分块（流式）
  additional_kwargs?: Record<string, unknown>;  // 额外参数
  response_metadata?: Record<string, unknown>;  // 响应元数据
}

interface ContentItem {
  text?: string;
  functionCall?: FunctionCall;
  thoughtSignature?: string;
}

interface ToolCall {
  name: string;                     // 工具名称
  args: Record<string, unknown>;    // 工具参数
  id: string;                       // 工具调用 ID
  type: "tool_call";
}

interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}
```

#### ToolMessageData（工具消息数据）

用于 `tool` 类型消息：

```typescript
interface ToolMessageData {
  id: string;
  content: string;                  // 工具执行结果
  status: string;                   // 执行状态
  artifact?: unknown[];             // 工具产物（可选）
  tool_call_id: string;             // 对应的工具调用 ID
  name: string;                     // 工具名称
  metadata?: Record<string, unknown>;
}
```

### MCPServer（MCP 服务器）

```typescript
interface MCPServer {
  id: string;                           // UUID，服务器唯一标识符
  name: string;                         // 服务器名称（唯一）
  type: "stdio" | "http";               // 服务器类型
  enabled: boolean;                     // 是否启用
  // stdio 类型配置
  command?: string;                     // 执行命令
  args?: string[];                      // 命令参数
  env?: Record<string, string>;         // 环境变量
  // http 类型配置
  url?: string;                         // HTTP 端点 URL
  headers?: Record<string, string>;     // HTTP 请求头
  createdAt: string;                    // ISO 8601 格式的创建时间
  updatedAt: string;                    // ISO 8601 格式的更新时间
}
```

stdio 类型示例：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "filesystem",
  "type": "stdio",
  "enabled": true,
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  "env": {},
  "createdAt": "2025-01-12T10:30:00.000Z",
  "updatedAt": "2025-01-12T10:30:00.000Z"
}
```

http 类型示例：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "name": "remote-tools",
  "type": "http",
  "enabled": true,
  "url": "https://api.example.com/mcp",
  "headers": { "Authorization": "Bearer token123" },
  "createdAt": "2025-01-12T10:30:00.000Z",
  "updatedAt": "2025-01-12T10:30:00.000Z"
}
```

### MCPToolsData（MCP 工具数据）

```typescript
interface MCPToolsData {
  serverGroups: MCPToolsGrouped;    // 按服务器分组的工具
  totalCount: number;               // 工具总数
}

interface MCPToolsGrouped {
  [serverName: string]: MCPServerTools;
}

interface MCPServerTools {
  tools: MCPTool[];                 // 工具列表
  count: number;                    // 该服务器的工具数量
}

interface MCPTool {
  name: string;                     // 工具名称
  description?: string;             // 工具描述（可选）
}
```

示例：

```json
{
  "serverGroups": {
    "filesystem": {
      "tools": [
        { "name": "read_file", "description": "Read contents of a file" },
        { "name": "write_file", "description": "Write contents to a file" }
      ],
      "count": 2
    }
  },
  "totalCount": 2
}
```

---

## API 端点


### 线程管理

#### 获取线程列表

获取所有对话线程，按更新时间倒序排列。

```
GET /api/agent/threads
```

**响应**

- 状态码: `200 OK`
- 响应体: `Thread[]`

**示例**

请求：

```bash
curl http://localhost:3000/api/agent/threads
```

响应：

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "讨论项目架构",
    "createdAt": "2025-01-12T10:30:00.000Z",
    "updatedAt": "2025-01-12T11:45:00.000Z"
  },
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "title": "New thread",
    "createdAt": "2025-01-12T09:00:00.000Z",
    "updatedAt": "2025-01-12T09:00:00.000Z"
  }
]
```

---

#### 创建新线程

创建一个新的对话线程。

```
POST /api/agent/threads
```

**请求体**

无需请求体。

**响应**

- 状态码: `201 Created`
- 响应体: `Thread`

**示例**

请求：

```bash
curl -X POST http://localhost:3000/api/agent/threads
```

响应：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "title": "New thread",
  "createdAt": "2025-01-12T12:00:00.000Z",
  "updatedAt": "2025-01-12T12:00:00.000Z"
}
```

---

#### 更新线程标题

更新指定线程的标题。

```
PATCH /api/agent/threads
```

**请求体**

```typescript
{
  id: string;       // 线程 ID（必需）
  title: string;    // 新标题（必需）
}
```

**响应**

- 状态码: `200 OK`
- 响应体: `Thread`

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | "id and title required" | 缺少必需参数 |
| 500 | "Update failed" | 更新失败 |

**示例**

请求：

```bash
curl -X PATCH http://localhost:3000/api/agent/threads \
  -H "Content-Type: application/json" \
  -d '{"id": "550e8400-e29b-41d4-a716-446655440000", "title": "新标题"}'
```

响应：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "新标题",
  "createdAt": "2025-01-12T10:30:00.000Z",
  "updatedAt": "2025-01-12T12:30:00.000Z"
}
```

---

#### 删除线程

删除指定的对话线程。

```
DELETE /api/agent/threads
```

**请求体**

```typescript
{
  id: string;    // 线程 ID（必需）
}
```

**响应**

- 状态码: `200 OK`
- 响应体: `{ success: true }`

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | "Thread id required" | 缺少线程 ID |
| 404 | "Thread not found" | 线程不存在 |
| 500 | "Delete failed" | 删除失败 |

**示例**

请求：

```bash
curl -X DELETE http://localhost:3000/api/agent/threads \
  -H "Content-Type: application/json" \
  -d '{"id": "550e8400-e29b-41d4-a716-446655440000"}'
```

响应：

```json
{
  "success": true
}
```

---


### 消息历史

#### 获取线程消息历史

获取指定线程的所有历史消息。

```
GET /api/agent/history/{threadId}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| threadId | string | 线程 ID |

**响应**

- 状态码: `200 OK`
- 响应体: `MessageResponse[]`

**说明**

返回的消息数组包含该线程中的所有消息，包括：
- `human` - 用户发送的消息
- `ai` - AI 助手的回复
- `tool` - 工具执行结果

**示例**

请求：

```bash
curl http://localhost:3000/api/agent/history/550e8400-e29b-41d4-a716-446655440000
```

响应：

```json
[
  {
    "type": "human",
    "data": {
      "id": "msg-001",
      "content": "你好，请帮我分析这个文件"
    }
  },
  {
    "type": "ai",
    "data": {
      "id": "msg-002",
      "content": "好的，我来帮你分析这个文件。让我先读取文件内容...",
      "tool_calls": [
        {
          "name": "read_file",
          "args": { "path": "/tmp/example.txt" },
          "id": "call-001",
          "type": "tool_call"
        }
      ]
    }
  },
  {
    "type": "tool",
    "data": {
      "id": "msg-003",
      "content": "文件内容: Hello World",
      "status": "success",
      "tool_call_id": "call-001",
      "name": "read_file"
    }
  },
  {
    "type": "ai",
    "data": {
      "id": "msg-004",
      "content": "文件内容是 \"Hello World\"。这是一个简单的文本文件。"
    }
  }
]
```

---


### AI 流式响应

#### 发送消息并获取流式响应

向 AI 发送消息并通过 Server-Sent Events (SSE) 接收流式响应。

```
GET /api/agent/stream
```

**查询参数**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| content | string | 是 | 用户消息内容 |
| threadId | string | 是 | 线程 ID |
| model | string | 否 | 模型名称（如 "gpt-4o", "gemini-1.5-pro"） |
| provider | string | 否 | 模型提供商（"openai", "google", "deepseek"） |
| tools | string | 否 | 启用的工具列表，逗号分隔 |
| allowTool | string | 否 | 工具审批操作："allow" 或 "deny" |
| approveAllTools | string | 否 | 是否自动批准所有工具："true" 或 "false" |
| attachments | string | 否 | 文件附件 JSON 数组（URL 编码） |

**响应**

- Content-Type: `text/event-stream; charset=utf-8`
- 响应为 SSE 流

**SSE 事件格式**

1. **连接建立**

```
: connected
```

2. **数据事件** - AI 响应或工具结果

```
data: {"type":"ai","data":{"id":"msg-001","content":"你好！"}}
```

3. **完成事件**

```
event: done
data: {}
```

4. **错误事件**

```
event: error
data: {"message":"Stream error","threadId":"xxx"}
```

**工具审批流程**

当 AI 需要调用工具时，会返回包含 `tool_calls` 的消息。前端需要：

1. 显示工具调用信息给用户
2. 用户选择批准或拒绝
3. 使用 `allowTool=allow` 或 `allowTool=deny` 参数重新调用此端点

**文件附件格式**

`attachments` 参数应为 URL 编码的 JSON 数组：

```typescript
FileAttachment[]
```

示例（编码前）：

```json
[{"url":"http://localhost:9000/uploads/abc.png","key":"abc.png","name":"image.png","type":"image/png","size":1024}]
```

**示例**

基本请求：

```bash
curl "http://localhost:3000/api/agent/stream?content=你好&threadId=550e8400-e29b-41d4-a716-446655440000"
```

指定模型：

```bash
curl "http://localhost:3000/api/agent/stream?content=你好&threadId=xxx&model=gpt-4o&provider=openai"
```

批准工具调用：

```bash
curl "http://localhost:3000/api/agent/stream?content=&threadId=xxx&allowTool=allow"
```

**JavaScript 客户端示例**

```javascript
const params = new URLSearchParams({
  content: "你好",
  threadId: "550e8400-e29b-41d4-a716-446655440000",
  model: "gpt-4o",
  provider: "openai"
});

const eventSource = new EventSource(`/api/agent/stream?${params}`);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "ai") {
    console.log("AI:", data.data.content);
  } else if (data.type === "tool") {
    console.log("Tool result:", data.data.content);
  }
};

eventSource.addEventListener("done", () => {
  console.log("Stream completed");
  eventSource.close();
});

eventSource.addEventListener("error", (event) => {
  console.error("Stream error:", event);
  eventSource.close();
});
```

---


### 文件上传

#### 上传文件

上传文件到 S3/MinIO 存储，用于 AI 对话中的多模态输入。

```
POST /api/agent/upload
```

**请求**

- Content-Type: `multipart/form-data`
- 表单字段: `file` - 要上传的文件

**支持的文件类型**

| MIME 类型 | 扩展名 | 最大大小 |
|-----------|--------|----------|
| image/png | .png | 5 MB |
| image/jpeg | .jpg, .jpeg | 5 MB |
| application/pdf | .pdf | 10 MB |
| text/markdown | .md | 2 MB |
| text/plain | .txt | 2 MB |
| application/octet-stream | .md, .markdown, .txt | 2 MB |

**限制**

- 每条消息最多 3 个附件
- 文件大小不能超过对应类型的限制

**响应**

- 状态码: `200 OK`
- 响应体:

```typescript
{
  success: boolean;
  url: string;        // 文件访问 URL
  key: string;        // S3 存储键
  name: string;       // 原始文件名
  type: string;       // MIME 类型
  size: number;       // 文件大小（字节）
}
```

**错误响应**

| 状态码 | 错误信息 | field | 说明 |
|--------|----------|-------|------|
| 400 | "No file provided" | file | 未提供文件 |
| 400 | "File type xxx is not allowed..." | type | 文件类型不支持 |
| 400 | "File size exceeds maximum..." | size | 文件过大 |
| 400 | "File appears to be binary, not text" | content | 文本文件包含二进制内容 |
| 500 | "Upload failed" | server | 服务器错误 |

**示例**

请求：

```bash
curl -X POST http://localhost:3000/api/agent/upload \
  -F "file=@/path/to/image.png"
```

响应：

```json
{
  "success": true,
  "url": "http://localhost:9000/uploads/abc123-def456.png",
  "key": "abc123-def456.png",
  "name": "image.png",
  "type": "image/png",
  "size": 102400
}
```

**JavaScript 客户端示例**

```javascript
async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/agent/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  return await response.json();
}

// 使用示例
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];
const attachment = await uploadFile(file);
console.log("Uploaded:", attachment.url);
```

---


### MCP 服务器管理

#### 获取 MCP 服务器列表

获取所有已配置的 MCP 服务器。

```
GET /api/mcp-servers
```

**响应**

- 状态码: `200 OK`
- 响应体: `MCPServer[]`

**示例**

请求：

```bash
curl http://localhost:3000/api/mcp-servers
```

响应：

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "filesystem",
    "type": "stdio",
    "enabled": true,
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    "env": {},
    "url": null,
    "headers": null,
    "createdAt": "2025-01-12T10:30:00.000Z",
    "updatedAt": "2025-01-12T10:30:00.000Z"
  }
]
```

---

#### 创建 MCP 服务器

添加新的 MCP 服务器配置。

```
POST /api/mcp-servers
```

**请求体**

对于 stdio 类型：

```typescript
{
  name: string;                     // 服务器名称（必需，唯一）
  type: "stdio";                    // 服务器类型（必需）
  command: string;                  // 执行命令（必需）
  args?: string[];                  // 命令参数
  env?: Record<string, string>;     // 环境变量
}
```

对于 http 类型：

```typescript
{
  name: string;                     // 服务器名称（必需，唯一）
  type: "http";                     // 服务器类型（必需）
  url: string;                      // HTTP 端点 URL（必需）
  headers?: Record<string, string>; // HTTP 请求头
}
```

**响应**

- 状态码: `201 Created`
- 响应体: `MCPServer`

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | "Name and type are required" | 缺少必需参数 |
| 400 | "Command is required for stdio servers" | stdio 类型缺少 command |
| 400 | "URL is required for http servers" | http 类型缺少 url |
| 409 | "Server name already exists" | 名称重复 |
| 500 | "Failed to create MCP server" | 创建失败 |

**示例**

创建 stdio 服务器：

```bash
curl -X POST http://localhost:3000/api/mcp-servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "filesystem",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
  }'
```

创建 http 服务器：

```bash
curl -X POST http://localhost:3000/api/mcp-servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "remote-api",
    "type": "http",
    "url": "https://api.example.com/mcp",
    "headers": {"Authorization": "Bearer token123"}
  }'
```

---

#### 更新 MCP 服务器

更新已有的 MCP 服务器配置。

```
PATCH /api/mcp-servers
```

**请求体**

```typescript
{
  id: string;                       // 服务器 ID（必需）
  name?: string;                    // 新名称
  type?: "stdio" | "http";          // 新类型
  enabled?: boolean;                // 是否启用
  // stdio 类型字段
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http 类型字段
  url?: string;
  headers?: Record<string, string>;
}
```

**响应**

- 状态码: `200 OK`
- 响应体: `MCPServer`

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | "ID is required" | 缺少服务器 ID |
| 404 | "Server not found" | 服务器不存在 |
| 500 | "Failed to update MCP server" | 更新失败 |

**示例**

禁用服务器：

```bash
curl -X PATCH http://localhost:3000/api/mcp-servers \
  -H "Content-Type: application/json" \
  -d '{"id": "550e8400-e29b-41d4-a716-446655440001", "enabled": false}'
```

---

#### 删除 MCP 服务器

删除指定的 MCP 服务器配置。

```
DELETE /api/mcp-servers?id={serverId}
```

**查询参数**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | string | 是 | 服务器 ID |

**响应**

- 状态码: `200 OK`
- 响应体: `{ success: true }`

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | "ID is required" | 缺少服务器 ID |
| 404 | "Server not found" | 服务器不存在 |
| 500 | "Failed to delete MCP server" | 删除失败 |

**示例**

```bash
curl -X DELETE "http://localhost:3000/api/mcp-servers?id=550e8400-e29b-41d4-a716-446655440001"
```

响应：

```json
{
  "success": true
}
```

---


### MCP 工具

#### 获取可用工具列表

获取所有已启用 MCP 服务器提供的工具列表。

```
GET /api/mcp-tools
```

**响应**

- 状态码: `200 OK`
- 响应体: `MCPToolsData`

**说明**

工具按其所属的 MCP 服务器分组。工具名称格式为 `servername__toolname`，在响应中会被解析为干净的工具名。

**示例**

请求：

```bash
curl http://localhost:3000/api/mcp-tools
```

响应：

```json
{
  "serverGroups": {
    "filesystem": {
      "tools": [
        {
          "name": "read_file",
          "description": "Read the complete contents of a file from the file system"
        },
        {
          "name": "write_file",
          "description": "Write content to a file, creating it if it doesn't exist"
        },
        {
          "name": "list_directory",
          "description": "List the contents of a directory"
        }
      ],
      "count": 3
    },
    "web-search": {
      "tools": [
        {
          "name": "search",
          "description": "Search the web for information"
        }
      ],
      "count": 1
    }
  },
  "totalCount": 4
}
```

**无工具时的响应**

```json
{
  "serverGroups": {},
  "totalCount": 0
}
```

**错误响应**

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 500 | "Failed to fetch MCP tools" | 获取工具失败 |

---


## 错误处理

### 通用错误格式

所有 API 端点在发生错误时返回统一的错误格式：

```typescript
interface ErrorResponse {
  error: string;      // 错误描述
  field?: string;     // 出错的字段（可选）
}
```

### HTTP 状态码汇总

| 状态码 | 含义 | 典型场景 |
|--------|------|----------|
| 200 | OK | GET、PATCH 请求成功 |
| 201 | Created | POST 创建资源成功 |
| 400 | Bad Request | 请求参数无效、缺少必需字段、文件类型不支持 |
| 404 | Not Found | 线程或服务器不存在 |
| 409 | Conflict | MCP 服务器名称重复 |
| 500 | Internal Server Error | 数据库错误、存储错误、流处理错误 |

### 常见错误示例

**参数验证错误 (400)**

```json
{
  "error": "id and title required"
}
```

**资源不存在 (404)**

```json
{
  "error": "Thread not found"
}
```

**名称冲突 (409)**

```json
{
  "error": "Server name already exists"
}
```

**文件上传错误 (400)**

```json
{
  "error": "File type application/zip is not allowed. Allowed types: image/png, image/jpeg, application/pdf, text/markdown, text/plain",
  "field": "type"
}
```

---

## 环境变量配置

### 必需配置

```bash
# 数据库连接
DATABASE_URL="postgresql://user:password@localhost:5434/langgraph_agent"

# S3/MinIO 存储
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin"
S3_BUCKET="uploads"
S3_REGION="us-east-1"

# AI 模型 API 密钥（至少配置一个）
OPENAI_API_KEY="sk-..."
GOOGLE_API_KEY="..."
DEEPSEEK_API_KEY="..."
```

### 可选配置

```bash
# CORS 跨域配置（用于外部 UI 访问）
# 多个源用逗号分隔，使用 "*" 允许所有源（仅开发环境）
CORS_ALLOWED_ORIGINS="http://localhost:3001,https://my-ui.example.com"

# 默认 AI 模型配置
DEFAULT_MODEL="gpt-4o"
DEFAULT_PROVIDER="openai"
```

### API 基础路径

默认 API 基础路径为 `/api`。所有端点都位于此路径下：

- `/api/agent/threads` - 线程管理
- `/api/agent/history/{threadId}` - 消息历史
- `/api/agent/stream` - AI 流式响应
- `/api/agent/upload` - 文件上传
- `/api/mcp-servers` - MCP 服务器管理
- `/api/mcp-tools` - MCP 工具列表

如需自定义基础路径，可通过 Next.js 的 `basePath` 配置或反向代理实现。

---

## 跨域访问 (CORS)

当从不同源的前端应用访问此 API 时，需要配置 CORS。

### 配置方法

在 `.env` 文件中设置允许的源：

```bash
# 允许特定源
CORS_ALLOWED_ORIGINS="http://localhost:3001,https://my-app.example.com"

# 允许所有源（仅开发环境）
CORS_ALLOWED_ORIGINS="*"
```

### CORS 响应头

配置后，API 响应将包含以下头：

```
Access-Control-Allow-Origin: <请求源>
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
```

### SSE 流式响应

SSE 端点 (`/api/agent/stream`) 同样支持 CORS，允许跨域建立 EventSource 连接。

---

## 快速开始

### 1. 创建线程

```bash
curl -X POST http://localhost:3000/api/agent/threads
```

### 2. 发送消息

```bash
curl "http://localhost:3000/api/agent/stream?content=你好&threadId=<线程ID>"
```

### 3. 获取历史

```bash
curl http://localhost:3000/api/agent/history/<线程ID>
```

### 4. 上传文件

```bash
curl -X POST http://localhost:3000/api/agent/upload -F "file=@image.png"
```

### 5. 带附件发送消息

```bash
# 先上传文件获取 attachment 信息，然后：
curl "http://localhost:3000/api/agent/stream?content=分析这张图片&threadId=<线程ID>&attachments=<URL编码的附件JSON>"
```
