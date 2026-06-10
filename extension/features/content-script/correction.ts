
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

const mockDictionary: Record<string, string[]> = {
  "नेपालि": ["नेपाली"],
  "रामो": ["राम्रो"],
  "सापकोट": ["सापकोटा"],
  "सन्दिप": ["सन्दीप"],
  "भाषाा": ["भाषा"],
  "होो": ["हो"]
}

export const checkSentenceCorrection = async (
  text: string
): Promise<CorrectionResponse> => {
  await new Promise((resolve) => setTimeout(resolve, 300))

  const words = text.split(/\s+/)

  let currentIndex = 0

  const resultWords: CorrectionWord[] = []

  for (const word of words) {
    const start = text.indexOf(word, currentIndex)
    const end = start + word.length

    currentIndex = end

    const suggestions = mockDictionary[word] || []

    resultWords.push({
      word,
      correct: suggestions.length === 0,
      suggestions,
      start,
      end
    })
  }

  const corrected = resultWords
    .map((word) =>
      word.suggestions.length > 0
        ? word.suggestions[0]
        : word.word
    )
    .join(" ")

  return {
    original: text,
    corrected,
    hasError: resultWords.some((w) => !w.correct),
    words: resultWords
  }
}