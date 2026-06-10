import { getCaretRect } from "./caret"
import { POPOVER_ID } from "./constants"
import type { EditableElement, Suggestion } from "./types"

type RenderSuggestionsOptions = {
  onSelect: (suggestion: Suggestion) => void
}

export const getPopover = () => {
  let popover = document.getElementById(POPOVER_ID)

  if (popover) {
    return popover
  }

  popover = document.createElement("div")
  popover.id = POPOVER_ID
  popover.setAttribute("role", "listbox")
  popover.style.cssText = [
    "position: fixed",
    "z-index: 2147483647",
    "display: none",
    "min-width: 180px",
    "max-width: min(320px, calc(100vw - 24px))",
    "padding: 6px",
    "border: 1px solid rgba(15, 23, 42, 0.12)",
    "border-radius: 8px",
    "background: #ffffff",
    "box-shadow: 0 18px 45px rgba(15, 23, 42, 0.18)",
    "color: #0f172a",
    "font: 13px/1.4 Inter, ui-sans-serif, system-ui, sans-serif"
  ].join(";")

  document.documentElement.append(popover)

  return popover
}

export const hidePopover = () => {
  getPopover().style.display = "none"
}

export const positionPopover = (element: EditableElement) => {
  const popover = getPopover()
  const rect = getCaretRect(element)
  const popoverRect = popover.getBoundingClientRect()
  const left = Math.min(
    Math.max(12, rect.left),
    window.innerWidth - popoverRect.width - 12
  )
  const aboveTop = rect.top - popoverRect.height - 8
  const top =
    aboveTop > 8 ? aboveTop : Math.min(rect.bottom + 8, window.innerHeight - 48)

  popover.style.left = `${left}px`
  popover.style.top = `${top}px`
}

export const renderSuggestions = (
  element: EditableElement,
  suggestions: Suggestion[],
  { onSelect }: RenderSuggestionsOptions
) => {
  const popover = getPopover()

  popover.replaceChildren()

  for (const suggestion of suggestions) {
    const button = document.createElement("button")
    const label = document.createElement("span")
    const value = document.createElement("strong")

    button.type = "button"
    button.setAttribute("role", "option")
    button.style.cssText = [
      "display: flex",
      "width: 100%",
      "align-items: center",
      "justify-content: space-between",
      "gap: 12px",
      "border: 0",
      "border-radius: 6px",
      "background: transparent",
      "padding: 7px 8px",
      "color: inherit",
      "cursor: pointer",
      "font: inherit",
      "text-align: left"
    ].join(";")
    button.addEventListener("mouseenter", () => {
      button.style.background = "#f1f5f9"
    })
    button.addEventListener("mouseleave", () => {
      button.style.background = "transparent"
    })
    button.addEventListener("mousedown", (event) => {
      event.preventDefault()
      onSelect(suggestion)
    })

    value.textContent = suggestion.value
    value.style.fontWeight = "700"
    label.textContent = suggestion.label
    label.style.cssText = "font-size: 11px; color: #64748b; white-space: nowrap"

    button.append(value, label)
    popover.append(button)
  }

  popover.style.display = "block"
  positionPopover(element)
}
