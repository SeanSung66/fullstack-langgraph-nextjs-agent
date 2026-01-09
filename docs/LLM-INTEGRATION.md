# LLM 集成架构分析

本文档详细分析项目的大语言模型（LLM）集成实现。

## 1. 核心技术栈

| 组件 | 技术选型 |
|------|----------|
| 框架 | Next.js 15 + React 19 |
| LLM 编排 | LangGraph.js (v1.0.2) |
| 模型提供商 | Google Gemini (默认) / OpenAI |
| 工具扩展 | MCP (Model Context Protocol) |
| 状态持久化 | PostgreSQL (LangGraph Checkpoint) |
| ORM | Prisma |

## 2. 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (React)                           │
│  chatService.ts → EventSource (SSE) → /api/agent/stream    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   API 层 (Next.js Route)                    │
│  stream/route.ts → agentService.ts → streamResponse()      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   Agent 核心 (LangGraph)                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  StateGraph (MessagesAnnotation)                    │   │
│  │  ┌─────┐    ┌──────────────┐    ┌───────┐          │   │
│  │  │START│───→│    agent     │───→│  END  │          │   │
│  │  └─────┘    └──────┬───────┘    └───────┘          │   │
│  │                    ↓ (有 tool_calls)                │   │
│  │            ┌───────────────┐                        │   │
│  │            │ tool_approval │ ←── 人工审批中断点     │   │
│  │            └───────┬───────┘                        │   │
│  │                    ↓                                │   │
│  │              ┌─────────┐                            │   │
│  │              │  tools  │ ←── ToolNode (MCP Tools)  │   │
│  │              └────┬────┘                            │   │
│  │                   └──────→ agent (循环)             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   LLM 提供商                                │
│  createChatModel() → ChatGoogleGenerativeAI / ChatOpenAI   │
│  默认模型: gemini-3-flash-preview                          │
└─────────────────────────────────────────────────────────────┘
```

## 3. 核心模块说明

### 3.1 模型工厂 (`src/lib/agent/util.ts`)

负责创建 LLM 实例的统一入口：

- 支持 `google` 和 `openai` 两个提供商
- 默认使用 `gemini-3-flash-preview` 模型
- 通过 `createChatModel()` 函数统一创建模型实例
- 支持配置 `temperature` 等参数

```typescript
export function createChatModel({
  provider = "google",
  model,
  temperature = 1,
}: CreateChatModelOptions): BaseChatModel {
  switch (provider) {
    case "openai":
      return new ChatOpenAI({ model, temperature });
    case "google":
    default:
      return new ChatGoogleGenerativeAI({ model, temperature });
  }
}
```

### 3.2 Agent 构建器 (`src/lib/agent/builder.ts`)

使用 LangGraph 的 `StateGraph` 构建有状态的对话流程：

- 定义了三个核心节点：`agent`、`tool_approval`、`tools`
- 实现了工具审批机制，支持三种操作：
  - `continue`: 直接执行工具
  - `update`: 修改工具参数后执行
  - `feedback`: 返回反馈给 agent 重新规划
- 使用 `interrupt()` 实现人机交互中断点
- 支持 `approveAllTools` 配置跳过审批流程

### 3.3 MCP 工具集成 (`src/lib/agent/mcp.ts`)

动态加载和管理 MCP (Model Context Protocol) 工具：

- 从数据库读取 MCP Server 配置
- 支持两种传输协议：
  - `stdio`: 本地命令行工具
  - `http`: 远程 HTTP 服务
- 使用 `@langchain/mcp-adapters` 的 `MultiServerMCPClient`
- 工具名称自动添加服务器前缀避免命名冲突

### 3.4 记忆/状态管理 (`src/lib/agent/memory.ts`)

基于 PostgreSQL 的对话状态持久化：

- 使用 `PostgresSaver` 作为 checkpointer
- 支持按 `thread_id` 检索历史消息
- 自动管理 checkpoint 表的初始化
- 连接字符串支持 SSL 配置

### 3.5 系统提示词 (`src/lib/agent/prompt.ts`)

定义 Agent 的行为规范：

- 专业行为准则
- 工具使用规则
- 响应格式要求（Markdown）
- 动态注入当前日期

## 4. 数据流详解

### 4.1 请求流程

1. **用户发送消息**
   - 前端调用 `chatService.createMessageStream()` 创建 EventSource 连接

2. **SSE 请求处理**
   - 请求到达 `/api/agent/stream` 路由
   - 解析查询参数：`content`、`threadId`、`model`、`tools`、`attachments` 等

3. **Agent 执行**
   - `agentService.streamResponse()` 构建 `HumanMessage`
   - 支持多模态输入（文本 + 图片附件）
   - `ensureAgent()` 创建或复用 Agent 实例

4. **LLM 调用**
   - Agent 调用配置的 LLM 模型
   - 如有工具调用则进入审批流程

5. **流式响应**
   - 通过 SSE 推送 AI 响应和工具执行结果到前端

### 4.2 工具审批流程

```
用户消息 → Agent 生成 tool_call → tool_approval 节点
                                        ↓
                              interrupt() 暂停执行
                                        ↓
                              等待用户审批决策
                                        ↓
                    ┌─────────────┬─────────────┐
                    ↓             ↓             ↓
                continue       update       feedback
                    ↓             ↓             ↓
               执行工具     修改参数后执行   返回 agent
```

## 5. 数据库模型

### Thread（对话线程）

```prisma
model Thread {
  id        String   @id @default(uuid())
  title     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### MCPServer（MCP 服务器配置）

```prisma
model MCPServer {
  id        String        @id @default(uuid())
  name      String        @unique
  type      MCPServerType // stdio | http
  enabled   Boolean       @default(true)
  command   String?       // stdio 类型
  args      Json?
  env       Json?
  url       String?       // http 类型
  headers   Json?
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
}
```

## 6. 关键依赖

```json
{
  "@langchain/core": "^1.0.6",
  "@langchain/google-genai": "^1.0.3",
  "@langchain/langgraph": "^1.0.2",
  "@langchain/langgraph-checkpoint-postgres": "^1.0.0",
  "@langchain/mcp-adapters": "^1.0.0",
  "@langchain/openai": "^1.1.2"
}
```

## 7. 亮点特性

| 特性 | 说明 |
|------|------|
| 工具审批流程 | 用户可控制是否执行工具调用，支持修改参数 |
| 多模态支持 | 支持图片等附件的处理和传递给 LLM |
| 动态 MCP 配置 | 通过数据库管理 MCP Server，无需重启应用 |
| 会话持久化 | 基于 PostgreSQL 的可靠状态存储 |
| 模型可切换 | 运行时可指定不同的模型和提供商 |
| 流式响应 | 基于 SSE 的实时响应推送 |

## 8. 扩展指南

### 添加新的 LLM 提供商

在 `src/lib/agent/util.ts` 的 `createChatModel()` 函数中添加新的 case：

```typescript
case "anthropic":
  return new ChatAnthropic({ model, temperature });
```

### 添加自定义工具

1. 创建工具定义
2. 在调用 `ensureAgent()` 时通过 `tools` 参数传入
3. 或通过 MCP Server 配置动态加载
