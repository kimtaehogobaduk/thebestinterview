// Server-only helpers for AI knowledge ingestion (chunking, embedding, YouTube transcripts).

const GATEWAY_EMBEDDINGS = "https://ai.gateway.lovable.dev/v1/embeddings";
const EMBED_MODEL = "google/gemini-embedding-2";
export const EMBED_DIM = 3072;

/** Chunk text into ~1000-char pieces with soft sentence boundaries + 150-char overlap. */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const lastPunct = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("。"),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("\n"),
      );
      if (lastPunct > size * 0.5) end = i + lastPunct + 1;
    }
    chunks.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks.filter((c) => c.length > 20);
}

/** Embed batch of strings via Lovable AI Gateway. Batches of ≤100 per request. */
export async function embedTexts(inputs: string[]): Promise<number[][]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += 100) {
    const batch = inputs.slice(i, i + 100);
    const res = await fetch(GATEWAY_EMBEDDINGS, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: batch }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Embed ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = (await res.json()) as { data?: Array<{ embedding: number[]; index: number }> };
    const rows = (data.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
    out.push(...rows);
  }
  return out;
}

/** Format a JS number array as a pgvector literal string for postgrest insert. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.map((v) => (Number.isFinite(v) ? v : 0)).join(",")}]`;
}

/** Extract YouTube video id from various URL formats. */
export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/** Fetch YouTube video title + best available caption transcript (ko > en > first). */
export async function fetchYouTubeTranscript(
  url: string,
): Promise<{ title: string; text: string; videoId: string }> {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error("유효한 YouTube URL이 아닙니다.");
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ko`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": "ko,en;q=0.9",
    },
  });
  if (!pageRes.ok) throw new Error(`YouTube 페이지 요청 실패 (${pageRes.status})`);
  const html = await pageRes.text();

  const titleMatch =
    html.match(/<meta name="title" content="([^"]+)"/) ||
    html.match(/<title>([^<]+)<\/title>/);
  const title = (titleMatch?.[1] ?? videoId).replace(/ - YouTube$/, "").trim();

  const capMatch = html.match(/"captionTracks":(\[[^\]]+\])/);
  if (!capMatch) throw new Error("이 영상에는 자막이 없습니다. 텍스트로 직접 붙여넣어 주세요.");
  let tracks: Array<{ baseUrl: string; languageCode: string; kind?: string }> = [];
  try {
    tracks = JSON.parse(capMatch[1].replace(/\\u0026/g, "&"));
  } catch {
    throw new Error("자막 목록 파싱 실패");
  }
  if (tracks.length === 0) throw new Error("자막 트랙 없음");

  const track =
    tracks.find((t) => t.languageCode === "ko") ||
    tracks.find((t) => t.languageCode === "en") ||
    tracks[0];

  const capRes = await fetch(track.baseUrl);
  if (!capRes.ok) throw new Error(`자막 다운로드 실패 (${capRes.status})`);
  const xml = await capRes.text();
  const text = xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 50) throw new Error("추출된 자막이 너무 짧습니다.");
  return { title, text, videoId };
}
