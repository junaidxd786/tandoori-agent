import OpenAI from "openai";
import { supabaseAdmin } from "./supabase-admin";

export type SemanticMenuMatch = {
  id: string;
  name: string;
  price: number;
  category: string | null;
  description: string | null;
  is_available: boolean;
  similarity: number | null;
};

type MenuRow = {
  id: string;
  branch_id: string;
  name: string;
  price: number | string;
  category: string | null;
  description: string | null;
  is_available: boolean;
};

const DEFAULT_EMBEDDING_MODEL = process.env.MENU_EMBEDDING_MODEL || "text-embedding-3-small";
const DEFAULT_EMBEDDING_BASE_URL =
  process.env.MENU_EMBEDDING_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  "https://api.openai.com/v1";
const DEFAULT_EMBEDDING_API_KEY =
  process.env.MENU_EMBEDDING_API_KEY ||
  process.env.OPENAI_API_KEY ||
  "";

let embeddingClient: OpenAI | null = null;

function getEmbeddingClient(): OpenAI | null {
  if (!DEFAULT_EMBEDDING_API_KEY) return null;
  if (embeddingClient) return embeddingClient;

  embeddingClient = new OpenAI({
    apiKey: DEFAULT_EMBEDDING_API_KEY,
    baseURL: DEFAULT_EMBEDDING_BASE_URL,
  });

  return embeddingClient;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function overlapScore(query: string, candidate: string): number {
  const left = new Set(normalizeText(query).split(" ").filter(Boolean));
  const right = new Set(normalizeText(candidate).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union > 0 ? intersection / union : 0;
}

function buildEmbeddingSource(item: Pick<MenuRow, "name" | "category" | "description">): string {
  return [item.name, item.category, item.description]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" | ");
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

async function createEmbedding(input: string): Promise<number[] | null> {
  const client = getEmbeddingClient();
  if (!client || !input.trim()) return null;

  const response = await client.embeddings.create({
    model: DEFAULT_EMBEDDING_MODEL,
    input,
  });

  const vector = response.data[0]?.embedding;
  return Array.isArray(vector) && vector.length > 0 ? vector : null;
}

function toSemanticMatch(row: Partial<MenuRow> & { id: string; name: string; price: number | string }): SemanticMenuMatch {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    category: row.category ?? null,
    description: row.description ?? null,
    is_available: row.is_available ?? true,
    similarity: "similarity" in row && typeof row.similarity === "number" ? row.similarity : null,
  };
}

function lexicalFallback(queryText: string, rows: MenuRow[], limit: number): SemanticMenuMatch[] {
  return rows
    .map((row) => ({
      ...row,
      similarity: overlapScore(queryText, buildEmbeddingSource(row)),
    }))
    .filter((row) => row.similarity >= 0.2)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, limit)
    .map(toSemanticMatch);
}

export async function syncMenuEmbeddingsForBranch(branchId: string): Promise<void> {
  const client = getEmbeddingClient();
  if (!client) return;

  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("id, branch_id, name, price, category, description, is_available")
    .eq("branch_id", branchId);

  if (error) throw error;

  for (const row of (data ?? []) as MenuRow[]) {
    const source = buildEmbeddingSource(row);
    const embedding = await createEmbedding(source);
    if (!embedding) continue;

    const { error: upsertError } = await supabaseAdmin.from("menu_item_embeddings").upsert(
      {
        menu_item_id: row.id,
        branch_id: row.branch_id,
        embedding_model: DEFAULT_EMBEDDING_MODEL,
        embedding_source: source,
        embedding: toVectorLiteral(embedding),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "menu_item_id" },
    );

    if (upsertError) {
      throw upsertError;
    }
  }
}

export async function getSemanticMenuMatches(
  branchId: string,
  queryText: string,
  limit = 5,
): Promise<SemanticMenuMatch[]> {
  const { data: rows, error: rowError } = await supabaseAdmin
    .from("menu_items")
    .select("id, branch_id, name, price, category, description, is_available")
    .eq("branch_id", branchId)
    .eq("is_available", true);

  if (rowError || !rows) {
    console.error("[semantic-menu] Failed to load menu rows:", rowError);
    return [];
  }

  const menuRows = rows as MenuRow[];
  const embedding = await createEmbedding(queryText).catch((error) => {
    console.error("[semantic-menu] Embedding generation failed:", error);
    return null;
  });

  if (!embedding) {
    return lexicalFallback(queryText, menuRows, limit);
  }

  const { data, error } = await supabaseAdmin.rpc("match_menu_items_by_embedding", {
    branch_uuid: branchId,
    query_embedding: toVectorLiteral(embedding),
    match_count: limit,
    similarity_threshold: 0.52,
  });

  if (error || !Array.isArray(data) || data.length === 0) {
    if (error) {
      console.error("[semantic-menu] Vector lookup failed:", error);
    }
    return lexicalFallback(queryText, menuRows, limit);
  }

  return data.map((row) => toSemanticMatch(row as Partial<MenuRow> & { id: string; name: string; price: number | string }));
}
