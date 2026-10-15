import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MODEL = "openai/gpt-6-astra";

async function callResponses(instructions: string, input: string, schemaName: string, schema: object) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("NO_KEY");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: MODEL,
      instructions,
      input,
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
    }),
  });
  if (!res.ok || !res.body) {
    let msg = `AI request failed (${res.status})`;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.message || msg;
    } catch {}
    if (res.status === 402) msg = "The robot is out of AI credits. Please add credits and try again.";
    if (res.status === 429) msg = "The robot is a bit busy. Please wait a moment and try again.";
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try {
        const ev = JSON.parse(d);
        if (ev.type === "response.output_text.delta") text += ev.delta;
        if (ev.type === "error" || ev.type === "response.failed")
          throw new Error(ev?.error?.message || ev?.response?.error?.message || "AI failed");
      } catch (e) {
        if (e instanceof Error && !(e instanceof SyntaxError)) throw e;
      }
    }
  }
  if (!text) throw new Error("The robot could not think of an answer. Please try again.");
  return JSON.parse(text);
}

const QuestionSchema = z.object({
  question: z.string().min(3),
  options: z.array(z.string().min(1)).length(3),
  correctIndex: z.number().int().min(0).max(2),
  hint: z.string(),
  explanation: z.string(),
});
export type QuizQuestion = z.infer<typeof QuestionSchema>;

const quizJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["enough", "message", "questions"],
  properties: {
    enough: { type: "boolean" },
    message: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options", "correctIndex", "hint", "explanation"],
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correctIndex: { type: "integer" },
          hint: { type: "string" },
          explanation: { type: "string" },
        },
      },
    },
  },
};

export const generateQuiz = createServerFn({ method: "POST" })
  .inputValidator((i: { transcript: string }) => z.object({ transcript: z.string().max(20000) }).parse(i))
  .handler(async ({ data }) => {
    const t = data.transcript.trim();
    if (t.split(/\s+/).length < 25)
      return { ok: false as const, error: "The lesson is too short. Please teach a little more or add to the transcript." };
    try {
      const out = await callResponses(
        `You help primary-school children (grades 1-5). A teacher taught a lesson; you get the transcript.
Create exactly 5 multiple-choice questions ONLY about facts the teacher actually explained. Use simple words.
Each question has exactly 3 options, exactly one correct. Vary correctIndex (0,1,2) across questions.
hint: a gentle clue that does NOT reveal the answer. explanation: 1-2 short sentences why the answer is right.
If the transcript is too short, unclear, or off-topic noise, set enough=false, questions=[] and explain kindly in message.`,
        `Lesson transcript:\n"""${t}"""`,
        "quiz",
        quizJsonSchema,
      );
      if (!out.enough) return { ok: false as const, error: out.message || "I need a clearer lesson. Please record more." };
      const qs = z.array(QuestionSchema).length(5).safeParse(out.questions);
      if (!qs.success) return { ok: false as const, error: "The quiz didn't come out right. Please try again." };
      return { ok: true as const, questions: qs.data };
    } catch (e) {
      const m = e instanceof Error ? e.message : "Something went wrong";
      if (m === "NO_KEY") return { ok: false as const, error: "AI is not set up. Try DEMO MODE instead.", noKey: true };
      return { ok: false as const, error: m };
    }
  });

const helpJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["explanation", "diagramTitle", "steps"],
  properties: {
    explanation: { type: "string" },
    diagramTitle: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["emoji", "label"],
        properties: { emoji: { type: "string" }, label: { type: "string" } },
      },
    },
  },
};

export type HelpData = { explanation: string; diagramTitle: string; steps: { emoji: string; label: string }[] };

export const getHelp = createServerFn({ method: "POST" })
  .inputValidator((i: { transcript: string; question: string; options: string[] }) =>
    z.object({ transcript: z.string().max(20000), question: z.string(), options: z.array(z.string()) }).parse(i),
  )
  .handler(async ({ data }) => {
    try {
      const out = await callResponses(
        `You are a kind robot helping a child (grades 1-5) understand a quiz question, using ONLY the teacher's lesson.
Write a simple explanation (2-4 short sentences) of the concept WITHOUT saying which option is correct.
Also make a simple visual diagram: 3-5 steps, each with one relevant emoji and a short label (max 5 words), showing how the idea works.`,
        `Lesson:\n"""${data.transcript}"""\n\nQuestion: ${data.question}\nOptions: ${data.options.join(" | ")}`,
        "help",
        helpJsonSchema,
      );
      return { ok: true as const, help: out as HelpData };
    } catch (e) {
      const m = e instanceof Error ? e.message : "Something went wrong";
      return { ok: false as const, error: m === "NO_KEY" ? "AI is not set up." : m };
    }
  });
