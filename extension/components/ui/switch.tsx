import type { InputHTMLAttributes } from "react"

import { cn } from "~lib/utils"

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <input
      className={cn(
        "h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full border border-transparent bg-input transition-colors checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        "before:block before:h-4 before:w-4 before:translate-x-0 before:rounded-full before:bg-background before:shadow before:transition-transform checked:before:translate-x-4",
        className
      )}
      type="checkbox"
      {...props}
    />
  )
}
