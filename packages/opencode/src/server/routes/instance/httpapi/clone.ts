import path from "path"
import { Effect, Option, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Git } from "@/git"

export const route = "/experimental/clone"

const Payload = Schema.Struct({ url: Schema.String })

export function handler(input: { git: Git.Interface; fs: FSUtil.Interface }) {
  return Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(Payload).pipe(Effect.option)
    if (Option.isNone(body))
      return error(400, 'Expected a JSON body like { "url": "https://github.com/owner/repository.git" }')

    const url = body.value.url.trim()
    const name = repoName(url)
    if (!name) return error(400, "Only public GitHub HTTPS repository URLs are supported")

    const parent = path.resolve(Global.Path.home, "projects")
    const directory = path.resolve(parent, name)
    if (!isInside(directory, parent)) return error(400, "Invalid repository destination")
    if (yield* input.fs.existsSafe(directory)) return error(409, "A project with this repository name already exists")

    yield* input.fs.ensureDir(parent)
    const result = yield* input.git.run(["-c", "credential.helper=", "clone", "--", url, directory], {
      cwd: parent,
      env: { GIT_TERMINAL_PROMPT: "0" },
    })
    const stderr = result.stderr.toString("utf8").trim()
    if (stderr.includes("could not read Username")) return error(422, "Repository not found or not public")
    if (result.exitCode !== 0) return error(422, stderr || "git clone failed")
    return HttpServerResponse.jsonUnsafe({ directory })
  }).pipe(Effect.catch(() => Effect.succeed(error(500, "Clone failed"))))
}

export function repoName(value: string) {
  const url = parseRepositoryUrl(value)
  if (!url) return
  return url.pathname
    .split("/")
    .at(-1)
    ?.replace(/\.git$/, "")
}

function parseRepositoryUrl(value: string) {
  try {
    const url = new URL(value)
    const parts = url.pathname.split("/").filter(Boolean)
    const [owner, repository] = parts
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      parts.length !== 2 ||
      !owner ||
      !repository ||
      !/^[\w.-]+$/.test(owner) ||
      !/^[\w.-]+(?:\.git)?$/.test(repository)
    ) {
      return
    }
    const name = repository.replace(/\.git$/, "")
    if (!name || name.startsWith(".")) return
    return url
  } catch {
    return
  }
}

function isInside(directory: string, parent: string) {
  const relative = path.relative(parent, directory)
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)
}

function error(status: number, message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status })
}

export * as ProjectClone from "./clone"
