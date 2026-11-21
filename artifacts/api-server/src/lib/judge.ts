import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Challenge, SubmissionResult } from "@workspace/api-zod";
import { getTestCases } from "./problems";
import { logger } from "./logger";

const RUN_TIMEOUT_MS = 2_500;
const MAX_STDOUT_CHARS = 16_000;
const RUNNER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "judge_runner.py",
);

interface RunnerResponse {
  verdict: SubmissionResult["verdict"];
  passed: number;
  total: number;
  output: string | null;
  message: string;
}

export async function judgePython(
  challenge: Challenge,
  code: string,
  includeHidden: boolean,
): Promise<
  Pick<
    SubmissionResult,
    "verdict" | "passed" | "total" | "runtimeMs" | "message" | "output"
  >
> {
  const cases = getTestCases(challenge.id, includeHidden);
  if (!cases.length) {
    return {
      verdict: "CE",
      passed: 0,
      total: 0,
      runtimeMs: 0,
      message: "이 문제에는 테스트가 설정되어 있지 않습니다.",
      output: null,
    };
  }

  const workspace = await mkdtemp(path.join(tmpdir(), "algoarena-"));
  const startedAt = performance.now();
  try {
    const response = await runIsolated({
      workspace,
      payload: {
        code,
        functionName: challenge.functionName,
        cases,
      },
    });
    return {
      ...response,
      runtimeMs: Math.max(1, Math.round(performance.now() - startedAt)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "채점기를 시작하지 못했습니다.";
    const verdict: SubmissionResult["verdict"] = message.includes("시간이 초과")
      ? "TLE"
      : message.includes("메모리 제한")
        ? "MLE"
        : "RE";
    logger.warn(
      { error: message, challengeId: challenge.id },
      "Python judge execution failed",
    );
    return {
      verdict,
      passed: 0,
      total: cases.length,
      runtimeMs: Math.max(1, Math.round(performance.now() - startedAt)),
      message:
        verdict === "TLE"
          ? "시간 초과입니다. 끝나지 않는 반복문이 있는지 확인해 주세요."
          : verdict === "MLE"
            ? "메모리 제한을 초과했습니다."
            : "Python 실행기가 코드를 실행하지 못했습니다.",
      output: null,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

interface RunInput {
  workspace: string;
  payload: {
    code: string;
    functionName: string;
    cases: ReturnType<typeof getTestCases>;
  };
}

function runIsolated({ workspace, payload }: RunInput): Promise<RunnerResponse> {
  return new Promise((resolve, reject) => {
    const python = spawn("python3", ["-I", "-S", RUNNER_PATH], {
      cwd: workspace,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: workspace,
        TMPDIR: workspace,
        PYTHONHASHSEED: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      python.kill("SIGKILL");
      settle(() => reject(new Error("Python 실행 시간이 초과되었습니다.")));
    }, RUN_TIMEOUT_MS);

    python.stdout.setEncoding("utf8");
    python.stderr.setEncoding("utf8");
    python.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_STDOUT_CHARS) {
        python.kill("SIGKILL");
        settle(() => reject(new Error("채점 결과가 메모리 제한을 초과했습니다.")));
      }
    });
    python.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_000);
    });
    python.on("error", (error) => settle(() => reject(error)));
    python.on("close", (exitCode, signal) => {
      if (settled) return;
      if (signal === "SIGKILL" || signal === "SIGXCPU") {
        settle(() => reject(new Error("Python 실행 시간이 초과되었습니다.")));
        return;
      }
      if (exitCode !== 0) {
        settle(() => reject(new Error(stderr || `Python 실행이 종료되었습니다 (코드 ${exitCode}).`)));
        return;
      }
      try {
        const result = JSON.parse(stdout) as RunnerResponse;
        settle(() => resolve(result));
      } catch {
        settle(() => reject(new Error("채점기가 올바르지 않은 결과를 반환했습니다.")));
      }
    });

    python.stdin.end(JSON.stringify(payload));
  });
}
