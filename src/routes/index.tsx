import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Square, Trash2, Sparkles, HelpCircle, Volume2, RotateCcw, BookOpen, Check, X, Keyboard } from "lucide-react";
import robot from "@/assets/robot.png";
import { generateQuiz, getHelp, type QuizQuestion, type HelpData } from "@/lib/quiz.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Classroom Listening Robot – Listen, Learn & Quiz!" },
      { name: "description", content: "Your teacher teaches. The robot listens, then turns the lesson into a fun quiz for kids." },
      { property: "og:title", content: "AI Classroom Listening Robot" },
      { property: "og:description", content: "Your teacher teaches. I listen. Then we play a quiz!" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const DEMO_LESSON = `Today we are learning how plants make their own food. This is called photosynthesis. Plants need three things to make food: sunlight, water, and a gas called carbon dioxide. The roots drink water from the soil. The leaves take in carbon dioxide from the air through tiny holes. The green color in leaves is called chlorophyll, and it catches sunlight. Using sunlight, the plant turns water and carbon dioxide into sugar, which is its food. While doing this, the plant gives out oxygen, which we need to breathe. So plants help us by making the air fresh!`;

const DEMO_QUIZ: QuizQuestion[] = [
  { question: "What is it called when plants make their own food?", options: ["Photosynthesis", "Hibernation", "Evaporation"], correctIndex: 0, hint: "It's a long word the teacher said that starts with 'photo'.", explanation: "Photosynthesis means plants use light to make food." },
  { question: "Which part of the plant drinks water from the soil?", options: ["Leaves", "Roots", "Flowers"], correctIndex: 1, hint: "Think about the part that is hidden under the ground.", explanation: "Roots grow in the soil and drink water." },
  { question: "What gas do leaves take in from the air?", options: ["Oxygen", "Helium", "Carbon dioxide"], correctIndex: 2, hint: "It's a gas we breathe out.", explanation: "Leaves take in carbon dioxide through tiny holes." },
  { question: "What makes leaves green and catches sunlight?", options: ["Chlorophyll", "Sugar", "Soil"], correctIndex: 0, hint: "The teacher said a special word for the green color.", explanation: "Chlorophyll is green and catches sunlight." },
  { question: "What do plants give out that we need to breathe?", options: ["Water", "Oxygen", "Sugar"], correctIndex: 1, hint: "We need it in every breath we take!", explanation: "Plants give out oxygen, which keeps the air fresh." },
];
const DEMO_HELP: HelpData = { explanation: "Plants are like little kitchens! They take in water through roots and air through leaves. Sunlight gives them energy to cook their food.", diagramTitle: "How a plant makes food", steps: [{ emoji: "☀️", label: "Sunlight shines" }, { emoji: "💧", label: "Roots drink water" }, { emoji: "💨", label: "Leaves take in air" }, { emoji: "🌱", label: "Plant makes sugar" }, { emoji: "🫧", label: "Oxygen goes out" }] };

type Phase = "ready" | "listening" | "processing" | "quiz" | "results";
type Answer = { correct: boolean };

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.9; u.pitch = 1.15;
  window.speechSynthesis.speak(u);
}

