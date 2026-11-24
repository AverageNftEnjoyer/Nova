import type { ReactNode } from "react"

export interface SetupInstructionsProps {
  title: string
  /** Steps in the order the user does them. */
  steps: ReactNode[]
}

/** A numbered setup sequence (numbers are meaningful here: the steps run in order). */
export function SetupInstructions({ title, steps }: SetupInstructionsProps) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-md font-medium text-fg">{title}</h3>
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, index) => (
          <li key={index} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2.5 text-sm text-muted">
            <span className="pt-px text-right font-mono text-xs tabular-nums text-faint">{index + 1}</span>
            <span className="leading-5 [&_code]:rounded-sm [&_code]:bg-surface-3 [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_code]:text-fg">
              {step}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
