import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const startSessionSchema = z.object({
  mode: z.enum(["full", "pressure"]),
  target_school: z.string().min(1),
  school_type: z.string().optional(),
  per_question_time_sec: z.number().int().min(30).max(600).nullable(),
  time_limit_enabled: z.boolean(),
});

export const analyzeSchool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ school: z.string().min(1), school_type: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { groqChat, safeParseJson } = await import("@/lib/ai.server");
    const sys = `당신은 한국의 특목고·자사고 입시 전문가입니다. 사용자가 제공한 학교명을 기반으로 그 학교의 구술면접 스타일, 기출 성향, 선호 인재상, 자주 나오는 질문 유형을 JSON으로만 답하세요.
스키마: {"school_full_name": string, "type": "과학고|영재학교|자사고|외고|국제고|기타", "interview_style": string, "preferred_talents": string[], "past_question_patterns": string[], "focus_subjects": string[], "notes": string}`;
    const txt = await groqChat(
      [
        { role: "system", content: sys },
        { role: "user", content: `학교명: ${data.school}\n유형힌트: ${data.school_type ?? "미지정"}` },
      ],
      { json: true, temperature: 0.3 },
    );
    return safeParseJson(txt) ?? { school_full_name: data.school, notes: txt.slice(0, 500) };
  });

export const startSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => startSessionSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: analysis } = await context.supabase
      .from("interview_sessions")
      .insert({
        user_id: context.userId,
        mode: data.mode,
        target_school: data.target_school,
        school_type: data.school_type ?? null,
        per_question_time_sec: data.per_question_time_sec,
        time_limit_enabled: data.time_limit_enabled,
      })
      .select("id")
      .single();
    if (!analysis) throw new Error("세션 생성 실패");
    return { id: analysis.id };
  });

export const endSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ session_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("interview_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", data.session_id)
      .eq("user_id", context.userId);
    return { ok: true };
  });

export const saveAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        session_id: z.string().uuid(),
        question_id: z.string().uuid(),
        transcript: z.string(),
        duration_sec: z.number().int().min(0).max(3600),
        silence_events: z.number().int().min(0).default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await context.supabase.from("interview_answers").insert({
      session_id: data.session_id,
      question_id: data.question_id,
      transcript: data.transcript,
      duration_sec: data.duration_sec,
      silence_events: data.silence_events,
    });
    return { ok: true };
  });

/**
 * Generate next question. Fans out 3 Cerebras keys, one prompt per interviewer,
 * chooses one based on rotation + logic-gap heuristic.
 */
