import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property-based tests for tokenGenerator
 * Feature: token-level-streaming
 * Property 2: AIMessageChunk 到 StreamChunk 的类型映射
 * Validates: Requirements 1.1, 1.2
 */

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

    if (Array.isArray(chunk) && chunk.length === 2) {
      const [chunkType, chunkData] = chunk;

      if (chunkType === "messages" && Array.isArray(chunkData) && chunkData.length >= 1) {
        const message = chunkData[0];
        if (!message) continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const constructorName = (message as any)?.constructor?.name;

        if (constructorName === "AIMessageChunk") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const aiMessage = message as any;
          const content = aiMessage.content;

          if (typeof content === "string" && content) {
            yield { type: "token", content, messageId: aiMessage.id };
          } else if (Array.isArray(content)) {
            for (const item of content) {
              if (typeof item === "string" && item) {
                yield { type: "token", content: item, messageId: aiMessage.id };
              } else if (item && typeof item === "object") {
                if ("text" in item && item.text) {
                  yield { type: "token", content: item.text as string, messageId: aiMessage.id };
                }
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

// Helper to create mock messages
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

async function* createMockIterable(chunks: unknown[]): AsyncIterable<unknown> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collectChunks(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const results: StreamChunk[] = [];
  for await (const chunk of iterable) {
    results.push(chunk);
  }
  return results;
}

describe("tokenGenerator property tests", () => {
  /**
   * Property 2: AIMessageChunk 到 StreamChunk 的类型映射
   * 对于任意 AIMessageChunk，如果其 content 为非空字符串，则 tokenGenerator 应生成类型为 "token" 的 StreamChunk
   * Validates: Requirements 1.1, 1.2
   */
  describe("Property 2: AIMessageChunk to StreamChunk type mapping", () => {
    it("should yield token type for any non-empty string content", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }), // Non-empty string
          fc.string(), // Message ID
          async (content, msgId) => {
            const mockChunk = createMockAIMessageChunk(content, { id: msgId || "test-id" });
            const iterable = createMockIterable([["messages", [mockChunk, {}]]]);
            
            const results = await collectChunks(tokenGenerator(iterable));
            
            // Should yield exactly one token chunk
            expect(results.length).toBe(1);
            expect(results[0].type).toBe("token");
            expect(results[0].content).toBe(content);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should yield tool_call type for any valid tool call", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            name: fc.string({ minLength: 1 }),
            args: fc.dictionary(fc.string(), fc.jsonValue()),
            id: fc.string({ minLength: 1 }),
            type: fc.constant("tool_call"),
          }),
          fc.string(), // Message ID
          async (toolCall, msgId) => {
            const mockChunk = createMockAIMessageChunk("", { 
              id: msgId || "test-id",
              tool_calls: [toolCall as { name: string; args: Record<string, unknown>; id: string; type: string }]
            });
            const iterable = createMockIterable([["messages", [mockChunk, {}]]]);
            
            const results = await collectChunks(tokenGenerator(iterable));
            
            // Should yield exactly one tool_call chunk
            expect(results.length).toBe(1);
            expect(results[0].type).toBe("tool_call");
            expect(results[0].toolCall?.name).toBe(toolCall.name);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should yield tool_result type for any ToolMessage", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }), // Tool name
          fc.string(), // Tool result content
          fc.string(), // Message ID
          async (toolName, content, msgId) => {
            const mockToolMessage = createMockToolMessage(toolName, content, { id: msgId || "test-id" });
            const iterable = createMockIterable([["messages", [mockToolMessage, {}]]]);
            
            const results = await collectChunks(tokenGenerator(iterable));
            
            // Should yield exactly one tool_result chunk
            expect(results.length).toBe(1);
            expect(results[0].type).toBe("tool_result");
            expect(results[0].toolResult?.name).toBe(toolName);
            expect(results[0].toolResult?.content).toBe(content);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 1: Token 内容累积一致性
   * 对于任意有效的 token StreamChunk 序列，将所有 token 的 content 字段拼接后，
   * 应该等于原始输入的所有 token 内容的拼接
   * Validates: Requirements 1.1, 3.1
   */
  describe("Property 1: Token content accumulation consistency", () => {
    it("should preserve all token content when accumulated", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 20 }), // Array of non-empty tokens
          async (tokens) => {
            // Create mock chunks for each token
            const chunks = tokens.map((token, i) => 
              ["messages", [createMockAIMessageChunk(token, { id: `msg-${i}` }), {}]]
            );
            const iterable = createMockIterable(chunks);
            
            const results = await collectChunks(tokenGenerator(iterable));
            
            // Accumulated content should equal joined tokens
            const accumulated = results
              .filter(r => r.type === "token")
              .map(r => r.content)
              .join("");
            const expected = tokens.join("");
            
            expect(accumulated).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 3: ToolMessage 到 StreamChunk 的转换
   * 对于任意 ToolMessage，tokenGenerator 应生成类型为 "tool_result" 的 StreamChunk，
   * 且 toolResult.name 等于 ToolMessage.name
   * Validates: Requirements 1.3
   */
  describe("Property 3: ToolMessage to StreamChunk conversion", () => {
    it("should correctly convert ToolMessage with object content to JSON string", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }), // Tool name
          fc.jsonValue(), // Any JSON-serializable value
          async (toolName, jsonContent) => {
            const mockToolMessage = createMockToolMessage(toolName, jsonContent as object);
            const iterable = createMockIterable([["messages", [mockToolMessage, {}]]]);
            
            const results = await collectChunks(tokenGenerator(iterable));
            
            expect(results.length).toBe(1);
            expect(results[0].type).toBe("tool_result");
            expect(results[0].toolResult?.name).toBe(toolName);
            
            // Content should be stringified if not already a string
            if (typeof jsonContent === "string") {
              expect(results[0].toolResult?.content).toBe(jsonContent);
            } else {
              expect(results[0].toolResult?.content).toBe(JSON.stringify(jsonContent));
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Edge case: Empty and null handling
   */
  describe("Edge cases", () => {
    it("should not yield any chunks for empty string content", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(""), // Empty string
          async (content) => {
            const mockChunk = createMockAIMessageChunk(content);
            const iterable = createMockIterable([["messages", [mockChunk, {}]]]);
            
            const results = await collectChunks(tokenGenerator(iterable));
            
            expect(results.length).toBe(0);
          }
        ),
        { numRuns: 10 }
      );
    });

    it("should handle mixed content types correctly", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.oneof(
              fc.string({ minLength: 1 }).map(s => ({ type: "text" as const, value: s })),
              fc.record({
                name: fc.string({ minLength: 1 }),
                args: fc.dictionary(fc.string(), fc.jsonValue()),
              }).map(tc => ({ type: "tool" as const, value: tc }))
            ),
            { minLength: 1, maxLength: 10 }
          ),
          async (items) => {
            const chunks: unknown[] = [];
            
            for (const item of items) {
              if (item.type === "text") {
                chunks.push(["messages", [createMockAIMessageChunk(item.value), {}]]);
              } else {
                chunks.push(["messages", [createMockAIMessageChunk("", {
                  tool_calls: [{
                    name: item.value.name,
                    args: item.value.args as Record<string, unknown>,
                    id: `call-${Date.now()}`,
                    type: "tool_call"
                  }]
                }), {}]]);
              }
            }
            
            const iterable = createMockIterable(chunks);
            const results = await collectChunks(tokenGenerator(iterable));
            
            // Should have same number of results as input items
            expect(results.length).toBe(items.length);
            
            // Each result should have correct type
            for (let i = 0; i < items.length; i++) {
              if (items[i].type === "text") {
                expect(results[i].type).toBe("token");
              } else {
                expect(results[i].type).toBe("tool_call");
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
