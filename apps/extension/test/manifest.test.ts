import { DEPLOYED_APP_URL } from "@predictx/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../src/manifest";

async function hostPermissions(): Promise<string[]> {
  if (typeof manifest !== "function") throw new Error("src/manifest.ts must stay a function of the Vite env");
  const built = await manifest({ command: "build", mode: "production" });
  return built.host_permissions ?? [];
}

// A blank value counts as unset, so these cases do not depend on the developer's own .env.
function stubExtension(api: string): void {
  vi.stubEnv("VITE_EXTENSION_API_BASE_URL", api);
  vi.stubEnv("VITE_EXTENSION_DASHBOARD_URL", "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("manifest host_permissions", () => {
  it("lets the service worker call the deployed API when nothing is overridden", async () => {
    stubExtension("");
    const permissions = await hostPermissions();
    expect(permissions).toContain(`${DEPLOYED_APP_URL}/*`);
    expect(permissions.filter((p) => /localhost|127\.0\.0\.1/.test(p))).toEqual([]);
  });

  it("ignores the dashboard's localhost VITE_API_BASE_URL (the reported .env)", async () => {
    stubExtension("");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8787/api/v1");
    const permissions = await hostPermissions();
    expect(permissions).toContain(`${DEPLOYED_APP_URL}/*`);
    expect(permissions).not.toContain("http://localhost:8787/*");
  });

  it("follows VITE_EXTENSION_API_BASE_URL for a local-stack build", async () => {
    stubExtension("http://localhost:8787/api/v1");
    const permissions = await hostPermissions();
    expect(permissions).toContain("http://localhost:8787/*");
    expect(permissions).not.toContain(`${DEPLOYED_APP_URL}/*`);
  });

  it("keeps access to x.com and twitter.com", async () => {
    stubExtension("");
    expect(await hostPermissions()).toEqual(expect.arrayContaining(["https://x.com/*", "https://twitter.com/*"]));
  });
});
