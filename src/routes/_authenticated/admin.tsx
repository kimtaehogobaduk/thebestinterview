import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { adminListUsers, adminGetUser } from "@/lib/interview.functions";
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

function AdminPage() {
  const listFn = useServerFn(adminListUsers);
  const detailFn = useServerFn(adminGetUser);
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => listFn(), retry: false });
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["admin-user", selected],
    queryFn: () => detailFn({ data: { user_id: selected! } }),
    enabled: !!selected,
  });

  if (users.isError) {
    return (
      <div className="min-h-screen bg-background p-12 text-foreground">
        <Link to="/dashboard" className="text-sm text-muted-foreground">← 대시보드</Link>
        <h1 className="mt-6 text-2xl font-bold">권한 없음</h1>
        <p className="mt-2 text-muted-foreground">
          관리자 계정만 접근 가능합니다. 관리자 승격은 데이터베이스에서 <code className="rounded bg-secondary px-1">user_roles</code>에 <code className="rounded bg-secondary px-1">role='admin'</code> 레코드를 추가하세요.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <Link to="/dashboard" className="text-sm text-muted-foreground">← 대시보드</Link>
        <span className="text-sm">관리자</span>
      </header>
      <div className="flex">
        <aside className="w-80 border-r border-border p-4">
          <h2 className="text-sm font-semibold">사용자 ({users.data?.length ?? 0})</h2>
          <ul className="mt-3 space-y-1">
            {users.data?.map((u) => (
              <li key={u.id}>
                <button
                  onClick={() => setSelected(u.id)}
                  className={`w-full rounded px-3 py-2 text-left text-sm ${selected === u.id ? "bg-primary/20" : "hover:bg-secondary"}`}
                >
                  <div className="font-medium">{u.display_name ?? u.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {u.email} · {u.target_school ?? "미정"}
                  </div>
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
                    <Link
                      key={s.id}
                      to="/report/$id"
                      params={{ id: s.id }}
                      className="block rounded border border-border bg-card p-3 text-sm hover:border-primary"
                    >
                      <div className="font-medium">{s.target_school}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(s.started_at).toLocaleString("ko-KR")} · {s.status}
                      </div>
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
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                      {d.extracted_text}
                    </pre>
                  </details>
                ))}
              </section>
            </div>
          ) : (
            <p className="text-muted-foreground">사용자를 선택하세요.</p>
          )}
        </main>
      </div>
    </div>
  );
}
