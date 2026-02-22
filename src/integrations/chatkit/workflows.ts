import fs from "node:fs";
import path from "node:path";
import { appendChatKitEvent } from "./observability.js";
import { runChatKitWorkflow } from "./runner.js";
import type { ChatKitRunResult } from "./types.js";

export type ChatKitWorkflowStepKind = "research" | "summarize" | "display";

export interface ChatKitWorkflowStep {
  id: string;
  kind: ChatKitWorkflowStepKind;
  skillName: string;
  instruction: string;
}

export interface ChatKitStructuredWorkflowInput {
  userContextId: string;
  conversationId?: string;
  missionRunId?: string;
  prompt: string;
  skillNames?: string[];
  maxAttemptsPerStep?: number;
}

export interface ChatKitStructuredWorkflowResult {
  ok: boolean;
  finalOutput: string;
  steps: Array<{
    id: string;
    kind: ChatKitWorkflowStepKind;
    ok: boolean;
    attempts: number;
    outputText: string;
    errorCode: string;
  }>;
  errorCode?: string;
  errorMessage?: string;
}

type StepExecutor = (input: {
  prompt: string;
  userContextId: string;
  conversationId?: string;
  missionRunId?: string;
}) => Promise<ChatKitRunResult>;

const DEFAULT_SKILLS = ["research", "summarize", "nova-core"];
const DEFAULT_MAX_ATTEMPTS = 2;

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function resolveSkillNames(input: string[] | undefined): string[] {
  const source = Array.isArray(input) && input.length > 0 ? input : DEFAULT_SKILLS;
  const unique = new Set(
    source.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean),
  );
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function readSkillSnippet(skillName: string): string {
  try {
    const filePath = path.join(process.cwd(), "skills", skillName, "SKILL.md");
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/).slice(0, 80);
    return lines.join("\n").trim();
  } catch {
    return "";
  }
}

function buildSkillContextBlock(skillNames: string[]): string {
  const blocks = skillNames
    .map((skillName) => {
      const snippet = readSkillSnippet(skillName);
      if (!snippet) return "";
      return `### Skill: ${skillName}\n${snippet}`;
    })
    .filter(Boolean);
  return blocks.join("\n\n").trim();
}

export function buildStructuredWorkflowPlan(input: {
  prompt: string;
  skillNames?: string[];
}): { steps: ChatKitWorkflowStep[]; skillContext: string } {
  const skillNames = resolveSkillNames(input.skillNames);
  const skillContext = buildSkillContextBlock(skillNames);
  const steps: ChatKitWorkflowStep[] = [
    {
      id: "step_research",
      kind: "research",
      skillName: "research",
      instruction:
        "Research the user request with factual grounding and identify key claims, evidence, and unknowns.",
    },
    {
      id: "step_summarize",
      kind: "summarize",
      skillName: "summarize",
      instruction:
        "Summarize the research output into concise findings, preserving dates, quantities, and uncertainty.",
    },
    {
      id: "step_display",
      kind: "display",
      skillName: "nova-core",
      instruction:
        "Format the final answer for Nova response UX: clear sections, actionable takeaways, and confidence callout.",
    },
  ];
  return { steps, skillContext };
}

