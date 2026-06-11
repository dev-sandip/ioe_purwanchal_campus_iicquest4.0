import { checkSentence, type CheckOptions } from "~/lib/grammar-api"

export type CorrectionWord = {
  word: string
  correct: boolean
  suggestions: string[]
  start: number
  end: number
}

export type CorrectionResponse = {
  original: string
  corrected: string
  hasError: boolean
  words: CorrectionWord[]
}

/**
 * Build the list of correction suggestions for a single word from the API
 * response. The best correction (`corrected`) is placed first, followed by
 * any alternative suggestions. Entries identical to the original word are
 * dropped because there is nothing to apply for them.
 */
const buildSuggestions = (
  word: string,
  corrected: string,
  suggestions: { word: string }[]
): string[] => {
  const ordered = [corrected, ...suggestions.map((item) => item.word)]
  const unique = new Set<string>()

  for (const candidate of ordered) {
    if (candidate && candidate !== word) {
      unique.add(candidate)
    }
  }

  return Array.from(unique)
}

/**
 * Run a sentence-level grammar/spelling check against the API and map the
 * response into positioned correction words so the caller can highlight and
 * replace specific words within the original text.
 */
export const checkSentenceCorrection = async (
  text: string,
  options?: CheckOptions
): Promise<CorrectionResponse> => {
  const result = await checkSentence(text, options)

  let cursor = 0

  const words: CorrectionWord[] = result.details.map((detail) => {
    const found = text.indexOf(detail.word, cursor)
    const start = found === -1 ? cursor : found
    const end = start + detail.word.length

    cursor = end

    const isWrong = detail.status === "wrong"
    const suggestions = isWrong
      ? buildSuggestions(detail.word, detail.corrected, detail.suggestions)
      : []

    return {
      word: detail.word,
      // Treat the word as correct when the model has no actionable change to
      // offer, even if it flagged the word as "wrong".
      correct: !isWrong || suggestions.length === 0,
      suggestions,
      start,
      end
    }
  })

  return {
    original: result.input,
    corrected: result.output,
    hasError: words.some((word) => !word.correct),
    words
  }
}