export const generateNextQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ session_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { cerebrasChat, safeParseJson } = await import("@/lib/ai.server");
    const sb = context.supabase;

    const { data: session } = await sb
      .from("interview_sessions")
      .select("*")
      .eq("id", data.session_id)
      .single();
    if (!session) throw new Error("세션 없음");

    const { data: docs } = await sb
      .from("documents")
      .select("kind, extracted_text")
      .eq("user_id", context.userId);

    const jaso = docs?.find((d) => d.kind === "jaso")?.extracted_text ?? "";
    const saengbu = docs?.find((d) => d.kind === "saengbu")?.extracted_text ?? "";

    const { data: prev } = await sb
      .from("interview_questions")
      .select("id, interviewer, question_text, order_idx")
      .eq("session_id", data.session_id)
      .order("order_idx", { ascending: true });

    const prevQuestions = prev ?? [];
    const { data: prevAnswers } = await sb
      .from("interview_answers")
      .select("question_id, transcript, duration_sec")
      .eq("session_id", data.session_id);

    const answerMap = new Map(prevAnswers?.map((a) => [a.question_id, a]) ?? []);
    const lastQ = prevQuestions[prevQuestions.length - 1];
    const lastA = lastQ ? answerMap.get(lastQ.id) : null;

    // Rotation: alternate A/B/C but allow follow-up from same interviewer if logic gap.
    const rotation: Array<"A" | "B" | "C"> = ["A", "B", "C"];
    let nextInterviewer = rotation[prevQuestions.length % 3];
    let isFollowup = false;

    if (lastA && lastQ && lastA.transcript.length > 20) {
      // Heuristic logic-gap: short/rambling/silence-heavy → follow-up
      const isShort = lastA.transcript.length < 60;
      const isRambling =
        (lastA.duration_sec ?? 0) > 40 && lastA.transcript.length / (lastA.duration_sec || 1) < 2;
      if ((isShort || isRambling) && Math.random() < 0.55) {
        nextInterviewer = lastQ.interviewer as "A" | "B" | "C";
        isFollowup = true;
      }
    }

    const interviewerSpec: Record<string, { name: string; role: string; focus: string }> = {
      A: {
        name: "면접관 A (전공 역량 평가자)",
        role: "학업·수과학·인문 탐구 심층 검증",
        focus: "자기소개서/생기부의 탐구 활동·세특·수상 경력을 기반으로 개념 깊이와 사고 과정을 검증한다.",
      },
      B: {
        name: "면접관 B (논리 구조 평가자)",
        role: "답변의 유기적 구조·요약력·논리 허점 검증 및 동적 꼬리질문",
        focus: "직전 답변의 논리 흐름, 근거 결여, 전제의 오류를 정밀하게 파고든다.",
      },
      C: {
        name: "면접관 C (인성·태도 평가자)",
        role: "지원 동기, 발화 전달력, 압박 상황 정서 반응",
        focus: "왜 이 학교인가, 학교와의 fit, 협업·자기주도 사례, 인성 관련 판단을 묻는다.",
      },
    };

    const spec = interviewerSpec[nextInterviewer];
    const askedList = prevQuestions.map((q, i) => `${i + 1}. [${q.interviewer}] ${q.question_text}`).join("\n") || "(없음)";
    const schoolAnalysis = JSON.stringify(session.school_analysis ?? {});

    const { retrieveKnowledgeContext } = await import("@/lib/knowledge.server");
    const knowledgeQuery = `${session.target_school} ${session.school_type ?? ""} ${lastQ?.question_text ?? ""} ${jaso.slice(0, 400)}`;
    const knowledgeChunks = await retrieveKnowledgeContext(sb, knowledgeQuery, 4);
    const knowledgeBlock = knowledgeChunks.length
      ? `\n\n[관리자 학습 지식베이스 발췌 — 문항 설계 시 참고]:\n${knowledgeChunks.map((c, i) => `(${i + 1}) ${c}`).join("\n")}`
      : "";

    const sys = `당신은 대한민국 최상위권 특목고·자사고의 엄격하고 정밀한 입학사정관이자 ${spec.name}입니다.
역할: ${spec.role}
집중: ${spec.focus}

지원자 자기소개서 요약:
${jaso.slice(0, 3500) || "(없음)"}

지원자 생활기록부 요약:
${saengbu.slice(0, 3500) || "(없음)"}

지원 학교(${session.target_school}) 분석:
${schoolAnalysis}${knowledgeBlock}

이미 출제된 질문 (절대 중복 금지, 완전히 새 축으로):
${askedList}

${
  isFollowup && lastQ && lastA
    ? `직전 질문: ${lastQ.question_text}\n지원자 답변: ${lastA.transcript}\n답변의 논리적 허점·근거 미비·전제 오류를 파고드는 꼬리질문을 만드세요.`
    : "자기소개서·생기부의 새로운 축, 또는 지원 학교 분석 기반의 새 질문을 만드세요."
}

응답은 반드시 JSON으로만: {"question": string(한국어, 한 문장, 정중하지만 압박감), "keywords": string[](채점 시 사각사각 SFX 트리거용 핵심 키워드 3~5개)}`;

    const raw = await cerebrasChat(
      { A: 0, B: 1, C: 2 }[nextInterviewer] as 0 | 1 | 2,
      [
        { role: "system", content: sys },
        { role: "user", content: "다음 질문을 출제하세요." },
      ],
      { temperature: 0.9, max_tokens: 500, json: true },
    );

    const parsed = safeParseJson<{ question: string; keywords: string[] }>(raw);
    const questionText =
      parsed?.question?.trim() ||
      raw.replace(/^["'\s]+|["'\s]+$/g, "").split("\n")[0] ||
      "지원 동기를 한 문장으로 말씀해 주시겠어요?";
    const keywords = parsed?.keywords ?? [];

    const { data: inserted, error } = await sb
      .from("interview_questions")
      .insert({
        session_id: data.session_id,
        interviewer: nextInterviewer,
        question_text: questionText,
        keywords,
        order_idx: prevQuestions.length,
        is_followup: isFollowup,
      })
      .select("id, question_text, interviewer, keywords, is_followup, order_idx")
      .single();

    if (error || !inserted) throw new Error(error?.message ?? "질문 저장 실패");
    return inserted;
  });

