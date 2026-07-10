const allowedMethods = new Set(["GET", "POST", "OPTIONS"]);
const allowedHeaders = new Set(["authorization", "content-type", "x-x2md-token"]);

export function isAllowedApiOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;
  if (/^views:\/\/[a-z0-9._~-]+$/i.test(origin)) return true;
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return true;
  return [
    "http://127.0.0.1:9527",
    "http://localhost:9527",
    "http://[::1]:9527",
  ].includes(origin);
}

export function corsHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  const origin = request.headers.get("origin");
  if (origin && isAllowedApiOrigin(request)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function preflightResponse(request: Request): Response {
  const origin = request.headers.get("origin");
  const method = request.headers.get("access-control-request-method") || "OPTIONS";
  const requestedHeaders = (request.headers.get("access-control-request-headers") || "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (!origin || !isAllowedApiOrigin(request) || !allowedMethods.has(method.toUpperCase()) || requestedHeaders.some((header) => !allowedHeaders.has(header))) {
    return new Response("", { status: 403, headers: { Vary: "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-X2MD-Token",
    },
  });
}
