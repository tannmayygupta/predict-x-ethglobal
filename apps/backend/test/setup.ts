// X-04: no unit test may reach the network. Any code path that touches real fetch fails loudly.
globalThis.fetch = () => {
  throw new Error("network disabled in tests");
};
