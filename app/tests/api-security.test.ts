import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../core/config.ts";
import { extensionToken, issueAppSession, revokeAppSession } from "../core/pairing.ts";
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

test("opaque native settings origin can use an app session without admitting extension credentials", async () => {
  const { appDir } = fixture();
  const session = issueAppSession();
  try {
    const preflight = await handleApiRequest(new Request("http://127.0.0.1:9527/choose-folder", {
      method: "OPTIONS",
      headers: {
        Origin: "null",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    }), { appDir });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "null");

    const config = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
      headers: { Origin: "null", Authorization: `Bearer ${session}` },
    }), { appDir });
    assert.equal(config.status, 200);
    assert.equal(config.headers.get("Access-Control-Allow-Origin"), "null");

    const extensionCredential = extensionToken(String(loadConfig(appDir).install_secret));
    const rejectedExtension = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
      headers: { Origin: "null", Authorization: `Bearer ${extensionCredential}` },
    }), { appDir });
    assert.equal(rejectedExtension.status, 403);
    assert.equal(rejectedExtension.headers.get("Access-Control-Allow-Origin"), null);

    const chooseFolder = await handleApiRequest(new Request("http://127.0.0.1:9527/choose-folder", {
      method: "POST",
      headers: {
        Origin: "null",
        Authorization: `Bearer ${session}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPath: appDir }),
    }), { appDir, dialogDryRun: true });
    assert.equal(chooseFolder.status, 200);
    assert.equal(chooseFolder.headers.get("Access-Control-Allow-Origin"), "null");
    assert.equal((await chooseFolder.json()).path, appDir);
  } finally {
    revokeAppSession(session);
  }
});
