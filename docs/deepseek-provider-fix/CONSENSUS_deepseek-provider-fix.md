# CONSENSUS: DeepSeek Provider 修复

## 明确的需求描述

修复 provider 参数在整个数据流中的传递，确保用户选择的 LLM provider (google/openai/deepseek) 能正确传递到后端并创建对应的 chat model。

## 技术实现方案

### 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `src/types/message.ts` | `MessageOptions` 添加 `provider?: string` |
| `src/components/MessageInput.tsx` | `handleSubmit` 传递 `provider` |
| `src/services/chatService.ts` | `createMessageStream` 添加 `provider` param |
| `src/app/api/agent/stream/route.ts` | 解析 `provider` query param |
| `src/services/agentService.ts` | `ensureAgent` 传递 `provider` |

## 验收标准

1. 选择 DeepSeek provider 发送消息，请求发送到 DeepSeek API
2. 选择 Google provider 发送消息，请求发送到 Google API  
3. 选择 OpenAI provider 发送消息，请求发送到 OpenAI API
4. TypeScript 编译无错误
5. 现有功能不受影响

## 技术约束

- 保持向后兼容：provider 为可选参数，默认值 "google"
- 复用现有 `createChatModel` 函数
- 遵循项目现有代码风格
