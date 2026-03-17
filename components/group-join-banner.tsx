import { cn } from "@/lib/utils";

const GROUP_JOIN_URL =
  "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=158v3e28-d8fb-40fd-94bd-e8762d48d5e8";

export function GroupJoinBanner({ className }: { className?: string }) {
  return (
    <a
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50/80 px-4 py-2 text-center font-medium text-red-600 text-sm transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:hover:bg-red-950/50",
        className
      )}
      href={GROUP_JOIN_URL}
      rel="noreferrer"
      target="_blank"
    >
      快来加入交流群吧，可直接点击。
    </a>
  );
}
