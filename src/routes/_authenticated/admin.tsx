import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { adminListUsers, adminGetUser } from "@/lib/interview.functions";
import {
  listKnowledge,
  ingestKnowledgeText,
  ingestKnowledgeYouTube,
  deleteKnowledge,
} from "@/lib/knowledge.functions";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "관리자 · AI 구술면접" },
      { name: "description", content: "관리자 대시보드." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type Tab = "users" | "knowledge";

function AdminPage() {
  const listFn = useServerFn(adminListUsers);
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => listFn(), retry: false });
  const [tab, setTab] = useState<Tab>("users");

  if (users.isError) {
    return (
      <div className="min-h-screen bg-background p-12 text-foreground">
        <Link to="/dashboard" className="text-sm text-muted-foreground">← 대시보드</Link>
        <h1 className="mt-6 text-2xl font-bold">권한 없음</h1>
        <p className="mt-2 text-muted-foreground">관리자 계정만 접근 가능합니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <Link to="/dashboard" className="text-sm text-muted-foreground">← 대시보드</Link>
        <nav className="flex gap-1 text-sm">
          <TabBtn active={tab === "users"} onClick={() => setTab("users")}>사용자</TabBtn>
          <TabBtn active={tab === "knowledge"} onClick={() => setTab("knowledge")}>AI 학습</TabBtn>
        </nav>
        <span className="text-sm text-muted-foreground">관리자</span>
      </header>
      {tab === "users" ? <UsersTab users={users.data ?? []} /> : <KnowledgeTab />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
    >
      {children}
    </button>
  );
}

function UsersTab({ users }: { users: Array<{ id: string; email: string; display_name: string | null; target_school: string | null }> }) {
  const detailFn = useServerFn(adminGetUser);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["admin-user", selected],
    queryFn: () => detailFn({ data: { user_id: selected! } }),
    enabled: !!selected,
  });
  return (
    <div className="flex">
      <aside className="w-80 border-r border-border p-4">
        <h2 className="text-sm font-semibold">사용자 ({users.length})</h2>
        <ul className="mt-3 space-y-1">
          {users.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => setSelected(u.id)}
                className={`w-full rounded px-3 py-2 text-left text-sm ${selected === u.id ? "bg-primary/20" : "hover:bg-secondary"}`}
              >
                <div className="font-medium">{u.display_name ?? u.email}</div>
                <div className="text-xs text-muted-foreground">{u.email} · {u.target_school ?? "미정"}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="flex-1 p-8">
        {detail.data ? (
          <div>
            <h2 className="text-2xl font-bold">{detail.data.profile?.display_name}</h2>
            <p className="text-muted-foreground">{detail.data.profile?.email}</p>
            <section className="mt-6">
              <h3 className="font-semibold">면접 세션 ({detail.data.sessions.length})</h3>
              <div className="mt-2 space-y-2">
                {detail.data.sessions.map((s) => (
                  <Link key={s.id} to="/report/$id" params={{ id: s.id }} className="block rounded border border-border bg-card p-3 text-sm hover:border-primary">
                    <div className="font-medium">{s.target_school}</div>
                    <div className="text-xs text-muted-foreground">{new Date(s.started_at).toLocaleString("ko-KR")} · {s.status}</div>
                  </Link>
                ))}
              </div>
            </section>
            <section className="mt-6">
              <h3 className="font-semibold">문서</h3>
              {detail.data.documents.map((d) => (
                <details key={d.kind} className="mt-2 rounded border border-border bg-card p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {d.kind === "jaso" ? "자기소개서" : "생활기록부"} ({d.extracted_text.length}자)
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{d.extracted_text}</pre>
                </details>
              ))}
            </section>
          </div>
        ) : (
          <p className="text-muted-foreground">사용자를 선택하세요.</p>
        )}
      </main>
    </div>
  );
}

