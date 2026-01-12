# Token 级流式输出前端集成指南

本文档介绍如何在外部前端应用中集成 Token 级流式 AI 响应。

## SSE 数据格式

后端通过 Server-Sent Events (SSE) 发送以下格式的数据：

### 事件类型

| type | 说明 | 数据字段 |
|------|------|---------|
| `token` | AI 输出的增量文本 | `content`, `messageId` |
| `tool_call` | AI 请求调用工具 | `toolCall`, `messageId` |
| `tool_result` | 工具执行结果 | `toolResult`, `messageId` |
| `done` | 流式输出完成 | - |
| `error` | 发生错误 | `error` |

### 数据示例

```
: connected

data: {"type":"token","content":"你","messageId":"msg-123"}

data: {"type":"token","content":"好","messageId":"msg-123"}

data: {"type":"token","content":"！","messageId":"msg-123"}

data: {"type":"tool_call","toolCall":{"name":"read_file","args":{"path":"/tmp/test.txt"},"id":"call-1","type":"tool_call"},"messageId":"msg-124"}

data: {"type":"tool_result","toolResult":{"name":"read_file","content":"file content"},"messageId":"msg-125"}

data: {"type":"done"}

event: done
data: {}
```

## TypeScript 类型定义

```typescript
// types/stream.ts
export interface StreamChunk {
  type: "token" | "tool_call" | "tool_result" | "done" | "error";
  content?: string;
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    id: string;
    type: "tool_call";
  };
  toolResult?: {
    name: string;
    content: string;
  };
  error?: string;
  messageId?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCall?: StreamChunk["toolCall"];
  toolResult?: StreamChunk["toolResult"];
}
```

## React Hook 实现

```typescript
// hooks/useStreamingChat.ts
import { useState, useCallback, useRef } from "react";
import type { StreamChunk, Message } from "../types/stream";

interface UseStreamingChatOptions {
  apiBaseUrl?: string;
  threadId: string;
  model?: string;
  provider?: string;
}

export function useStreamingChat(options: UseStreamingChatOptions) {
  const { apiBaseUrl = "http://localhost:3000", threadId, model, provider } = options;
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentContentRef = useRef<string>("");

  const sendMessage = useCallback(async (content: string) => {
    setError(null);
    setIsStreaming(true);
    currentContentRef.current = "";

    // 添加用户消息
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
    };
    setMessages((prev) => [...prev, userMessage]);

    // 创建 AI 消息占位
    const assistantMessageId = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: assistantMessageId, role: "assistant", content: "" },
    ]);

    // 构建请求 URL
    const params = new URLSearchParams({
      content,
      threadId,
      ...(model && { model }),
      ...(provider && { provider }),
    });

    try {
      abortControllerRef.current = new AbortController();
      
      const response = await fetch(`${apiBaseUrl}/api/agent/stream?${params}`, {
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader available");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const chunk: StreamChunk = JSON.parse(line.slice(6));
              
              switch (chunk.type) {
                case "token":
                  currentContentRef.current += chunk.content || "";
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: currentContentRef.current }
                        : msg
                    )
                  );
                  break;

                case "tool_call":
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, toolCall: chunk.toolCall }
                        : msg
                    )
                  );
                  break;

                case "tool_result":
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `tool-${Date.now()}`,
                      role: "tool",
                      content: chunk.toolResult?.content || "",
                      toolResult: chunk.toolResult,
                    },
                  ]);
                  break;

                case "error":
                  setError(chunk.error || "Unknown error");
                  break;

                case "done":
                  break;
              }
            } catch (e) {
              // 忽略非 JSON 行的解析错误
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [apiBaseUrl, threadId, model, provider]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    stopStreaming,
    clearMessages,
  };
}
```

## React 组件示例

```tsx
// components/Chat.tsx
import { useState } from "react";
import { useStreamingChat } from "../hooks/useStreamingChat";

export function Chat({ threadId }: { threadId: string }) {
  const [input, setInput] = useState("");
  const { messages, isStreaming, error, sendMessage, stopStreaming } = useStreamingChat({
    apiBaseUrl: "http://localhost:3000",
    threadId,
    model: "gpt-4o",
    provider: "openai",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isStreaming) {
      sendMessage(input);
      setInput("");
    }
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="role">{msg.role}</div>
            <div className="content">{msg.content}</div>
            {msg.toolCall && (
              <div className="tool-call">
                🔧 调用工具: {msg.toolCall.name}
              </div>
            )}
          </div>
        ))}
        {isStreaming && <div className="typing-indicator">AI 正在输入...</div>}
      </div>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息..."
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button type="button" onClick={stopStreaming}>停止</button>
        ) : (
          <button type="submit">发送</button>
        )}
      </form>
    </div>
  );
}
```