export const generateReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ session_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { cerebrasChat, safeParseJson } = await import("@/lib/ai.server");
    const sb = context.supabase;

    const { data: session } = await sb
      .from("interview_sessions")
      .select("*")
      .eq("id", data.session_id)
      .single();
    if (!session) throw new Error("세션 없음");

    const { data: qs } = await sb
      .from("interview_questions")
      .select("id, interviewer, question_text, order_idx, is_followup")
      .eq("session_id", data.session_id)
      .order("order_idx");
    const { data: ans } = await sb
      .from("interview_answers")
      .select("question_id, transcript, duration_sec, silence_events")
      .eq("session_id", data.session_id);

    const map = new Map(ans?.map((a) => [a.question_id, a]) ?? []);
    const transcript = (qs ?? [])
      .map((q, i) => {
        const a = map.get(q.id);
        return `[Q${i + 1} ${q.interviewer}${q.is_followup ? " 꼬리" : ""}] ${q.question_text}\n[A] ${a?.transcript ?? "(무응답)"}${a ? `  (${a.duration_sec}s, 정적${a.silence_events}회)` : ""}`;
      })
      .join("\n\n");

    const sys = `당신은 대한민국 최상위 특목고/자사고의 AI 수석 입학사정관입니다. 아래 면접 세션 전체를 분석하여 JSON으로만 답하세요.
스키마: {
  "summary": string(3~5문장 종합평),
  "fit_score": 0~100,
  "logic_score": 0~100,
  "attitude_score": 0~100,
  "strengths": string[3],
  "weaknesses": string[3],
  "interviewer_A": string, "interviewer_B": string, "interviewer_C": string,
  "action_items": string[3]
}`;
    const raw = await cerebrasChat(
      0,
      [
        { role: "system", content: sys },
        {
          role: "user",
          content: `지원 학교: ${session.target_school}\n모드: ${session.mode}\n\n=== 면접 기록 ===\n${transcript}`,
        },
      ],
      { temperature: 0.4, max_tokens: 2000, json: true },
    );
    const parsed = safeParseJson<{
      summary: string;
      fit_score: number;
      logic_score: number;
      attitude_score: number;
      strengths: string[];
      weaknesses: string[];
      action_items: string[];
    }>(raw) ?? {
      summary: raw.slice(0, 600),
      fit_score: 0,
      logic_score: 0,
      attitude_score: 0,
      strengths: [],
      weaknesses: [],
      action_items: [],
    };

    await sb.from("interview_reports").upsert(
      {
        session_id: data.session_id,
        summary: parsed.summary,
        fit_score: parsed.fit_score,
        logic_score: parsed.logic_score,
        attitude_score: parsed.attitude_score,
        strengths: parsed.strengths,
        weaknesses: parsed.weaknesses,
        full_json: parsed as never,
      },
      { onConflict: "session_id" },
    );
    return parsed;
  });

export const getSessionDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ session_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: session } = await sb
      .from("interview_sessions")
      .select("*")
      .eq("id", data.session_id)
      .single();
    const { data: qs } = await sb
      .from("interview_questions")
      .select("*")
      .eq("session_id", data.session_id)
      .order("order_idx");
    const { data: ans } = await sb
      .from("interview_answers")
      .select("*")
      .eq("session_id", data.session_id);
    const { data: report } = await sb
      .from("interview_reports")
      .select("*")
      .eq("session_id", data.session_id)
      .maybeSingle();
    return { session, questions: qs ?? [], answers: ans ?? [], report };
  });

export const listMySessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("interview_sessions")
      .select("id, mode, target_school, status, started_at, ended_at")
      .eq("user_id", context.userId)
      .order("started_at", { ascending: false })
      .limit(50);
    return data ?? [];
  });

export const saveDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: z.enum(["jaso", "saengbu"]),
        source: z.enum(["pdf", "text"]),
        storage_path: z.string().nullable(),
        extracted_text: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // upsert: one per kind per user
    const { data: existing } = await context.supabase
      .from("documents")
      .select("id")
      .eq("user_id", context.userId)
      .eq("kind", data.kind)
      .maybeSingle();
    if (existing) {
      await context.supabase
        .from("documents")
        .update({
          source: data.source,
          storage_path: data.storage_path,
          extracted_text: data.extracted_text,
        })
        .eq("id", existing.id);
      return { id: existing.id };
    }
    const { data: ins } = await context.supabase
      .from("documents")
      .insert({
        user_id: context.userId,
        kind: data.kind,
        source: data.source,
        storage_path: data.storage_path,
        extracted_text: data.extracted_text,
      })
      .select("id")
      .single();
    return { id: ins!.id };
  });

export const getMyDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("documents")
      .select("kind, source, extracted_text, updated_at")
      .eq("user_id", context.userId);
    return data ?? [];
  });

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        display_name: z.string().max(100).optional(),
        target_school: z.string().max(100).optional(),
        school_type: z.string().max(50).optional(),
        avatar_config: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: Record<string, unknown> = {};
    if (data.display_name !== undefined) payload.display_name = data.display_name;
    if (data.target_school !== undefined) payload.target_school = data.target_school;
    if (data.school_type !== undefined) payload.school_type = data.school_type;
    if (data.avatar_config !== undefined) payload.avatar_config = data.avatar_config;
    await context.supabase.from("profiles").update(payload as never).eq("id", context.userId);
    return { ok: true };
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .single();
    return data;
  });

// Admin
export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("권한 없음");
    const { data } = await context.supabase
      .from("profiles")
      .select("id, email, display_name, target_school, school_type, created_at")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

export const adminGetUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("권한 없음");
    const [{ data: profile }, { data: sessions }, { data: docs }] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", data.user_id).single(),
      context.supabase
        .from("interview_sessions")
        .select("*")
        .eq("user_id", data.user_id)
        .order("started_at", { ascending: false }),
      context.supabase
        .from("documents")
        .select("kind, source, extracted_text, updated_at")
        .eq("user_id", data.user_id),
    ]);
    return { profile, sessions: sessions ?? [], documents: docs ?? [] };
  });
