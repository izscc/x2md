import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../core/config.ts";
import { extensionToken } from "../core/pairing.ts";
import { handleApiRequest } from "../main/http-server.ts";

const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

function fixture() {
  const appDir = mkdtempSync(join(tmpdir(), "x2md-security-"));
  const token = extensionToken(String(loadConfig(appDir).install_secret));
  return { appDir, token };
}

test("ordinary and null origins cannot use credentials on sensitive routes", async () => {
  const { appDir, token } = fixture();
  for (const origin of ["https://evil.example", "null"]) {
    const response = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
      headers: { Origin: origin, Authorization: `Bearer ${token}` },
    }), { appDir });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
});

test("paired extension receives exact CORS while an unpaired extension is rejected", async () => {
  const { appDir, token } = fixture();
  const denied = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    headers: { Origin: extensionOrigin },
  }), { appDir });
  assert.equal(denied.status, 401);

  const allowed = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    headers: { Origin: extensionOrigin, Authorization: `Bearer ${token}` },
  }), { appDir });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), extensionOrigin);
  assert.equal(allowed.headers.get("Vary"), "Origin");
});

test("localhost-looking origins still require a valid credential", async () => {
  const { appDir, token } = fixture();
  const origin = "http://localhost:9527";
  const forged = await handleApiRequest(new Request("http://127.0.0.1:9527/status", { headers: { Origin: origin } }), { appDir });
  assert.equal(forged.status, 401);
  const debug = await handleApiRequest(new Request("http://127.0.0.1:9527/status", {
    headers: { Origin: origin, Authorization: `Bearer ${token}` },
  }), { appDir });
  assert.equal(debug.status, 200);
  assert.equal(debug.headers.get("Access-Control-Allow-Origin"), origin);
});

test("preflight reflects only allowed origin, method and headers", async () => {
  const { appDir } = fixture();
  const allowed = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "OPTIONS",
    headers: {
      Origin: extensionOrigin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization, content-type",
    },
  }), { appDir });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), extensionOrigin);
  assert.equal(allowed.headers.get("Access-Control-Allow-Headers"), "Authorization, Content-Type, X-X2MD-Token");

  const denied = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "OPTIONS",
    headers: { Origin: extensionOrigin, "Access-Control-Request-Headers": "x-evil" },
  }), { appDir });
  assert.equal(denied.status, 403);
});
