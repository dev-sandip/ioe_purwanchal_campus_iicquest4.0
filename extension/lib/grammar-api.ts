/**
 * Client for the Nepali Grammar Checker API.
 *
 * Endpoints:
 * - POST /detect  { word }   -> { word, correct, confidence }
 * - POST /correct { word }   -> { word, suggestions: [{ word, score }] }
 *
 * Detection and correction are performed word-by-word; the sentence-level
 * `/check` endpoint is intentionally not used.
 *
 * The base URL is configurable via PLASMO_PUBLIC_GRAMMAR_API_URL.
 */

const DEFAULT_API_BASE = "https://pujan-dev-ioe-purwanchal.hf.space"

const API_BASE = (
  process.env.PLASMO_PUBLIC_GRAMMAR_API_URL ?? DEFAULT_API_BASE
).replace(/\/+$/, "")

const DEFAULT_TIMEOUT_MS = 8000

export type ApiSuggestion = {
  word: string
  score: number
}

export type DetectResponse = {
  word: string
  correct: boolean
  confidence: number
}

export type CorrectResponse = {
  word: string
  suggestions: ApiSuggestion[]
}

const postJson = async <T>(
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  if (signal) {
    if (signal.aborted) {
      controller.abort()
    } else {
      signal.addEventListener("abort", () => controller.abort(), {
        once: true
      })
    }
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(
        `Grammar API ${path} failed with status ${response.status}`
      )
    }

    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

/** Detect whether a single word is spelled correctly. */
export const detectWord = (word: string, signal?: AbortSignal) =>
  postJson<DetectResponse>("/detect", { word }, signal)

/** Get ranked correction suggestions for a single word. */
export const correctWord = (word: string, signal?: AbortSignal) =>
  postJson<CorrectResponse>("/correct", { word }, signal)
