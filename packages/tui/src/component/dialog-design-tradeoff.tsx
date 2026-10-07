import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Match, Show, Switch, createMemo, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useTuiConfig } from "../config"
import { useDialog, type DialogContext } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { getScrollAcceleration } from "../util/scroll"
import { useBindings } from "../keymap"
import {
  FACTOR_LABEL,
  collectRepoContext,
  explainTradeoffs,
  parseApproach,
  type Rating,
  type RepoContext,
  type TradeoffResult,
} from "../util/design-tradeoff"

const RATING_SYMBOL: Record<Rating, string> = {
  favorable: "▲",
  mixed: "◆",
  unfavorable: "▼",
  unclear: "·",
}

const RATING_TEXT: Record<Rating, string> = {
  favorable: "favorable",
  mixed: "mixed",
  unfavorable: "unfavorable",
  unclear: "not enough detail",
}

const APPROACH_LETTERS = ["A", "B", "C"]

export type TradeoffInputs = {
  decision: string
  approaches: string[]
}

/** Structured comparison of approaches, or a clear message when there is not enough information. */
export function TradeoffReport(props: { result: TradeoffResult }) {
  const { theme } = useTheme()
  const ratingColor = (rating: Rating) =>
    ({
      favorable: theme.success,
      mixed: theme.warning,
      unfavorable: theme.error,
      unclear: theme.textMuted,
    })[rating]

  return (
    <box gap={1}>
      <Show when={props.result.decision}>
        <text fg={theme.text} wrapMode="word">
          <b>Decision:</b> {props.result.decision}
        </text>
      </Show>
      <Switch>
        <Match when={props.result.status === "insufficient" && props.result}>
          {(result) => (
            <box gap={1}>
              <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                Not enough information for a meaningful comparison
              </text>
              <box>
                <For each={result().problems}>
                  {(problem) => (
                    <text fg={theme.warning} wrapMode="word">
                      ! {problem}
                    </text>
                  )}
                </For>
              </box>
              <box>
                <text fg={theme.text}>To get a useful comparison:</text>
                <For each={result().hints}>
                  {(hint) => (
                    <text fg={theme.textMuted} wrapMode="word">
                      • {hint}
                    </text>
                  )}
                </For>
              </box>
            </box>
          )}
        </Match>
        <Match when={props.result.status === "ready" && props.result}>
          {(result) => (
            <box gap={1}>
              <box>
                <text fg={theme.textMuted}>Repository context</text>
                <For each={result().context}>
                  {(line) => (
                    <text fg={theme.textMuted} wrapMode="word">
                      {"  "}
                      {line}
                    </text>
                  )}
                </For>
              </box>
              <For each={result().approaches}>
                {(analysis, index) => (
                  <box border={["left"]} borderColor={theme.primary} paddingLeft={1}>
                    <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="word">
                      {APPROACH_LETTERS[index()] ?? index() + 1}. {analysis.approach.name}
                    </text>
                    <text fg={theme.textMuted} wrapMode="word">
                      {analysis.approach.description}
                    </text>
                    <For each={analysis.factors}>
                      {(factor) => (
                        <box>
                          <text fg={theme.text}>
                            <span style={{ fg: ratingColor(factor.rating) }}>{RATING_SYMBOL[factor.rating]}</span>{" "}
                            <b>{FACTOR_LABEL[factor.factor]}</b>{" "}
                            <span style={{ fg: ratingColor(factor.rating) }}>{RATING_TEXT[factor.rating]}</span>
                          </text>
                          <For each={factor.pros}>
                            {(reason) => (
                              <text fg={theme.textMuted} wrapMode="word">
                                {"    "}
                                <span style={{ fg: theme.success }}>+</span> {reason}
                              </text>
                            )}
                          </For>
                          <For each={factor.cons}>
                            {(reason) => (
                              <text fg={theme.textMuted} wrapMode="word">
                                {"    "}
                                <span style={{ fg: theme.error }}>−</span> {reason}
                              </text>
                            )}
                          </For>
                        </box>
                      )}
                    </For>
                  </box>
                )}
              </For>
              <box>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  How they compare
                </text>
                <For each={result().contrasts}>
                  {(line) => (
                    <text fg={theme.text} wrapMode="word">
                      • {line}
                    </text>
                  )}
                </For>
              </box>
              <box>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Questions to help you decide
                </text>
                <For each={result().questions}>
                  {(line) => (
                    <text fg={theme.textMuted} wrapMode="word">
                      ? {line}
                    </text>
                  )}
                </For>
              </box>
            </box>
          )}
        </Match>
      </Switch>
    </box>
  )
}

export function DialogDesignTradeoff(props: { result: TradeoffResult; onEdit: () => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const height = createMemo(() => Math.max(8, Math.floor(dimensions().height * 0.75) - 6))

  onMount(() => dialog.setSize("large"))

  useBindings(() => ({
    bindings: [{ key: "return", desc: "Edit tradeoff inputs", group: "Dialog", cmd: () => props.onEdit() }],
  }))

  return (
    <box gap={1}>
      <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Design Tradeoff Explainer
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <scrollbox
        maxHeight={height()}
        paddingLeft={2}
        paddingRight={2}
        scrollbarOptions={{ visible: false }}
        scrollAcceleration={scrollAcceleration()}
      >
        <TradeoffReport result={props.result} />
      </scrollbox>
      <box flexDirection="row" gap={2} paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <text fg={theme.text} onMouseUp={() => props.onEdit()}>
          enter <span style={{ fg: theme.textMuted }}>edit inputs</span>
        </text>
        <text fg={theme.text}>
          esc <span style={{ fg: theme.textMuted }}>close</span>
        </text>
      </box>
    </box>
  )
}

/** Collects the decision and approaches step by step, then shows the comparison. */
DialogDesignTradeoff.start = async (
  dialog: DialogContext,
  options: { directory?: string; initial?: TradeoffInputs },
): Promise<void> => {
  const initial = options.initial ?? { decision: "", approaches: [] }
  const total = 4

  const decision = await DialogPrompt.show(dialog, `Design Tradeoff Explainer · step 1/${total}`, {
    value: initial.decision,
    placeholder: "What are you deciding? e.g. How should we store user sessions?",
  })
  if (decision === null) return

  const approaches: string[] = []
  for (const [index, letter] of APPROACH_LETTERS.entries()) {
    const optional = index >= 2
    const value = await DialogPrompt.show(dialog, `Approach ${letter} · step ${index + 2}/${total}`, {
      value: initial.approaches[index] ?? "",
      placeholder: optional
        ? "Optional third approach (leave empty to skip)"
        : "Name: how it works, e.g. In-memory map: keep sessions in a Map inside the server",
    })
    if (value === null) return
    approaches.push(value)
  }

  const inputs: TradeoffInputs = { decision, approaches }
  const result = explainTradeoffs({
    decision,
    approaches: approaches.map((value, index) => parseApproach(value, `Approach ${APPROACH_LETTERS[index]}`)),
    context: readContext(options.directory),
  })

  dialog.replace(() => (
    <DialogDesignTradeoff
      result={result}
      onEdit={() => void DialogDesignTradeoff.start(dialog, { directory: options.directory, initial: inputs })}
    />
  ))
}

function readContext(directory?: string): RepoContext | undefined {
  if (!directory) return undefined
  try {
    return collectRepoContext(directory)
  } catch {
    return undefined
  }
}
