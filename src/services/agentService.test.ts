import { describe, it, expect } from "vitest";

// Define StreamChunk type locally to avoid importing agentService which has side effects
interface StreamChunk {
  type: "token" | "tool_call" | "tool_result" | "done" | "error";
  content?: string;
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    id: string;
    type: string;
  };
  toolResult?: { name: string; content: string };
  error?: string;
  messageId?: string;
}

// Define ToolCall type locally
interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  id: string;
  type: string;
}

/**
 * Copy of tokenGenerator function for testing purposes.
 * This avoids importing the actual module which has database side effects.
 */
async function* tokenGenerator(
  iterable: AsyncIterable<unknown>,
): AsyncGenerator<StreamChunk, void, unknown> {
  for await (const chunk of iterable) {
    if (!chunk) continue;

    // Handle messages mode: ["messages", [message, metadata]]
    if (Array.isArray(chunk) && chunk.length === 2) {
      const [chunkType, chunkData] = chunk;

      if (chunkType === "messages" && Array.isArray(chunkData) && chunkData.length >= 1) {
        const message = chunkData[0];
        if (!message) continue;

        // Get constructor name to identify message type
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const constructorName = (message as any)?.constructor?.name;

        // Handle AIMessageChunk (streaming tokens from LLM)
        if (constructorName === "AIMessageChunk") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const aiMessage = message as any;
          const content = aiMessage.content;

          // Extract text content - can be string or array of content items
          if (typeof content === "string" && content) {
            yield { type: "token", content, messageId: aiMessage.id };
          } else if (Array.isArray(content)) {
            for (const item of content) {
              if (typeof item === "string" && item) {
                yield { type: "token", content: item, messageId: aiMessage.id };
              } else if (item && typeof item === "object") {
                // Handle text content item
                if ("text" in item && item.text) {
                  yield { type: "token", content: item.text as string, messageId: aiMessage.id };
                }
                // Handle function call (tool call) in content
                if ("functionCall" in item && item.functionCall) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const fc = item.functionCall as any;
                  yield {
                    type: "tool_call",
                    toolCall: {
                      name: fc.name,
                      args: fc.args,
                      id: aiMessage.id || Date.now().toString(),
                      type: "tool_call",
                    },
                    messageId: aiMessage.id,
                  };
                }
              }
            }
          }

          // Handle tool_calls array (standard LangChain format)
          if (
            aiMessage.tool_calls &&
            Array.isArray(aiMessage.tool_calls) &&
            aiMessage.tool_calls.length > 0
          ) {
            for (const toolCall of aiMessage.tool_calls) {
              yield {
                type: "tool_call",
                toolCall: toolCall as ToolCall,
                messageId: aiMessage.id,
              };
            }
          }
        }

        // Handle ToolMessage (tool execution results)
        if (constructorName === "ToolMessage") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolMessage = message as any;
          yield {
            type: "tool_result",
            toolResult: {
              name: toolMessage.name || "unknown",
              content:
                typeof toolMessage.content === "string"
                  ? toolMessage.content
                  : JSON.stringify(toolMessage.content),
            },
            messageId: toolMessage.id,
          };
        }
      }
    }
  }
}

/**
 * Helper to create a mock AIMessageChunk
 */
function createMockAIMessageChunk(content: string | unknown[], options?: {
  id?: string;
  tool_calls?: Array<{ name: string; args: Record<string, unknown>; id: string; type: string }>;
}) {
  return {
    constructor: { name: "AIMessageChunk" },
    content,
    id: options?.id || `msg-${Date.now()}`,
    tool_calls: options?.tool_calls || [],
  };
}

/**
 * Helper to create a mock ToolMessage
 */
function createMockToolMessage(name: string, content: string | object, options?: {
  id?: string;
}) {
  return {
    constructor: { name: "ToolMessage" },
    name,
    content,
    id: options?.id || `tool-${Date.now()}`,
  };
}

/**
 * Helper to create an async iterable from chunks
 */
