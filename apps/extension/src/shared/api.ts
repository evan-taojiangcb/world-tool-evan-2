import type { RuntimeMessage, RuntimeResponse } from "../types/messages";

export async function sendRuntimeMessage<T = unknown>(message: RuntimeMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error ?? "Unknown runtime error");
  }
  return response.data as T;
}
