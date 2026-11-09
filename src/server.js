import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import { sendJson } from "./http.js";
import { routeRequest } from "./routes.js";

function corsHeaders(origin) {
  if (!origin) return {};
  if (!config.allowedOrigins.includes(origin)) return null;
  return {
    "Access-Control-Allow-Headers": "content-type,x-request-id",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Max-Age": "3600",
    Vary: "Origin",
  };
}

const server = createServer(async (request, response) => {
  const started = Date.now();
  const requestId = request.headers["x-request-id"] || randomUUID();
  response.setHeader("X-Request-Id", requestId);

  const origin = request.headers.origin;
  const cors = corsHeaders(origin);
  if (cors === null) {
    sendJson(response, 403, { error: "Origin is not allowed.", code: "origin_denied", requestId });
    return;
  }
  Object.entries(cors).forEach(([name, value]) => response.setHeader(name, value));

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  let status = 500;
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    await routeRequest(request, response, url.pathname);
    status = response.statusCode;
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    status = apiError?.status || 500;
    if (!apiError) {
      console.error(JSON.stringify({ level: "error", requestId, error: error.stack || error.message }));
    }
    if (!response.headersSent) {
      sendJson(response, status, {
        error: apiError?.message || "The API could not complete the request.",
        code: apiError?.code || "internal_error",
        ...(apiError?.details ? { details: apiError.details } : {}),
        requestId,
      });
    } else {
      response.destroy();
    }
  } finally {
    console.log(
      JSON.stringify({
        level: "info",
        method: request.method,
        path: request.url,
        requestId,
        status,
        elapsedMs: Date.now() - started,
      }),
    );
  }
});

server.requestTimeout = 130_000;
server.headersTimeout = 135_000;
server.keepAliveTimeout = 5_000;

server.listen(config.port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: `${config.serviceName} listening`,
      port: config.port,
      basePath: config.apiBasePath,
    }),
  );
});

async function shutdown(signal) {
  console.log(JSON.stringify({ level: "info", message: "Shutting down", signal }));
  server.close(async () => {
    try {
      const { disconnectKafka } = await import("./services/kafka.js");
      await disconnectKafka();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
