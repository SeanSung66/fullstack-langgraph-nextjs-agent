import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MessageOptions, MessageResponse, AIMessageData, ToolMessageData } from "@/types/message";
import type { StreamChunk } from "@/services/agentService";
import { fetchMessageHistory } from "@/services/chatService";

interface UseChatThreadOptions {
  threadId: string | null;
}

export interface UseChatThreadReturn {
  messages: MessageResponse[];
  isLoadingHistory: boolean;
  isSending: boolean;
  historyError: Error | null;
  sendError: Error | null;
  sendMessage: (text: string, opts?: MessageOptions) => Promise<void>;
  refetchMessages: () => Promise<unknown>;
  approveToolExecution: (toolCallId: string, action: "allow" | "deny") => Promise<void>;
}

interface ChatServiceConfig {
  baseUrl?: string;
  endpoints?: {
    stream?: string;
  };
}

const config: ChatServiceConfig = {
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || "/api/agent",
  endpoints: {
    stream: "/stream",
  },
};

function getStreamUrl(): string {
  return `${config.baseUrl}${config.endpoints?.stream || "/stream"}`;
}

export function useChatThread({ threadId }: UseChatThreadOptions): UseChatThreadReturn {
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);
  const accumulatedContentRef = useRef<string>("");
  const [sendError, setSendError] = useState<Error | null>(null);
  const [isSending, setIsSending] = useState(false);

  const {
    data: messages = [],
    isLoading: isLoadingHistory,
    error: historyError,
    refetch: refetchMessagesQuery,
  } = useQuery<MessageResponse[]>({
    queryKey: ["messages", threadId],
    enabled: !!threadId,
    queryFn: () => (threadId ? fetchMessageHistory(threadId) : Promise.resolve([])),
  });

  // Ensure we fetch once the threadId becomes available
  useEffect(() => {
    if (threadId) {
      void refetchMessagesQuery();
    }
  }, [threadId, refetchMessagesQuery]);

  /**
   * Process a single StreamChunk and update React Query cache.
   */
  const processStreamChunk = useCallback(
    (chunk: StreamChunk, threadId: string) => {
      switch (chunk.type) {
        case "token": {
          // Accumulate token content
          accumulatedContentRef.current += chunk.content || "";
          const messageId = chunk.messageId || `ai-${Date.now()}`;

          // Create or update AI message
          if (!currentMessageIdRef.current) {
            currentMessageIdRef.current = messageId;
            // Create new AI message
            const newMessage: MessageResponse = {
              type: "ai",
              data: {
                id: messageId,
                content: accumulatedContentRef.current,
              } as AIMessageData,
            };
            queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => [
              ...old,
              newMessage,
            ]);
          } else {
            // Update existing AI message content
            queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => {
              const idx = old.findIndex(
                (m) => m.type === "ai" && m.data.id === currentMessageIdRef.current,
              );
              if (idx === -1) return old;

              const clone = [...old];
              clone[idx] = {
                ...clone[idx],
                data: {
                  ...clone[idx].data,
                  content: accumulatedContentRef.current,
                } as AIMessageData,
              };
              return clone;
            });
          }
          break;
        }

        case "tool_call": {
          // Update AI message with tool call info
          if (currentMessageIdRef.current && chunk.toolCall) {
            queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => {
              const idx = old.findIndex(
                (m) => m.type === "ai" && m.data.id === currentMessageIdRef.current,
              );
              if (idx === -1) return old;

              const clone = [...old];
              const currentData = clone[idx].data as AIMessageData;
              const existingToolCalls = currentData.tool_calls || [];

              // Check if this tool call already exists (by id)
              const toolCallExists = existingToolCalls.some((tc) => tc.id === chunk.toolCall!.id);
              if (toolCallExists) return old;

              clone[idx] = {
                ...clone[idx],
                data: {
                  ...currentData,
                  tool_calls: [...existingToolCalls, chunk.toolCall!],
                } as AIMessageData,
              };
              return clone;
            });
          }
          break;
        }

        case "tool_result": {
          // Add tool result as a new tool message
          if (chunk.toolResult) {
            const toolMessage: MessageResponse = {
              type: "tool",
              data: {
                id: chunk.messageId || `tool-${Date.now()}`,
                content: chunk.toolResult.content,
                name: chunk.toolResult.name,
                status: "success",
                tool_call_id: chunk.messageId || "",
              } as ToolMessageData,
            };
            queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => [
              ...old,
              toolMessage,
            ]);

            // Reset accumulation for next AI message
            currentMessageIdRef.current = null;
            accumulatedContentRef.current = "";
          }
          break;
        }

        case "done": {
          setIsSending(false);
          currentMessageIdRef.current = null;
          accumulatedContentRef.current = "";
          break;
        }

        case "error": {
          // Surface the error in the chat as a message
          const errorMsg: MessageResponse = {
            type: "error",
            data: {
              id: `err-${Date.now()}`,
              content: `⚠️ ${chunk.error || "An error occurred"}`,
            },
          };
          queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => [
            ...old,
            errorMsg,
          ]);
          setIsSending(false);
          currentMessageIdRef.current = null;
          accumulatedContentRef.current = "";
          break;
        }
      }
    },
    [queryClient],
  );

  /**
   * Handle streaming response using fetch + ReadableStream.
   * Parses SSE data lines and processes StreamChunk objects.
   */
  const handleStreamResponse = useCallback(
    async (streamParams: { threadId: string; text?: string; opts?: MessageOptions }) => {
      const { threadId, text = "", opts } = streamParams;

      setIsSending(true);
      setSendError(null);

      // Abort any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Reset accumulation state
      currentMessageIdRef.current = null;
      accumulatedContentRef.current = "";

      try {
        // Build query params
        const params = new URLSearchParams({ content: text, threadId });
        if (opts?.model) params.set("model", opts.model);
        if (opts?.provider) params.set("provider", opts.provider);
        if (opts?.tools?.length) params.set("tools", opts.tools.join(","));
        if (opts?.allowTool) params.set("allowTool", opts.allowTool);
        if (opts?.approveAllTools !== undefined) {
          params.set("approveAllTools", opts.approveAllTools ? "true" : "false");
        }
        if (opts?.attachments && opts.attachments.length > 0) {
          params.set("attachments", JSON.stringify(opts.attachments));
        }

        const response = await fetch(`${getStreamUrl()}?${params}`, {
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Stream request failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        // Process the stream
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            // Skip empty lines and comments
            if (!line || line.startsWith(":")) continue;

            // Parse SSE data lines
            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6);
              if (!jsonStr || jsonStr === "{}") continue;

              try {
                const chunk = JSON.parse(jsonStr) as StreamChunk;
                processStreamChunk(chunk, threadId);
              } catch {
                // Ignore malformed JSON
              }
            }

            // Handle SSE events
            if (line.startsWith("event: done")) {
              setIsSending(false);
              currentMessageIdRef.current = null;
              accumulatedContentRef.current = "";
            }

            if (line.startsWith("event: error")) {
              setIsSending(false);
              currentMessageIdRef.current = null;
              accumulatedContentRef.current = "";
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") {
          // Stream was intentionally aborted
          return;
        }
        setSendError(err as Error);
        setIsSending(false);
        currentMessageIdRef.current = null;
        accumulatedContentRef.current = "";
      }
    },
    [processStreamChunk],
  );

  const sendMessage = useCallback(
    async (text: string, opts?: MessageOptions) => {
      // Guard: require a thread to target
      if (!threadId) return;

      // Optimistic UI: append the user's message immediately
      const tempId = `temp-${Date.now()}`;
      const userMessage: MessageResponse = {
        type: "human",
        data: {
          id: tempId,
          content: text,
          attachments: opts?.attachments,
        },
      };
      queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => [
        ...old,
        userMessage,
      ]);

      // Handle the streaming response
      await handleStreamResponse({ threadId, text, opts });
    },
    [threadId, queryClient, handleStreamResponse],
  );

  const approveToolExecution = useCallback(
    async (_toolCallId: string, action: "allow" | "deny") => {
      if (!threadId) return;

      // Handle the streaming response with allowTool parameter
      await handleStreamResponse({
        threadId,
        text: "",
        opts: { allowTool: action },
      });
    },
    [threadId, handleStreamResponse],
  );

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    },
    [],
  );

  return {
    messages,
    isLoadingHistory,
    isSending,
    historyError: historyError as Error | null,
    sendError,
    sendMessage,
    refetchMessages: refetchMessagesQuery,
    approveToolExecution,
  };
}
