import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { StreamChunk } from "@/services/agentService";
import type { MessageResponse, AIMessageData } from "@/types/message";

/**
 * Property tests for frontend message accumulation logic.
 * Tests Property 5: Frontend message accumulation correctness from design doc.
 *
 * Note: These tests verify the pure logic of token accumulation without React hooks.
 */

/**
 * Simulates the token accumulation logic from useChatThread hook.
 * This is a pure function extraction for testing purposes.
 */
function accumulateTokens(chunks: StreamChunk[]): string {
  let accumulated = "";
  for (const chunk of chunks) {
    if (chunk.type === "token" && chunk.content) {
      accumulated += chunk.content;
    }
  }
  return accumulated;
}

/**
 * Simulates processing StreamChunks into MessageResponse array.
 */
function processChunksToMessages(chunks: StreamChunk[]): MessageResponse[] {
  const messages: MessageResponse[] = [];
  let currentMessageId: string | null = null;
  let accumulatedContent = "";

  for (const chunk of chunks) {
    switch (chunk.type) {
      case "token": {
        accumulatedContent += chunk.content || "";
        const messageId = chunk.messageId || `ai-${Date.now()}`;

        if (!currentMessageId) {
          currentMessageId = messageId;
          messages.push({
            type: "ai",
            data: {
              id: messageId,
              content: accumulatedContent,
            } as AIMessageData,
          });
        } else {
          // Update existing message
          const idx = messages.findIndex((m) => m.type === "ai" && m.data.id === currentMessageId);
          if (idx !== -1) {
            messages[idx] = {
              ...messages[idx],
              data: {
                ...messages[idx].data,
                content: accumulatedContent,
              } as AIMessageData,
            };
          }
        }
        break;
      }

      case "tool_call": {
        if (currentMessageId && chunk.toolCall) {
          const idx = messages.findIndex((m) => m.type === "ai" && m.data.id === currentMessageId);
          if (idx !== -1) {
            const currentData = messages[idx].data as AIMessageData;
            const existingToolCalls = currentData.tool_calls || [];
            messages[idx] = {
              ...messages[idx],
              data: {
                ...currentData,
                tool_calls: [...existingToolCalls, chunk.toolCall],
              } as AIMessageData,
            };
          }
        }
        break;
      }

      case "tool_result": {
        if (chunk.toolResult) {
          messages.push({
            type: "tool",
            data: {
              id: chunk.messageId || `tool-${Date.now()}`,
              content: chunk.toolResult.content,
              name: chunk.toolResult.name,
              status: "success",
              tool_call_id: chunk.messageId || "",
            },
          });
          // Reset for next AI message
          currentMessageId = null;
          accumulatedContent = "";
        }
        break;
      }

      case "error": {
        messages.push({
          type: "error",
          data: {
            id: `err-${Date.now()}`,
            content: `⚠️ ${chunk.error || "An error occurred"}`,
          },
        });
        currentMessageId = null;
        accumulatedContent = "";
        break;
      }

      case "done": {
        currentMessageId = null;
        accumulatedContent = "";
        break;
      }
    }
  }

  return messages;
}

