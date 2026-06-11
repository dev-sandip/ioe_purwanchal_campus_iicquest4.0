"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectWord } from "@/lib/onnx/detector";
import { correctWord, type MvpCorrectionResult } from "@/lib/onnx/correctorMvp";
import { apiDetectWord, apiCorrectWord, triggerFederatedRound } from "@/lib/api/client";

interface Segment {
  text: string;
  isWord: boolean;
}

// Keep only Devanagari letters/marks (+ word chars) for the model input.
function coreWord(raw: string): string {
  return raw.replace(/^[^\u0900-\u097F\w]+/u, "").replace(/[^\u0900-\u097F\w]+$/u, "");
}

function segmentText(text: string): Segment[] {
  return text
    .split(/(\s+)/)
    .filter((p) => p.length > 0)
    .map((p) => ({ text: p, isWord: !/^\s+$/.test(p) }));
}

interface WordAnalysis {
  probCorrect: number;
  incorrect: boolean;
}

const THRESHOLD = 0.5;

export default function Home() {
  const [text, setText] = useState("");
  const [analysis, setAnalysis] = useState<Map<string, WordAnalysis>>(new Map());
  const [corrections, setCorrections] = useState<Map<string, MvpCorrectionResult>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{ word: string; x: number; y: number } | null>(null);

  const correctingRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelsUnavailableRef = useRef(false);

  // Quiet prediction-source switch (local ONNX vs remote API).
  const [useApi, setUseApi] = useState(false);
  const useApiRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Theme (manual light/dark toggle, persisted).
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const saved = (typeof localStorage !== "undefined" && localStorage.getItem("theme")) as
      | "light"
      | "dark"
      | null;
    const initial =
      saved ??
      (typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem("theme", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Count predictions in browser cache; every 50 quietly kick off a federated round.
  const bumpPredictions = useCallback((n: number) => {
    if (n <= 0) return;
    let before = 0;
    try {
      before = parseInt(localStorage.getItem("np_pred_count") ?? "0", 10) || 0;
    } catch {
      /* ignore */
    }
    const after = before + n;
    try {
      localStorage.setItem("np_pred_count", String(after));
    } catch {
      /* ignore */
    }
    if (Math.floor(after / 50) > Math.floor(before / 50)) {
      void triggerFederatedRound();
    }
  }, []);

  const runDetect = useCallback(
    (word: string) => (useApiRef.current ? apiDetectWord(word) : detectWord(word, THRESHOLD)),
    [],
  );
  const runCorrect = useCallback(
    (word: string) => (useApiRef.current ? apiCorrectWord(word) : correctWord(word)),
    [],
  );

  const analyze = useCallback(async (value: string) => {
    if (modelsUnavailableRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const words = Array.from(
        new Set(
          segmentText(value)
            .filter((s) => s.isWord)
            .map((s) => coreWord(s.text))
            .filter(Boolean),
        ),
      );
      const next = new Map<string, WordAnalysis>();
      for (const w of words) {
        const r = await runDetect(w);
        next.set(w, { probCorrect: r.probCorrect, incorrect: r.incorrect });
      }
      bumpPredictions(words.length);
      setAnalysis(next);
    } catch (e) {
      modelsUnavailableRef.current = true;
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [runDetect, bumpPredictions]);

  useEffect(() => {
    if (modelsUnavailableRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void analyze(text), 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text, analyze]);

  const requestCorrection = useCallback(
    async (word: string) => {
      if (corrections.has(word) || correctingRef.current.has(word)) return;
      correctingRef.current.add(word);
      try {
        const result = await runCorrect(word);
        setCorrections((prev) => new Map(prev).set(word, result));
      } catch (e) {
        setCorrections((prev) =>
          new Map(prev).set(word, {
            correction: null,
            candidates: [],
            status: "error",
            message: (e as Error).message,
            usingPlaceholderVocab: false,
          }),
        );
      } finally {
        correctingRef.current.delete(word);
      }
    },
    [corrections, runCorrect],
  );

  const segs = useMemo(() => segmentText(text), [text]);
  const hoveredCorrection = hovered ? corrections.get(hovered.word) : undefined;

  const toggleSource = useCallback(() => {
    const nextVal = !useApiRef.current;
    useApiRef.current = nextVal;
    setUseApi(nextVal);
    modelsUnavailableRef.current = false;
    setCorrections(new Map());
    setAnalysis(new Map());
    void analyze(text);
  }, [analyze, text]);

  const flaggedCount = useMemo(() => {
    let n = 0;
    for (const a of analysis.values()) if (a.incorrect) n++;
    return n;
  }, [analysis]);
  const wordCount = useMemo(
    () => segmentText(text).filter((s) => s.isWord).length,
    [text],
  );

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      {/* discreet menu */}
      <div className="fixed left-3 top-3 z-50">
        <button
          aria-label="."
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-300 transition hover:bg-zinc-200/50 hover:text-zinc-400 dark:text-zinc-700 dark:hover:bg-zinc-800/50"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="3" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="8" cy="13" r="1.4" />
          </svg>
        </button>
        {menuOpen && (
          <div className="mt-1 w-32 rounded-lg border border-zinc-200 bg-white p-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            <button
              onClick={toggleSource}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-700"
            >
              <span>Correct Word</span>
              <span
                className={`relative h-4 w-7 rounded-full transition ${useApi ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${useApi ? "left-3.5" : "left-0.5"}`}
                />
              </span>
            </button>
          </div>
        )}
      </div>

      {/* theme toggle */}
      <button
        onClick={toggleTheme}
        aria-label="Toggle theme"
        className="fixed right-3 top-3 z-50 flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      >
        {theme === "dark" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      <main className="flex w-full max-w-2xl flex-col gap-6">
        {/* Header */}
        <header className="flex flex-col items-center gap-2 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-500 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            ONNX · on-device
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            नेपाली लेखन सहायक
          </h1>
          <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
            Nepali spell checker — type below, misspelled words are underlined.
            Hover any flagged word for the top&nbsp;3 suggested corrections.
          </p>
        </header>

        {/* Editor card */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="np-input" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              तपाईंको पाठ (Your text)
            </label>
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              {busy && (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-500" />
              )}
              {busy ? "जाँच गर्दै…" : "तयार"}
            </div>
          </div>
          <textarea
            id="np-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            spellCheck={false}
            suppressHydrationWarning
            className="w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-lg leading-relaxed text-zinc-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-indigo-950"
            placeholder="यहाँ नेपाली लेख्नुहोस्…"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
              शब्द: <b className="text-zinc-700 dark:text-zinc-200">{wordCount}</b>
            </span>
            <span className="rounded-md bg-rose-50 px-2 py-1 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300">
              अशुद्ध: <b>{flaggedCount}</b>
            </span>
            <button
              onClick={() => void analyze(text)}
              disabled={busy}
              className="ml-auto rounded-lg bg-indigo-600 px-3.5 py-1.5 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              जाँच गर्नुहोस्
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            {error}
          </div>
        )}

        {/* Result card */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            नतिजा (Result)
            <span className="text-xs font-normal text-zinc-400">— hover red words</span>
          </div>
          <div className="min-h-28 rounded-xl bg-zinc-50 p-4 text-xl leading-loose text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
            {segs.length === 0 && <span className="text-zinc-400">…</span>}
            {segs.map((seg, i) => {
              if (!seg.isWord) return <span key={i}>{seg.text}</span>;
              const core = coreWord(seg.text);
              const a = core ? analysis.get(core) : undefined;
              const incorrect = a?.incorrect;
              return (
                <span
                  key={i}
                  onMouseEnter={(e) => {
                    if (!core) return;
                    setHovered({ word: core, x: e.clientX, y: e.clientY });
                    if (incorrect) void requestCorrection(core);
                  }}
                  onMouseLeave={() => setHovered(null)}
                  className={
                    incorrect
                      ? "cursor-help rounded bg-rose-100 px-0.5 underline decoration-rose-500 decoration-wavy underline-offset-4 transition hover:bg-rose-200 dark:bg-rose-950/60 dark:hover:bg-rose-900/60"
                      : ""
                  }
                >
                  {seg.text}
                </span>
              );
            })}
          </div>
        </section>

        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <p>
            Detection: <code>detector_best.onnx</code> · Correction:{" "}
            <code>encoder</code> + <code>decoder</code> (beam search) · runs fully in your browser.
          </p>
          <p className="mt-2">
            ℹ️ Federated learning fires automatically after every <b>50 predictions</b>. The learned
            biases are stored in your browser cache and auto-uploaded to retrain the model.
          </p>
        </div>
      </main>

      {/* Floating tooltip */}
      {hovered && (
        <div
          className="pointer-events-none fixed z-50 w-56 rounded-xl border border-zinc-200 bg-white/95 p-3 text-sm shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-800/95"
          style={{ left: Math.min(hovered.x + 14, (typeof window !== "undefined" ? window.innerWidth : 9999) - 240), top: hovered.y + 18 }}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">{hovered.word}</span>
          </div>
          {(() => {
            const a = analysis.get(hovered.word);
            if (a && !a.incorrect)
              return (
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <span>✓</span> सही देखिन्छ
                  <span className="ml-auto text-xs text-zinc-400">{a.probCorrect.toFixed(2)}</span>
                </div>
              );
            if (!hoveredCorrection)
              return (
                <div className="flex items-center gap-2 text-zinc-500">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-500" />
                  सुझाव खोज्दै…
                </div>
              );
            if (hoveredCorrection.status === "ok")
              return (
                <div>
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
                    सुझावहरू
                  </div>
                  {hoveredCorrection.candidates.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {hoveredCorrection.candidates.map((cand, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 rounded-lg bg-emerald-50 px-2 py-1 dark:bg-emerald-950/40"
                        >
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                            {cand}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-zinc-400">कुनै सुझाव छैन</span>
                  )}
                </div>
              );
            return (
              <div className="text-amber-600 dark:text-amber-400">{hoveredCorrection.message}</div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
