import { redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { BotFatherConsole } from "@/components/bot-father-console";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getBotFatherAccessibleBotSlugs,
  getBotFatherAdminEmails,
  hasBotFatherConsoleAccess,
  isBotFatherAdminEmail,
} from "@/lib/bot-father-admin";

export default async function BotFatherPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const isAdmin = isBotFatherAdminEmail(session.user.email);
  const accessibleBots = getBotFatherAccessibleBotSlugs(session.user.email);

  if (!hasBotFatherConsoleAccess(session.user.email)) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>无权访问 Bot Father 管理台</CardTitle>
            <CardDescription>
              只有配置在 `BOT_FATHER_WEB_ADMIN_EMAILS` 的管理员，或显式绑定了 bot 的邮箱，才能进入这个页面。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div>当前账号：{session.user.email || "-"}</div>
            <div>
              已配置管理员：
              {getBotFatherAdminEmails().length > 0
                ? getBotFatherAdminEmails().join(", ")
                : "未配置"}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <BotFatherConsole
      accessibleBotSlugs={accessibleBots}
      currentUserEmail={session.user.email || "-"}
      isAdmin={isAdmin}
    />
  );
}
