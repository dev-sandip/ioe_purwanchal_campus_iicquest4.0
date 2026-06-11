import { correctWord, detectWord } from "~/lib/grammar-api"

import { DEVANAGARI_PATTERN, WORDS_PATTERN } from "./constants"

export type CorrectionWord = {
  word: string
  correct: boolean
  suggestions: string[]
  start: number
  end: number
}

export type CorrectionResponse = {
  original: string
  hasError: boolean
  words: CorrectionWord[]
}

export type CorrectionOptions = {
  signal?: AbortSignal
}

/** Minimum length of a word before it is worth checking against the API. */
const MIN_WORD_LENGTH = 2

type WordToken = {
  word: string
  start: number
  end: number
}

/** Split text into Unicode-aware word tokens with their character offsets. */
const tokenizeWords = (text: string): WordToken[] => {
  const tokens: WordToken[] = []

  for (const match of text.matchAll(WORDS_PATTERN)) {
    const word = match[0]
    const start = match.index ?? 0

    tokens.push({ word, start, end: start + word.length })
  }

  return tokens
}

/** Whether a word is a Nepali word long enough to be checked. */
const isCheckable = (word: string): boolean =>
  word.length >= MIN_WORD_LENGTH && DEVANAGARI_PATTERN.test(word)

/**
 * Build the list of correction suggestions for a single word, dropping any
 * candidate identical to the original (there is nothing to apply for those)
 * and removing duplicates while preserving rank order.
 */
const dedupeSuggestions = (
  word: string,
  suggestions: { word: string }[]
): string[] => {
  const unique = new Set<string>()

  for (const candidate of suggestions) {
    if (candidate.word && candidate.word !== word) {
      unique.add(candidate.word)
    }
  }

  return Array.from(unique)
}

/**
 * Word-by-word spelling check.
 *
 * Each Nepali word in the text is run through `/detect`; only words flagged
 * incorrect are then sent to `/correct` for ranked alternatives. Unique words
 * are checked once and the results fanned back out to every occurrence, so a
 * repeated typo is only one round trip. The sentence-level `/check` endpoint
 * is intentionally not used.
 */
export const checkTextCorrections = async (
  text: string,
  options: CorrectionOptions = {}
): Promise<CorrectionResponse> => {
  const { signal } = options
  const tokens = tokenizeWords(text)

  const uniqueWords = Array.from(
    new Set(tokens.filter((token) => isCheckable(token.word)).map((t) => t.word))
  )

  // 1. Detect which unique words are misspelled. Failures are treated as
  //    correct so a flaky request never spams the user with false positives.
  const detections = await Promise.all(
    uniqueWords.map(async (word) => {
      try {
        const result = await detectWord(word, signal)
        return [word, result.correct] as const
      } catch {
        return [word, true] as const
      }
    })
  )

  const correctByWord = new Map<string, boolean>(detections)

  // 2. Fetch ranked corrections only for the misspelled words.
  const wrongWords = uniqueWords.filter(
    (word) => correctByWord.get(word) === false
  )

  const corrections = await Promise.all(
    wrongWords.map(async (word) => {
      try {
        const result = await correctWord(word, signal)
        return [word, dedupeSuggestions(word, result.suggestions)] as const
      } catch {
        return [word, [] as string[]] as const
      }
    })
  )

  const suggestionsByWord = new Map<string, string[]>(corrections)

  const words: CorrectionWord[] = tokens.map((token) => {
    const detectedWrong =
      isCheckable(token.word) && correctByWord.get(token.word) === false
    const suggestions = detectedWrong
      ? (suggestionsByWord.get(token.word) ?? [])
      : []

    return {
      word: token.word,
      // Only treat a word as incorrect when we have an actionable suggestion.
      correct: !detectedWrong || suggestions.length === 0,
      suggestions,
      start: token.start,
      end: token.end
    }
  })

  return {
    original: text,
    hasError: words.some((word) => !word.correct),
    words
  }
}
