import { config } from "../config.js";
import { fetchJson } from "../http.js";

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "and", "are", "because", "been",
  "before", "being", "between", "court", "did", "does", "from", "have",
  "into", "judgment", "judgments", "legal", "that", "the", "their", "this",
  "through", "what", "when", "where", "which", "with", "would",
]);

function questionTerms(question) {
  return [...new Set(
    String(question || "")
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g)
      ?.filter((term) => !STOP_WORDS.has(term)) || [],
  )].slice(0, 16);
}

function preferredNodeTypes(terms) {
  const values = new Set();
  const includes = (...candidates) => candidates.some((candidate) => terms.includes(candidate));
  if (includes("hold", "holding", "held", "decision", "decided", "conclusion")) {
    values.add("HOLDING");
    values.add("OUTCOME");
  }
  if (includes("reason", "reasoning", "rule", "principle")) values.add("LEGAL_RULE");
  if (includes("fact", "facts", "factual")) values.add("FACT");
  if (includes("issue", "issues", "question")) values.add("ISSUE");
  if (includes("precedent", "precedents", "authority", "authorities", "cited", "case")) {
    values.add("CASE");
    values.add("LEGAL_RULE");
  }
  if (includes("statute", "statutes", "section", "sections", "act", "article")) {
    values.add("STATUTE");
    values.add("SECTION");
  }
  if (includes("judge", "judges", "bench", "author")) values.add("JUDGE");
  return [...values];
}

export async function retrieveGraphEvidence({ judgmentIds, nodeIds, question = "" }) {
  if (!config.neo4j.password) return [];

  const terms = questionTerms(question);
  const preferredTypes = preferredNodeTypes(terms);

  const authorization = Buffer.from(
    `${config.neo4j.username}:${config.neo4j.password}`,
  ).toString("base64");
  const statement = `
    MATCH (n:GraphNode)
    WHERE size($judgmentIds) = 0 OR n.document_id IN $judgmentIds
    WITH n,
         reduce(score = 0, term IN $terms |
           score + CASE WHEN toLower(
             coalesce(n.label, '') + ' ' +
             coalesce(n.name, '') + ' ' +
             coalesce(n.evidence, '') + ' ' +
             coalesce(n.description, '')
           ) CONTAINS term THEN 1 ELSE 0 END
         ) + CASE WHEN n.type IN $preferredTypes THEN 3 ELSE 0 END AS relevance
    WHERE (size($nodeIds) > 0 AND n.id IN $nodeIds)
       OR relevance > 0
       OR (size($terms) = 0 AND size($judgmentIds) > 0)
    OPTIONAL MATCH (n)-[r]-(m)
    RETURN properties(n) AS source,
           CASE WHEN r IS NULL THEN null ELSE coalesce(r.relation, type(r)) END AS relation,
           CASE WHEN m IS NULL THEN null ELSE properties(m) END AS target,
           relevance
    ORDER BY relevance DESC, coalesce(n.page, 0)
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
              terms,
              preferredTypes,
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
    score: row?.[3] || 0,
  }));
}
