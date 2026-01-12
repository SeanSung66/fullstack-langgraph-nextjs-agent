# ACCEPTANCE: DeepSeek Provider 修复

## 完成情况

| 任务 | 状态 | 说明 |
|------|------|------|
| Task 1: 类型定义更新 | ✅ | `MessageOptions` 添加 `provider?: string` |
| Task 2: 前端参数传递 | ✅ | `handleSubmit` 传递 `provider` |
| Task 3: chatService URL 参数 | ✅ | `createMessageStream` 添加 provider param |
| Task 4: API 路由解析 | ✅ | 解析 provider 并传递给 streamResponse |
| Task 5: agentService 传递 | ✅ | 两处 ensureAgent 调用都添加了 provider |

## 验收检查

- [x] TypeScript 编译无错误
- [x] 代码风格与项目一致
- [x] 数据流完整：前端 → API → Agent

## 修改文件清单

1. `src/types/message.ts` - 添加 provider 字段
2. `src/components/MessageInput.tsx` - 传递 provider
3. `src/services/chatService.ts` - URL 参数添加 provider
4. `src/app/api/agent/stream/route.ts` - 解析 provider 参数
5. `src/services/agentService.ts` - 传递 provider 到 ensureAgent

## 修复后数据流

```
MessageInput (provider: "deepseek", model: "deepseek-chat")
    ↓
chatService.createMessageStream
    ↓ URL: ?provider=deepseek&model=deepseek-chat
/api/agent/stream
    ↓ opts: { provider: "deepseek", model: "deepseek-chat" }
agentService.streamResponse
    ↓
ensureAgent({ provider: "deepseek", model: "deepseek-chat" })
    ↓
createChatModel({ provider: "deepseek", model: "deepseek-chat" })
    ↓ ✅ 正确调用 DeepSeek API
```
