const BOT_FATHER_ADMIN_EMAILS = (
  process.env.BOT_FATHER_WEB_ADMIN_EMAILS ||
  process.env.BOT_FATHER_ADMIN_EMAILS ||
  ""
)
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

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
