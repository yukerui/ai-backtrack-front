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

export function enrichAssistantText(raw: string) {
  if (!raw) {
    return raw;
  }

  const pathRegex = /(?:backend\/|front\/)?artifacts\/[A-Za-z0-9._/-]+\.(?:html|csv)/g;
  const barePathRegex =
    /(^|[\s:：,，;；\(\)（）\[\]【】<>《》"'`])((?:backend\/|front\/)?artifacts\/[A-Za-z0-9._/-]+\.(?:html|csv))(?![A-Za-z0-9._/-])/gm;
  const seen = new Set<string>();

  let text = raw
    .replace(
      /在项目根目录运行\s*`open\s+[^`]+`\s*即可在浏览器中查看，?/g,
      "可直接点击下方链接查看，"
    )
    .replace(
      /run\s+`open\s+[^`]+`\s+to\s+view\s+it\s+in\s+your\s+browser\.?/gi,
      "open it directly from the link below."
    )
    .replace(/\[Image\s*#\d+\]/gi, "");

  text = text.replace(
    /`((?:backend\/|front\/)?artifacts\/[A-Za-z0-9._/-]+\.(?:html|csv))`/g,
    (_, pathValue) => {
      const normalized = String(pathValue);
      seen.add(normalized);
      return `[\`${normalized}\`](${toArtifactUrl(normalized)})`;
    }
  );

  text = text.replace(barePathRegex, (_, prefix, pathValue) => {
    const normalized = String(pathValue);
    seen.add(normalized);
    return `${prefix}[${normalized}](${toArtifactUrl(normalized)})`;
  });

  let match: RegExpExecArray | null = null;
  while ((match = pathRegex.exec(text)) !== null) {
    seen.add(match[0]);
  }

  if (seen.size === 0) {
    return text;
  }

  const csvTargets = Array.from(seen).filter((item) => item.endsWith(".csv"));
  const appended: string[] = [];

  if (csvTargets.length > 0) {
    appended.push(
      ...csvTargets.map((pathValue, index) => `[下载数据文件${index + 1}](${toArtifactUrl(pathValue)})`)
    );
  }

  if (appended.length === 0) {
    return text;
  }

  return `${text}\n\n${appended.join(" | ")}`;
}
