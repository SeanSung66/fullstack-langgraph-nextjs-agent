# 🏗️ 架构文档

本文档全面介绍 LangGraph.js AI Agent 模板的架构设计，帮助开发者理解系统设计模式并扩展功能。

## 📋 目录

1. [系统概述](#系统概述)
2. [核心组件](#核心组件)
3. [后端服务](#后端服务)
4. [数据流](#数据流)
5. [数据库设计](#数据库设计)
6. [Agent 工作流](#agent-工作流)
7. [MCP 集成](#mcp-集成)
8. [工具审批流程](#工具审批流程)
9. [文件上传与存储](#文件上传与存储)
10. [流式架构](#流式架构)
11. [错误处理](#错误处理)
12. [性能优化](#性能优化)

## 🌐 系统概述

### 高层架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        浏览器 (客户端)                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   聊天 UI       │  │   设置 UI       │  │   线程列表      │ │
│  │   组件          │  │   (MCP 配置)    │  │   侧边栏        │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   React Query   │  │   Context API   │  │   自定义 Hooks  │ │
│  │   (状态管理)    │  │   (UI 状态)     │  │   (数据逻辑)    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                            HTTP/SSE
                                │
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js 服务器                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   API 路由      │  │   Agent 服务    │  │   聊天服务      │ │
│  │   (REST/SSE)    │  │   (流式处理)    │  │   (工具函数)    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  Agent 构建器   │  │   MCP 客户端    │  │   内存管理      │ │
│  │  (LangGraph)    │  │   (工具)        │  │   (历史记录)    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                          数据库/网络
                                │
┌─────────────────────────────────────────────────────────────────────────────┐
│                          外部系统                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ PostgreSQL  │  │OpenAI/Google│  │ MCP 服务器  │  │ MinIO/S3 (存储)     │ │
│  │(持久化)     │  │ (LLM APIs)  │  │  (工具)     │  │ (文件上传)          │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 技术栈

#### 前端

- **Next.js 15**: App Router 与服务端组件
- **React 19**: 最新特性，包括 Suspense 和并发渲染
- **TypeScript**: 严格模式，确保类型安全
- **Tailwind CSS**: 实用优先的样式方案
- **shadcn/ui**: 无障碍组件库
- **React Query (TanStack Query)**: 服务端状态管理

#### 后端

- **Node.js**: JavaScript 运行时
- **Prisma ORM**: 类型安全的数据库访问
- **PostgreSQL**: 主数据库
- **Server-Sent Events**: 实时流式传输
- **MinIO/S3**: 对象存储，用于文件上传

#### AI 与工具

- **LangGraph.js**: Agent 编排框架
- **LangChain**: LLM 抽象层和工具
- **OpenAI/Google**: 语言模型提供商
- **Model Context Protocol**: 动态工具集成

## 🧩 核心组件

### 1. Agent 构建器 (`src/lib/agent/builder.ts`)

AI Agent 系统的核心，负责创建和配置 LangGraph StateGraph。

```typescript
export class AgentBuilder {
  private toolNode: ToolNode;
  private readonly model: BaseChatModel;
  private tools: DynamicTool[];
  private systemPrompt: string;
  private approveAllTools: boolean;
  private checkpointer?: BaseCheckpointSaver;

  build() {
    const stateGraph = new StateGraph(MessagesAnnotation);
    stateGraph
      .addNode("agent", this.callModel.bind(this))
      .addNode("tools", this.toolNode)
      .addNode("tool_approval", this.approveToolCall.bind(this))
      .addEdge(START, "agent")
      .addConditionalEdges("agent", this.shouldApproveTool.bind(this))
      .addEdge("tools", "agent");

    return stateGraph.compile({ checkpointer: this.checkpointer });
  }
}
```

**核心职责：**

- 构建带有人机协作模式的 StateGraph
- 工具绑定和审批工作流
- 模型配置和提示词管理
- 集成 Checkpointer 实现持久化

### 2. MCP 集成 (`src/lib/agent/mcp.ts`)

管理从 Model Context Protocol 服务器动态加载工具。

```typescript
export async function createMCPClient(): Promise<MultiServerMCPClient | null> {
  const mcpServers = await getMCPServerConfigs(); // 从数据库获取

  if (Object.keys(mcpServers).length === 0) {
    return null;
  }

  const client = new MultiServerMCPClient({
    mcpServers: mcpServers,
    throwOnLoadError: false,
    prefixToolNameWithServerName: true, // 防止冲突
  });

  return client;
}
```

**核心特性：**

- 数据库驱动的 MCP 服务器配置
- 支持 stdio 和 HTTP 传输方式
- 工具名称前缀防止冲突
- 优雅处理服务器连接失败

### 3. 流式服务 (`src/services/agentService.ts`)

通过 Server-Sent Events 处理 Agent 响应的实时流式传输。

```typescript
export async function streamResponse(params: {
  threadId: string;
  userText: string;
  opts?: MessageOptions;
}) {
  // 确保线程存在
  await ensureThread(threadId, userText);

  // 处理工具审批 vs 普通输入
  const inputs = opts?.allowTool
    ? new Command({ resume: { action: opts.allowTool === "allow" ? "continue" : "update" } })
    : { messages: [new HumanMessage(userText)] };

  const agent = await ensureAgent({
    model: opts?.model,
    tools: opts?.tools,
    approveAllTools: opts?.approveAllTools,
  });

  // 使用 checkpointer 进行流式处理以实现持久化
  const iterable = await agent.stream(inputs, {
    streamMode: ["updates"],
    configurable: { thread_id: threadId },
  });

  // 处理并生成流式数据块
  async function* generator(): AsyncGenerator<MessageResponse, void, unknown> {
    for await (const chunk of iterable) {
      // 处理数据块并生成 MessageResponse
    }
  }

  return generator();
}
```

### 4. 聊天 Hook (`src/hooks/useChatThread.ts`)

提供聊天功能的 React Hook，支持乐观 UI 更新。

```typescript
export function useChatThread({ threadId }: UseChatThreadOptions) {
  const queryClient = useQueryClient();
  const streamRef = useRef<EventSource | null>(null);

  const sendMessage = useCallback(
    async (text: string, opts?: MessageOptions) => {
      // 乐观 UI：立即添加用户消息
      const userMessage: MessageResponse = {
        type: "human",
        data: { id: `temp-${Date.now()}`, content: text },
      };
      queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => [
        ...old,
        userMessage,
      ]);

      // 流式获取 Agent 响应
      await handleStreamResponse({ threadId, text, opts });
    },
    [threadId, queryClient, handleStreamResponse],
  );

  return {
    messages,
    sendMessage,
    approveToolExecution,
    // ... 其他方法
  };
}
```

## 🔌 后端服务

本项目采用 Next.js 全栈架构，后端完全基于 API Routes 实现，无需独立的后端服务进程。

### API 路由总览

| 路由 | 方法 | 功能描述 |
|------|------|----------|
| `/api/agent/stream` | GET | SSE 流式响应，核心聊天接口 |
| `/api/agent/threads` | GET/POST/PATCH/DELETE | 对话线程 CRUD 操作 |
| `/api/agent/history/[threadId]` | GET | 获取指定线程的历史消息 |
| `/api/agent/upload` | POST | 文件上传到 S3/MinIO |
| `/api/mcp-servers` | GET/POST/PATCH/DELETE | MCP 服务器配置管理 |
| `/api/mcp-tools` | GET | 获取所有可用的 MCP 工具列表 |

### 服务层架构

```
src/
├── app/api/                    # API 路由层
│   ├── agent/
│   │   ├── stream/route.ts     # SSE 流式响应端点
│   │   ├── threads/route.ts    # 线程管理
│   │   ├── history/[threadId]/ # 历史消息查询
│   │   └── upload/route.ts     # 文件上传
│   ├── mcp-servers/route.ts    # MCP 服务器配置
│   └── mcp-tools/route.ts      # MCP 工具列表
├── services/                   # 业务逻辑层
│   ├── agentService.ts         # Agent 流式响应核心逻辑
│   ├── chatService.ts          # 聊天相关服务
│   └── messageUtils.ts         # 消息处理工具
└── lib/                        # 核心库
    ├── agent/                  # Agent 相关
    │   ├── builder.ts          # LangGraph StateGraph 构建
    │   ├── mcp.ts              # MCP 客户端集成
    │   ├── memory.ts           # PostgresSaver 持久化
    │   └── prompt.ts           # 系统提示词
    ├── database/prisma.ts      # Prisma 客户端
    └── storage/                # 文件存储
        ├── s3-client.ts        # S3 客户端配置
        ├── upload.ts           # 上传逻辑
        ├── validation.ts       # 文件验证
        └── content.ts          # AI 内容处理
```

### 核心服务详解

#### 1. Agent 流式服务 (`/api/agent/stream`)

核心聊天接口，通过 SSE 实现实时流式响应：

```typescript
// 请求参数
GET /api/agent/stream?content=用户消息&threadId=xxx&model=gpt-4o&provider=openai

// 可选参数
- allowTool: "allow" | "deny"  // 工具审批响应
- tools: "tool1,tool2"         // 启用的工具列表
- approveAllTools: "true"      // 自动批准所有工具
- attachments: JSON            // 文件附件
```

**处理流程：**
1. 解析请求参数
2. 调用 `agentService.streamResponse()` 获取异步生成器
3. 将 Agent 响应转换为 SSE 事件流
4. 发送 `done` 事件标记完成

#### 2. 线程管理 (`/api/agent/threads`)

对话线程的完整 CRUD 操作：

| 方法 | 功能 | 请求体 |
|------|------|--------|
| GET | 获取最近 50 个线程 | - |
| POST | 创建新线程 | - |
| PATCH | 更新线程标题 | `{ id, title }` |
| DELETE | 删除线程 | `{ id }` |

#### 3. MCP 服务器管理 (`/api/mcp-servers`)

动态管理 MCP 服务器配置：

```typescript
// 创建 stdio 类型服务器
POST /api/mcp-servers
{
  "name": "filesystem",
  "type": "stdio",
  "command": "npx",
  "args": ["@modelcontextprotocol/server-filesystem", "/path"],
  "env": { "LOG_LEVEL": "info" }
}

// 创建 http 类型服务器
POST /api/mcp-servers
{
  "name": "web-api",
  "type": "http",
  "url": "http://localhost:8080/mcp",
  "headers": { "Authorization": "Bearer token" }
}
```

#### 4. 文件上传 (`/api/agent/upload`)

处理多模态消息的文件上传：

- 支持图片 (PNG, JPEG)、文档 (PDF)、文本 (MD, TXT)
- 文件验证（类型、大小）
- 大文件自动使用分片上传（>5MB）
- 返回文件元数据供 AI 处理

### 数据持久化

项目使用双重持久化策略：

**1. Prisma + PostgreSQL**
- 存储线程元数据 (`Thread`)
- 存储 MCP 服务器配置 (`MCPServer`)

**2. LangGraph PostgresSaver**
- 存储完整对话状态（checkpoints）
- 支持对话恢复和 Human-in-the-loop 中断

```typescript
// memory.ts
export function createPostgresMemory(): PostgresSaver {
  return PostgresSaver.fromConnString(process.env.DATABASE_URL);
}

export const getHistory = async (threadId: string): Promise<BaseMessage[]> => {
  const history = await postgresCheckpointer.get({
    configurable: { thread_id: threadId },
  });
  return history?.channel_values?.messages || [];
};
```

### 请求处理流程

```
用户请求
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                    API 路由层                           │
│  /api/agent/stream ─► 参数解析 ─► 验证 ─► 调用服务层    │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                   服务层                                │
│  agentService.streamResponse()                          │
│    ├─► ensureThread() ─► 确保线程存在                   │
│    ├─► ensureAgent() ─► 创建/获取 Agent 实例            │
│    └─► agent.stream() ─► 流式生成响应                   │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                    核心库                               │
│  AgentBuilder (LangGraph)                               │
│    ├─► callModel() ─► LLM 调用                          │
│    ├─► approveToolCall() ─► 工具审批中断                │
│    └─► toolNode ─► MCP 工具执行                         │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                  外部服务                               │
│  PostgreSQL │ OpenAI/Gemini │ MCP Servers │ MinIO/S3   │
└─────────────────────────────────────────────────────────┘
```

## 🔄 数据流

### 消息流程图

```
用户输入 → 乐观 UI → API 路由 → Agent 服务 → LangGraph Agent
    ↓                                              ↓
React Query ←─ SSE 流 ←─ 流式响应 ←─ Agent 流 ←───┘
    ↓
UI 更新
```

### 详细流程步骤

1. **用户输入**
   - 用户在 `MessageInput` 组件中输入消息
   - 调用 `useChatThread.sendMessage()`

2. **乐观 UI 更新**
   - 用户消息立即添加到 React Query 缓存
   - UI 即时更新，提供响应式体验

3. **API 请求**
   - 打开到 `/api/agent/stream` 的 SSE 连接
   - 请求包含线程 ID、消息内容和选项

4. **Agent 处理**
   - `streamResponse()` 确保线程存在于数据库
   - 使用当前 MCP 工具和配置创建 Agent
   - LangGraph 开始处理，使用 checkpointer 实现持久化

5. **工具审批（如需要）**
   - Agent 在工具调用处暂停（如需审批）
   - 工具详情通过 SSE 发送到前端
   - 用户通过 UI 批准/拒绝
   - 发送恢复命令继续处理

6. **流式响应**
   - Agent 响应逐块通过 SSE 流式传输
   - 前端按消息 ID 累积数据块
   - React Query 缓存实时更新

7. **持久化**
   - 所有消息存储在 LangGraph checkpointer 中
   - 线程元数据在 PostgreSQL 中更新
   - MCP 服务器配置持久化

## 🗄️ 数据库设计

### 实体关系图

```
┌─────────────────┐         ┌─────────────────┐
│     Thread      │         │   MCPServer     │
├─────────────────┤         ├─────────────────┤
│ id: String (PK) │         │ id: String (PK) │
│ title: String   │         │ name: String    │
│ createdAt: Date │         │ type: Enum      │
│ updatedAt: Date │         │ enabled: Bool   │
└─────────────────┘         │ command: String?│
                            │ args: Json?     │
                            │ env: Json?      │
                            │ url: String?    │
                            │ headers: Json?  │
                            │ createdAt: Date │
                            │ updatedAt: Date │
                            └─────────────────┘

                    ┌─────────────────────────┐
                    │   LangGraph Checkpoints │
                    │   (框架管理)            │
                    ├─────────────────────────┤
                    │ thread_id: String       │
                    │ checkpoint_id: String   │
                    │                         │
                    └─────────────────────────┘
```

### Schema 详情

#### Thread 模型

```prisma
model Thread {
  id        String   @id @default(uuid())
  title     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**用途**：对话线程的最小元数据。实际对话历史存储在 LangGraph checkpoints 中，以实现高效的状态管理。

#### MCPServer 模型

```prisma
model MCPServer {
  id        String            @id @default(uuid())
  name      String            @unique
  type      MCPServerType     // stdio | http
  enabled   Boolean           @default(true)
  // stdio 服务器
  command   String?
  args      Json?
  env       Json?
  // http 服务器
  url       String?
  headers   Json?
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
}
```

**用途**：MCP 服务器的动态配置。支持 stdio（命令行）和 HTTP 两种服务器类型，配置灵活使用 JSON 格式。

## 🤖 Agent 工作流

### StateGraph 结构

```
    START
      │
      ▼
┌──────────┐
│  agent   │ ──► 调用带工具的语言模型
└──────────┘
      │
      ▼
  是否需要
  审批工具?
   ┌─────────┐
   │   是    │ ──► ┌─────────────┐
   └─────────┘     │tool_approval│ ──► 人工审核
                   └─────────────┘
   ┌─────────┐              │
   │   否    │              ▼
   └─────────┘         ┌─────────┐
      │                │  tools  │ ──► 执行工具
      ▼                └─────────┘
    END                     │
                           ▼
                      返回 agent
```

### 节点说明

#### Agent 节点

- **输入**：当前对话状态
- **处理**：
  - 将系统提示词添加到消息历史
  - 将可用工具绑定到语言模型
  - 生成响应（可能包含工具调用）
- **输出**：AI 消息（文本和/或工具调用）

#### 工具审批节点

- **输入**：包含工具调用的 AI 消息
- **处理**：
  - 检查是否启用 `approveAllTools`
  - 如未启用，中断并显示工具详情供人工审核
  - 等待用户决定（允许/拒绝/修改）
- **输出**：继续执行工具或返回 agent 的命令

#### 工具节点

- **输入**：已批准的工具调用
- **处理**：通过 MCP 客户端执行工具
- **输出**：工具结果作为消息

### 中断处理

```typescript
const humanReview = interrupt<
  { question: string; toolCall: ToolCall },
  { action: string; data: string | MessageContentComplex[] }
>({
  question: "Is this correct?",
  toolCall: toolCall,
});

switch (humanReview.action) {
  case "continue":
    return new Command({ goto: "tools" });
  case "update":
    return new Command({
      goto: "tools",
      update: { messages: [updatedMessage] },
    });
  case "feedback":
    return new Command({
      goto: "agent",
      update: { messages: [toolMessage] },
    });
}
```

## 🔧 MCP 集成

### 服务器配置流程

```
数据库 MCPServer → getMCPServerConfigs() → MultiServerMCPClient → Agent 工具
```

### 配置示例

#### Stdio 服务器（文件系统）

```typescript
{
  name: "filesystem",
  type: "stdio",
  command: "npx",
  args: ["@modelcontextprotocol/server-filesystem", "/allowed/path"],
  env: { "LOG_LEVEL": "info" }
}
```

#### HTTP 服务器（自定义 API）

```typescript
{
  name: "web-search",
  type: "http",
  url: "https://api.example.com/mcp",
  headers: {
    "Authorization": "Bearer token",
    "Content-Type": "application/json"
  }
}
```

### 工具加载流程

1. **数据库查询**：获取已启用的 MCP 服务器
2. **客户端创建**：初始化 MultiServerMCPClient
3. **工具发现**：从每个服务器获取可用工具
4. **名称前缀**：添加服务器名称前缀防止冲突
5. **Agent 绑定**：将工具绑定到语言模型

## ✅ 工具审批流程

### 用户界面流程

```
检测到工具调用 → 渲染审批 UI → 用户决定 → 发送命令 → Agent 恢复
```

### 审批选项

#### 1. 允许

- **操作**：使用原始参数执行工具
- **实现**：`new Command({ goto: "tools" })`
- **结果**：工具运行，Agent 继续处理结果

#### 2. 拒绝

- **操作**：跳过工具执行
- **实现**：返回 agent 并附带拒绝消息
- **结果**：Agent 在没有工具结果的情况下继续

#### 3. 修改

- **操作**：执行前编辑工具参数
- **实现**：使用新参数更新消息
- **结果**：工具使用修改后的输入运行

### 前端实现

```typescript
const approveToolExecution = useCallback(
  async (toolCallId: string, action: "allow" | "deny") => {
    await handleStreamResponse({
      threadId,
      text: "",
      opts: { allowTool: action },
    });
  },
  [threadId, handleStreamResponse],
);
```

## 📁 文件上传与存储

应用通过文件上传支持多模态 AI 对话。文件存储在 S3 兼容存储中（开发环境使用 MinIO），并处理后供 AI 使用。

### 上传流程

```
用户 → MessageInput → 上传 API → MinIO/S3 → 文件元数据
                                        ↓
Agent 请求 ← processAttachmentsForAI ← 下载并转换为 Base64
```

### 支持的文件类型

| 类型 | 扩展名 | 最大大小 | AI 处理方式 |
|------|--------|----------|-------------|
| 图片 | PNG, JPEG | 5MB | Base64 数据 URL |
| 文档 | PDF | 10MB | Base64 数据 URL |
| 文本 | MD, TXT | 2MB | UTF-8 文本提取 |

### 关键组件

#### 上传端点 (`src/app/api/agent/upload/route.ts`)

处理文件验证和存储：

- 验证 MIME 类型和文件大小
- 通过扩展名处理 `application/octet-stream` 类型的文本文件
- 使用唯一键上传到 MinIO/S3
- 返回文件元数据（URL、key、名称、类型、大小）

#### 存储工具 (`src/lib/storage/`)

- **s3-client.ts**：AWS SDK S3 客户端配置
- **upload.ts**：上传函数，支持大文件分片上传
- **validation.ts**：文件类型和大小验证规则
- **content.ts**：AI 文件处理（base64 转换、文本提取）

#### 多模态消息构建 (`src/services/agentService.ts`)

```typescript
if (opts?.attachments && opts.attachments.length > 0) {
  const attachmentContents = await processAttachmentsForAI(opts.attachments);
  messageContent = [{ type: "text", text: userText }, ...attachmentContents];
}
```

### 存储架构

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  MessageInput   │────►│  上传 API       │────►│   MinIO/S3      │
│  (文件选择)     │     │  (验证)         │     │   (存储)        │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  LangChain      │◄────│ processAttach-  │◄────│  下载并转换     │
│  HumanMessage   │     │ mentsForAI()    │     │  Base64         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 生产环境迁移

存储层使用 AWS SDK v3，可与任何 S3 兼容服务配合使用。从 MinIO 切换到生产存储（AWS S3、Cloudflare R2 等），只需更新环境变量，无需修改代码。

## 🌊 流式架构

### Server-Sent Events (SSE) 流程

```
客户端请求 → API 路由 → Agent 流 → SSE 响应 → 客户端处理
```

### 消息处理

#### 服务端 (`/api/agent/stream/route.ts`)

```typescript
export async function POST(request: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const responseGenerator = streamResponse(params);

        for await (const messageResponse of responseGenerator) {
          const data = JSON.stringify(messageResponse);
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
        }

        controller.enqueue(new TextEncoder().encode(`event: done\ndata: {}\n\n`));
      } catch (error) {
        controller.enqueue(
          new TextEncoder().encode(
            `event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

#### 客户端 (`useChatThread.ts`)

```typescript
stream.onmessage = (event: MessageEvent) => {
  const messageResponse = JSON.parse(event.data) as MessageResponse;
  const data = messageResponse.data as AIMessageData;

  // 第一个数据块：创建新消息
  if (!currentMessageRef.current || currentMessageRef.current.data.id !== data.id) {
    currentMessageRef.current = messageResponse;
    queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => [
      ...old,
      currentMessageRef.current!,
    ]);
  } else {
    // 后续数据块：累积内容
    const currentData = currentMessageRef.current.data as AIMessageData;
    const newContent = currentData.content + data.content;

    currentMessageRef.current = {
      ...currentMessageRef.current,
      data: { ...currentData, content: newContent },
    };

    // 更新 React Query 缓存
    queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => {
      const idx = old.findIndex((m) => m.data?.id === currentMessageRef.current!.data.id);
      if (idx === -1) return old;
      const clone = [...old];
      clone[idx] = currentMessageRef.current!;
      return clone;
    });
  }
};
```

### 消息类型

```typescript
type MessageResponse =
  | { type: "human"; data: HumanMessageData }
  | { type: "ai"; data: AIMessageData }
  | { type: "tool"; data: ToolMessageData }
  | { type: "error"; data: ErrorMessageData };

interface AIMessageData {
  id: string;
  content: string;
  tool_calls?: ToolCall[];
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
}
```

## 🚨 错误处理

### 错误分类

#### 1. 网络错误

- **原因**：连接失败、超时
- **处理**：指数退避重试
- **UI**：显示错误消息和重试按钮

#### 2. 认证错误

- **原因**：无效 API 密钥、过期令牌
- **处理**：清除无效凭据，提示重新认证
- **UI**：设置面板更新凭据

#### 3. MCP 服务器错误

- **原因**：服务器不可用、配置问题
- **处理**：优雅降级，禁用失败的服务器
- **UI**：设置中显示服务器状态指示器

#### 4. 工具执行错误

- **原因**：无效参数、权限问题
- **处理**：将错误返回给 Agent 进行恢复
- **UI**：在工具结果中显示错误

### 错误恢复策略

```typescript
// 流错误处理
stream.addEventListener("error", async (ev: Event) => {
  try {
    const dataText = (ev as MessageEvent<string>)?.data;
    const message = extractErrorMessage(dataText);

    // 在聊天中显示错误
    const errorMsg: MessageResponse = {
      type: "error",
      data: { id: `err-${Date.now()}`, content: `⚠️ ${message}` },
    };

    queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => [
      ...old,
      errorMsg,
    ]);
  } finally {
    // 始终清理
    setIsSending(false);
    currentMessageRef.current = null;
    stream.close();
    streamRef.current = null;
  }
});
```

## ⚡ 性能优化

### 前端优化

#### 1. React Query 缓存

- **策略**：Stale-while-revalidate
- **缓存时间**：消息历史 5 分钟
- **后台刷新**：窗口聚焦时

#### 2. 组件记忆化

- **用途**：记忆化昂贵的渲染
- **示例**：长对话的消息列表虚拟化

#### 3. 代码分割

- **基于路由**：Next.js App Router 自动处理
- **基于组件**：重型组件动态导入

### 后端优化

#### 1. 数据库索引

```sql
-- 线程查询优化
CREATE INDEX idx_thread_updated_at ON "Thread" ("updatedAt" DESC);

-- MCP 服务器查询优化
CREATE INDEX idx_mcpserver_enabled ON "MCPServer" ("enabled") WHERE enabled = true;
```

#### 2. 连接池

- **数据库**：Prisma 连接池
- **MCP 服务器**：复用客户端连接

#### 3. 流式效率

- **分块**：SSE 最优数据块大小
- **背压**：优雅处理慢客户端

### 内存管理

#### 1. 流清理

```typescript
useEffect(
  () => () => {
    if (streamRef.current) {
      try {
        streamRef.current.close();
      } catch {}
    }
  },
  [],
);
```

#### 2. LangGraph 检查点

- **自动**：框架自动清理旧检查点
- **配置**：通过 checkpointer 设置保留策略

## 📊 监控与可观测性

### 日志策略

#### 1. 结构化日志

```typescript
logger.info("Agent processing started", {
  threadId,
  model: opts?.model,
  toolCount: tools.length,
  approveAllTools: opts?.approveAllTools,
});
```

#### 2. 错误追踪

- **客户端**：错误边界与错误上报
- **服务端**：带上下文的集中式错误日志

#### 3. 性能指标

- **响应时间**：追踪 Agent 处理时长
- **工具使用**：监控 MCP 服务器性能
- **流健康**：SSE 连接成功率

### 健康检查

#### 1. 数据库连接

```typescript
export async function healthCheck() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "healthy", database: "connected" };
  } catch (error) {
    return { status: "unhealthy", database: "disconnected", error };
  }
}
```

#### 2. MCP 服务器状态

```typescript
export async function checkMCPServers() {
  const servers = await prisma.mCPServer.findMany({ where: { enabled: true } });
  const statuses = await Promise.allSettled(servers.map((server) => testMCPConnection(server)));
  return statuses.map((status, i) => ({
    server: servers[i].name,
    status: status.status,
    error: status.status === "rejected" ? status.reason : null,
  }));
}
```

---

本架构设计注重可扩展性、可维护性和可扩展性。模块化设计允许轻松添加新功能，同时保持清晰的关注点分离。全面的错误处理和性能优化确保了一个健壮的生产就绪系统。
