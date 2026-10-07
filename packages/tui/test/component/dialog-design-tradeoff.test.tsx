/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup, onMount } from "solid-js"
import { DialogDesignTradeoff, type TradeoffInputs } from "../../src/component/dialog-design-tradeoff"
import { TuiConfigProvider } from "../../src/config"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

async function mountExplainer(root: string, initial: TradeoffInputs) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  await Bun.write(path.join(root, "package.json"), JSON.stringify({ devDependencies: { vitest: "^1" } }))

  function Starter() {
    const dialog = useDialog()
    onMount(() => void DialogDesignTradeoff.start(dialog, { directory: root, initial }))
    return <box />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig({ keybinds: { "dialog.prompt.submit": "return" } })
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <DialogProvider>
                    <Starter />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  return testRender(() => <Harness />, { width: 120, height: 120, kittyKeyboard: true })
}

type App = Awaited<ReturnType<typeof mountExplainer>>

/** Renders until the frame contains the text. The theme loads asynchronously, so early frames are empty. */
async function waitForText(app: App, text: string, timeout = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    if (frame.includes(text)) return frame
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for "${text}"`)
}

/** Submits each of the four input steps (decision + three approaches) with their prefilled values. */
async function submitSteps(app: App) {
  for (let step = 1; step <= 4; step++) {
    await waitForText(app, `step ${step}/4`)
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    app.mockInput.pressEnter()
  }
}

test("collects the inputs step by step and shows the structured comparison", async () => {
  await using tmp = await tmpdir()
  const app = await mountExplainer(tmp.path, {
    decision: "How should we store user sessions?",
    approaches: [
      "In-memory map: Keep a global in-memory map of sessions in the server",
      "Redis: Install redis as a new dependency and persist sessions there",
      "",
    ],
  })
  try {
    await submitSteps(app)
    const frame = await waitForText(app, "How they compare")
    expect(frame).toContain("Design Tradeoff Explainer")
    expect(frame).toContain("Decision: How should we store user sessions?")
    expect(frame).toContain("Tests: found (vitest)")
    expect(frame).toContain("A. In-memory map")
    expect(frame).toContain("B. Redis")
    expect(frame).toContain("Testability")
    expect(frame).toContain("Consistency with repo")
    expect(frame).toContain("does not depend on yet")
    expect(frame).toContain("does not pick a winner")
    expect(frame).toContain("Questions to help you decide")
  } finally {
    app.renderer.destroy()
  }
})

test("shows a clear state when there is not enough information and lets the user edit inputs", async () => {
  await using tmp = await tmpdir()
  const app = await mountExplainer(tmp.path, {
    decision: "Which cache should we use?",
    approaches: ["Redis: use redis for caching results", "", ""],
  })
  try {
    await submitSteps(app)
    const frame = await waitForText(app, "Not enough information")
    expect(frame).toContain("At least two approaches are needed to compare tradeoffs.")
    expect(frame).toContain("To get a useful comparison:")
    expect(frame).not.toContain("How they compare")

    app.mockInput.pressEnter()
    const edit = await waitForText(app, "step 1/4")
    expect(edit).toContain("Which cache should we use?")
  } finally {
    app.renderer.destroy()
  }
})
