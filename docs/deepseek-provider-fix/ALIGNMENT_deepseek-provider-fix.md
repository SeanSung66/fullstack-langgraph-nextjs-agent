# ALIGNMENT: DeepSeek Provider 修复

## 原始需求

当前使用 DeepSeek 模型时存在问题：
- `MessageOptions` 缺少 `provider` 字段
- 前端选择 "deepseek" 但只传了 `model: "deepseek-chat"`
- 后端 `ensureAgent` 收不到 `provider`，使用默认 `google`
- 实际调用 Google API 而非 DeepSeek API
- Google 拒绝了 `deepseek-chat` 模型，返回空响应

## 项目上下文理解

### 现有数据流

```
前端 ModelConfiguration
    ↓ (provider, model 状态)
Thread 组件
    ↓ (sendMessage 调用)
useChatThread hook
    ↓ (createMessageStream)
chatService.ts
    ↓ (URL query params: model, 无 provider)
/api/agent/stream route
    ↓ (opts: { model }, 无 provider)
agentService.streamResponse
    ↓ (ensureAgent({ model }), 无 provider)
ensureAgent → createAgent
    ↓ (provider 使用默认值 "google")
createChatModel({ provider: "google", model: "deepseek-chat" })
    ↓ 错误！
Google API 收到无效模型名
```

### 问题根因分析

1. **类型定义缺失**: `MessageOptions` 没有 `provider` 字段
2. **前端未传递**: `Thread` 组件调用 `sendMessage` 时未传 `provider`
3. **API 路由未解析**: `/api/agent/stream` 未从 query params 读取 `provider`
4. **服务层未传递**: `agentService.streamResponse` 未将 `provider` 传给 `ensureAgent`

### 现有支持

后端已有完整的 provider 支持：
- `src/lib/agent/util.ts`: `createChatModel` 支持 `deepseek` provider
- `AgentConfigOptions` 已定义 `provider` 字段
- DeepSeek 配置使用 `ChatOpenAI` + 自定义 baseURL

## 边界确认

### 任务范围内
- 添加 `provider` 字段到 `MessageOptions`
- 前端传递 `provider` 参数
- API 路由解析 `provider` 参数
- 服务层传递 `provider` 到 agent

### 任务范围外
- 添加新的 LLM provider
- 修改 UI 组件布局
- 修改 DeepSeek API 配置

## 需求理解确认

### 预期行为
1. 用户在 UI 选择 provider (google/openai/deepseek)
2. 用户选择或输入对应的 model 名称
3. 发送消息时，provider 和 model 一起传递到后端
4. 后端使用正确的 provider 创建对应的 chat model
5. DeepSeek 请求发送到 `https://api.deepseek.com/v1`

### 验收标准
- [ ] 选择 DeepSeek provider 后发送消息，请求发送到 DeepSeek API
- [ ] 选择 Google provider 后发送消息，请求发送到 Google API
- [ ] 选择 OpenAI provider 后发送消息，请求发送到 OpenAI API
- [ ] 类型安全：TypeScript 编译无错误

## 疑问澄清

### 已自行解决
1. **provider 参数如何传递？** → 通过 URL query params，与 model 参数一致
2. **默认 provider 是什么？** → 保持现有默认值 `google`
3. **需要修改哪些文件？** → 已通过代码分析确定完整链路

### 无需询问
问题定义清晰，技术方案明确，无需额外确认。
