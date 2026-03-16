import { auth } from "@/app/(auth)/auth";
import { ChatHistoryPage } from "@/components/chat-history-page";

export default async function Page() {
  const session = await auth();

  return <ChatHistoryPage user={session?.user} />;
}
