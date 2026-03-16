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
import { getBotFatherAdminEmails, isBotFatherAdminEmail } from "@/lib/bot-father-admin";

export default async function BotFatherPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!isBotFatherAdminEmail(session.user.email)) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>无权访问 Bot Father 管理台</CardTitle>
            <CardDescription>
              只有配置在 `BOT_FATHER_WEB_ADMIN_EMAILS` 里的站点管理员才能进入这个页面。
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

  return <BotFatherConsole currentUserEmail={session.user.email || "-"} />;
}
