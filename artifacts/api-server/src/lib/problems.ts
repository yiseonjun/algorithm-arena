import type { Challenge } from "@workspace/api-zod";
import { challengeData } from "./problem-catalog";
import { challengeTests, type JudgeTestCase } from "./problem-tests";

export type { JudgeTestCase } from "./problem-tests";

export function listChallenges(): Challenge[] {
  return structuredClone(challengeData);
}

export function listChallengesByDifficulty(
  difficulty: Challenge["difficulty"],
): Challenge[] {
  return structuredClone(
    challengeData.filter((challenge) => challenge.difficulty === difficulty),
  );
}

export function findChallenge(id: string): Challenge | undefined {
  const challenge = challengeData.find((entry) => entry.id === id);
  return challenge ? structuredClone(challenge) : undefined;
}

export function getTestCases(
  challengeId: string,
  includeHidden: boolean,
): JudgeTestCase[] {
  const suite = challengeTests[challengeId];
  if (!suite) return [];
  return [...suite.public, ...(includeHidden ? suite.hidden : [])];
}
