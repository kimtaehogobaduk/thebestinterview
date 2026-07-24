import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMyDocuments, saveDocument } from "@/lib/interview.functions";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/documents")({
  component: DocsPage,
});

function DocsPage() {
  const docsFn = useServerFn(getMyDocuments);
  const saveFn = useServerFn(saveDocument);
  const docs = useQuery({ queryKey: ["documents"], queryFn: () => docsFn() });

  const [jaso, setJaso] = useState("");
  const [saengbu, setSaengbu] = useState("");
  const [parsing, setParsing] = useState<null | "jaso" | "saengbu">(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (docs.data) {
      setJaso(docs.data.find((d) => d.kind === "jaso")?.extracted_text ?? "");
      setSaengbu(docs.data.find((d) => d.kind === "saengbu")?.extracted_text ?? "");
    }
  }, [docs.data]);

  async function parsePdf(file: File, kind: "jaso" | "saengbu") {
    setParsing(kind);
    try {
      const pdfjs = await import("pdfjs-dist");
      // Use bundled worker via URL
      const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      const buf = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n\n";
      }
      // Also upload to storage
      const { data: user } = await supabase.auth.getUser();
      if (user.user) {
        const path = `${user.user.id}/${kind}-${Date.now()}.pdf`;
        await supabase.storage.from("documents").upload(path, file, { upsert: true });
        if (kind === "jaso") setJaso(text);
        else setSaengbu(text);
      }
    } catch (e) {
      alert("PDF 파싱 실패: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setParsing(null);
    }
  }

  async function save(kind: "jaso" | "saengbu") {
    setSaving(true);
    try {
      const text = kind === "jaso" ? jaso : saengbu;
      await saveFn({
        data: {
          kind,
          source: "text",
          storage_path: null,
          extracted_text: text,
        },
      });
      docs.refetch();
      alert("저장되었습니다.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "오류");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-primary" />
          <span className="font-semibold">← 대시보드</span>
        </Link>
      </header>
      <main className="mx-auto max-w-4xl px-8 py-12">
        <h1 className="text-2xl font-bold">자기소개서 · 생활기록부</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          PDF를 업로드하거나 직접 붙여넣으세요. AI가 심층 문항 풀을 구성합니다.
        </p>

        {(["jaso", "saengbu"] as const).map((kind) => {
          const val = kind === "jaso" ? jaso : saengbu;
          const setVal = kind === "jaso" ? setJaso : setSaengbu;
          const label = kind === "jaso" ? "자기소개서" : "생활기록부 (세특 포함)";
          return (
            <section key={kind} className="mt-8 rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{label}</h2>
                <div className="flex items-center gap-3">
                  <label className="cursor-pointer rounded-md border border-input px-3 py-1.5 text-xs hover:bg-secondary">
                    {parsing === kind ? "파싱 중..." : "PDF 업로드"}
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) parsePdf(f, kind);
                      }}
                    />
                  </label>
                  <button
                    onClick={() => save(kind)}
                    disabled={saving || !val.trim()}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    저장
                  </button>
                </div>
              </div>
              <textarea
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder="여기에 직접 입력하거나 PDF를 업로드해 자동 추출하세요."
                className="mt-3 min-h-[280px] w-full resize-y rounded-md border border-input bg-background p-3 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">{val.length.toLocaleString()}자</p>
            </section>
          );
        })}
      </main>
    </div>
  );
}
