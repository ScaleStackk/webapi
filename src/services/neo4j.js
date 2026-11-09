import { config } from "../config.js";
import { fetchJson } from "../http.js";

export async function retrieveGraphEvidence({ judgmentIds, nodeIds }) {
  if (!config.neo4j.password) return [];

  const authorization = Buffer.from(
    `${config.neo4j.username}:${config.neo4j.password}`,
  ).toString("base64");
  const statement = `
    MATCH (n)
    WHERE (size($nodeIds) > 0 AND n.id IN $nodeIds)
       OR (size($judgmentIds) > 0 AND n.document_id IN $judgmentIds)
    OPTIONAL MATCH (n)-[r]-(m)
    RETURN properties(n) AS source,
           CASE WHEN r IS NULL THEN null ELSE coalesce(r.relation, type(r)) END AS relation,
           CASE WHEN m IS NULL THEN null ELSE properties(m) END AS target
    LIMIT $limit
  `;

  const payload = await fetchJson(
    `${config.neo4j.url}/db/${encodeURIComponent(config.neo4j.database)}/tx/commit`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${authorization}` },
      body: JSON.stringify({
        statements: [
          {
            statement,
            parameters: {
              judgmentIds,
              nodeIds,
              limit: config.neo4j.resultLimit,
            },
            resultDataContents: ["row"],
          },
        ],
      }),
    },
    config.requestTimeoutMs,
  );

  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message || "Neo4j query failed.");
  }

  return (payload.results?.[0]?.data || []).map(({ row }) => ({
    source: row?.[0] || {},
    relation: row?.[1] || null,
    target: row?.[2] || null,
  }));
}
