import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const prevItem = z.object({
  order: z.number().int(),
  interviewer: z.enum(["A", "B", "C"]),
  question: z.string(),
  answer: z.string().default(""),
  duration_sec: z.number().int().min(0).max(3600).default(0),
});

export const publicAnalyzeSchool = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ school: z.string().min(1), school_type: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { groqChat, safeParseJson } = await import("@/lib/ai.server");
    const sys = `당신은 한국의 특목고·자사고 입시 전문가입니다. 학교명을 기반으로 구술면접 스타일, 기출 성향, 선호 인재상, 자주 나오는 질문 유형을 JSON으로만 답하세요.
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

export const publicNextQuestion = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        target_school: z.string().min(1),
        school_type: z.string().optional().nullable(),
        school_analysis: z.unknown().optional(),
        jaso: z.string().optional().default(""),
        saengbu: z.string().optional().default(""),
        prev: z.array(prevItem).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { cerebrasChat, safeParseJson } = await import("@/lib/ai.server");
    const prev = data.prev;
    const lastQ = prev[prev.length - 1];

    const rotation: Array<"A" | "B" | "C"> = ["A", "B", "C"];
    let nextInterviewer: "A" | "B" | "C" = rotation[prev.length % 3];
    let isFollowup = false;
    if (lastQ && lastQ.answer.length > 20) {
      const isShort = lastQ.answer.length < 60;
      const isRambling = lastQ.duration_sec > 40 && lastQ.answer.length / (lastQ.duration_sec || 1) < 2;
      if ((isShort || isRambling) && Math.random() < 0.55) {
        nextInterviewer = lastQ.interviewer;
        isFollowup = true;
      }
    }

    const spec: Record<"A" | "B" | "C", { name: string; role: string; focus: string }> = {
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
    const s = spec[nextInterviewer];
    const askedList =
      prev.map((q) => `${q.order + 1}. [${q.interviewer}] ${q.question}`).join("\n") || "(없음)";

    const sys = `당신은 대한민국 최상위권 특목고·자사고의 엄격하고 정밀한 입학사정관이자 ${s.name}입니다.
역할: ${s.role}
집중: ${s.focus}

지원자 자기소개서 요약:
${(data.jaso ?? "").slice(0, 3500) || "(없음)"}

지원자 생활기록부 요약:
${(data.saengbu ?? "").slice(0, 3500) || "(없음)"}

지원 학교(${data.target_school}) 분석:
${JSON.stringify(data.school_analysis ?? {})}

이미 출제된 질문 (절대 중복 금지, 완전히 새 축으로):
${askedList}

${
  isFollowup && lastQ
    ? `직전 질문: ${lastQ.question}\n지원자 답변: ${lastQ.answer}\n답변의 논리적 허점·근거 미비·전제 오류를 파고드는 꼬리질문을 만드세요.`
    : "자기소개서·생기부의 새로운 축, 또는 지원 학교 분석 기반의 새 질문을 만드세요."
}

응답은 반드시 JSON으로만: {"question": string(한국어, 한 문장, 정중하지만 압박감), "keywords": string[](채점 시 SFX 트리거용 핵심 키워드 3~5개)}`;

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
    return {
      interviewer: nextInterviewer,
      question_text: questionText,
      keywords: parsed?.keywords ?? [],
      is_followup: isFollowup,
      order_idx: prev.length,
    };
  });

export const publicReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        target_school: z.string().min(1),
        mode: z.enum(["full", "pressure"]).default("full"),
        qa: z.array(prevItem).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { cerebrasChat, safeParseJson } = await import("@/lib/ai.server");
    const transcript = data.qa
      .map(
        (q, i) =>
          `[Q${i + 1} ${q.interviewer}] ${q.question}\n[A] ${q.answer || "(무응답)"} (${q.duration_sec}s)`,
      )
      .join("\n\n");

    const sys = `당신은 대한민국 최상위 특목고/자사고의 AI 수석 입학사정관입니다. 아래 면접 세션 전체를 냉정하고 직설적으로 분석해 JSON으로만 답하세요.

평가 원칙 (엄격):
- 사실 기반, 근거 필수. 과장된 칭찬 금지, 완곡한 표현으로 비판을 감싸지 말 것.
- 지원자의 강점이 실제로 관찰되지 않았다면 strengths는 빈 배열([])을 반환.
- weaknesses는 관찰된 문제만 명시. 없으면 빈 배열.
- 점수는 실제 답변 품질에 근거해 부여. 무응답/짧은 답변은 낮게 매길 것.
- summary는 결과 요약이지 위로가 아님. 3~5문장, 담백.
- action_items는 즉시 실행 가능한 구체 지시.

스키마: {
  "summary": string,
  "fit_score": 0~100,
  "logic_score": 0~100,
  "attitude_score": 0~100,
  "strengths": string[],
  "weaknesses": string[],
  "interviewer_A": string, "interviewer_B": string, "interviewer_C": string,
  "action_items": string[]
}`;
    const raw = await cerebrasChat(
      0,
      [
        { role: "system", content: sys },
        { role: "user", content: `지원 학교: ${data.target_school}\n모드: ${data.mode}\n\n=== 면접 기록 ===\n${transcript}` },
      ],
      { temperature: 0.3, max_tokens: 2000, json: true },
    );
    return (
      safeParseJson<{
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
      }
    );
  });
