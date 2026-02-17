import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { runs } from "@trigger.dev/sdk";
import type { fundChatTask } from "@/trigger/fund-chat-task";
import { enrichAssistantText } from "@/lib/artifacts";

type RawTaskOutput =
  | string
  | {
      text?: unknown;
      artifacts?: unknown;
      [key: string]: unknown;
    }
  | null
  | undefined;

const FAILURE_STATUSES = new Set([
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "TIMED_OUT",
  "CANCELED",
  "EXPIRED",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toArtifactList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .filter((item) => typeof item === "string")
    .map((item) => String(item))
    .filter((item) => item.length > 0);
}

function normalizeOutput(raw: RawTaskOutput) {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return normalizeOutput(parsed as RawTaskOutput);
    } catch {
      return { text: raw, artifacts: [] as string[] };
    }
  }

  if (!isRecord(raw)) {
    return { text: "", artifacts: [] as string[] };
  }

  const text = typeof raw.text === "string" ? raw.text : "";
  const artifacts = toArtifactList(raw.artifacts);

  if (text) {
    return { text, artifacts };
  }

  // Fallback: render object as JSON so frontend still has something visible.
  return {
    text: `\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\``,
    artifacts,
  };
}

function appendArtifactsToText(text: string, artifacts: string[]) {
  if (artifacts.length === 0) {
    return text;
  }
  const missing = artifacts.filter((artifactPath) => !text.includes(artifactPath));
  if (missing.length === 0) {
    return text;
  }
  const lines = missing.map((artifactPath) => `- \`${artifactPath}\``).join("\n");
  const prefix = text.trim() ? `${text.trim()}\n\n` : "";
  return `${prefix}资源\n${lines}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;
  const run = await runs.retrieve<typeof fundChatTask>(runId);
  const payloadUserId = (run.payload as { userId?: string } | null)?.userId;
  if (payloadUserId && payloadUserId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (run.status !== "COMPLETED") {
    return NextResponse.json({
      status: run.status,
      isCompleted: false,
      isFailed: FAILURE_STATUSES.has(run.status),
      error: run.error || null,
    });
  }

  let output = run.output as RawTaskOutput;

  if (!output && (run as { outputPresignedUrl?: string }).outputPresignedUrl) {
    const presigned = (run as { outputPresignedUrl?: string }).outputPresignedUrl;
    if (presigned) {
      try {
        const fetched = await fetch(presigned);
        if (fetched.ok) {
          output = (await fetched.json()) as RawTaskOutput;
        }
      } catch {
        // ignore fetch errors
      }
    }
  }

  const normalized = normalizeOutput(output);
  const withArtifacts = appendArtifactsToText(normalized.text, normalized.artifacts);
  const enriched = enrichAssistantText(withArtifacts);

  return NextResponse.json({
    status: run.status,
    isCompleted: true,
    text: enriched,
    artifacts: normalized.artifacts,
  });
}
