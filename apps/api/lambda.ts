import { deleteCollection, getWordCache, listCollections, putWordCache, upsertCollections } from "./lib/dynamo";
import { queryDictionary } from "./lib/dictionary";

type HttpEvent = {
  requestContext?: {
    http?: {
      method?: string;
      path?: string;
    };
    stage?: string;
  };
  rawPath?: string;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
};

type HttpResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Content-Type,X-Username",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS"
};

function json(statusCode: number, body: unknown): HttpResponse {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  };
}

function getHeader(headers: Record<string, string | undefined> | undefined, key: string): string | undefined {
  if (!headers) return undefined;
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function getPath(event: HttpEvent): string {
  if (event.rawPath) return event.rawPath;
  return event.requestContext?.http?.path || "";
}

function getMethod(event: HttpEvent): string {
  return (event.requestContext?.http?.method || "GET").toUpperCase();
}

function decodeBody(event: HttpEvent): string {
  if (!event.body) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}

function extractCollectionWord(path: string, fromPathParam?: string): string | undefined {
  if (fromPathParam) return fromPathParam;
  const matched = path.match(/^\/api\/collections\/([^/]+)$/);
  if (!matched) return undefined;
  return decodeURIComponent(matched[1]);
}

export async function handler(event: HttpEvent): Promise<HttpResponse> {
  try {
    const method = getMethod(event);
    const path = getPath(event);

    if (method === "OPTIONS") {
      return { statusCode: 204, headers: JSON_HEADERS, body: "" };
    }

    if (method === "GET" && path === "/api/word") {
      const word = event.queryStringParameters?.word?.trim();
      if (!word) return json(400, { error: "word is required" });
      const cached = await getWordCache(word);
      if (cached) return json(200, cached);
      const data = await queryDictionary(word);
      await putWordCache(word, data);
      return json(200, data);
    }

    if (path === "/api/collections" && method === "GET") {
      const username = getHeader(event.headers, "x-username");
      if (!username) return json(400, { error: "X-Username is required" });
      const items = await listCollections(username);
      return json(200, items);
    }

    if (path === "/api/collections" && method === "POST") {
      const username = getHeader(event.headers, "x-username");
      if (!username) return json(400, { error: "X-Username is required" });
      const parsed = JSON.parse(decodeBody(event) || "{}") as { words?: Array<{ word?: string; data?: unknown; collectedAt?: number }> };
      const words = Array.isArray(parsed.words) ? parsed.words : [];
      const synced = await upsertCollections(
        username,
        words.map((item) => ({
          username,
          word: String(item.word || "").toLowerCase(),
          data: item.data as any,
          collectedAt: Number(item.collectedAt || Date.now())
        }))
      );
      return json(200, synced);
    }

    if (method === "DELETE" && path.startsWith("/api/collections/")) {
      const username = getHeader(event.headers, "x-username");
      if (!username) return json(400, { error: "X-Username is required" });
      const word = extractCollectionWord(path, event.pathParameters?.word);
      if (!word) return json(400, { error: "word is required" });
      await deleteCollection(username, word);
      return json(200, { ok: true });
    }

    return json(404, { error: "Not found" });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "Internal server error" });
  }
}
