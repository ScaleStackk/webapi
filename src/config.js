function text(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function integer(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number.parseInt(text(name, String(fallback)), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boolean(name, fallback = false) {
  const value = text(name, String(fallback)).toLowerCase();
  if (["true", "1", "yes"].includes(value)) return true;
  if (["false", "0", "no"].includes(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function csv(name, fallback = "") {
  return text(name, fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const apiBasePath = `/${text("API_BASE_PATH", "api/v1").replace(/^\/+|\/+$/g, "")}`;

export const config = Object.freeze({
  serviceName: "questacase-webapi",
  port: integer("PORT", 8080, { min: 1, max: 65535 }),
  apiBasePath,
  maxJsonBytes: integer("MAX_JSON_BYTES", 1_048_576, { min: 1024 }),
  requestTimeoutMs: integer("REQUEST_TIMEOUT_MS", 15_000, { min: 1000 }),
  allowedOrigins: csv(
    "API_ALLOWED_ORIGINS",
    "https://questacase.web.app,https://questacase.firebaseapp.com,http://localhost:3000",
  ),
  s3: {
    region: text("AWS_REGION", "ap-south-1"),
    bucket: text("S3_BUCKET"),
    prefix: text("S3_PREFIX", "judgments").replace(/^\/+|\/+$/g, ""),
    endpoint: text("S3_ENDPOINT") || undefined,
    forcePathStyle: boolean("S3_FORCE_PATH_STYLE", false),
    presignSeconds: integer("S3_PRESIGN_SECONDS", 300, { min: 60, max: 900 }),
    encryption: text("S3_SERVER_SIDE_ENCRYPTION", "AES256"),
    kmsKeyId: text("S3_KMS_KEY_ID") || undefined,
    maxPdfBytes: integer("MAX_PDF_BYTES", 52_428_800, { min: 1 }),
  },
  kafka: {
    brokers: csv("KAFKA_BROKERS", "kafka:19092"),
    clientId: text("KAFKA_CLIENT_ID", "questacase-webapi"),
    topic: text("KAFKA_UPLOAD_TOPIC", "judgment.uploaded"),
    ssl: boolean("KAFKA_SSL", false),
    saslMechanism: text("KAFKA_SASL_MECHANISM") || undefined,
    saslUsername: text("KAFKA_SASL_USERNAME") || undefined,
    saslPassword: text("KAFKA_SASL_PASSWORD") || undefined,
  },
  embedding: {
    url: text("EMBEDDING_API_URL"),
    apiKey: text("EMBEDDING_API_KEY") || undefined,
    model: text("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5"),
  },
  qdrant: {
    url: text("QDRANT_URL", "http://qdrant:6333").replace(/\/+$/, ""),
    apiKey: text("QDRANT_API_KEY") || undefined,
    collection: text("QDRANT_COLLECTION", "judgment_chunks"),
    limit: integer("QDRANT_RESULT_LIMIT", 8, { min: 1, max: 50 }),
  },
  neo4j: {
    url: text("NEO4J_URL", "http://neo4j:7474").replace(/\/+$/, ""),
    username: text("NEO4J_USERNAME", "neo4j"),
    password: text("NEO4J_PASSWORD"),
    database: text("NEO4J_DATABASE", "neo4j"),
    resultLimit: integer("NEO4J_RESULT_LIMIT", 30, { min: 1, max: 200 }),
    required: boolean("NEO4J_REQUIRED", false),
  },
  inference: {
    url: text("INFERENCE_API_URL", "http://inference:11434").replace(/\/+$/, ""),
    model: text("INFERENCE_MODEL", "qwen3:4b"),
    apiKey: text("INFERENCE_API_KEY") || undefined,
    numPredict: integer("INFERENCE_NUM_PREDICT", 600, { min: 64, max: 4096 }),
    contextCharacters: integer("MAX_CONTEXT_CHARACTERS", 24_000, {
      min: 2000,
      max: 200_000,
    }),
  },
});

export function missingUploadConfiguration() {
  const missing = [];
  if (!config.s3.bucket) missing.push("S3_BUCKET");
  if (!config.kafka.brokers.length) missing.push("KAFKA_BROKERS");
  return missing;
}

export function missingQueryConfiguration({ vector = true, graph = true } = {}) {
  const missing = [];
  if (vector && !config.embedding.url) missing.push("EMBEDDING_API_URL");
  if (vector && !config.qdrant.url) missing.push("QDRANT_URL");
  if (!config.inference.url) missing.push("INFERENCE_API_URL");
  if (graph && !config.neo4j.password) missing.push("NEO4J_PASSWORD");
  return missing;
}