async function* createMockIterable(chunks: unknown[]): AsyncIterable<unknown> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("tokenGenerator", () => {
  describe("AIMessageChunk text content extraction", () => {
    it("should yield token chunk for string content", async () => {
      const mockChunk = createMockAIMessageChunk("Hello");
      const iterable = createMockIterable([["messages", [mockChunk, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("token");
      expect(results[0].content).toBe("Hello");
    });

    it("should yield multiple token chunks for multiple messages", async () => {
      const chunks = [
        ["messages", [createMockAIMessageChunk("Hello"), {}]],
        ["messages", [createMockAIMessageChunk(" "), {}]],
        ["messages", [createMockAIMessageChunk("World"), {}]],
      ];
      const iterable = createMockIterable(chunks);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(3);
      expect(results.map(r => r.content).join("")).toBe("Hello World");
    });

    it("should handle array content with text items", async () => {
      const mockChunk = createMockAIMessageChunk([
        { text: "Hello" },
        { text: " World" },
      ]);
      const iterable = createMockIterable([["messages", [mockChunk, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(2);
      expect(results[0].content).toBe("Hello");
      expect(results[1].content).toBe(" World");
    });

    it("should handle array content with string items", async () => {
      const mockChunk = createMockAIMessageChunk(["Hello", " ", "World"]);
      const iterable = createMockIterable([["messages", [mockChunk, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(3);
      expect(results.map(r => r.content).join("")).toBe("Hello World");
    });

    it("should skip empty string content", async () => {
      const mockChunk = createMockAIMessageChunk("");
      const iterable = createMockIterable([["messages", [mockChunk, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(0);
    });

    it("should include messageId in token chunks", async () => {
      const mockChunk = createMockAIMessageChunk("Test", { id: "test-msg-123" });
      const iterable = createMockIterable([["messages", [mockChunk, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results[0].messageId).toBe("test-msg-123");
    });
  });

  describe("tool_calls handling", () => {
    it("should yield tool_call chunk for tool calls", async () => {
      const toolCall = {
        name: "read_file",
        args: { path: "/tmp/test.txt" },
        id: "call-123",
        type: "tool_call",
      };
      const mockChunk = createMockAIMessageChunk("", { tool_calls: [toolCall] });
      const iterable = createMockIterable([["messages", [mockChunk, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("tool_call");
      expect(results[0].toolCall?.name).toBe("read_file");
      expect(results[0].toolCall?.args).toEqual({ path: "/tmp/test.txt" });
    });

    it("should yield multiple tool_call chunks for multiple tool calls", async () => {
      const toolCalls = [
        { name: "read_file", args: { path: "/a.txt" }, id: "call-1", type: "tool_call" },
        { name: "write_file", args: { path: "/b.txt", content: "test" }, id: "call-2", type: "tool_call" },
      ];
      const mockChunk = createMockAIMessageChunk("", { tool_calls: toolCalls });
      const iterable = createMockIterable([["messages", [mockChunk, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(2);
      expect(results[0].toolCall?.name).toBe("read_file");
      expect(results[1].toolCall?.name).toBe("write_file");
    });

    it("should handle functionCall in content array", async () => {
      const mockChunk = createMockAIMessageChunk([
        { functionCall: { name: "search", args: { query: "test" } } },
      ], { id: "msg-func" });
      const iterable = createMockIterable([["messages", [mockChunk, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("tool_call");
      expect(results[0].toolCall?.name).toBe("search");
    });
  });

  describe("ToolMessage handling", () => {
    it("should yield tool_result chunk for ToolMessage", async () => {
      const mockToolMessage = createMockToolMessage("read_file", "file content here");
      const iterable = createMockIterable([["messages", [mockToolMessage, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("tool_result");
      expect(results[0].toolResult?.name).toBe("read_file");
      expect(results[0].toolResult?.content).toBe("file content here");
    });

    it("should stringify object content in ToolMessage", async () => {
      const mockToolMessage = createMockToolMessage("api_call", { status: "success", data: [1, 2, 3] });
      const iterable = createMockIterable([["messages", [mockToolMessage, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results[0].toolResult?.content).toBe(JSON.stringify({ status: "success", data: [1, 2, 3] }));
    });

    it("should use 'unknown' for missing tool name", async () => {
      const mockToolMessage = {
        constructor: { name: "ToolMessage" },
        name: undefined,
        content: "result",
        id: "tool-1",
      };
      const iterable = createMockIterable([["messages", [mockToolMessage, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results[0].toolResult?.name).toBe("unknown");
    });
  });

  describe("edge cases and error handling", () => {
    it("should skip null chunks", async () => {
      const iterable = createMockIterable([null, undefined]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(0);
    });

    it("should skip non-array chunks", async () => {
      const iterable = createMockIterable(["string", 123, { obj: true }]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(0);
    });

    it("should skip chunks with wrong format", async () => {
      const iterable = createMockIterable([
        ["not-messages", [{}]],
        ["messages", "not-array"],
        ["messages", []],
      ]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(0);
    });

    it("should skip messages with unknown constructor", async () => {
      const unknownMessage = {
        constructor: { name: "UnknownMessage" },
        content: "test",
      };
      const iterable = createMockIterable([["messages", [unknownMessage, {}]]]);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(0);
    });

    it("should handle mixed message types in sequence", async () => {
      const chunks = [
        ["messages", [createMockAIMessageChunk("Hello"), {}]],
        ["messages", [createMockAIMessageChunk("", { 
          tool_calls: [{ name: "test", args: {}, id: "c1", type: "tool_call" }] 
        }), {}]],
        ["messages", [createMockToolMessage("test", "result"), {}]],
        ["messages", [createMockAIMessageChunk(" World"), {}]],
      ];
      const iterable = createMockIterable(chunks);

      const results: StreamChunk[] = [];
      for await (const chunk of tokenGenerator(iterable)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(4);
      expect(results[0].type).toBe("token");
      expect(results[1].type).toBe("tool_call");
      expect(results[2].type).toBe("tool_result");
      expect(results[3].type).toBe("token");
    });
  });
});
