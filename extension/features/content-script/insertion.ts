import { getSnapshot, getWordContext } from "./editable"
import type { EditableElement, Suggestion } from "./types"

const dispatchTextInputEvent = (element: HTMLElement, value: string) => {
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    })
  )
}

const applySuggestionToTextControl = (
  element: HTMLInputElement | HTMLTextAreaElement,
  suggestion: Suggestion
) => {
  const caret = element.selectionStart ?? element.value.length
  const start = Math.max(0, caret - suggestion.replaceLength)
  const needsLeadingSpace =
    suggestion.replaceLength === 0 &&
    caret > 0 &&
    !/\s$/.test(element.value.slice(0, caret))
  const value = `${needsLeadingSpace ? " " : ""}${suggestion.value}`
  const nextValue = `${element.value.slice(0, start)}${value}${element.value.slice(caret)}`
  const valueSetter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    "value"
  )?.set

  valueSetter?.call(element, nextValue)
  element.setSelectionRange(start + value.length, start + value.length)
  dispatchTextInputEvent(element, value)
}

const setContentEditableRangeStart = (
  element: HTMLElement,
  range: Range,
  startOffset: number
) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let node = walker.nextNode()

  while (node) {
    const textLength = node.textContent?.length ?? 0
    const nextConsumed = consumed + textLength

    if (startOffset <= nextConsumed) {
      range.setStart(node, Math.max(0, startOffset - consumed))
      return
    }

    consumed = nextConsumed
    node = walker.nextNode()
  }

  range.setStart(element, element.childNodes.length)
}

const applySuggestionToContentEditable = (
  element: HTMLElement,
  suggestion: Suggestion
) => {
  const selection = window.getSelection()

  if (!selection || selection.rangeCount === 0) {
    return
  }

  const range = selection.getRangeAt(0)
  const snapshot = getSnapshot(element)
  const { textBeforeCaret } = getWordContext(snapshot)

  if (suggestion.replaceLength > 0) {
    setContentEditableRangeStart(
      element,
      range,
      Math.max(0, snapshot.caret - suggestion.replaceLength)
    )
  }

  const needsLeadingSpace =
    suggestion.replaceLength === 0 &&
    textBeforeCaret.length > 0 &&
    !/\s$/.test(textBeforeCaret)
  const text = `${needsLeadingSpace ? " " : ""}${suggestion.value}`

  selection.removeAllRanges()
  selection.addRange(range)

  if (document.execCommand("insertText", false, text)) {
    return
  }

  range.deleteContents()

  const textNode = document.createTextNode(text)

  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  dispatchTextInputEvent(element, text)
}

export const applySuggestionToEditable = (
  element: EditableElement,
  suggestion: Suggestion
) => {
  element.focus()

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    applySuggestionToTextControl(element, suggestion)
  } else {
    applySuggestionToContentEditable(element, suggestion)
  }
}
