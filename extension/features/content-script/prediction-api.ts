import { correctWord, detectWord } from "~/lib/grammar-api"

import { DEVANAGARI_PATTERN } from "./constants"
import type { Suggestion, WordContext } from "./types"

/** Minimum length of the in-progress word before we query the API. */
const MIN_WORD_LENGTH = 2

/** Maximum number of live suggestions to surface for the current word. */
const MAX_PREDICTIONS = 5

export type PredictionOptions = {
  signal?: AbortSignal
  maxSuggestions?: number
}

/**
 * Live, word-level suggestions for the word the user is currently typing.
 *
 * The word at the caret is first run through `/detect`; only when it is
 * flagged incorrect do we fetch ranked alternatives from `/correct`. This
 * keeps the experience quiet for correctly spelled words while offering fast,
 * inline corrections as the user types.
 */
export const predictCurrentWord = async (
  context: WordContext,
  { signal, maxSuggestions = MAX_PREDICTIONS }: PredictionOptions = {}
): Promise<Suggestion[]> => {
  const currentWord = context.currentWord.trim()

  // Only act while actively typing a Nepali word (no trailing space yet).
  if (
    context.language !== "nepali" ||
    currentWord.length < MIN_WORD_LENGTH ||
    !DEVANAGARI_PATTERN.test(currentWord) ||
    /\s$/.test(context.textBeforeCaret)
  ) {
    return []
  }

  const detection = await detectWord(currentWord, signal)

  if (detection.correct) {
    return []
  }

  const correction = await correctWord(currentWord, signal)

  const seen = new Set<string>()
  const suggestions: Suggestion[] = []

  for (const candidate of correction.suggestions) {
    if (candidate.word === currentWord || seen.has(candidate.word)) {
      continue
    }

    seen.add(candidate.word)
    suggestions.push({
      value: candidate.word,
      label: "Suggestion",
      kind: "correction",
      type: "prediction",
      replaceLength: currentWord.length
    })

    if (suggestions.length >= maxSuggestions) {
      break
    }
  }

  return suggestions
}
