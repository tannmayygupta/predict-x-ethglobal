import { createApiClient, type Transport } from "@predictx/ui";
import { apiBaseUrl } from "../config";
import { API_MESSAGE, type ApiMessage, type ApiReply } from "../messages";

/** Every backend call goes through the service worker (decision D-T5), never from the x.com page context. */
const extensionTransport: Transport = async (request) => {
  const reply = await chrome.runtime.sendMessage<ApiMessage, ApiReply>({ type: API_MESSAGE, request });
  if (!reply || !reply.ok) throw new Error(reply && !reply.ok ? reply.error : "no reply from the extension");
  return reply.response;
};

export const api = createApiClient(apiBaseUrl, extensionTransport);
