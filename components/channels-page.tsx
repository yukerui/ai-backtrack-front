import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { isBotFatherAdminEmail } from "@/lib/bot-father-admin";
import { BotFatherConsole } from "@/components/bot-father-console";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export async function ChannelsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const isAdmin = isBotFatherAdminEmail(session.user.email);

  if (session.user.type === "guest") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>注册账号后即可创建和管理 Channels</CardTitle>
            <CardDescription>
              访客账号只能查看这个入口。注册正式账号后，你就可以在网页里创建自己的
              Feishu channel，并长期管理自己的 channel 列表。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div>当前访客账号：{session.user.email || "-"}</div>
            <div>下一步建议直接注册正式账号，再回来打开这个页面。</div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/register">去注册</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/login">已有账号，去登录</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <BotFatherConsole
      currentUserEmail={session.user.email || "-"}
      isAdmin={isAdmin}
    />
  );
}

export default ChannelsPage;
