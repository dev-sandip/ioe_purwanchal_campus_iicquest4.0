export type EditableElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLElement

export type DetectedLanguage = "english" | "nepali" | "unknown"

export type TextSnapshot = {
  caret: number
  text: string
}

export type WordContext = {
  contextWords: string[]
  currentWord: string
  language: DetectedLanguage
  previousWord: string
  textBeforeCaret: string
}

export type PredictionContext = Pick<
  WordContext,
  | "contextWords"
  | "currentWord"
  | "language"
  | "previousWord"
  | "textBeforeCaret"
>

export type Suggestion = {
  label: string
  kind: "next" | "correction"
  replaceLength: number
  value: string
}
