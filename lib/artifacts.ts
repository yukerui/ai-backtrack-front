import "server-only";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ARTIFACTS_SIGNING_SECRET =
  process.env.ARTIFACTS_SIGNING_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  process.env.AUTH_SECRET ||
  "";
const ARTIFACTS_TOKEN_TTL_MS = Number.parseInt(
  process.env.ARTIFACTS_TOKEN_TTL_MS || "3600000",
  10
);
const PUBLIC_BASE_URL =
  process.env.PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXTAUTH_URL ||
  process.env.VERCEL_URL ||
  "";

function toBase64Url(input: Buffer | string) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signArtifactToken(pathValue: string) {
  if (!ARTIFACTS_SIGNING_SECRET) {
    return "";
  }
  const payload = JSON.stringify({ p: pathValue, e: Date.now() + ARTIFACTS_TOKEN_TTL_MS });
  const sig = createHmac("sha256", ARTIFACTS_SIGNING_SECRET).update(payload).digest();
  return `${toBase64Url(payload)}.${toBase64Url(sig)}`;
}

function getRepoRoot() {
  const cwd = process.cwd();
  const candidate = path.resolve(cwd, "..");
  if (fs.existsSync(path.resolve(cwd, "backend")) && fs.existsSync(path.resolve(cwd, "front"))) {
    return cwd;
  }
  if (
    fs.existsSync(path.resolve(candidate, "backend")) &&
    fs.existsSync(path.resolve(candidate, "front"))
  ) {
    return candidate;
  }
  return cwd;
}

const REPO_ROOT = getRepoRoot();
const ARTIFACT_ROOTS = [
  path.resolve(REPO_ROOT, "artifacts"),
  path.resolve(REPO_ROOT, "backend/artifacts"),
  path.resolve(REPO_ROOT, "front/artifacts"),
];

export type BacktestArtifactKind = "backtest-html" | "csv" | "other";

export type BacktestArtifactItem = {
  path: string;
  url: string;
  kind: BacktestArtifactKind;
  title: string;
};

function resolveArtifactPath(inputPath: string) {
  const cleaned = inputPath.replace(/^\/+/, "");
  if (cleaned.startsWith("backend/artifacts/") || cleaned.startsWith("front/artifacts/")) {
    return cleaned;
  }
  if (!cleaned.startsWith("artifacts/")) {
    return cleaned;
  }
  const candidates = [
    path.resolve(REPO_ROOT, cleaned),
    path.resolve(REPO_ROOT, `backend/${cleaned}`),
    path.resolve(REPO_ROOT, `front/${cleaned}`),
  ];
  const matched = candidates.find((candidate) =>
    ARTIFACT_ROOTS.some((root) => candidate.startsWith(root + path.sep)) && fs.existsSync(candidate)
  );
  if (!matched) {
    return cleaned;
  }
  return path.relative(REPO_ROOT, matched).replace(/\\/g, "/");
}

function toArtifactUrl(pathValue: string) {
  const resolved = resolveArtifactPath(pathValue);
  const token = signArtifactToken(resolved);
  const relativeUrl = token
    ? `/api/artifacts?token=${encodeURIComponent(token)}`
    : `/api/artifacts?path=${encodeURIComponent(resolved)}`;

  if (!PUBLIC_BASE_URL) {
    return relativeUrl;
  }

  const base = /^https?:\/\//i.test(PUBLIC_BASE_URL)
    ? PUBLIC_BASE_URL
    : `https://${PUBLIC_BASE_URL}`;
  const normalizedBase = base.replace(
    /:\/\/ai-backend\.freebacktrack\.techech(?=[:/]|$)/i,
    "://freebacktrack.techech"
  );

  return `${normalizedBase.replace(/\/+$/, "")}${relativeUrl}`;
}

function inferArtifactKind(pathValue: string): BacktestArtifactKind {
  if (/\.html?$/i.test(pathValue)) {
    return "backtest-html";
  }
  if (/\.csv$/i.test(pathValue)) {
    return "csv";
  }
  return "other";
}

function buildArtifactTitle(pathValue: string, kind: BacktestArtifactKind) {
  const basename = path.basename(pathValue).replace(/\.(html?|csv)$/i, "");
  const name = basename.replace(/[_-]+/g, " ").trim() || path.basename(pathValue);
  if (kind === "backtest-html") {
    return `${name} 图表`;
  }
  if (kind === "csv") {
    return `${name} 数据`;
  }
  return name;
}

export function buildArtifactItems(artifactPaths: string[]): BacktestArtifactItem[] {
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const items: BacktestArtifactItem[] = [];

  for (const candidate of artifactPaths) {
    const input = String(candidate || "").trim();
    if (!input) {
      continue;
    }
    const resolvedPath = resolveArtifactPath(input);
    if (seen.has(resolvedPath)) {
      continue;
    }
    seen.add(resolvedPath);

    const kind = inferArtifactKind(resolvedPath);
    items.push({
      path: resolvedPath,
      url: toArtifactUrl(resolvedPath),
      kind,
      title: buildArtifactTitle(resolvedPath, kind),
    });
  }

  return items;
}
