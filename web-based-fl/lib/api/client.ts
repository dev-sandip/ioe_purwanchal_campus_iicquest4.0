// Remote inference client. Mirrors the return shapes of the local
// detector/corrector so the UI can use either interchangeably.

import type { DetectorResult } from "@/lib/onnx/detector";
import type { MvpCorrectionResult } from "@/lib/onnx/correctorMvp";

const API_BASE = "https://pujan-dev-ioe-purwanchal.hf.space";

interface DetectResponse {
  word: string;
  correct: boolean;
  confidence: number;
}
interface Suggestion {
  word: string;
  score: number;
}
interface CorrectResponse {
  word: string;
  suggestions: Suggestion[];
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${path} ${res.status}`);
  return (await res.json()) as T;
}

export async function apiDetectWord(word: string): Promise<DetectorResult> {
  const j = await postJson<DetectResponse>("/detect", { word });
  return {
    probCorrect: j.correct ? j.confidence : 1 - j.confidence,
    incorrect: !j.correct,
    usingPlaceholderVocab: false,
  };
}

export async function apiCorrectWord(word: string): Promise<MvpCorrectionResult> {
  const j = await postJson<CorrectResponse>("/correct", { word });
  const candidates = (j.suggestions ?? [])
    .map((s) => s.word)
    .filter(Boolean)
    .slice(0, 3);
  return {
    correction: candidates[0] ?? null,
    candidates,
    status: "ok",
    usingPlaceholderVocab: false,
  };
}

// Fire-and-forget federated-learning round. Never throws.
export async function triggerFederatedRound(): Promise<void> {
  try {
    await fetch(`${API_BASE}/fl/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "detector", rounds: 1, clients: 2 }),
      keepalive: true,
    });
  } catch {
    /* silent */
  }
}
