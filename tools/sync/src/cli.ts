/**
 * tools/sync · 一键同步：本地门禁 → 提交 → 推送 → 等流水线 → 校验线上。
 *
 * 用法：
 *   npm run sync                     # 自动提交（默认信息）并同步到底
 *   npm run sync -- "你的提交信息"     # 自定义提交信息
 *   npm run sync -- --no-check       # 跳过本地门禁（lint/typecheck/validate/test）
 *   npm run sync -- --no-wait        # 推完就走，不等 CI / 部署
 *
 * 设计要点：
 * - 推送只依赖本机已配置的 git 凭据（Git Credential Manager），不需要额外填 token。
 * - 等待流水线与线上校验会顺带读取同一份凭据里的 token；读不到时退化为打印链接，不报错。
 * - HTTPS 到 GitHub 偶发连接重置，因此推送内置重试，避免"推了一半就失败"。
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const REPO_ROOT = process.cwd();
const GATES = ["lint", "typecheck", "validate", "test"] as const;
const PUSH_RETRIES = 5;
const PUSH_BACKOFF_MS = 8_000;
const POLL_INTERVAL_MS = 15_000;
const WAIT_TIMEOUT_MS = 12 * 60 * 1000;
const SITE_RETRIES = 8;

interface Options {
  message: string;
  check: boolean;
  wait: boolean;
}

interface RunInfo {
  name: string;
  path: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_sha: string;
}

interface LiveInfo {
  entry: string;
  assetOk: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { message: "", check: true, wait: true };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-check") opts.check = false;
    else if (arg === "--no-wait") opts.wait = false;
    else if (arg === "-m" || arg === "--message") {
      i += 1;
      opts.message = argv[i] ?? "";
    } else rest.push(arg);
  }
  if (!opts.message && rest.length > 0) opts.message = rest.join(" ");
  return opts;
}

function gitRun(args: string[]): { code: number; output: string } {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  const output = ((r.stdout ?? "") + (r.stderr ?? "")).trim();
  return { code: r.status ?? 1, output };
}

function gitOut(args: string[]): string {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : "";
}

function aheadCount(branch: string): number {
  const r = spawnSync("git", ["rev-list", "--count", `origin/${branch}..HEAD`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0) return 1;
  const n = Number.parseInt((r.stdout ?? "0").trim(), 10);
  return Number.isFinite(n) ? n : 1;
}

function runGate(step: string): boolean {
  const r = spawnSync("npm", ["run", step], { cwd: REPO_ROOT, stdio: "inherit", shell: true });
  return (r.status ?? 1) === 0;
}

function readGitHubToken(): string | null {
  const r = spawnSync("git", ["credential", "fill"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    input: "protocol=https\nhost=github.com\n\n",
  });
  if (r.status !== 0) return null;
  const m = /^password=(.+)$/m.exec(r.stdout ?? "");
  return m ? m[1].trim() : null;
}

function parseRemote(url: string): { owner: string; repo: string } | null {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).filter(Boolean)[0] ?? "";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "rust-and-blood-sync",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function waitForRuns(owner: string, repo: string, sha: string, token: string): Promise<RunInfo[]> {
  const started = Date.now();
  let last: RunInfo[] = [];
  while (Date.now() - started < WAIT_TIMEOUT_MS) {
    try {
      const data = await fetchJson<{ workflow_runs: RunInfo[] }>(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=30`,
        token,
      );
      last = data.workflow_runs.filter((r) => r.head_sha === sha);
      const hasDeploy = last.some((r) => r.path.endsWith("deploy.yml"));
      if (last.length > 0 && hasDeploy && last.every((r) => r.status === "completed")) return last;
    } catch (error) {
      console.log(`  查询流水线失败，稍后重试：${describeError(error)}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return last;
}

async function readLiveInfo(siteUrl: string): Promise<LiveInfo | null> {
  try {
    const res = await fetch(siteUrl, { redirect: "follow" });
    if (!res.ok) return null;
    const html = await res.text();
    const m = /assets\/index-[^"]+\.js/.exec(html);
    if (!m) return null;
    const asset = await fetch(new URL(m[0], siteUrl).toString());
    return { entry: m[0], assetOk: asset.ok };
  } catch {
    return null;
  }
}

async function waitForSite(siteUrl: string, before: string | null): Promise<LiveInfo | null> {
  let last: LiveInfo | null = null;
  for (let i = 1; i <= SITE_RETRIES; i += 1) {
    const info = await readLiveInfo(siteUrl);
    if (info) {
      last = info;
      if (!before || info.entry !== before) {
        console.log(`  ✓ 入口 ${info.entry} · 资源 ${info.assetOk ? "可访问" : "异常"}`);
        return info;
      }
    }
    if (i < SITE_RETRIES) {
      console.log(`  第 ${i} 次：CDN 尚未切到新版本，等待中…`);
      await sleep(15_000);
    }
  }
  return last;
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const started = Date.now();

  console.log("\n▸ 同步前检查");
  if (gitOut(["rev-parse", "--is-inside-work-tree"]) !== "true") {
    console.log("  ✗ 当前目录不是 git 仓库");
    return 1;
  }
  const remoteUrl = gitOut(["remote", "get-url", "origin"]);
  const parsed = remoteUrl ? parseRemote(remoteUrl) : null;
  if (!parsed) {
    console.log("  ✗ 没有可用的 origin 远程仓库（需要是 GitHub 地址）");
    return 1;
  }
  const { owner, repo } = parsed;
  const branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"]) || "main";
  const actionsUrl = `https://github.com/${owner}/${repo}/actions`;
  const siteUrl = `https://${owner.toLowerCase()}.github.io/${repo}/`;
  console.log(`  仓库 ${owner}/${repo} · 分支 ${branch}`);
  console.log(`  站点 ${siteUrl}`);

  gitRun(["add", "-A"]);
  const pending = gitOut(["status", "--porcelain"]);
  const ahead = aheadCount(branch);
  if (!pending && ahead === 0) {
    console.log("\n✓ 已是最新：没有待提交的改动，也没有待推送的提交。");
    return 0;
  }
  if (pending) console.log(`  待提交文件 ${pending.split(/\r?\n/).length} 个`);
  if (ahead > 0) console.log(`  待推送提交 ${ahead} 个`);

  if (opts.check) {
    console.log("\n▸ 本地门禁（加 --no-check 可跳过）");
    for (const step of GATES) {
      process.stdout.write(`  ${step} … `);
      const ok = runGate(step);
      console.log(ok ? "通过" : "失败");
      if (!ok) {
        console.log("\n✗ 门禁未通过，已中止同步（不会推送）。修好后重试，或加 --no-check 强制同步。");
        return 1;
      }
    }
  }

  if (pending) {
    const message = opts.message || "chore: 同步更新";
    const c = gitRun(["commit", "-m", message]);
    if (c.code !== 0) {
      console.log(`\n✗ 提交失败\n${c.output}`);
      return 1;
    }
    console.log(`\n▸ 已提交 ${gitOut(["rev-parse", "--short", "HEAD"])} · ${message}`);
  }

  console.log("\n▸ 推送到 origin");
  let pushed = false;
  for (let i = 1; i <= PUSH_RETRIES; i += 1) {
    const p = gitRun(["push", "-u", "origin", branch]);
    if (p.code === 0) {
      console.log(`  ✓ 推送成功（第 ${i} 次尝试）`);
      pushed = true;
      break;
    }
    console.log(`  第 ${i} 次失败：${firstLine(p.output)}`);
    if (i < PUSH_RETRIES) await sleep(PUSH_BACKOFF_MS);
  }
  if (!pushed) {
    console.log("  ✗ 推送失败，请检查网络或 git 凭据");
    return 1;
  }

  const sha = gitOut(["rev-parse", "HEAD"]);
  console.log(`  提交 ${sha.slice(0, 7)}`);

  if (!opts.wait) {
    console.log(`\n✓ 已推送。流水线：${actionsUrl}`);
    return 0;
  }

  const token = readGitHubToken();
  const before = (await readLiveInfo(siteUrl))?.entry ?? null;
  if (before) console.log(`  线上当前入口 ${before}`);

  if (!token) {
    console.log("\n⚠ 读不到 GitHub 凭据，无法自动等待流水线。");
    console.log(`  请在浏览器确认部署：${actionsUrl}`);
    return 0;
  }

  console.log("\n▸ 等待 CI 与部署完成");
  const runs = await waitForRuns(owner, repo, sha, token);
  if (runs.length === 0) {
    console.log(`  ✗ 超时：未找到该提交的流水线。请查看 ${actionsUrl}`);
    return 1;
  }
  let failed = false;
  for (const run of [...runs].sort((a, b) => a.name.localeCompare(b.name))) {
    const ok = run.conclusion === "success";
    if (!ok) failed = true;
    console.log(`  ${ok ? "✓" : "✗"} ${run.name}：${run.conclusion ?? run.status}  ${run.html_url}`);
  }
  if (failed) {
    console.log("\n✗ 流水线未全部成功，部署可能未完成。");
    return 1;
  }

  console.log("\n▸ 校验线上站点");
  const info = await waitForSite(siteUrl, before);
  if (!info) {
    console.log("  ✗ 站点暂时无法访问，请稍后自行打开确认");
    return 1;
  }
  if (!info.assetOk) {
    console.log("  ✗ 入口资源无法访问，请检查 Pages 是否配置为 GitHub Actions");
    return 1;
  }

  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`\n✓ 同步完成 · 用时 ${secs}s`);
  console.log(`  站点 ${siteUrl}`);
  console.log(`  流水线 ${actionsUrl}`);
  return 0;
}

process.exitCode = await main();