describe("useChatThread property tests", () => {
  // Arbitrary generators
  const tokenChunkArb = fc.record({
    type: fc.constant("token" as const),
    content: fc.string({ minLength: 1 }),
    messageId: fc.constant("test-msg-id"),
  });

  const tokenChunksArb = fc.array(tokenChunkArb, { minLength: 1, maxLength: 20 });

  describe("Property 5: Frontend message accumulation correctness", () => {
    it("should accumulate all token content in order", () => {
      fc.assert(
        fc.property(tokenChunksArb, (chunks) => {
          const accumulated = accumulateTokens(chunks);
          const expected = chunks.map((c) => c.content || "").join("");
          expect(accumulated).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });

    it("should preserve token order during accumulation", () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 2, maxLength: 10 }),
          (contents) => {
            const chunks: StreamChunk[] = contents.map((content) => ({
              type: "token",
              content,
              messageId: "test-id",
            }));

            const accumulated = accumulateTokens(chunks);
            const expected = contents.join("");

            expect(accumulated).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should create exactly one AI message for consecutive token chunks", () => {
      fc.assert(
        fc.property(tokenChunksArb, (chunks) => {
          const messages = processChunksToMessages(chunks);
          const aiMessages = messages.filter((m) => m.type === "ai");

          // All chunks have same messageId, so should result in one AI message
          expect(aiMessages.length).toBe(1);
        }),
        { numRuns: 100 },
      );
    });

    it("should have final AI message content equal to all tokens concatenated", () => {
      fc.assert(
        fc.property(tokenChunksArb, (chunks) => {
          const messages = processChunksToMessages(chunks);
          const aiMessage = messages.find((m) => m.type === "ai");

          expect(aiMessage).toBeDefined();
          const expectedContent = chunks.map((c) => c.content || "").join("");
          expect((aiMessage!.data as AIMessageData).content).toBe(expectedContent);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Tool call handling", () => {
    it("should add tool calls to AI message", () => {
      const toolCallArb = fc.record({
        name: fc.string({ minLength: 1 }),
        args: fc.dictionary(fc.string(), fc.jsonValue()),
        id: fc.string({ minLength: 1 }),
        type: fc.constant("tool_call" as const),
      });

      fc.assert(
        fc.property(tokenChunkArb, toolCallArb, (tokenChunk, toolCall) => {
          const chunks: StreamChunk[] = [
            tokenChunk,
            { type: "tool_call", toolCall, messageId: tokenChunk.messageId },
          ];

          const messages = processChunksToMessages(chunks);
          const aiMessage = messages.find((m) => m.type === "ai");

          expect(aiMessage).toBeDefined();
          const data = aiMessage!.data as AIMessageData;
          expect(data.tool_calls).toBeDefined();
          expect(data.tool_calls!.length).toBe(1);
          expect(data.tool_calls![0].name).toBe(toolCall.name);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Tool result handling", () => {
    it("should create tool message for tool_result chunk", () => {
      const toolResultArb = fc.record({
        name: fc.string({ minLength: 1 }),
        content: fc.string(),
      });

      fc.assert(
        fc.property(toolResultArb, (toolResult) => {
          const chunks: StreamChunk[] = [{ type: "tool_result", toolResult, messageId: "tool-1" }];

          const messages = processChunksToMessages(chunks);
          const toolMessage = messages.find((m) => m.type === "tool");

          expect(toolMessage).toBeDefined();
          expect(toolMessage!.data.content).toBe(toolResult.content);
        }),
        { numRuns: 100 },
      );
    });

    it("should reset accumulation after tool_result", () => {
      fc.assert(
        fc.property(tokenChunksArb, tokenChunksArb, (firstBatch, secondBatch) => {
          const toolResult = { name: "test_tool", content: "result" };
          const chunks: StreamChunk[] = [
            ...firstBatch,
            { type: "tool_result", toolResult, messageId: "tool-1" },
            ...secondBatch.map((c) => ({ ...c, messageId: "second-msg-id" })),
          ];

          const messages = processChunksToMessages(chunks);
          const aiMessages = messages.filter((m) => m.type === "ai");

          // Should have two AI messages (before and after tool result)
          expect(aiMessages.length).toBe(2);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Error handling", () => {
    it("should create error message for error chunk", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (errorMessage) => {
          const chunks: StreamChunk[] = [{ type: "error", error: errorMessage }];

          const messages = processChunksToMessages(chunks);
          const errorMsg = messages.find((m) => m.type === "error");

          expect(errorMsg).toBeDefined();
          expect(errorMsg!.data.content).toContain(errorMessage);
        }),
        { numRuns: 100 },
      );
    });
  });
});
