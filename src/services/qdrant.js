import { config } from "../config.js";
import { fetchJson } from "../http.js";

export async function searchJudgmentChunks({ embedding, judgmentIds }) {
  const filter = judgmentIds.length
    ? {
        must: [
          {
            key: "document_id",
            match: { any: judgmentIds },
          },
        ],
      }
    : undefined;

  const payload = await fetchJson(
    `${config.qdrant.url}/collections/${encodeURIComponent(config.qdrant.collection)}/points/query`,
    {
      method: "POST",
      headers: config.qdrant.apiKey ? { "api-key": config.qdrant.apiKey } : {},
      body: JSON.stringify({
        query: embedding,
        filter,
        limit: config.qdrant.limit,
        with_payload: true,
        with_vector: false,
      }),
    },
    config.requestTimeoutMs,
  );

  const points = payload.result?.points || payload.result || [];
  if (!Array.isArray(points)) return [];

  return points.map((point) => ({
    id: point.id,
    score: point.score,
    documentId: point.payload?.document_id,
    chunkId: point.payload?.chunk_id,
    page: point.payload?.page,
    text: point.payload?.text || "",
    judgment: point.payload?.case_name || point.payload?.filename || point.payload?.document_id,
    graphNodeIds: Array.isArray(point.payload?.graph_node_ids)
      ? point.payload.graph_node_ids
      : [],
  }));
}
