import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Client } from "pg";

async function embed(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=" + apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    }
  );
  if (!res.ok) throw new Error(`Embedding failed (${res.status})`);
  const json = await res.json();
  return json.embedding.values as number[];
}

async function retrieve(question: string, topK = 3): Promise<string[]> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL");
  const queryEmbedding = await embed(question);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const result = await client.query(
    `SELECT content FROM chunks ORDER BY embedding <=> $1 LIMIT $2`,
    [JSON.stringify(queryEmbedding), topK]
  );
  await client.end();
  return result.rows.map((row) => row.content as string);
}

const server = new McpServer({ name: "resume-search", version: "1.0.0" });

server.tool(
  "search_resume",
  "Search Steven Lee's resume for background relevant to a question. Returns the most relevant excerpts.",
  { query: z.string().describe("The question or topic to search the resume for") },
  async ({ query }) => {
    const chunks = await retrieve(query, 3);
    return {
      content: [{ type: "text" as const, text: chunks.join("\n\n---\n\n") }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("resume-search MCP server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
