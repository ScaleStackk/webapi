import { config } from "../config.js";
import { fetchJson } from "../http.js";

export async function embedQuery(text) {
  const payload = await fetchJson(
    config.embedding.url,
    {
      method: "POST",
      headers: config.embedding.apiKey
        ? { Authorization: `Bearer ${config.embedding.apiKey}` }
        : {},
      body: JSON.stringify({ model: config.embedding.model, text }),
    },
    config.requestTimeoutMs,
  );

  const embedding = payload.embedding || payload.vector || payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || !embedding.length) {
    throw new Error("The embedding service returned no query vector.");
  }
  return embedding;
}
