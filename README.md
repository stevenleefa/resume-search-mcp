# resume-search-mcp

An MCP server that lets AI assistants search my resume with semantic search. Ask "what did Steven do at NELSON?" and the assistant pulls the relevant resume sections itself instead of guessing.

## How it works

1. The assistant calls the `search_resume` tool with a plain-English query.
2. The server embeds the query with Gemini (`gemini-embedding-001`, 768 dimensions).
3. It runs a nearest-neighbor search against a Postgres table of pre-embedded resume chunks (Neon + pgvector):

   ```sql
   SELECT content FROM chunks ORDER BY embedding <=> $1 LIMIT 3
   ```

4. The matching chunks come back as JSON, and the assistant answers from them.

Resume chunks are embedded once at ingest time. Each question is embedded live, used for the lookup, then thrown away. The server speaks JSON-RPC over stdio — the host (Claude Code, Claude Desktop, the MCP Inspector) spawns it as a subprocess and talks to it through stdin/stdout.

## The tool

**`search_resume`**

| Parameter | Type   | Description                            |
| --------- | ------ | -------------------------------------- |
| `query`   | string | Plain-English question about the resume |

Returns the 3 most similar resume chunks as JSON.

## Prerequisites

- Node.js 18+
- A Postgres database with the `pgvector` extension and a `chunks` table:

  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE TABLE IF NOT EXISTS chunks (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding vector(768)
  );
  ```

  I fill this table with an ingest script from my week1 RAG project — resume split into ~500-character chunks, each embedded with the same model.
- A Gemini API key from Google AI Studio.

## Setup

```bash
yarn install
yarn build
```

The server reads config from its environment. The MCP host passes these in, so there is no `.env` file in this repo:

- `DATABASE_URL` — Postgres connection string
- `GEMINI_API_KEY` — Gemini API key

## Wiring it up

**Claude Code** (user scope = available in every project):

```bash
claude mcp add --scope user resume-search --transport stdio \
  --env DATABASE_URL="your-neon-connection-string" \
  --env GEMINI_API_KEY="your-gemini-key" \
  -- node /path/to/resume-search-mcp/dist/index.js
```

Then `/mcp` lists it, and the assistant calls `search_resume` on its own when a question needs resume facts.

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`, then restart the app:

```json
{
  "mcpServers": {
    "resume-search": {
      "command": "node",
      "args": ["/path/to/resume-search-mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "your-neon-connection-string",
        "GEMINI_API_KEY": "your-gemini-key"
      }
    }
  }
}
```

**MCP Inspector** (manual test, no subscription needed):

```bash
DATABASE_URL="..." GEMINI_API_KEY="..." npx @modelcontextprotocol/inspector node dist/index.js
```

## Project structure

```
src/index.ts   # the whole server: tool definition, embedding, retrieval
tsconfig.json
package.json
```

## Notes

- Diagnostics go to stderr (`console.error`). Anything on stdout corrupts the JSON-RPC stream and kills the host connection.
- The embedding model and the stored vectors must match. Switch models and the chunks table needs a full re-ingest.
- Embeddings do similarity, not reasoning: "where did he work before NELSON?" matches chunks that mention NELSON a lot, not the actual timeline. Known limitation of pure vector search.
