const BOT_FATHER_ADMIN_EMAILS = (
  process.env.BOT_FATHER_WEB_ADMIN_EMAILS ||
  process.env.BOT_FATHER_ADMIN_EMAILS ||
  ""
)
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const BOT_FATHER_USER_BINDINGS = (() => {
  const raw =
    process.env.BOT_FATHER_WEB_BOT_BINDINGS ||
    process.env.BOT_FATHER_BOT_BINDINGS ||
    "";
  const entries = raw
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  const mapping = new Map<string, string[]>();
  for (const entry of entries) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const email = entry.slice(0, separatorIndex).trim().toLowerCase();
    const bots = entry
      .slice(separatorIndex + 1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!email || bots.length === 0) {
      continue;
    }
    mapping.set(email, bots);
  }
  return mapping;
})();

export function getBotFatherAdminEmails() {
  return BOT_FATHER_ADMIN_EMAILS;
}

export function isBotFatherAdminEmail(email: string | null | undefined) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return BOT_FATHER_ADMIN_EMAILS.includes(normalized);
}

export function getBotFatherStaticBotBindings() {
  return BOT_FATHER_USER_BINDINGS;
}

export function getBotFatherStaticallyBoundBotSlugs(
  email: string | null | undefined
) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  if (isBotFatherAdminEmail(normalized)) {
    return [];
  }
  return BOT_FATHER_USER_BINDINGS.get(normalized) || [];
}
