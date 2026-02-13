import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { ChatSDKError } from "@/lib/errors";

const ARTIFACTS_DIR = path.resolve(process.cwd(), "artifacts");

function getContentType(targetPath: string) {
  if (targetPath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (targetPath.endsWith(".csv")) {
    return "text/csv; charset=utf-8";
  }
  if (targetPath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const { searchParams } = new URL(request.url);
  const inputPath = searchParams.get("path");

  if (!inputPath) {
    return NextResponse.json({ error: "Missing path query parameter" }, { status: 400 });
  }

  const normalizedPath = inputPath.replace(/^\/+/, "");
  if (!normalizedPath.startsWith("artifacts/")) {
    return NextResponse.json({ error: "Invalid artifact path" }, { status: 400 });
  }

  const absolutePath = path.resolve(process.cwd(), normalizedPath);
  if (!absolutePath.startsWith(ARTIFACTS_DIR + path.sep)) {
    return NextResponse.json({ error: "Path traversal is not allowed" }, { status: 400 });
  }

  try {
    const content = await readFile(absolutePath);
    return new Response(content, {
      status: 200,
      headers: {
        "content-type": getContentType(absolutePath),
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Artifact file not found" }, { status: 404 });
  }
}
