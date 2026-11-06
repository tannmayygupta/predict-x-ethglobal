import { apiBaseUrl } from "../config";
import { isApiMessage, type ApiReply } from "../messages";
import { createApiProxy } from "./apiProxy";

const proxy = createApiProxy({ baseUrl: apiBaseUrl, fetchImpl: (input, init) => fetch(input, init) });

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (reply: ApiReply) => void) => {
  // Only this extension's own content scripts may use the gateway.
  if (sender.id !== chrome.runtime.id || !isApiMessage(message)) return false;
  void proxy.handle(message.request).then(sendResponse);
  return true; // the reply is async
});