function buildStepPrompt(params: {
  originalPrompt: string;
  priorOutput: string;
  skillContext: string;
  step: ChatKitWorkflowStep;
}): string {
  return [
    `User request: ${params.originalPrompt}`,
    params.priorOutput ? `Previous step output:\n${params.priorOutput}` : "",
    params.skillContext ? `Skill references:\n${params.skillContext}` : "",
    `Current step (${params.step.kind}): ${params.step.instruction}`,
    "Return only the step output.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildMissionWorkflowInput(input: ChatKitStructuredWorkflowInput): ChatKitStructuredWorkflowInput {
  return {
    userContextId: String(input.userContextId || "").trim(),
    conversationId: String(input.conversationId || "").trim(),
    missionRunId: String(input.missionRunId || "").trim(),
    prompt: String(input.prompt || "").trim(),
    skillNames: Array.isArray(input.skillNames) ? input.skillNames : undefined,
    maxAttemptsPerStep: input.maxAttemptsPerStep,
  };
}

export async function runStructuredChatKitWorkflow(
  input: ChatKitStructuredWorkflowInput,
  deps?: { executeStep?: StepExecutor },
): Promise<ChatKitStructuredWorkflowResult> {
  const normalized = buildMissionWorkflowInput(input);
  const userContextId = normalized.userContextId;
  const conversationId = normalized.conversationId || "";
  const missionRunId = normalized.missionRunId || "";
  const prompt = normalized.prompt;
  if (!userContextId) {
    return {
      ok: false,
      finalOutput: "",
      steps: [],
      errorCode: "MISSING_USER_CONTEXT",
      errorMessage: "Missing userContextId for ChatKit structured workflow.",
    };
  }
  if (!prompt) {
    return {
      ok: false,
      finalOutput: "",
      steps: [],
      errorCode: "MISSING_PROMPT",
      errorMessage: "Missing prompt for ChatKit structured workflow.",
    };
  }

  const maxAttempts = toInt(
    normalized.maxAttemptsPerStep,
    toInt(process.env.NOVA_CHATKIT_WORKFLOW_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 4),
    1,
    4,
  );
  const execute: StepExecutor = deps?.executeStep
    ? deps.executeStep
    : async ({ prompt: stepPrompt, userContextId: stepUser, conversationId: stepConversation, missionRunId: stepMission }) =>
        runChatKitWorkflow({
          prompt: stepPrompt,
          context: {
            userContextId: stepUser,
            conversationId: stepConversation,
            missionRunId: stepMission,
          },
        });

  const plan = buildStructuredWorkflowPlan({
    prompt,
    skillNames: normalized.skillNames,
  });
  const stepResults: ChatKitStructuredWorkflowResult["steps"] = [];
  let priorOutput = "";

  appendChatKitEvent({
    status: "ok",
    event: "chatkit.workflow.start",
    userContextId,
    conversationId,
    missionRunId,
    promptChars: prompt.length,
    details: {
      stepCount: plan.steps.length,
      maxAttempts,
      workflow: "research_summarize_display",
    },
  });

  for (const step of plan.steps) {
    let attempts = 0;
    let lastErrorCode = "";
    let outputText = "";
    let stepOk = false;
    while (attempts < maxAttempts && !stepOk) {
      attempts += 1;
      const stepPrompt = buildStepPrompt({
        originalPrompt: prompt,
        priorOutput,
        skillContext: plan.skillContext,
        step,
      });
      const result = await execute({
        prompt: stepPrompt,
        userContextId,
        conversationId,
        missionRunId,
      });
      if (result.ok === true && String(result.outputText || "").trim()) {
        stepOk = true;
        outputText = String(result.outputText || "").trim();
        priorOutput = outputText;
      } else {
        lastErrorCode = String(result.errorCode || "STEP_FAILED");
      }
    }
    stepResults.push({
      id: step.id,
      kind: step.kind,
      ok: stepOk,
      attempts,
      outputText,
      errorCode: stepOk ? "" : lastErrorCode || "STEP_FAILED",
    });
    if (!stepOk) {
      appendChatKitEvent({
        status: "error",
        event: "chatkit.workflow.step_failed",
        userContextId,
        conversationId,
        missionRunId,
        errorCode: lastErrorCode || "STEP_FAILED",
        errorMessage: `Workflow step failed: ${step.kind}`,
        details: {
          stepId: step.id,
          stepKind: step.kind,
          attempts,
          maxAttempts,
        },
      });
      return {
        ok: false,
        finalOutput: "",
        steps: stepResults,
        errorCode: lastErrorCode || "STEP_FAILED",
        errorMessage: `Workflow failed at step "${step.kind}".`,
      };
    }
  }

  appendChatKitEvent({
    status: "ok",
    event: "chatkit.workflow.success",
    userContextId,
    conversationId,
    missionRunId,
    outputChars: priorOutput.length,
    details: {
      stepCount: stepResults.length,
      workflow: "research_summarize_display",
    },
  });
  return {
    ok: true,
    finalOutput: priorOutput,
    steps: stepResults,
  };
}

