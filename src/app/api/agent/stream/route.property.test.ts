import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { StreamChunk } from "@/services/agentService";

/**
 * Property tests for SSE endpoint data format validity.
 * Tests Property 4: SSE data format validity from design doc.
 */
describe("SSE endpoint property tests", () => {
  // Arbitrary generators for StreamChunk types
  const tokenChunkArb = fc.record({
    type: fc.constant("token" as const),
    content: fc.string({ minLength: 1 }),
    messageId: fc.option(fc.string(), { nil: undefined }),
  });

  const toolCallArb = fc.record({
    name: fc.string({ minLength: 1 }),
    args: fc.dictionary(fc.string(), fc.jsonValue()),
    id: fc.string(),
    type: fc.constant("tool_call" as const),
  });

  const toolCallChunkArb = fc.record({
    type: fc.constant("tool_call" as const),
    toolCall: toolCallArb,
    messageId: fc.option(fc.string(), { nil: undefined }),
  });

  const toolResultChunkArb = fc.record({
    type: fc.constant("tool_result" as const),
    toolResult: fc.record({
      name: fc.string({ minLength: 1 }),
      content: fc.string(),
    }),
    messageId: fc.option(fc.string(), { nil: undefined }),
  });

  const doneChunkArb = fc.record({
    type: fc.constant("done" as const),
  });

  const errorChunkArb = fc.record({
    type: fc.constant("error" as const),
    error: fc.string(),
  });

  const streamChunkArb: fc.Arbitrary<StreamChunk> = fc.oneof(
    tokenChunkArb,
    toolCallChunkArb,
    toolResultChunkArb,
    doneChunkArb,
    errorChunkArb,
  );

  describe("Property 4: SSE data format validity", () => {
    it("should serialize any StreamChunk to valid JSON", () => {
      fc.assert(
        fc.property(streamChunkArb, (chunk) => {
          // Should not throw
          const serialized = JSON.stringify(chunk);
          expect(typeof serialized).toBe("string");
          expect(serialized.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it("should deserialize back to equivalent StreamChunk", () => {
      fc.assert(
        fc.property(streamChunkArb, (chunk) => {
          const serialized = JSON.stringify(chunk);
          const deserialized = JSON.parse(serialized) as StreamChunk;

          // Type should match
          expect(deserialized.type).toBe(chunk.type);

          // Content should match for token chunks
          if (chunk.type === "token") {
            expect(deserialized.content).toBe(chunk.content);
          }

          // Tool call should match
          if (chunk.type === "tool_call" && chunk.toolCall) {
            expect(deserialized.toolCall?.name).toBe(chunk.toolCall.name);
            expect(deserialized.toolCall?.id).toBe(chunk.toolCall.id);
          }

          // Tool result should match
          if (chunk.type === "tool_result" && chunk.toolResult) {
            expect(deserialized.toolResult?.name).toBe(chunk.toolResult.name);
            expect(deserialized.toolResult?.content).toBe(chunk.toolResult.content);
          }

          // Error should match
          if (chunk.type === "error") {
            expect(deserialized.error).toBe(chunk.error);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("should produce valid SSE data line format", () => {
      fc.assert(
        fc.property(streamChunkArb, (chunk) => {
          const sseDataLine = `data: ${JSON.stringify(chunk)}\n\n`;

          // Should start with "data: "
          expect(sseDataLine.startsWith("data: ")).toBe(true);

          // Should end with double newline
          expect(sseDataLine.endsWith("\n\n")).toBe(true);

          // Should be parseable after removing prefix
          const jsonPart = sseDataLine.slice(6, -2);
          const parsed = JSON.parse(jsonPart);
          expect(parsed.type).toBe(chunk.type);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("SSE line parsing simulation", () => {
    it("should correctly parse SSE data lines with various content", () => {
      fc.assert(
        fc.property(tokenChunkArb, (chunk) => {
          // Simulate what the frontend receives
          const sseDataLine = `data: ${JSON.stringify(chunk)}`;

          // Frontend parsing logic
          if (sseDataLine.startsWith("data: ")) {
            const jsonStr = sseDataLine.slice(6);
            const parsed = JSON.parse(jsonStr) as StreamChunk;

            expect(parsed.type).toBe("token");
            expect(parsed.content).toBe(chunk.content);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("should handle special characters in content", () => {
      const specialCharsArb = fc.record({
        type: fc.constant("token" as const),
        content: fc.oneof(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.constant("Hello\nWorld"),
          fc.constant("Tab\there"),
          fc.constant('Quote"test'),
          fc.constant("Backslash\\test"),
          fc.constant("中文内容"),
          fc.constant("🎉🚀✨"),
          fc.constant("Mixed 中文 and emoji 🎉"),
        ),
        messageId: fc.option(fc.string(), { nil: undefined }),
      });

      fc.assert(
        fc.property(specialCharsArb, (chunk) => {
          const serialized = JSON.stringify(chunk);
          const deserialized = JSON.parse(serialized) as StreamChunk;
          expect(deserialized.content).toBe(chunk.content);
        }),
        { numRuns: 100 },
      );
    });
  });
});
