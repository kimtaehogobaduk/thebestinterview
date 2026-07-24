import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const sourceTypeSchema = z.enum(["pdf", "excel", "csv", "text", "youtube", "other"]);

async function assertAdmin(context: {
  supabase: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }> };
  userId: string;
}) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("관리자만 접근 가능합니다.");
}

/** Ingest raw text (extracted client-side from PDF/Excel/CSV or pasted). */
export const ingestKnowledgeText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        title: z.string().min(1).max(300),
        source_type: sourceTypeSchema,
        source_url: z.string().max(1000).nullable().optional(),
        raw_text: z.string().min(20).max(2_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { chunkText, embedTexts, toVectorLiteral } = await import("@/lib/knowledge.server");
    const chunks = chunkText(data.raw_text);
    if (chunks.length === 0) throw new Error("유효한 텍스트가 없습니다.");

    const { data: doc, error: docErr } = await context.supabase
      .from("knowledge_documents")
      .insert({
        admin_id: context.userId,
        title: data.title,
        source_type: data.source_type,
        source_url: data.source_url ?? null,
        raw_text: data.raw_text.slice(0, 500_000),
        chunk_count: chunks.length,
        metadata: {},
      })
      .select("id")
      .single();
    if (docErr || !doc) throw new Error(docErr?.message ?? "문서 저장 실패");

    const vectors = await embedTexts(chunks);
    const rows = chunks.map((content, idx) => ({
      document_id: doc.id,
      chunk_index: idx,
      content,
      embedding: toVectorLiteral(vectors[idx]),
      metadata: {},
    }));

    // Insert chunks in batches of 50 to keep payload sane.
    for (let i = 0; i < rows.length; i += 50) {
      const slice = rows.slice(i, i + 50);
      const { error } = await context.supabase.from("knowledge_chunks").insert(slice);
      if (error) {
        // Attempt cleanup and surface error.
        await context.supabase.from("knowledge_documents").delete().eq("id", doc.id);
        throw new Error(`청크 저장 실패: ${error.message}`);
      }
    }
    return { id: doc.id, chunks: chunks.length };
  });

/** Ingest a YouTube URL — server-side fetches transcript and embeds. */
export const ingestKnowledgeYouTube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ url: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { fetchYouTubeTranscript } = await import("@/lib/knowledge.server");
    const { title, text, videoId } = await fetchYouTubeTranscript(data.url);
    const { chunkText, embedTexts, toVectorLiteral } = await import("@/lib/knowledge.server");
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error("자막에서 유효한 텍스트를 추출하지 못했습니다.");

    const { data: doc, error: docErr } = await context.supabase
      .from("knowledge_documents")
      .insert({
        admin_id: context.userId,
        title,
        source_type: "youtube",
        source_url: `https://www.youtube.com/watch?v=${videoId}`,
        raw_text: text.slice(0, 500_000),
        chunk_count: chunks.length,
        metadata: { video_id: videoId },
      })
      .select("id")
      .single();
    if (docErr || !doc) throw new Error(docErr?.message ?? "문서 저장 실패");

    const vectors = await embedTexts(chunks);
    const rows = chunks.map((content, idx) => ({
      document_id: doc.id,
      chunk_index: idx,
      content,
      embedding: toVectorLiteral(vectors[idx]),
      metadata: {},
    }));
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await context.supabase.from("knowledge_chunks").insert(rows.slice(i, i + 50));
      if (error) {
        await context.supabase.from("knowledge_documents").delete().eq("id", doc.id);
        throw new Error(`청크 저장 실패: ${error.message}`);
      }
    }
    return { id: doc.id, title, chunks: chunks.length };
  });

export const listKnowledge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("knowledge_documents")
      .select("id, title, source_type, source_url, chunk_count, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("knowledge_documents")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Retrieve top-k knowledge context for a query. Callable by any authenticated user (used during question gen). */
export async function retrieveKnowledgeContext(
  supabase: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: Array<{ content: string; similarity: number }> | null; error: unknown }>;
  },
  query: string,
  k = 4,
): Promise<string[]> {
  if (!query.trim()) return [];
  try {
    const { embedTexts, toVectorLiteral } = await import("@/lib/knowledge.server");
    const [vec] = await embedTexts([query]);
    const { data } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: toVectorLiteral(vec),
      match_count: k,
    });
    return (data ?? [])
      .filter((r) => r.similarity > 0.35)
      .map((r) => r.content);
  } catch (e) {
    console.warn("[knowledge] retrieval failed", e);
    return [];
  }
}
