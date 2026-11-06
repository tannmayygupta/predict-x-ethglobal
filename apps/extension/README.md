# PredictX Chrome extension (legacy prototype)

**Status:** design prototype carried over from v2.1. It is slated to be replaced by task T-A01 in `docs/TASKS.md`. Prices, wallet, AI and contract calls are not connected.

React + TypeScript UI preview for crypto research, prediction markets, and X cashtag overlays. The side panel opens from Chrome's toolbar action or the Predictx mark on X. The overlay can be hidden in Settings.

## Build

```sh
pnpm install                                  # from the repo root
pnpm --filter predictx-extension build
```

In Chrome, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked** with `apps/extension/dist`. Visit `x.com` to see the floating mark and cashtag cards.

The panel includes a research chat, asset tabs, market list, trade preview, chat history, and extension settings. X share buttons open `https://x.com/intent/tweet` with prefilled text. Prices and analysis are design samples; wallet, market data, AI, and contract calls are not connected.


