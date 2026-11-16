import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  config,
  missingQueryConfiguration,
  missingUploadConfiguration,
} from "./config.js";
import { ApiError, assert } from "./errors.js";
import { readJson, sendJson } from "./http.js";
import { embedQuery } from "./services/embedding.js";
import { answerWithEvidence } from "./services/inference.js";
import { retrieveGraphEvidence } from "./services/neo4j.js";
import { searchJudgmentChunks } from "./services/qdrant.js";

const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanFilename(value) {
  const filename = path
    .basename(String(value || ""))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  assert(filename && /\.pdf$/i.test(filename), 400, "invalid_filename", "A PDF filename is required.");
  return filename;
}

function documentIds(value) {
  assert(Array.isArray(value), 400, "invalid_judgment_ids", "judgmentIds must be an array.");
  assert(value.length <= 100, 400, "too_many_judgments", "At most 100 judgment IDs may be queried.");
  return [...new Set(value.map((id) => String(id).trim()).filter(Boolean))];
}

function retrievalOptions(value) {
  if (value === undefined || value === null) return { vector: true, graph: true };
  assert(
    typeof value === "object" && !Array.isArray(value),
    400,
    "invalid_retrieval",
    "retrieval must be an object.",
  );
  for (const name of ["vector", "graph"]) {
    assert(
      typeof value[name] === "boolean",
      400,
      "invalid_retrieval",
      `retrieval.${name} must be a boolean.`,
    );
  }
  const retrieval = { vector: value.vector, graph: value.graph };
  assert(
    retrieval.vector || retrieval.graph,
    400,
    "retrieval_required",
    "Enable vector retrieval, graph retrieval, or both.",
  );
  return retrieval;
}

function uploadReadiness() {
  const missing = missingUploadConfiguration();
  if (missing.length) {
    throw new ApiError(503, "upload_not_configured", "The upload pipeline is not configured.", {
      missing,
    });
  }
}

function queryReadiness(retrieval) {
  const missing = missingQueryConfiguration(retrieval);
  if (missing.length) {
    throw new ApiError(503, "query_not_configured", "The query pipeline is not configured.", {
      missing,
    });
  }
}

async function health(_request, response) {
  sendJson(response, 200, {
    service: config.serviceName,
    status: "ok",
    timestamp: new Date().toISOString(),
    pipelines: {
      upload: missingUploadConfiguration().length ? "not_configured" : "configured",
      query: missingQueryConfiguration().length ? "not_configured" : "configured",
    },
  });
}

async function presignUpload(request, response) {
  uploadReadiness();
  const { createPdfUpload } = await import("./services/s3.js");
  const body = await readJson(request, config.maxJsonBytes);
  const filename = cleanFilename(body.filename);
  const contentType = String(body.contentType || "").toLowerCase();
  const sizeBytes = Number(body.sizeBytes);

  assert(contentType === "application/pdf", 415, "invalid_content_type", "Only PDF uploads are accepted.");
  assert(Number.isInteger(sizeBytes) && sizeBytes > 0, 400, "invalid_size", "sizeBytes must be a positive integer.");
  assert(sizeBytes <= config.s3.maxPdfBytes, 413, "pdf_too_large", `PDFs may not exceed ${config.s3.maxPdfBytes} bytes.`);

  const documentId = randomUUID();
  const authorization = await createPdfUpload({ documentId });
  sendJson(response, 200, {
    documentId,
    filename,
    ...authorization,
  });
}

