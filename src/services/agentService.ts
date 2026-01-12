import { ensureAgent } from "@/lib/agent";
import { ensureThread } from "@/lib/thread";
import type { MessageOptions, ToolCall } from "@/types/message";
import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { processAttachmentsForAI } from "@/lib/storage/content";

/**
 * Token-level streaming chunk type
 */
export interface StreamChunk {
  type: "token" | "tool_call" | "tool_result" | "done" | "error";
  content?: string;
  toolCall?: ToolCall;
  toolResult?: { name: string; content: string };
  error?: string;
  messageId?: string;
}

/**
 * Returns an async iterable producing incremental token chunks for streaming.
 * Thread is ensured before streaming.
 */
export async function streamResponse(params: {
  threadId: string;
  userText: string;
  opts?: MessageOptions;
}) {
  const { threadId, userText, opts } = params;
  await ensureThread(threadId, userText);

  // If allowTool is present, use Command with resume action instead of regular inputs
  if (opts?.allowTool) {
    const inputs = new Command({
      resume: {
        action: opts.allowTool === "allow" ? "continue" : "update",
        data: {},
      },
    });

    const agent = await ensureAgent({
      model: opts?.model,
      provider: opts?.provider,
      tools: opts?.tools,
      approveAllTools: opts?.approveAllTools,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iterable = await agent.stream(inputs as any, {
      streamMode: ["messages"],
      configurable: { thread_id: threadId },
    });

    return tokenGenerator(iterable);
  }

  // Build multimodal message with attachments
  let messageContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

  if (opts?.attachments && opts.attachments.length > 0) {
    const attachmentContents = await processAttachmentsForAI(opts.attachments);
    messageContent = [{ type: "text", text: userText }, ...attachmentContents];
  } else {
    messageContent = userText;
  }

  const inputs = {
    messages: [new HumanMessage({ content: messageContent })],
  };

  const agent = await ensureAgent({
    model: opts?.model,
    provider: opts?.provider,
    tools: opts?.tools,
    approveAllTools: opts?.approveAllTools,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iterable = await agent.stream(inputs as any, {
    streamMode: ["messages"],
    configurable: { thread_id: threadId },
  });

  return tokenGenerator(iterable);
}


/**
 * Token-level generator for streaming responses.
 * Handles LangGraph's ["messages", [AIMessageChunk/ToolMessage, metadata]] format.
 *
 * @param iterable - The async iterable from LangGraph agent.stream()
 * @yields StreamChunk objects for each token, tool call, or tool result
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

// Export tokenGenerator for testing purposes
export { tokenGenerator };
