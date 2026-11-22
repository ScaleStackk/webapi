import assert from "node:assert/strict";
import { test } from "node:test";

process.env.INFERENCE_URL ||= "http://inference.test";

const { answerWithEvidence } = await import("../src/services/inference.js");

function mockModel(answer) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ answer }) } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

const chunks = [
  { judgment: "State of Rajasthan v. Chatra", page: 3, text: "The child witness was found reliable.", documentId: "docB" },
];
const overruling = {
  cited: { id: "shared:chatra", label: "State of Rajasthan v. Chatra" },
  citing: { id: "shared:later", label: "Later v. Bench", date: "2025-06-01" },
  relation: "OVERRULES",
  evidence: "Chatra (supra) is hereby overruled.",
  page: 7,
  documentId: "docC",
};

test("an overruling of a case in the answer is put first and returned as a warning", async () => {
  const calls = mockModel("Chatra was overruled by Later v. Bench [Source 1].");
  const result = await answerWithEvidence({
    question: "Is a child witness reliable?",
    chunks,
    graphEvidence: [],
    citingEvidence: [overruling],
  });
  const prompt = calls[0].body.messages[1].content;
  assert.match(prompt, /\[Source 1\] OVERRULED WARNING: Later v\. Bench \(2025-06-01\) overruled State of Rajasthan v\. Chatra/);
  assert.equal(result.sources[0].relation, "OVERRULES");
  assert.deepEqual(result.warnings, [
    {
      caseLabel: "State of Rajasthan v. Chatra",
      overruledBy: "Later v. Bench",
      documentId: "docC",
      page: 7,
      evidence: "Chatra (supra) is hereby overruled.",
    },
  ]);
});

test("later treatments other than overruling are ordinary graph evidence", async () => {
  const calls = mockModel("It was followed [Source 2].");
  const result = await answerWithEvidence({
    question: "Is a child witness reliable?",
    chunks,
    graphEvidence: [],
    citingEvidence: [{ ...overruling, relation: "FOLLOWS" }],
  });
  assert.match(calls[0].body.messages[1].content, /Later treatment: Later v\. Bench \(2025-06-01\) followed/);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.sources.length, 2);
});

test("without citing evidence the answer is built as before", async () => {
  const calls = mockModel("Reliable [Source 1].");
  const result = await answerWithEvidence({ question: "Is a child witness reliable?", chunks, graphEvidence: [] });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].kind, "vector");
  assert.deepEqual(result.warnings, []);
  assert.doesNotMatch(calls[0].body.messages[1].content, /OVERRULED|Later treatment/);
});