function Index() {
  const [phase, setPhase] = useState<Phase>("ready");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [manual, setManual] = useState(false);
  const [demo, setDemo] = useState(false);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const recRef = useRef<any>(null);
  const listeningRef = useRef(false);
  const committedRef = useRef(0);
  const genQuiz = useServerFn(generateQuiz);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); setManual(true); }
  }, []);

  const start = async () => {
    setError(null);
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); setManual(true); setError("Your browser can't listen. Please type the lesson below instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setManual(true);
      setError("I can't hear you — microphone permission was denied. You can type the lesson instead.");
      return;
    }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
    committedRef.current = 0;
    rec.onresult = (e: any) => {
      // Android Chrome re-fires onresult with results already seen (stale
      // resultIndex, repeated finals/interims). Only commit finals whose
      // index we haven't processed yet; rebuild interim from uncommitted
      // non-final results so temporary text never gets appended twice.
      let fin = ""; let int = "";
      for (let i = 0; i < e.results.length; i++) {
        if (i < committedRef.current) continue;
        const r = e.results[i];
        if (r.isFinal) { fin += r[0].transcript + " "; committedRef.current = i + 1; }
        else int += r[0].transcript;
      }
      if (fin) setTranscript((t) => (t + " " + fin).replace(/\s+/g, " ").trimStart());
      setInterim(int);
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed") { setManual(true); setError("Microphone permission was denied. Please type the lesson instead."); listeningRef.current = false; setPhase("ready"); }
    };
    rec.onend = () => {
      // Auto-restart keeps the same result list on Android, so committedRef
      // must NOT be reset here — resetting would re-append everything.
      if (listeningRef.current) { try { rec.start(); } catch {} }
    };
    recRef.current = rec; listeningRef.current = true; setDemo(false);
    rec.start(); setPhase("listening");
  };

  const stopRec = () => { listeningRef.current = false; committedRef.current = 0; recRef.current?.stop(); setInterim(""); };

  const createQuiz = async () => {
    stopRec();
    setError(null);
    const t = transcript.trim();
    if (t.split(/\s+/).filter(Boolean).length < 25) {
      setPhase("ready");
      setError(t ? "That lesson is a bit short. Please teach a little more or add to the transcript." : "I didn't hear anything yet. Please start listening or type the lesson.");
      return;
    }
    setPhase("processing");
    if (demo && t === DEMO_LESSON) {
      await new Promise((r) => setTimeout(r, 1500));
      beginQuiz(DEMO_QUIZ); return;
    }
    try {
      const res = await genQuiz({ data: { transcript: t } });
      if (res.ok) beginQuiz(res.questions);
      else { setError(res.error); setPhase("ready"); }
    } catch {
      setError("I couldn't make the quiz. Please try again."); setPhase("ready");
    }
  };

  const beginQuiz = (qs: QuizQuestion[]) => { setQuestions(qs); setIdx(0); setAnswers([]); setPhase("quiz"); };

  const loadDemo = () => { stopRec(); setDemo(true); setTranscript(DEMO_LESSON); setError(null); setPhase("ready"); };

  const newLesson = () => { stopRec(); setTranscript(""); setQuestions([]); setAnswers([]); setIdx(0); setDemo(false); setError(null); setPhase("ready"); };

  const status: Record<Phase, string> = {
    ready: "Robot is ready! 🤖",
    listening: "Robot is listening...",
    processing: "Great! I understood the lesson. Let me prepare your quiz!",
    quiz: `Question ${idx + 1} of ${questions.length}`,
    results: "Quiz complete!",
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
      <header className="text-center">
        <img src={robot} alt="Friendly robot mascot" width={1024} height={1024}
          className={`mx-auto h-36 w-36 sm:h-44 sm:w-44 ${phase === "listening" || phase === "processing" ? "animate-floaty" : ""}`} />
        <h1 className="mt-2 text-3xl font-bold text-primary sm:text-5xl">AI Classroom Listening Robot</h1>
        <p className="mt-2 text-lg font-semibold text-secondary sm:text-xl">Your teacher teaches. I listen. Then we play a quiz!</p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-card px-5 py-2 font-bold shadow-card" role="status" aria-live="polite">
          {demo && <span className="rounded-full bg-sunny px-2 py-0.5 text-xs text-sunny-foreground">DEMO MODE</span>}
          {status[phase]}
        </div>
      </header>

      {error && (
        <div className="mt-5 rounded-2xl border-2 border-destructive/40 bg-card p-4 text-center font-semibold text-destructive">{error}</div>
      )}

      {(phase === "ready" || phase === "listening") && (
        <section className="mt-6 space-y-5">
          <div className="flex flex-wrap justify-center gap-3">
            {phase === "ready" ? (
              <BigBtn onClick={start} tone="primary" disabled={!supported}><Mic className="h-7 w-7" /> START LISTENING</BigBtn>
            ) : (
              <BigBtn onClick={createQuiz} tone="sunny"><Square className="h-6 w-6" /> STOP &amp; CREATE QUIZ</BigBtn>
            )}
            {phase === "ready" && transcript.trim() && (
              <BigBtn onClick={createQuiz} tone="sunny"><Sparkles className="h-6 w-6" /> CREATE QUIZ</BigBtn>
            )}
          </div>

          {phase === "listening" && (
            <div className="flex h-16 items-center justify-center gap-1.5" aria-hidden>
              {Array.from({ length: 12 }).map((_, i) => (
                <span key={i} className="h-full w-2.5 origin-center rounded-full bg-secondary animate-wave" style={{ animationDelay: `${(i % 6) * 0.12}s` }} />
              ))}
            </div>
          )}

          <div className="rounded-3xl bg-card p-5 shadow-card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-xl font-semibold"><BookOpen className="h-5 w-5 text-primary" /> Lesson transcript</h2>
              <div className="flex flex-wrap gap-2">
                <SmallBtn onClick={() => setManual((m) => !m)}><Keyboard className="h-4 w-4" /> {manual ? "Lock text" : "Type / edit"}</SmallBtn>
                <SmallBtn onClick={() => { setTranscript(""); setInterim(""); setDemo(false); }}><Trash2 className="h-4 w-4" /> CLEAR TRANSCRIPT</SmallBtn>
                <SmallBtn onClick={loadDemo}><Sparkles className="h-4 w-4" /> Demo lesson</SmallBtn>
              </div>
            </div>
            {manual ? (
              <textarea value={transcript} onChange={(e) => { setTranscript(e.target.value); setDemo(false); }}
                placeholder="Type or paste the teacher's lesson here..."
                className="min-h-48 w-full rounded-2xl border-2 bg-muted p-4 text-lg outline-none focus:border-primary" />
            ) : (
              <div className="min-h-48 rounded-2xl bg-muted p-4 text-lg leading-relaxed">
                {transcript || interim ? (<>{transcript} <span className="text-muted-foreground">{interim}</span></>) : (
                  <span className="text-muted-foreground">The teacher's words will appear here while I listen...</span>
                )}
              </div>
            )}
            {!supported && <p className="mt-2 text-sm text-muted-foreground">Speech recognition isn't supported in this browser (try Chrome or Edge). You can type the lesson instead.</p>}
          </div>
        </section>
      )}

      {phase === "processing" && (
        <section className="mt-10 flex flex-col items-center gap-4">
          <div className="flex gap-3">
            {[0, 1, 2].map((i) => <span key={i} className="h-5 w-5 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
          </div>
          <p className="text-lg font-semibold text-muted-foreground">Generating questions...</p>
        </section>
      )}

      {phase === "quiz" && questions[idx] && (
        <QuizCard key={idx} q={questions[idx]} n={idx} total={questions.length} score={answers.filter((a) => a.correct).length}
          transcript={transcript} demo={demo}
          onDone={(correct) => {
            const next = [...answers, { correct }];
            setAnswers(next);
            if (idx + 1 >= questions.length) setPhase("results"); else setIdx(idx + 1);
          }} />
      )}

      {phase === "results" && (
        <section className="mt-6 rounded-3xl bg-card p-6 text-center shadow-card">
          <h2 className="text-4xl font-bold text-primary">{answers.filter((a) => a.correct).length} out of {questions.length}</h2>
          <p className="mt-2 text-xl font-semibold">{encourage(answers.filter((a) => a.correct).length, questions.length)}</p>
          <ul className="mx-auto mt-5 max-w-xl space-y-2 text-left">
            {questions.map((q, i) => (
              <li key={i} className="flex items-start gap-3 rounded-2xl bg-muted p-3">
                {answers[i]?.correct ? <Check className="mt-0.5 h-6 w-6 shrink-0 text-success" /> : <X className="mt-0.5 h-6 w-6 shrink-0 text-destructive" />}
                <span><b>{q.question}</b><br /><span className="text-muted-foreground">Answer: {q.options[q.correctIndex]}</span></span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <BigBtn tone="primary" onClick={() => beginQuiz(questions)}><RotateCcw className="h-6 w-6" /> PLAY AGAIN</BigBtn>
            <BigBtn tone="sunny" onClick={newLesson}><BookOpen className="h-6 w-6" /> NEW LESSON</BigBtn>
          </div>
        </section>
      )}
    </main>
  );
}

function encourage(s: number, t: number) {
  if (s === t) return "Superstar! You got them all! 🌟";
  if (s >= t - 1) return "Amazing work! You really listened! 🎉";
  if (s >= t / 2) return "Good job! Keep learning and growing! 🌱";
  return "Nice try! Let's learn together and play again! 💪";
}

function QuizCard({ q, n, total, score, transcript, demo, onDone }: {
  q: QuizQuestion; n: number; total: number; score: number; transcript: string; demo: boolean; onDone: (correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [wrongs, setWrongs] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [help, setHelp] = useState<HelpData | null>(null);
  const [helpErr, setHelpErr] = useState<string | null>(null);
  const [loadingHelp, setLoadingHelp] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const help$ = useServerFn(getHelp);
  const correct = picked === q.correctIndex;

  const choose = (i: number) => {
    if (locked) return;
    setPicked(i); setLocked(true);
    if (i === q.correctIndex) {
      setCelebrate(true);
      setTimeout(() => onDone(wrongs.length === 0), 1800);
    } else setWrongs((w) => [...w, i]);
  };

  const openHelp = async () => {
    setHelpOpen(true);
    if (help) return;
    if (demo) { setHelp(DEMO_HELP); return; }
    setLoadingHelp(true); setHelpErr(null);
    try {
      const r = await help$({ data: { transcript, question: q.question, options: q.options } });
      if (r.ok) setHelp(r.help); else setHelpErr(r.error);
    } catch { setHelpErr("I couldn't think of a hint right now."); }
    setLoadingHelp(false);
  };

  const tryAgain = () => { setHelpOpen(false); setPicked(null); setLocked(false); };

  return (
    <section className="relative mt-6">
      {celebrate && <Confetti />}
      <div className="mb-3 flex items-center justify-between font-bold">
        <span className="rounded-full bg-card px-4 py-1.5 shadow-card">Question {n + 1} of {total}</span>
        <span className="rounded-full bg-sunny px-4 py-1.5 text-sunny-foreground shadow-card">⭐ Score: {score}</span>
      </div>
      <div className="mb-4 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(n / total) * 100}%` }} /></div>
      <div className="rounded-3xl bg-card p-6 shadow-card">
        <div className="flex items-start gap-3">
          <h2 className="flex-1 text-2xl font-semibold sm:text-3xl">{q.question}</h2>
          <button aria-label="Read question aloud" onClick={() => speak(`${q.question}. A: ${q.options[0]}. B: ${q.options[1]}. C: ${q.options[2]}.`)} className="rounded-full bg-accent p-3 text-accent-foreground"><Volume2 className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 grid gap-3">
          {q.options.map((o, i) => {
            const isPicked = picked === i;
            const tried = wrongs.includes(i);
            const cls = isPicked && correct ? "bg-success text-success-foreground" : isPicked ? "bg-destructive text-destructive-foreground" : tried ? "bg-muted text-muted-foreground line-through" : "bg-accent text-accent-foreground hover:-translate-y-0.5";
            return (
              <button key={i} disabled={locked || tried} onClick={() => choose(i)}
                className={`flex items-center gap-4 rounded-2xl p-4 text-left text-xl font-bold shadow-pop transition-transform disabled:cursor-not-allowed ${cls}`}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card font-display text-2xl text-primary">{"ABC"[i]}</span>
                {o}
              </button>
            );
          })}
        </div>

        {locked && correct && (
          <p className="mt-5 text-center text-2xl font-bold text-success">Excellent! You got it! 🎉</p>
        )}
        {locked && !correct && (
          <div className="mt-5 text-center">
            <p className="text-xl font-bold text-destructive">Not quite! Let's think about it together.</p>
            <button onClick={openHelp} className="mt-4 inline-flex items-center gap-2 rounded-full bg-sunny px-8 py-4 text-2xl font-bold text-sunny-foreground shadow-pop transition-transform hover:-translate-y-0.5">
              <HelpCircle className="h-7 w-7" /> HELP ME
            </button>
          </div>
        )}
      </div>

      {helpOpen && (
        <div className="mt-5 rounded-3xl border-4 border-sunny bg-card p-6 shadow-card">
          <div className="flex items-center gap-3">
            <img src={robot} alt="" width={1024} height={1024} loading="lazy" className="h-14 w-14" />
            <h3 className="text-2xl font-semibold">Let's learn together!</h3>
          </div>
          {loadingHelp && <p className="mt-4 font-semibold text-muted-foreground">Thinking of a helpful picture...</p>}
          {helpErr && <p className="mt-4 font-semibold text-destructive">{helpErr} Here's a clue: {q.hint}</p>}
          {help && (
            <>
              <p className="mt-4 text-lg leading-relaxed">{help.explanation}</p>
              <p className="mt-2 text-lg"><b>Clue:</b> {q.hint}</p>
              <div className="mt-5 rounded-2xl bg-muted p-4">
                <p className="mb-3 text-center font-display text-lg font-semibold text-secondary">{help.diagramTitle}</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {help.steps.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex w-24 flex-col items-center rounded-2xl bg-card p-3 text-center shadow-card">
                        <span className="text-4xl">{s.emoji}</span>
                        <span className="mt-1 text-sm font-bold">{s.label}</span>
                      </div>
                      {i < help.steps.length - 1 && <span className="text-2xl font-bold text-primary">→</span>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {help && <SmallBtn onClick={() => speak(`${help.explanation} Clue: ${q.hint}`)}><Volume2 className="h-4 w-4" /> Listen</SmallBtn>}
            <BigBtn tone="primary" onClick={tryAgain}><RotateCcw className="h-6 w-6" /> Try Again</BigBtn>
          </div>
        </div>
      )}
    </section>
  );
}

function Confetti() {
  const colors = ["bg-primary", "bg-secondary", "bg-sunny", "bg-success"];
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {Array.from({ length: 40 }).map((_, i) => (
        <span key={i} className={`absolute top-0 h-3 w-2 rounded-sm animate-confetti ${colors[i % 4]}`}
          style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 10) * 0.08}s` }} />
      ))}
    </div>
  );
}

function BigBtn({ children, onClick, tone, disabled }: { children: React.ReactNode; onClick: () => void; tone: "primary" | "sunny"; disabled?: boolean }) {
  const c = tone === "primary" ? "bg-primary text-primary-foreground" : "bg-sunny text-sunny-foreground";
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-3 rounded-full px-7 py-4 font-display text-xl font-semibold shadow-pop transition-transform hover:-translate-y-0.5 active:translate-y-0.5 disabled:opacity-50 sm:text-2xl ${c}`}>
      {children}
    </button>
  );
}

function SmallBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-sm font-bold text-accent-foreground hover:opacity-90">
      {children}
    </button>
  );
}
