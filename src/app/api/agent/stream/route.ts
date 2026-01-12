import { NextRequest } from "next/server";
import { streamResponse, StreamChunk } from "@/services/agentService";
import type { FileAttachment } from "@/types/message";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE endpoint that streams token-level AI response chunks produced by the LangGraph React agent.
 * 
 * Query params:
 *  - content: user message text
 *  - threadId: conversation thread ID
 *  - model: (optional) model name
 *  - provider: (optional) model provider
 *  - tools: (optional) comma-separated list of enabled tools
 *  - allowTool: (optional) "allow" or "deny" for tool approval
 *  - approveAllTools: (optional) "true" to auto-approve all tools
 *  - attachments: (optional) JSON array of file attachments
 * 
 * SSE Events:
 *  - data: StreamChunk objects (token, tool_call, tool_result, done, error)
 *  - event: done - signals stream completion
 *  - event: error - signals an error occurred
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userContent = searchParams.get("content") || "";
  const threadId = searchParams.get("threadId") || "unknown";
  const model = searchParams.get("model") || undefined;
  const provider = searchParams.get("provider") || undefined;
  const allowTool = searchParams.get("allowTool") as "allow" | "deny" | null;
  const toolsParam = searchParams.get("tools") || "";
  const approveAllTools = searchParams.get("approveAllTools") === "true";
  const attachmentsParam = searchParams.get("attachments") || "";

  const tools = toolsParam
    ? toolsParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

  // Parse attachments from JSON
  let attachments: FileAttachment[] | undefined;
  if (attachmentsParam) {
    try {
      attachments = JSON.parse(attachmentsParam);
    } catch (error) {
      console.error("Failed to parse attachments:", error);
    }
  }

  // Thread existence handled in service.

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Send function for StreamChunk objects
      const send = (data: StreamChunk) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Initial comment to establish stream
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Run the agent streaming in the background
      (async () => {
        try {
          const iterable = await streamResponse({
            threadId,
            userText: userContent,
            opts: {
              model,
              provider,
              tools,
              allowTool: allowTool || undefined,
              approveAllTools,
              attachments,
            },
          });

          // Forward all StreamChunk objects from tokenGenerator
          for await (const chunk of iterable) {
            send(chunk);
          }

          // Signal completion with done chunk and SSE event
          send({ type: "done" });
          controller.enqueue(encoder.encode("event: done\n"));
          controller.enqueue(encoder.encode("data: {}\n\n"));
        } catch (err: unknown) {
          // Send error chunk
          send({
            type: "error",
            error: (err as Error)?.message || "Stream error",
          });
          // Emit an error event
          controller.enqueue(encoder.encode("event: error\n"));
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ message: (err as Error)?.message || "Stream error", threadId })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      })();
    },
    cancel() {
      // If client disconnects, nothing special yet (LangGraph stream will stop as iteration halts)
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