## 纯 JavaScript 实现 (无框架)

```javascript
// streaming-client.js
class StreamingChatClient {
  constructor(apiBaseUrl = "http://localhost:3000") {
    this.apiBaseUrl = apiBaseUrl;
    this.abortController = null;
  }

  async sendMessage(threadId, content, options = {}) {
    const { model, provider, onToken, onToolCall, onToolResult, onDone, onError } = options;

    const params = new URLSearchParams({
      content,
      threadId,
      ...(model && { model }),
      ...(provider && { provider }),
    });

    this.abortController = new AbortController();

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/agent/stream?${params}`, {
        signal: this.abortController.signal,
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const chunk = JSON.parse(line.slice(6));

              switch (chunk.type) {
                case "token":
                  fullContent += chunk.content || "";
                  onToken?.(chunk.content, fullContent);
                  break;
                case "tool_call":
                  onToolCall?.(chunk.toolCall);
                  break;
                case "tool_result":
                  onToolResult?.(chunk.toolResult);
                  break;
                case "done":
                  onDone?.(fullContent);
                  break;
                case "error":
                  onError?.(chunk.error);
                  break;
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        onError?.(err.message);
      }
    }
  }

  stop() {
    this.abortController?.abort();
  }
}

// 使用示例
const client = new StreamingChatClient("http://localhost:3000");

client.sendMessage("thread-123", "你好", {
  model: "gpt-4o",
  provider: "openai",
  onToken: (token, fullContent) => {
    document.getElementById("output").textContent = fullContent;
  },
  onDone: (fullContent) => {
    console.log("完成:", fullContent);
  },
  onError: (error) => {
    console.error("错误:", error);
  },
});
```

## Vue 3 Composable 实现

```typescript
// composables/useStreamingChat.ts
import { ref, Ref } from "vue";

interface StreamChunk {
  type: "token" | "tool_call" | "tool_result" | "done" | "error";
  content?: string;
  toolCall?: { name: string; args: Record<string, unknown>; id: string };
  toolResult?: { name: string; content: string };
  error?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
}

export function useStreamingChat(apiBaseUrl = "http://localhost:3000") {
  const messages: Ref<Message[]> = ref([]);
  const isStreaming = ref(false);
  const error: Ref<string | null> = ref(null);
  let abortController: AbortController | null = null;

  async function sendMessage(threadId: string, content: string, options?: { model?: string; provider?: string }) {
    error.value = null;
    isStreaming.value = true;

    messages.value.push({ id: `user-${Date.now()}`, role: "user", content });
    
    const assistantId = `assistant-${Date.now()}`;
    messages.value.push({ id: assistantId, role: "assistant", content: "" });

    const params = new URLSearchParams({ content, threadId, ...options });
    abortController = new AbortController();

    try {
      const response = await fetch(`${apiBaseUrl}/api/agent/stream?${params}`, {
        signal: abortController.signal,
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const chunk: StreamChunk = JSON.parse(line.slice(6));
              if (chunk.type === "token") {
                fullContent += chunk.content || "";
                const msg = messages.value.find((m) => m.id === assistantId);
                if (msg) msg.content = fullContent;
              } else if (chunk.type === "error") {
                error.value = chunk.error || "Unknown error";
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") error.value = err.message;
    } finally {
      isStreaming.value = false;
    }
  }

  function stop() {
    abortController?.abort();
    isStreaming.value = false;
  }

  return { messages, isStreaming, error, sendMessage, stop };
}
```

## API 端点参考

### GET /api/agent/stream

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| content | string | 是 | 用户消息内容 |
| threadId | string | 是 | 线程 ID |
| model | string | 否 | 模型名称 |
| provider | string | 否 | 模型提供商 |
| tools | string | 否 | 启用的工具（逗号分隔） |
| allowTool | string | 否 | 工具审批：allow/deny |
| approveAllTools | string | 否 | 自动批准所有工具 |
| attachments | string | 否 | 文件附件 JSON |

### 响应头

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
```
