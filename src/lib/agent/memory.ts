import { BaseMessage } from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let postgresCheckpointerInstance: PostgresSaver | null = null;

/**
 * Creates a PostgresSaver instance using environment variables
 * @returns PostgresSaver instance
 */
export function createPostgresMemory(): PostgresSaver {
  const connectionString = `${process.env.DATABASE_URL}${
    process.env.DB_SSLMODE ? `?sslmode=${process.env.DB_SSLMODE}` : ""
  }`;
  return PostgresSaver.fromConnString(connectionString);
}

/**
 * Get PostgresSaver instance (lazy initialization).
 * This prevents build-time errors when DATABASE_URL is not set.
 */
export function getPostgresCheckpointer(): PostgresSaver {
  if (postgresCheckpointerInstance) {
    return postgresCheckpointerInstance;
  }
  postgresCheckpointerInstance = createPostgresMemory();
  return postgresCheckpointerInstance;
}

/**
 * Retrieves the message history for a specific thread.
 * @param threadId - The ID of the thread to retrieve history for.
 * @returns An array of messages associated with the thread.
 */
export const getHistory = async (threadId: string): Promise<BaseMessage[]> => {
  const checkpointer = getPostgresCheckpointer();
  const history = await checkpointer.get({
    configurable: { thread_id: threadId },
  });
  return Array.isArray(history?.channel_values?.messages) ? history.channel_values.messages : [];
};

/**
 * @deprecated Use getPostgresCheckpointer() instead for lazy initialization
 */
export const postgresCheckpointer = {
  get instance() {
    return getPostgresCheckpointer();
  },
};
