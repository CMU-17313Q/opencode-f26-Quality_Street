import { describe, expect, test } from "bun:test"
import { ProjectClone } from "../../src/server/routes/instance/httpapi/clone"

describe("ProjectClone.repoName", () => {
  test("derives a folder name from public GitHub HTTPS URLs", () => {
    expect(ProjectClone.repoName("https://github.com/octocat/Hello-World.git")).toBe("Hello-World")
    expect(ProjectClone.repoName("https://github.com/octocat/Hello-World")).toBe("Hello-World")
    expect(ProjectClone.repoName("https://github.com/opencode-ai/my_repo.git")).toBe("my_repo")
  })

  test("rejects non-GitHub, credentialed, malformed, and unsafe URLs", () => {
    expect(ProjectClone.repoName("git@github.com:octocat/Hello-World.git")).toBeUndefined()
    expect(ProjectClone.repoName("http://github.com/octocat/Hello-World")).toBeUndefined()
    expect(ProjectClone.repoName("https://gitlab.com/group/repository")).toBeUndefined()
    expect(ProjectClone.repoName("https://github.com.evil.test/octocat/Hello-World")).toBeUndefined()
    expect(ProjectClone.repoName("https://user:token@github.com/octocat/Hello-World")).toBeUndefined()
    expect(ProjectClone.repoName("https://github.com/octocat/../projects")).toBeUndefined()
    expect(ProjectClone.repoName("https://github.com/octocat/Hello-World/tree/main")).toBeUndefined()
    expect(ProjectClone.repoName("https://github.com/octocat/Hello-World?ref=main")).toBeUndefined()
    expect(ProjectClone.repoName("https://github.com/")).toBeUndefined()
    expect(ProjectClone.repoName("not a url")).toBeUndefined()
  })
})
