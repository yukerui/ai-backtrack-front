import Link from "next/link";
import type { User } from "next-auth";
import { SidebarHistory } from "@/components/sidebar-history";
import { Button } from "@/components/ui/button";

export function ChatHistoryPage({ user }: { user: User | undefined }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-4 py-6 md:px-6">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="font-semibold text-2xl tracking-tight">Chat</h1>
          <p className="text-muted-foreground text-sm">
            在这里查看历史对话，点开后继续聊；新对话从右上角或下面按钮进入。
          </p>
        </div>
        <Button asChild className="w-full md:w-auto">
          <Link href="/chat/new">开始新对话</Link>
        </Button>
      </div>

      <div className="min-h-0 flex-1 rounded-2xl border bg-card px-4 py-3 shadow-sm md:px-6 md:py-5">
        <SidebarHistory user={user} />
      </div>
    </div>
  );
}
