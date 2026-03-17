import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { BotFatherConsole } from "@/components/bot-father-console";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isBotFatherAdminEmail } from "@/lib/bot-father-admin";

export async function ChannelsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const isAdmin = isBotFatherAdminEmail(session.user.email);

  if (session.user.type === "guest") {
    return (
      <div className="flex h-full flex-col p-4 md:p-6">
        <div className="mb-4">
          <SidebarToggle />
        </div>
        <div className="flex flex-1 items-center justify-center">
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