async function completeUpload(request, response) {
  uploadReadiness();
  const [{ publishJudgmentUploaded }, { inspectUploadedPdf }] = await Promise.all([
    import("./services/kafka.js"),
    import("./services/s3.js"),
  ]);
  const body = await readJson(request, config.maxJsonBytes);
  const documentId = String(body.documentId || "").trim();
  const filename = cleanFilename(body.filename);
  const declaredSize = Number(body.sizeBytes);

  assert(DOCUMENT_ID_PATTERN.test(documentId), 400, "invalid_document_id", "The document ID is invalid.");
  assert(Number.isInteger(declaredSize) && declaredSize > 0, 400, "invalid_size", "sizeBytes must be a positive integer.");

  let stored;
  try {
    stored = await inspectUploadedPdf(documentId);
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
      throw new ApiError(409, "upload_not_found", "The PDF was not found in S3. Upload it before completing the request.");
    }
    throw error;
  }

  assert(stored.contentLength > 0, 409, "empty_upload", "The uploaded S3 object is empty.");
  assert(stored.contentLength <= config.s3.maxPdfBytes, 413, "pdf_too_large", "The uploaded PDF exceeds the configured limit.");
  assert(stored.contentLength === declaredSize, 409, "size_mismatch", "The uploaded S3 object size does not match the declared size.");
  assert(stored.contentType === "application/pdf", 415, "invalid_s3_content_type", "The S3 object is not marked as a PDF.");
  if (body.etag && stored.etag) {
    assert(String(body.etag) === stored.etag, 409, "etag_mismatch", "The uploaded S3 object ETag does not match.");
  }

  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const event = {
    schemaVersion: "1.0",
    eventType: "judgment.uploaded",
    eventId,
    occurredAt,
    document: {
      documentId,
      originalFilename: filename,
      contentType: "application/pdf",
      sizeBytes: stored.contentLength,
    },
    storage: {
      bucket: stored.bucket,
      key: stored.key,
      uri: stored.uri,
      etag: stored.etag,
    },
  };
  await publishJudgmentUploaded(event);

  sendJson(response, 202, {
    id: documentId,
    jobId: eventId,
    name: filename.replace(/\.pdf$/i, ""),
    filename,
    size: stored.contentLength,
    status: "queued",
    addedAt: occurredAt,
    pages: null,
    storage: { key: stored.key },
  });
}

async function queryJudgments(request, response) {
  const body = await readJson(request, config.maxJsonBytes);
  const question = String(body.question || "").trim();
  const judgmentIds = documentIds(body.judgmentIds || []);
  const retrieval = retrievalOptions(body.retrieval);

  assert(question.length >= 2, 400, "question_required", "A question is required.");
  assert(question.length <= 4000, 400, "question_too_long", "The question may not exceed 4000 characters.");
  queryReadiness(retrieval);

  let chunks = [];
  if (retrieval.vector) {
    const embedding = await embedQuery(question);
    chunks = await searchJudgmentChunks({ embedding, judgmentIds });
  }

  let graphEvidence = [];
  if (retrieval.graph) {
    const graphNodeIds = [...new Set(chunks.flatMap((chunk) => chunk.graphNodeIds))];
    const graphJudgmentIds = [
      ...new Set([
        ...judgmentIds,
        ...chunks.map((chunk) => chunk.documentId).filter(Boolean),
      ]),
    ];
    graphEvidence = await retrieveGraphEvidence({
      judgmentIds: graphJudgmentIds,
      nodeIds: graphNodeIds,
      question,
    });
  }

  if (!chunks.length && !graphEvidence.length) {
    sendJson(response, 200, {
      id: randomUUID(),
      answer: "No relevant evidence was found in the selected judgments.",
      sources: [],
      retrieval: {
        modes: retrieval,
        vectorChunks: 0,
        graphRelationships: 0,
      },
    });
    return;
  }

  const generated = await answerWithEvidence({ question, chunks, graphEvidence });

  sendJson(response, 200, {
    id: randomUUID(),
    answer: generated.answer,
    sources: generated.sources,
    retrieval: {
      modes: retrieval,
      vectorChunks: chunks.length,
      graphRelationships: graphEvidence.length,
    },
  });
}

export async function routeRequest(request, response, pathname) {
  const route = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const base = config.apiBasePath;

  if (request.method === "GET" && route === `${base}/health`) return health(request, response);
  if (request.method === "POST" && route === `${base}/uploads/presign`) return presignUpload(request, response);
  if (request.method === "POST" && route === `${base}/judgments`) return completeUpload(request, response);
  if (request.method === "POST" && route === `${base}/query`) return queryJudgments(request, response);

  throw new ApiError(404, "not_found", "API route not found.");
}