function KnowledgeTab() {
  const listFn = useServerFn(listKnowledge);
  const ingestTextFn = useServerFn(ingestKnowledgeText);
  const ingestYtFn = useServerFn(ingestKnowledgeYouTube);
  const deleteFn = useServerFn(deleteKnowledge);
  const kb = useQuery({ queryKey: ["knowledge"], queryFn: () => listFn() });

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [ytUrl, setYtUrl] = useState("");
  const [busy, setBusy] = useState<null | "file" | "text" | "yt">(null);
  const [status, setStatus] = useState<string>("");

  async function parseAndIngest(file: File) {
    setBusy("file");
    setStatus(`파싱 중: ${file.name}`);
    try {
      const name = file.name;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      let extracted = "";
      let sourceType: "pdf" | "excel" | "csv" | "text" | "other" = "other";
      if (ext === "pdf") {
        sourceType = "pdf";
        const pdfjs = await import("pdfjs-dist");
        const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        const buf = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const p = await pdf.getPage(i);
          const c = await p.getTextContent();
          extracted += c.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n\n";
        }
      } else if (ext === "xlsx" || ext === "xls") {
        sourceType = "excel";
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        for (const sn of wb.SheetNames) {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
          extracted += `\n=== ${sn} ===\n${csv}\n`;
        }
      } else if (ext === "csv") {
        sourceType = "csv";
        extracted = await file.text();
      } else if (ext === "txt" || ext === "md" || ext === "json") {
        sourceType = "text";
        extracted = await file.text();
      } else {
        throw new Error(`지원하지 않는 파일 형식: .${ext}`);
      }
      if (extracted.trim().length < 20) throw new Error("추출된 텍스트가 너무 짧습니다.");
      setStatus(`임베딩 생성 중... (${extracted.length.toLocaleString()}자)`);
      const res = await ingestTextFn({
        data: {
          title: title.trim() || name,
          source_type: sourceType,
          source_url: null,
          raw_text: extracted,
        },
      });
      setStatus(`✓ 저장 완료 — ${res.chunks}개 청크`);
      setTitle("");
      kb.refetch();
    } catch (e) {
      setStatus(`오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function ingestText() {
    if (!title.trim() || text.trim().length < 20) {
      alert("제목과 20자 이상 본문이 필요합니다.");
      return;
    }
    setBusy("text");
    setStatus("임베딩 생성 중...");
    try {
      const res = await ingestTextFn({
        data: { title, source_type: "text", source_url: null, raw_text: text },
      });
      setStatus(`✓ 저장 완료 — ${res.chunks}개 청크`);
      setTitle("");
      setText("");
      kb.refetch();
    } catch (e) {
      setStatus(`오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function ingestYt() {
    if (!ytUrl.trim()) return;
    setBusy("yt");
    setStatus("YouTube 자막 다운로드 & 임베딩 중...");
    try {
      const res = await ingestYtFn({ data: { url: ytUrl.trim() } });
      setStatus(`✓ "${res.title}" — ${res.chunks}개 청크 저장`);
      setYtUrl("");
      kb.refetch();
    } catch (e) {
      setStatus(`오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    await deleteFn({ data: { id } });
    kb.refetch();
  }

  return (
    <main className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="text-2xl font-bold">AI 학습 지식베이스</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        업로드한 자료는 임베딩 후 저장되며, 사용자의 면접 문항 생성 시 자동으로 검색되어 문항 품질을 높입니다.
      </p>

      <section className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold">파일 업로드 (PDF · Excel · CSV · TXT · MD · JSON)</h2>
        <div className="mt-3 flex flex-col gap-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="자료 제목 (비우면 파일명 사용)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <label className="cursor-pointer rounded-md border border-dashed border-input px-4 py-6 text-center text-sm hover:bg-secondary">
            {busy === "file" ? status : "클릭하여 파일 선택"}
            <input
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,.txt,.md,.json"
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) parseAndIngest(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold">텍스트 직접 입력</h2>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="자료 제목"
          className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="학습시킬 텍스트를 붙여넣으세요 (기출 해설, 면접 기법, 학교 자료 등)"
          className="mt-2 min-h-[200px] w-full resize-y rounded-md border border-input bg-background p-3 text-sm"
        />
        <button
          onClick={ingestText}
          disabled={busy !== null}
          className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy === "text" ? "저장 중..." : "학습시키기"}
        </button>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold">YouTube 링크</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          자막(수동/자동)이 있는 영상만 학습 가능. 한국어 → 영어 → 원본 순으로 자동 선택합니다.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="url"
            value={ytUrl}
            onChange={(e) => setYtUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={ingestYt}
            disabled={busy !== null || !ytUrl.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy === "yt" ? "처리 중..." : "학습시키기"}
          </button>
        </div>
      </section>

      {status && (
        <p className="mt-4 rounded-md bg-secondary px-3 py-2 text-sm">{status}</p>
      )}

      <section className="mt-8">
        <h2 className="font-semibold">저장된 지식 ({kb.data?.length ?? 0})</h2>
        <div className="mt-3 space-y-2">
          {kb.data?.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.title}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="rounded bg-secondary px-1.5 py-0.5">{d.source_type}</span>{" "}
                  · {d.chunk_count}청크 · {new Date(d.created_at).toLocaleString("ko-KR")}
                  {d.source_url && (
                    <>
                      {" · "}
                      <a href={d.source_url} target="_blank" rel="noreferrer" className="underline">
                        원본
                      </a>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => remove(d.id)}
                className="ml-4 rounded-md border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/10"
              >
                삭제
              </button>
            </div>
          ))}
          {kb.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">아직 학습된 자료가 없습니다.</p>
          )}
        </div>
      </section>
    </main>
  );
}
