"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { GroupJoinBanner } from "@/components/group-join-banner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { BadgeProps } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { getClientErrorMessage } from "@/lib/errors";
import { cn, fetcher } from "@/lib/utils";
import { SidebarToggle } from "./sidebar-toggle";

type BotSummary = {
  bot_slug: string;
  owner_open_id: string;
  display_name: string | null;
  state: string;
  app_id: string;
  updated_at: string;
};

type BotDetail = BotSummary & {
  owner_name?: string | null;
  feishu_domain?: string | null;
  allowed_users_csv?: string;
  tenant_user_id?: string;
  created_at?: string;
  validated_at?: string | null;
  provisioned_at?: string | null;
  last_started_at?: string | null;
  last_stopped_at?: string | null;
  last_error?: string | null;
  config_path?: string;
  workspace?: string;
  app_secret_masked?: string;
};

type BotFatherInfo = {
  home: string;
  root: string;
  configFile: string;
  configExists: boolean;
  controlPlanePath: string;
  controlPlaneExists: boolean;
  registryDbPath: string;
  registryExists: boolean;
  pythonExec: string;
  botFatherScript: string;
  botFatherScriptExists: boolean;
};

type InfoResponse = {
  ok: true;
  info: BotFatherInfo;
};

type BotsResponse = {
  ok: true;
  bots: BotSummary[];
};

type DetailResponse = {
  ok: true;
  bot: BotDetail;
};

type ActionResponse = {
  ok: true;
  output?: string;
  action?: string;
  lines?: number;
  bot?: BotDetail | null;
  pairing?: PairingSession | null;
};

type PairingSession = {
  bot_slug: string;
  status: string;
  nonce: string | null;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  consumed_at: string | null;
  claimed_open_id?: string | null;
  claimed_chat_id?: string | null;
};

type PairingResponse = {
  ok: true;
  pairing: PairingSession | null;
};

type CreateFormState = {
  botSlug: string;
  displayName: string;
  ownerName: string;
  appId: string;
  appSecret: string;
  allowedUsersCsv: string;
  start: boolean;
  force: boolean;
};

type CreatePreparationChecklist = {
  createdFeishuApp: boolean;
  preparedCredentials: boolean;
  enabledBotCapability: boolean;
};

type ChannelSetupChecklist = {
  configuredLongConnection: boolean;
  addedMessageEvent: boolean;
  publishedVersion: boolean;
};

type WorkspacePanel = "draft" | "bot";

type ChannelListFilter = "all" | "incomplete" | "ready" | "error";

type ChannelLifecycleStage = "incomplete" | "ready" | "error";

type ChannelRow = {
  bot: BotSummary;
  setupChecklist: ChannelSetupChecklist;
  stage: ChannelLifecycleStage;
  lifecycleLabel: string;
  nextStep: string;
  waitingOn: string[];
  progress: number;
  ownerClaimed: boolean;
};

const DEFAULT_CREATE_FORM: CreateFormState = {
  botSlug: "",
  displayName: "",
  ownerName: "",
  appId: "",
  appSecret: "",
  allowedUsersCsv: "",
  start: true,
  force: false,
};

const DEFAULT_CREATE_PREPARATION_CHECKLIST: CreatePreparationChecklist = {
  createdFeishuApp: false,
  preparedCredentials: false,
  enabledBotCapability: false,
};

const DEFAULT_CHANNEL_SETUP_CHECKLIST: ChannelSetupChecklist = {
  configuredLongConnection: false,
  addedMessageEvent: false,
  publishedVersion: false,
};

const CHANNEL_SETUP_STORAGE_KEY = "bot-father-channel-setup-v1";

const FEISHU_PERMISSION_IMPORT_JSON = `{
  "scopes": {
    "tenant": [
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:message.reactions:write_only"
    ],
    "user": []
  }
}`;

const CREATE_PREPARATION_STEPS = [
  {
    key: "createdFeishuApp",
    title: "创建飞书应用",
    description: "先在飞书开放平台创建企业自建应用，后续配置都围绕这个应用完成。",
  },
  {
    key: "preparedCredentials",
    title: "准备凭证并导入权限",
    description:
      "复制 App ID / App Secret，并先导入权限 JSON，避免创建后还要来回找配置入口。",
  },
  {
    key: "enabledBotCapability",
    title: "启用 Bot 能力",
    description:
      "必须先启用 Bot，网页创建成功后服务端才有能力继续接飞书长连接和消息监听。",
  },
] satisfies Array<{
  key: keyof CreatePreparationChecklist;
  title: string;
  description: string;
}>;

const CHANNEL_SETUP_STEPS = [
  {
    key: "configuredLongConnection",
    title: "回飞书选择长连接",
    description:
      "创建成功后，再去“事件与回调”里切成长连接；这一步依赖 Bot 已存在。",
  },
  {
    key: "addedMessageEvent",
    title: "添加消息事件",
    description: "添加事件 `im.message.receive_v1`，让 Bot 能收到私聊消息。",
  },
  {
    key: "publishedVersion",
    title: "创建并发布版本",
    description: "飞书配置改完后记得发布，否则新配置不会生效。",
  },
] satisfies Array<{
  key: keyof ChannelSetupChecklist;
  title: string;
  description: string;
}>;

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-muted/40 via-background to-background p-4">
      <div className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
        {label}
      </div>
      <div className="mt-2 font-semibold text-2xl tracking-tight">{value}</div>
      <div className="mt-1 text-muted-foreground text-sm">{hint}</div>
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-background/80 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted font-medium text-sm">
          {step}
        </div>
        <div className="min-w-0 space-y-2">
          <div>
            <div className="font-medium text-sm text-foreground">{title}</div>
            <div className="text-muted-foreground text-sm">{description}</div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function splitCsv(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeChannelSetupChecklist(
  value?: Partial<ChannelSetupChecklist> | null
) {
  return {
    ...DEFAULT_CHANNEL_SETUP_CHECKLIST,
    ...(value || {}),
  };
}

function readStoredChannelSetupChecklists() {
  if (typeof window === "undefined") {
    return {} as Record<string, ChannelSetupChecklist>;
  }
  try {
    const raw = window.localStorage.getItem(CHANNEL_SETUP_STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, ChannelSetupChecklist>;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {} as Record<string, ChannelSetupChecklist>;
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([botSlug, value]) => [
        botSlug,
        normalizeChannelSetupChecklist(value as Partial<ChannelSetupChecklist>),
      ])
    );
  } catch {
    return {} as Record<string, ChannelSetupChecklist>;
  }
}

function formatOwnerOpenId(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "待发送配对码完成绑定";
  }
  return normalized;
}

function isPendingPairing(pairing: PairingSession | null | undefined) {
  return pairing?.status === "pending" && Boolean(pairing?.nonce);
}

function pairingActionLabel(pairing: PairingSession | null | undefined) {
  return isPendingPairing(pairing) ? "刷新配对码" : "生成配对码";
}

function formatBotStateLabel(state: string) {
  switch (state) {
    case "running":
      return "运行中";
    case "stopped":
      return "已停止";
    case "error":
      return "异常";
    default:
      return state;
  }
}

function deriveChannelSetupChecklist(
  value: Partial<ChannelSetupChecklist> | undefined,
  ownerClaimed: boolean
) {
  if (ownerClaimed && !value) {
    return {
      configuredLongConnection: true,
      addedMessageEvent: true,
      publishedVersion: true,
    } satisfies ChannelSetupChecklist;
  }
  return normalizeChannelSetupChecklist(value);
}

function getChannelLifecycle(
  bot: BotSummary | BotDetail,
  value?: Partial<ChannelSetupChecklist>
): ChannelRow {
  const ownerClaimed = Boolean(String(bot.owner_open_id || "").trim());
  const setupChecklist = deriveChannelSetupChecklist(value, ownerClaimed);
  const waitingOn: string[] = [];

  if (!setupChecklist.configuredLongConnection) {
    waitingOn.push("回飞书切换到长连接");
  }
  if (!setupChecklist.addedMessageEvent) {
    waitingOn.push("添加消息事件");
  }
  if (!setupChecklist.publishedVersion) {
    waitingOn.push("创建并发布版本");
  }
  if (!ownerClaimed) {
    waitingOn.push("完成 Owner 配对");
  }

  let stage: ChannelLifecycleStage = "incomplete";
  if (bot.state === "error") {
    stage = "error";
  } else if (!waitingOn.length) {
    stage = "ready";
  }

  let lifecycleLabel = "接入中";
  if (stage === "error") {
    lifecycleLabel = "异常";
  } else if (!ownerClaimed) {
    lifecycleLabel = "待配对";
  } else if (waitingOn.length) {
    lifecycleLabel = "待确认";
  } else {
    lifecycleLabel = "可管理";
  }

  return {
    bot,
    setupChecklist,
    stage,
    lifecycleLabel,
    nextStep: waitingOn[0] || "进入日常管理",
    waitingOn,
    progress:
      4 + Object.values(setupChecklist).filter(Boolean).length + Number(ownerClaimed),
    ownerClaimed,
  };
}

function lifecycleBadgeClass(stage: ChannelLifecycleStage, ownerClaimed: boolean) {
  if (stage === "error") {
    return "border-destructive/30 bg-destructive/5 text-destructive";
  }
  if (ownerClaimed && stage === "ready") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";
  }
  if (!ownerClaimed) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  }
  return "border-sky-500/30 bg-sky-500/10 text-sky-700";
}

function PairingNonceCard({
  botSlug,
  pairing,
  busy,
  onRefresh,
  onCheckStatus,
}: {
  botSlug: string;
  pairing: PairingSession | null | undefined;
  busy: boolean;
  onRefresh: (botSlug: string) => void;
  onCheckStatus?: () => void;
}) {
  const pending = isPendingPairing(pairing);
  const nonce = pending ? pairing?.nonce : null;
  const expiresAt = formatTimestamp(pairing?.expires_at);

  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="space-y-1">
        <div className="font-medium text-sm">Owner 配对码</div>
        <div className="text-muted-foreground text-sm">
          在网页生成一次性配对码后，用飞书私聊你自己的 Bot 发送这串文本，Bot
          校验成功后才会把当前飞书账号绑定为 Owner。
        </div>
      </div>

      <div className="mt-4 rounded-xl border bg-background/90 p-4">
        <div className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
          当前配对码
        </div>
        <div className="mt-2 break-all font-mono text-3xl tracking-[0.32em]">
          {nonce || "点击下方生成"}
        </div>
        <div className="mt-2 text-muted-foreground text-xs">
          {pending
            ? `Bot: ${botSlug} · 有效期至 ${expiresAt}`
            : "当前没有可用的配对码。"}
        </div>
      </div>

      <div className="mt-4 grid gap-1 text-muted-foreground text-sm">
        <div>1. 记下上面的配对码。</div>
        <div>2. 在飞书里私聊这个 Bot，并直接发送这串配对码。</div>
        <div>3. 收到确认后，当前飞书账号就会成为这个 Channel 的 Owner。</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() => {
            onRefresh(botSlug);
          }}
          type="button"
          variant={pending ? "outline" : "default"}
        >
          {busy ? "处理中..." : pairingActionLabel(pairing)}
        </Button>
        {onCheckStatus ? (
          <Button
            disabled={busy}
            onClick={onCheckStatus}
            type="button"
            variant="outline"
          >
            我已发送，刷新状态
          </Button>
        ) : null}
      </div>
    </div>
  );
}

async function callApi<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.cause ||
      payload?.message ||
      "请求失败";
    throw new Error(message);
  }
  return payload as T;
}

function stateVariant(state: string): BadgeProps["variant"] {
  switch (state) {
    case "running":
      return "default";
    case "error":
      return "destructive";
    case "stopped":
      return "secondary";
    default:
      return "outline";
  }
}

export function BotFatherConsole({
  currentUserEmail,
  isAdmin,
}: {
  currentUserEmail: string;
  isAdmin: boolean;
}) {
  const [activePanel, setActivePanel] = useState<WorkspacePanel>("bot");
  const [selectedBotSlug, setSelectedBotSlug] = useState<string | null>(null);
  const [editingBotSlug, setEditingBotSlug] = useState<string | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [createForm, setCreateForm] =
    useState<CreateFormState>(DEFAULT_CREATE_FORM);
  const [createPreparation, setCreatePreparation] =
    useState<CreatePreparationChecklist>(DEFAULT_CREATE_PREPARATION_CHECKLIST);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [consoleOutput, setConsoleOutput] = useState("");
  const [logLines, setLogLines] = useState("120");
  const [searchQuery, setSearchQuery] = useState("");
  const [listFilter, setListFilter] = useState<ChannelListFilter>("all");
  const [channelSetupChecklists, setChannelSetupChecklists] = useState<
    Record<string, ChannelSetupChecklist>
  >({});
  const [setupChecklistsLoaded, setSetupChecklistsLoaded] = useState(false);
  const [pairingCache, setPairingCache] = useState<
    Record<string, PairingSession | null>
  >({});
  const [recentCreateContext, setRecentCreateContext] = useState<{
    botSlug: string;
    output: string;
    started: boolean;
  } | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  const {
    data: infoData,
    error: infoError,
    isLoading: infoLoading,
  } = useSWR<InfoResponse>(isAdmin ? "/api/bot-father/info" : null, fetcher);
  const {
    data: botsData,
    error: botsError,
    isLoading: botsLoading,
    mutate: mutateBots,
  } = useSWR<BotsResponse>("/api/bot-father/bots", fetcher);

  useEffect(() => {
    setChannelSetupChecklists(readStoredChannelSetupChecklists());
    setSetupChecklistsLoaded(true);
  }, []);

  useEffect(() => {
    if (!setupChecklistsLoaded || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      CHANNEL_SETUP_STORAGE_KEY,
      JSON.stringify(channelSetupChecklists)
    );
  }, [channelSetupChecklists, setupChecklistsLoaded]);

  const botList = botsData?.bots || [];
  const hasBots = botList.length > 0;
  const preCreateReady = Object.values(createPreparation).every(Boolean);

  const botRows = useMemo(() => {
    return [...botList]
      .map((bot) => getChannelLifecycle(bot, channelSetupChecklists[bot.bot_slug]))
      .sort((left, right) => {
        const stageRank: Record<ChannelLifecycleStage, number> = {
          error: 0,
          incomplete: 1,
          ready: 2,
        };
        const stageDiff = stageRank[left.stage] - stageRank[right.stage];
        if (stageDiff !== 0) {
          return stageDiff;
        }
        return (
          new Date(right.bot.updated_at).getTime() -
          new Date(left.bot.updated_at).getTime()
        );
      });
  }, [botList, channelSetupChecklists]);

  const inProgressBotCount = botRows.filter((row) => row.stage !== "ready").length;
  const readyBotCount = botRows.filter((row) => row.stage === "ready").length;
  const errorBotCount = botRows.filter((row) => row.stage === "error").length;

  const filteredBotRows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return botRows.filter((row) => {
      if (listFilter === "incomplete" && row.stage === "ready") {
        return false;
      }
      if (listFilter === "ready" && row.stage !== "ready") {
        return false;
      }
      if (listFilter === "error" && row.stage !== "error") {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return [
        row.bot.bot_slug,
        row.bot.display_name || "",
        row.bot.owner_open_id,
        row.lifecycleLabel,
        row.nextStep,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [botRows, listFilter, searchQuery]);

  const firstIncompleteBotSlug =
    botRows.find((row) => row.stage !== "ready")?.bot.bot_slug || null;

  useEffect(() => {
    if (!hasBots) {
      setActivePanel("draft");
      if (selectedBotSlug !== null) {
        setSelectedBotSlug(null);
      }
      return;
    }
    if (activePanel !== "bot") {
      return;
    }
    if (!filteredBotRows.length) {
      if (selectedBotSlug !== null) {
        setSelectedBotSlug(null);
      }
      return;
    }
    if (
      !selectedBotSlug ||
      !filteredBotRows.some((row) => row.bot.bot_slug === selectedBotSlug)
    ) {
      setSelectedBotSlug(filteredBotRows[0]?.bot.bot_slug || null);
    }
  }, [activePanel, filteredBotRows, hasBots, selectedBotSlug]);

  const detailKey = useMemo(() => {
    if (activePanel !== "bot" || !selectedBotSlug) {
      return null;
    }
    return `/api/bot-father/bots/${encodeURIComponent(selectedBotSlug)}`;
  }, [activePanel, selectedBotSlug]);

  const {
    data: detailData,
    error: detailError,
    isLoading: detailLoading,
    mutate: mutateDetail,
  } = useSWR<DetailResponse>(detailKey, fetcher);

  const selectedBot = detailData?.bot || null;
  const selectedBotRunning = selectedBot?.state === "running";
  const selectedLifecycle = selectedBot
    ? getChannelLifecycle(selectedBot, channelSetupChecklists[selectedBot.bot_slug])
    : null;
  const selectedBotOwnerClaimed = selectedLifecycle?.ownerClaimed || false;
  const pairingKey = useMemo(() => {
    if (!selectedBot || selectedBotOwnerClaimed) {
      return null;
    }
    return `/api/bot-father/bots/${encodeURIComponent(selectedBot.bot_slug)}/pairing`;
  }, [selectedBot, selectedBotOwnerClaimed]);
  const {
    data: pairingData,
    mutate: mutatePairing,
    isLoading: pairingLoading,
  } = useSWR<PairingResponse>(pairingKey, fetcher);
  const selectedBotPairing =
    selectedBot && !selectedBotOwnerClaimed
      ? pairingData?.pairing || pairingCache[selectedBot.bot_slug] || null
      : null;
  const activeViewMode = activePanel === "draft" ? "onboard" : "manage";
  const filteredBotList = filteredBotRows.map((row) => row.bot);
  const lastSetupBotSlug = recentCreateContext?.botSlug || null;
  const lastSetupStarted = recentCreateContext?.started || false;
  const lastSetupOutput = recentCreateContext?.output || "";
  const lastSetupPairing = lastSetupBotSlug
    ? pairingCache[lastSetupBotSlug] || null
    : null;
  let selectedBotPairingSection: ReactNode = null;
  if (selectedBot && !selectedBotOwnerClaimed) {
    if (pairingLoading && !selectedBotPairing) {
      selectedBotPairingSection = (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-muted-foreground text-sm">
          正在加载配对码...
        </div>
      );
    } else {
      selectedBotPairingSection = (
        <PairingNonceCard
          botSlug={selectedBot.bot_slug}
          busy={busyAction === "pairing"}
          onCheckStatus={() => {
            refreshCurrentBot();
          }}
          onRefresh={handleRefreshPairing}
          pairing={selectedBotPairing}
        />
      );
    }
  }

  useEffect(() => {
    if (!scrollTarget) {
      return;
    }
    const targetElement = document.getElementById(scrollTarget);
    if (!targetElement) {
      return;
    }
    targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollTarget(null);
  }, [activePanel, detailLoading, scrollTarget, selectedBot?.bot_slug]);

  async function refreshCurrentBot() {
    await Promise.all([mutateBots(), mutateDetail(), mutatePairing()]);
  }

  async function handleRefreshPairing(botSlug: string) {
    setBusyAction("pairing");
    try {
      const result = await callApi<PairingResponse>(
        `/api/bot-father/bots/${encodeURIComponent(botSlug)}/pairing`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      setPairingCache((current) => ({
        ...current,
        [botSlug]: result.pairing || null,
      }));
      await Promise.all([mutatePairing(), mutateBots(), mutateDetail()]);
      toast.success("配对码已刷新");
    } catch (error) {
      toast.error(getClientErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  function updateChannelSetupChecklist(
    botSlug: string,
    key: keyof ChannelSetupChecklist,
    checked: boolean
  ) {
    setChannelSetupChecklists((current) => ({
      ...current,
      [botSlug]: {
        ...normalizeChannelSetupChecklist(current[botSlug]),
        [key]: checked,
      },
    }));
  }

  function updateCreatePreparationChecklist(
    key: keyof CreatePreparationChecklist,
    checked: boolean
  ) {
    setCreatePreparation((current) => ({
      ...current,
      [key]: checked,
    }));
  }

  function openDraftChannelWorkbench() {
    setActivePanel("draft");
    setCreateForm(DEFAULT_CREATE_FORM);
    setCreatePreparation(DEFAULT_CREATE_PREPARATION_CHECKLIST);
    setEditingBotSlug(null);
    setScrollTarget("draft-precreate-checklist");
  }

  function closeEditSheet() {
    setEditSheetOpen(false);
    setEditingBotSlug(null);
    setCreateForm(DEFAULT_CREATE_FORM);
  }

  async function handleCreateBot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      editingBotSlug &&
      selectedBot?.bot_slug === editingBotSlug &&
      selectedBot.state === "running"
    ) {
      toast.error("请先停止运行后再编辑");
      return;
    }
    const submittedForm = createForm;
    const editingSlug = editingBotSlug;
    setBusyAction("create");
    try {
      const result = await callApi<ActionResponse>("/api/bot-father/bots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          botSlug: submittedForm.botSlug,
          displayName: submittedForm.displayName,
          ownerName: submittedForm.ownerName,
          appId: submittedForm.appId,
          appSecret: submittedForm.appSecret,
          allowedUsers: splitCsv(submittedForm.allowedUsersCsv),
          start: submittedForm.start,
          force: submittedForm.force,
        }),
      });
      if (editingSlug) {
        setConsoleOutput(result.output || "更新完成");
        closeEditSheet();
      } else {
        setRecentCreateContext({
          botSlug: submittedForm.botSlug,
          output: result.output || "创建完成",
          started: submittedForm.start,
        });
        setPairingCache((current) => ({
          ...current,
          [submittedForm.botSlug]: result.pairing || null,
        }));
        setCreateForm(DEFAULT_CREATE_FORM);
        setCreatePreparation(DEFAULT_CREATE_PREPARATION_CHECKLIST);
        setConsoleOutput("");
      }
      setActivePanel("bot");
      setSelectedBotSlug(submittedForm.botSlug);
      setScrollTarget(editingSlug ? "channel-management-card" : "channel-next-steps");
      await mutateBots();
      if (editingSlug) {
        await mutateDetail();
      }
      toast.success(
        editingSlug
          ? "Channel 已更新"
          : "基础连接已创建，继续完成飞书长连接和 Owner 配对"
      );
    } catch (error) {
      toast.error(getClientErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleBotAction(action: string) {
    if (!selectedBotSlug) {
      return;
    }
    setBusyAction(action);
    try {
      const result = await callApi<ActionResponse>(
        `/api/bot-father/bots/${encodeURIComponent(selectedBotSlug)}/actions/${encodeURIComponent(action)}`,
        {
          method: "POST",
        }
      );
      setConsoleOutput(result.output || `${action} completed`);
      await refreshCurrentBot();
      toast.success(`${action} 已执行`);
    } catch (error) {
      toast.error(getClientErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleLoadLogs() {
    if (!selectedBotSlug) {
      return;
    }
    setBusyAction("logs");
    try {
      const result = await callApi<ActionResponse>(
        `/api/bot-father/bots/${encodeURIComponent(selectedBotSlug)}/logs?lines=${encodeURIComponent(logLines)}`
      );
      setConsoleOutput(result.output || "没有日志输出");
      toast.success("已加载日志");
    } catch (error) {
      toast.error(getClientErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  function resetCreateBotForm() {
    setCreateForm(DEFAULT_CREATE_FORM);
    setEditingBotSlug(null);
  }

  function handleEditBot() {
    if (!selectedBot) {
      return;
    }
    setCreateForm({
      botSlug: selectedBot.bot_slug,
      displayName: selectedBot.display_name || "",
      ownerName: selectedBot.owner_name || "",
      appId: selectedBot.app_id,
      appSecret: "",
      allowedUsersCsv: splitCsv(selectedBot.allowed_users_csv || "").join("\n"),
      start: selectedBot.state === "running",
      force: true,
    });
    setEditingBotSlug(selectedBot.bot_slug);
    setEditSheetOpen(true);
  }

  function handleEditRequest() {
    if (selectedBotRunning) {
      toast.error("请先停止运行后再编辑");
      return;
    }
    handleEditBot();
  }

  async function handleDeleteBot() {
    if (!selectedBotSlug) {
      return;
    }
    const deletingBotSlug = selectedBotSlug;
    setBusyAction("delete");
    try {
      const result = await callApi<ActionResponse>(
        `/api/bot-father/bots/${encodeURIComponent(deletingBotSlug)}`,
        {
          method: "DELETE",
        }
      );
      setDeleteDialogOpen(false);
      setConsoleOutput(result.output || `已删除 ${deletingBotSlug}`);
      setChannelSetupChecklists((current) => {
        const next = { ...current };
        delete next[deletingBotSlug];
        return next;
      });
      setPairingCache((current) => {
        const next = { ...current };
        delete next[deletingBotSlug];
        return next;
      });
      if (recentCreateContext?.botSlug === deletingBotSlug) {
        setRecentCreateContext(null);
      }
      closeEditSheet();
      setSelectedBotSlug(null);
      setActivePanel("bot");
      await Promise.all([mutateBots(), mutateDetail()]);
      toast.success("Bot 已删除");
    } catch (error) {
      toast.error(getClientErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  function renderChannelForm(options?: { inSheet?: boolean }) {
    const inSheet = options?.inSheet ?? false;
    const isEditing = Boolean(editingBotSlug);

    return (
      <form className="space-y-5" onSubmit={handleCreateBot}>
        {isEditing ? (
          <div className="rounded-xl border bg-muted/30 p-3 text-muted-foreground text-sm">
            已载入当前 Channel 配置。出于安全原因，现有 App Secret
            不会自动回填。
          </div>
        ) : (
          <div className="rounded-xl border bg-muted/30 p-3 text-muted-foreground text-sm">
            先在飞书侧创建应用并启用 Bot，再在这里提交 App ID / App Secret。
            创建成功后，页面不会跳走，而是继续带你完成长连接、事件、发布和
            Owner 配对。
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={inSheet ? "sheet-displayName" : "displayName"}>
              显示名称
            </Label>
            <Input
              id={inSheet ? "sheet-displayName" : "displayName"}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
              placeholder="纳指助手"
              value={createForm.displayName}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={inSheet ? "sheet-botSlug" : "botSlug"}>
              自定义标识
            </Label>
            <Input
              id={inSheet ? "sheet-botSlug" : "botSlug"}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  botSlug: event.target.value,
                }))
              }
              placeholder="nasdaq_helper"
              readOnly={isEditing}
              value={createForm.botSlug}
            />
            {isEditing ? (
              <p className="text-muted-foreground text-xs">
                编辑已有 Channel 时不可修改自定义标识。
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor={inSheet ? "sheet-appId" : "appId"}>App ID</Label>
            <Input
              id={inSheet ? "sheet-appId" : "appId"}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  appId: event.target.value,
                }))
              }
              placeholder="cli_xxx"
              value={createForm.appId}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor={inSheet ? "sheet-appSecret" : "appSecret"}>
              App Secret
            </Label>
            <Input
              id={inSheet ? "sheet-appSecret" : "appSecret"}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  appSecret: event.target.value,
                }))
              }
              placeholder={
                isEditing
                  ? "如需更新密钥，请重新输入 App Secret"
                  : "输入后不会在页面回显"
              }
              type="password"
              value={createForm.appSecret}
            />
          </div>
        </div>

        <Collapsible
          className="rounded-xl border bg-background/70"
          defaultOpen={isEditing}
        >
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="font-medium text-sm">高级选项</div>
              <div className="text-muted-foreground text-xs">
                补充 owner 名称、附加白名单和启动策略等低频设置。
              </div>
            </div>
            <CollapsibleTrigger asChild>
              <Button size="sm" type="button" variant="outline">
                查看高级选项
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <div className="grid gap-4 border-t px-4 pb-4 pt-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={inSheet ? "sheet-ownerName" : "ownerName"}>
                    Owner 名称
                  </Label>
                  <Input
                    id={inSheet ? "sheet-ownerName" : "ownerName"}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        ownerName: event.target.value,
                      }))
                    }
                    placeholder="可选"
                    value={createForm.ownerName}
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor={inSheet ? "sheet-allowedUsers" : "allowedUsers"}
                  >
                    附加允许用户
                  </Label>
                  <Textarea
                    id={inSheet ? "sheet-allowedUsers" : "allowedUsers"}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        allowedUsersCsv: event.target.value,
                      }))
                    }
                    placeholder="可选，支持逗号或换行分隔；owner 会自动加入白名单"
                    rows={3}
                    value={createForm.allowedUsersCsv}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    checked={createForm.start}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        start: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  {isEditing ? "保存后尝试启动" : "创建后立即启动"}
                </label>
                {isAdmin && !isEditing ? (
                  <label className="flex items-center gap-2">
                    <input
                      checked={createForm.force}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          force: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    已存在时强制覆盖
                  </label>
                ) : null}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {!isEditing && !preCreateReady ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-amber-800 text-sm">
            你还没有确认完创建前准备。推荐先完成左侧 1-3 步；如果你已经在飞书
            后台做完，也可以继续创建。
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {!isEditing && !preCreateReady ? (
            <Button
              disabled={busyAction === "create"}
              onClick={() => {
                setScrollTarget("draft-precreate-checklist");
              }}
              type="button"
              variant="outline"
            >
              继续检查前置步骤
            </Button>
          ) : null}
          <Button
            disabled={busyAction === "create"}
            type="submit"
            variant={!isEditing && !preCreateReady ? "outline" : "default"}
          >
            {busyAction === "create"
              ? "提交中..."
              : isEditing
                ? "保存修改"
                : createForm.start
                  ? preCreateReady
                    ? "创建并启动"
                    : "我确认无误，仍要创建并启动"
                  : preCreateReady
                    ? "创建 Channel"
                    : "我确认无误，仍要创建"}
          </Button>
          {isEditing ? (
            <Button
              disabled={busyAction === "create"}
              onClick={closeEditSheet}
              type="button"
              variant="outline"
            >
              取消
            </Button>
          ) : (
            <Button
              disabled={busyAction === "create"}
              onClick={resetCreateBotForm}
              type="button"
              variant="outline"
            >
              清空表单
            </Button>
          )}
        </div>
      </form>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-4 md:p-6">
      <div className="sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 py-4 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-end">
          <div className="flex items-start gap-3">
            <SidebarToggle className="mt-1 shrink-0" />
            <div className="space-y-2">
              <h1 className="font-semibold text-2xl tracking-tight">
                Channels
              </h1>
              <p className="max-w-3xl text-muted-foreground text-sm">
                {isAdmin
                  ? `已登录管理员：${currentUserEmail}`
                  : `当前登录账号：${currentUserEmail}`}。创建成功后会继续留在接入流程，直到飞书长连接、消息事件、发布和 Owner 配对补齐为止。
              </p>
            </div>
          </div>
          <GroupJoinBanner className="lg:justify-self-center" />
          <div className="flex flex-wrap gap-2 lg:justify-self-end">
            <Button
              onClick={() => {
                openDraftChannelWorkbench();
              }}
              type="button"
              variant={activeViewMode === "onboard" ? "default" : "outline"}
            >
              新建 Channel
            </Button>
            <Button
              disabled={!firstIncompleteBotSlug}
              onClick={() => {
                if (!firstIncompleteBotSlug) {
                  return;
                }
                setActivePanel("bot");
                setSelectedBotSlug(firstIncompleteBotSlug);
              }}
              type="button"
              variant={
                activePanel === "bot" &&
                Boolean(firstIncompleteBotSlug) &&
                selectedBotSlug === firstIncompleteBotSlug
                  ? "default"
                  : "outline"
              }
            >
              继续未完成接入
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          hint="当前账号可管理的 Channel 数量"
          label="Channels"
          value={String(botList.length)}
        />
        <SummaryCard
          hint="还没补齐接入或仍需继续操作的 Channel"
          label="接入中"
          value={String(inProgressBotCount)}
        />
        <SummaryCard
          hint="接入链路已补齐，可直接做日常管理"
          label="可管理"
          value={String(readyBotCount)}
        />
        <SummaryCard
          hint="需要优先排查的异常项"
          label="异常"
          value={String(errorBotCount)}
        />
      </div>

      {activeViewMode === "onboard" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,460px)]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>创建与接入工作台</CardTitle>
                <CardDescription>
                  先在飞书完成创建前准备，再在右侧提交 App ID / App Secret。
                  创建成功后，页面会继续把你留在这里完成长连接、事件、发布和
                  Owner 配对。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-sm text-sky-900">
                  关键顺序已经替你理顺了：先启用 Bot，网页创建成功后，服务端才有能力继续接飞书长连接。
                </div>

                <a
                  className="inline-flex text-sm text-foreground underline underline-offset-4"
                  href="https://open.feishu.cn/app"
                  rel="noreferrer"
                  target="_blank"
                >
                  打开飞书开放平台
                </a>

                <div className="space-y-3" id="draft-precreate-checklist">
                  {CREATE_PREPARATION_STEPS.map((step, index) => (
                    <label
                      className="flex gap-3 rounded-2xl border bg-background/80 p-4"
                      key={step.key}
                    >
                      <input
                        checked={createPreparation[step.key]}
                        className="mt-1 h-4 w-4"
                        onChange={(event) => {
                          updateCreatePreparationChecklist(
                            step.key,
                            event.target.checked
                          );
                        }}
                        type="checkbox"
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="font-medium text-sm">
                          {index + 1}. {step.title}
                        </div>
                        <div className="text-muted-foreground text-sm">
                          {step.description}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                <Collapsible
                  className="min-w-0 overflow-hidden rounded-xl border bg-muted/30"
                  defaultOpen={false}
                >
                  <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground text-sm">
                        权限导入 JSON
                      </p>
                      <p className="text-muted-foreground text-xs">
                        在“权限管理 -&gt; 批量导入/导出权限 -&gt;
                        导入权限”里直接粘贴。
                      </p>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button size="sm" type="button" variant="outline">
                        查看 JSON
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent className="min-w-0">
                    <div className="mx-3 mb-3 min-w-0 overflow-x-auto rounded-md border bg-background">
                      <pre className="w-full min-w-0 whitespace-pre-wrap break-all p-3 font-mono text-[13px] leading-5 text-foreground sm:text-xs sm:leading-5 sm:whitespace-pre">
                        {FEISHU_PERMISSION_IMPORT_JSON}
                      </pre>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
                  <div>
                    <div className="font-medium text-sm">创建后继续完成的 4 步</div>
                    <div className="text-muted-foreground text-sm">
                      这些步骤依赖 Bot 已经创建成功。创建后页面不会跳走，而是继续在这里显示下一步。
                    </div>
                  </div>
                  <StepCard
                    description="回飞书“事件与回调”切成长连接。这一步必须在 Bot 创建后做。"
                    step={5}
                    title="选择长连接"
                  />
                  <StepCard
                    description="添加事件 `im.message.receive_v1`，否则 Bot 收不到私聊配对消息。"
                    step={6}
                    title="添加消息事件"
                  />
                  <StepCard
                    description="创建并发布版本，让长连接和事件配置真正生效。"
                    step={7}
                    title="创建并发布版本"
                  />
                  <StepCard
                    description="回网页生成配对码，再把它私聊发给 Bot 完成 Owner 绑定。"
                    step={8}
                    title="完成 Owner 配对"
                  />
                </div>
              </CardContent>
            </Card>

            {lastSetupBotSlug ? (
              <Card
                className="border-emerald-500/20 bg-emerald-500/5"
                id="channel-next-steps"
              >
                <CardHeader>
                  <CardTitle>创建成功，继续完成接入</CardTitle>
                  <CardDescription>
                    `{lastSetupBotSlug}` 的基础连接已经创建。现在不要离开这个工作台，继续完成长连接、事件、发布和 Owner 配对。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid gap-2 text-muted-foreground">
                    <div>1. 回飞书选择长连接。</div>
                    <div>2. 添加消息事件 `im.message.receive_v1`。</div>
                    <div>3. 创建并发布版本。</div>
                    <div>4. 回到网页生成配对码，并把它私聊发给自己的 Bot。</div>
                    <div>
                      {lastSetupStarted
                        ? "系统已按默认策略请求启动 Bridge。"
                        : "本次只创建了 Channel，未自动启动 Bridge。"}
                    </div>
                  </div>
                  <PairingNonceCard
                    botSlug={lastSetupBotSlug}
                    busy={busyAction === "pairing"}
                    onCheckStatus={() => {
                      setActivePanel("bot");
                      setSelectedBotSlug(lastSetupBotSlug);
                      refreshCurrentBot();
                    }}
                    onRefresh={handleRefreshPairing}
                    pairing={lastSetupPairing}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        setActivePanel("bot");
                        setSelectedBotSlug(lastSetupBotSlug);
                      }}
                      type="button"
                    >
                      打开这个 Channel
                    </Button>
                  </div>
                  <Collapsible defaultOpen={false}>
                    <CollapsibleTrigger asChild>
                      <Button size="sm" type="button" variant="outline">
                        查看本次创建输出
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <Textarea
                        className="mt-3 min-h-[220px] font-mono text-xs"
                        readOnly
                        value={lastSetupOutput}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <Card id="channel-form-card">
            <CardHeader>
              <CardTitle>创建基础连接</CardTitle>
              <CardDescription>
                这里先提交 App ID / App Secret。创建成功后不会跳到“已创建”页，而是继续在当前工作台提示你完成后续步骤。
              </CardDescription>
            </CardHeader>
            <CardContent>{renderChannelForm()}</CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>接入列表</CardTitle>
                <CardDescription>
                  未完成的 Channel 会优先排在前面。先选中一个，再到右侧继续接入或做日常管理。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <Input
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                    }}
                    placeholder="搜索名称、标识、owner 或下一步"
                    value={searchQuery}
                  />
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "全部", value: "all" },
                      { label: "接入中", value: "incomplete" },
                      { label: "可管理", value: "ready" },
                      { label: "异常", value: "error" },
                    ].map((filter) => (
                      <Button
                        key={filter.value}
                        onClick={() => {
                          setListFilter(filter.value as ChannelListFilter);
                        }}
                        size="sm"
                        type="button"
                        variant={
                          listFilter === filter.value ? "default" : "outline"
                        }
                      >
                        {filter.label}
                      </Button>
                    ))}
                    <Button
                      disabled={busyAction !== null}
                      onClick={() => {
                        mutateBots();
                        mutateDetail();
                        mutatePairing();
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      刷新
                    </Button>
                  </div>
                </div>
                {botsLoading ? (
                  <p className="text-muted-foreground text-sm">加载中...</p>
                ) : null}
                {botsError ? (
                  <p className="text-destructive text-sm">
                    {getClientErrorMessage(botsError)}
                  </p>
                ) : null}
                {!botsLoading && !filteredBotList.length ? (
                  <p className="text-muted-foreground text-sm">
                    {botList.length
                      ? "当前筛选条件下没有匹配的 Channel。"
                      : isAdmin
                        ? "当前还没有注册任何 Channel。"
                        : "你还没有创建任何 Channel。"}
                  </p>
                ) : null}
                <div className="space-y-3">
                  {filteredBotRows.map((row) => {
                    const { bot } = row;
                    const isActive =
                      activePanel === "bot" && bot.bot_slug === selectedBotSlug;
                    return (
                      <button
                        className={cn(
                          "flex w-full flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors",
                          isActive
                            ? "border-foreground/30 bg-muted"
                            : "border-border hover:bg-muted/50"
                        )}
                        key={bot.bot_slug}
                        onClick={() => {
                          setActivePanel("bot");
                          setSelectedBotSlug(bot.bot_slug);
                        }}
                        type="button"
                      >
                        <div className="flex w-full items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {bot.display_name || bot.bot_slug}
                            </div>
                            <div className="truncate text-muted-foreground text-sm">
                              {bot.bot_slug}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2.5 py-1 text-xs",
                                lifecycleBadgeClass(row.stage, row.ownerClaimed)
                              )}
                            >
                              {row.lifecycleLabel}
                            </span>
                            <Badge variant={stateVariant(bot.state)}>
                              {formatBotStateLabel(bot.state)}
                            </Badge>
                          </div>
                        </div>
                        <div className="w-full text-muted-foreground text-xs">
                          下一步：{row.nextStep}
                        </div>
                        <div className="w-full text-muted-foreground text-xs">
                          owner={formatOwnerOpenId(bot.owner_open_id)} · 已完成{" "}
                          {row.progress} / 8
                        </div>
                        <div className="w-full text-muted-foreground text-xs">
                          更新于 {formatTimestamp(bot.updated_at)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {isAdmin ? (
              <Collapsible
                className="rounded-2xl border bg-background/70"
                defaultOpen={false}
              >
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="font-medium text-sm">运行环境</div>
                    <div className="text-muted-foreground text-xs">
                      仅管理员可见，用于确认当前页面连接的 control plane 和
                      registry 配置。
                    </div>
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button size="sm" type="button" variant="outline">
                      查看环境信息
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <div className="border-t px-4 pb-4 pt-4 text-sm">
                    {infoLoading ? <p>加载中...</p> : null}
                    {infoError ? (
                      <p className="text-destructive">
                        {getClientErrorMessage(infoError)}
                      </p>
                    ) : null}
                    {infoData?.info ? (
                      <div className="space-y-2 break-all text-muted-foreground">
                        <div>Home: {infoData.info.home}</div>
                        <div>Root: {infoData.info.root}</div>
                        <div>Config: {infoData.info.configFile}</div>
                        <div>Python: {infoData.info.pythonExec}</div>
                        <div>
                          Registry:{" "}
                          {infoData.info.registryExists ? "ok" : "missing"}
                        </div>
                        <div>
                          Control Plane:{" "}
                          {infoData.info.controlPlaneExists ? "ok" : "missing"}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </div>

          <div className="space-y-6">
            {lastSetupBotSlug ? (
              <Card className="border-emerald-500/20 bg-emerald-500/5">
                <CardHeader>
                  <CardTitle>最近创建的 Channel</CardTitle>
                  <CardDescription>
                    `{lastSetupBotSlug}` 只完成了基础连接创建，还没有自动变成“接入完成”。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid gap-2 text-muted-foreground">
                    <div>凭证已通过校验，Channel 注册信息已经保存。</div>
                    <div>
                      接下来仍要回飞书完成长连接、消息事件和版本发布。
                    </div>
                    <div>
                      {lastSetupStarted
                        ? "已按默认策略请求启动 Bridge。"
                        : "本次仅创建 Channel，未自动启动 Bridge。"}
                    </div>
                    <div>
                      下一步请把网页里的配对码私聊发送给这个 Bot，完成 Owner
                      绑定。
                    </div>
                  </div>
                  <PairingNonceCard
                    botSlug={lastSetupBotSlug}
                    busy={busyAction === "pairing"}
                    onCheckStatus={() => {
                      setActivePanel("bot");
                      setSelectedBotSlug(lastSetupBotSlug);
                      refreshCurrentBot();
                    }}
                    onRefresh={handleRefreshPairing}
                    pairing={lastSetupPairing}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        if (lastSetupBotSlug) {
                          setActivePanel("bot");
                          setSelectedBotSlug(lastSetupBotSlug);
                        }
                      }}
                      type="button"
                    >
                      查看这个 Channel
                    </Button>
                  </div>
                  <Collapsible defaultOpen={false}>
                    <CollapsibleTrigger asChild>
                      <Button size="sm" type="button" variant="outline">
                        查看详细输出
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <Textarea
                        className="mt-3 min-h-[220px] font-mono text-xs"
                        readOnly
                        value={lastSetupOutput}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Channel 详情与操作</CardTitle>
                <CardDescription>
                  先看接入状态，再做启停、编辑、日志和排障。接入未完成时，右侧会优先显示配对和下一步。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {selectedBotSlug ? null : (
                  <p className="text-muted-foreground text-sm">
                    先从左侧选择一个 Channel。
                  </p>
                )}
                {detailLoading ? (
                  <p className="text-muted-foreground text-sm">
                    正在加载详情...
                  </p>
                ) : null}
                {detailError ? (
                  <p className="text-destructive text-sm">
                    {getClientErrorMessage(detailError)}
                  </p>
                ) : null}
                {selectedBot ? (
                  <>
                    <div className="rounded-2xl border bg-gradient-to-br from-muted/40 via-background to-background p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-semibold text-xl">
                              {selectedBot.display_name || selectedBot.bot_slug}
                            </div>
                            <Badge variant={stateVariant(selectedBot.state)}>
                              {formatBotStateLabel(selectedBot.state)}
                            </Badge>
                            {selectedLifecycle ? (
                              <span
                                className={cn(
                                  "rounded-full border px-2.5 py-1 text-xs",
                                  lifecycleBadgeClass(
                                    selectedLifecycle.stage,
                                    selectedLifecycle.ownerClaimed
                                  )
                                )}
                              >
                                {selectedLifecycle.lifecycleLabel}
                              </span>
                            ) : null}
                            {selectedBotRunning ? (
                              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-700 text-xs">
                                运行中，请先停止后编辑
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-sm">
                            <span className="break-all font-mono">
                              {selectedBot.bot_slug}
                            </span>
                            <span>
                              Owner:{" "}
                              {formatOwnerOpenId(selectedBot.owner_open_id)}
                            </span>
                            <span>App ID: {selectedBot.app_id}</span>
                          </div>
                          {selectedBot.last_error ? (
                            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm">
                              最近错误：{selectedBot.last_error}
                            </div>
                          ) : (
                            <div className="text-muted-foreground text-sm">
                              {selectedLifecycle?.stage === "ready"
                                ? "接入链路已补齐，可以直接进行启停、编辑和排障。"
                                : `主任务仍是：${selectedLifecycle?.nextStep || "继续接入"}`}
                            </div>
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[280px]">
                          <div className="rounded-xl border bg-background/80 p-3">
                            <div className="text-muted-foreground text-xs">
                              更新时间
                            </div>
                            <div className="mt-1 font-medium text-sm">
                              {formatTimestamp(selectedBot.updated_at)}
                            </div>
                          </div>
                          <div className="rounded-xl border bg-background/80 p-3">
                            <div className="text-muted-foreground text-xs">
                              最近启动
                            </div>
                            <div className="mt-1 font-medium text-sm">
                              {formatTimestamp(selectedBot.last_started_at)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <div className="font-medium text-sm">接入进度</div>
                          <div className="text-muted-foreground text-sm">
                            基础连接创建只算开始。长连接、消息事件、发布和 Owner
                            配对补齐后，才算真正完成接入。
                          </div>
                        </div>
                        <div className="rounded-xl border bg-background/80 px-4 py-3 text-sm">
                          已完成{" "}
                          <span className="font-semibold text-base">
                            {selectedLifecycle?.progress || 0}/8
                          </span>
                          <div className="text-muted-foreground text-xs">
                            下一步：{selectedLifecycle?.nextStep || "-"}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3">
                        {CHANNEL_SETUP_STEPS.map((step) => (
                          <label
                            className="flex gap-3 rounded-2xl border bg-background/80 p-4"
                            key={step.key}
                          >
                            <input
                              checked={
                                selectedLifecycle?.setupChecklist[step.key] || false
                              }
                              className="mt-1 h-4 w-4"
                              onChange={(event) => {
                                updateChannelSetupChecklist(
                                  selectedBot.bot_slug,
                                  step.key,
                                  event.target.checked
                                );
                              }}
                              type="checkbox"
                            />
                            <div className="min-w-0 space-y-1">
                              <div className="font-medium text-sm">
                                {step.title}
                              </div>
                              <div className="text-muted-foreground text-sm">
                                {step.description}
                              </div>
                            </div>
                          </label>
                        ))}
                        <div className="rounded-2xl border bg-background/80 p-4">
                          <div className="font-medium text-sm">Owner 配对</div>
                          <div className="mt-1 text-muted-foreground text-sm">
                            {selectedBotOwnerClaimed
                              ? "当前飞书账号已完成 Owner 绑定。"
                              : "把配对码私聊发给自己的 Bot 后，再回来刷新状态。"}
                          </div>
                        </div>
                      </div>
                    </div>

                    {selectedBotPairingSection}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busyAction !== null || selectedBotRunning}
                        onClick={() => {
                          handleBotAction("start");
                        }}
                        type="button"
                      >
                        启动
                      </Button>
                      <Button
                        disabled={busyAction !== null || !selectedBotRunning}
                        onClick={() => {
                          handleBotAction("stop");
                        }}
                        type="button"
                        variant="outline"
                      >
                        停止
                      </Button>
                      <Button
                        aria-disabled={selectedBotRunning}
                        className={cn(
                          selectedBotRunning
                            ? "border-dashed border-muted-foreground/30 text-muted-foreground opacity-60 hover:bg-background hover:text-muted-foreground"
                            : null
                        )}
                        disabled={busyAction !== null}
                        onClick={handleEditRequest}
                        type="button"
                        variant="outline"
                      >
                        编辑
                      </Button>
                      <Button
                        disabled={busyAction !== null}
                        onClick={() => {
                          refreshCurrentBot();
                        }}
                        type="button"
                        variant="outline"
                      >
                        刷新
                      </Button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-xl border bg-background/80 p-4">
                        <div className="text-muted-foreground text-xs">
                          自定义标识
                        </div>
                        <div className="mt-1 break-all font-medium">
                          {selectedBot.bot_slug}
                        </div>
                      </div>
                      <div className="rounded-xl border bg-background/80 p-4">
                        <div className="text-muted-foreground text-xs">
                          显示名称
                        </div>
                        <div className="mt-1 font-medium">
                          {selectedBot.display_name || "-"}
                        </div>
                      </div>
                        <div className="rounded-xl border bg-background/80 p-4">
                          <div className="text-muted-foreground text-xs">
                            状态
                          </div>
                          <div className="mt-1">
                            <Badge variant={stateVariant(selectedBot.state)}>
                              {formatBotStateLabel(selectedBot.state)}
                            </Badge>
                          </div>
                        </div>
                      <div className="rounded-xl border bg-background/80 p-4">
                        <div className="text-muted-foreground text-xs">
                          Owner Open ID
                        </div>
                        <div className="mt-1 break-all font-medium text-sm">
                          {formatOwnerOpenId(selectedBot.owner_open_id)}
                        </div>
                      </div>
                      <div className="rounded-xl border bg-background/80 p-4">
                        <div className="text-muted-foreground text-xs">
                          App ID
                        </div>
                        <div className="mt-1 break-all font-medium text-sm">
                          {selectedBot.app_id}
                        </div>
                      </div>
                      <div className="rounded-xl border bg-background/80 p-4">
                        <div className="text-muted-foreground text-xs">
                          最近停止
                        </div>
                        <div className="mt-1 font-medium text-sm">
                          {formatTimestamp(selectedBot.last_stopped_at)}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                      <div className="rounded-xl border bg-background/80 p-4">
                        <div className="space-y-1">
                          <div className="font-medium text-sm">诊断与维护</div>
                          <div className="text-muted-foreground text-xs">
                            常用排障操作集中在这里，避免和基础配置混排。
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            disabled={busyAction !== null}
                            onClick={() => {
                              handleBotAction("status");
                            }}
                            type="button"
                            variant="outline"
                          >
                            状态
                          </Button>
                          <Button
                            disabled={busyAction !== null}
                            onClick={() => {
                              handleBotAction("doctor");
                            }}
                            type="button"
                            variant="outline"
                          >
                            诊断
                          </Button>
                          <Button
                            disabled={busyAction !== null}
                            onClick={() => {
                              handleBotAction("rebuild");
                            }}
                            type="button"
                            variant="outline"
                          >
                            重建
                          </Button>
                        </div>
                      </div>
                      <div className="rounded-xl border bg-background/80 p-4">
                        <div className="space-y-2">
                          <Label htmlFor="logLines">日志行数</Label>
                          <Input
                            id="logLines"
                            onChange={(event) =>
                              setLogLines(event.target.value)
                            }
                            value={logLines}
                          />
                        </div>
                        <Button
                          className="mt-4 w-full"
                          disabled={busyAction !== null}
                          onClick={() => {
                            handleLoadLogs();
                          }}
                          type="button"
                          variant="outline"
                        >
                          加载日志
                        </Button>
                      </div>
                    </div>

                    <Collapsible
                      className="rounded-xl border bg-background/70"
                      defaultOpen={false}
                    >
                      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                          <div className="font-medium text-sm">
                            更多技术信息
                          </div>
                          <div className="text-muted-foreground text-xs">
                            密钥掩码、工作区路径和配置文件等低频信息默认折叠。
                          </div>
                        </div>
                        <CollapsibleTrigger asChild>
                          <Button size="sm" type="button" variant="outline">
                            查看技术信息
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                      <CollapsibleContent>
                        <div className="grid gap-3 border-t px-4 pb-4 pt-4 md:grid-cols-2">
                          <div className="rounded-xl border bg-background/80 p-4">
                            <div className="text-muted-foreground text-xs">
                              密钥
                            </div>
                            <div className="mt-1 break-all font-mono text-sm">
                              {selectedBot.app_secret_masked || "-"}
                            </div>
                          </div>
                          <div className="rounded-xl border bg-background/80 p-4 md:col-span-2">
                            <div className="text-muted-foreground text-xs">
                              Workspace
                            </div>
                            <div className="mt-1 break-all font-mono text-sm">
                              {selectedBot.workspace || "-"}
                            </div>
                          </div>
                          <div className="rounded-xl border bg-background/80 p-4 md:col-span-2">
                            <div className="text-muted-foreground text-xs">
                              Config
                            </div>
                            <div className="mt-1 break-all font-mono text-sm">
                              {selectedBot.config_path || "-"}
                            </div>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    <Collapsible
                      className="rounded-xl border border-destructive/30 bg-destructive/5"
                      defaultOpen={false}
                    >
                      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                          <div className="font-medium text-destructive text-sm">
                            危险操作
                          </div>
                          <div className="text-muted-foreground text-xs">
                            删除会同时移除 tenant
                            工作区和注册记录，默认折叠以避免误触。
                          </div>
                        </div>
                        <CollapsibleTrigger asChild>
                          <Button
                            className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            显示危险操作
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                      <CollapsibleContent>
                        <div className="border-destructive/20 border-t px-4 pb-4 pt-4">
                          <Button
                            className="w-full sm:w-auto"
                            disabled={busyAction !== null}
                            onClick={() => {
                              setDeleteDialogOpen(true);
                            }}
                            type="button"
                            variant="destructive"
                          >
                            删除 Channel
                          </Button>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </>
                ) : null}

                {consoleOutput ? (
                  <div className="space-y-2">
                    <Label htmlFor="botConsole">最近执行输出</Label>
                    <Textarea
                      className="min-h-[240px] font-mono text-xs"
                      id="botConsole"
                      readOnly
                      value={consoleOutput}
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            closeEditSheet();
            return;
          }
          setEditSheetOpen(true);
        }}
        open={editSheetOpen}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {editingBotSlug
                ? `编辑 Channel：${editingBotSlug}`
                : "编辑 Channel"}
            </SheetTitle>
            <SheetDescription>
              修改基础配置后保存即可；运行中的 Channel 需要先停止后再编辑。
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6">{renderChannelForm({ inSheet: true })}</div>
        </SheetContent>
      </Sheet>
      <AlertDialog onOpenChange={setDeleteDialogOpen} open={deleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除 Channel？</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedBotSlug
                ? `删除 ${selectedBotSlug} 后，会同时移除 tenant 工作区和注册记录。这个操作不可撤销。`
                : "这个操作不可撤销。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAction === "delete"}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busyAction === "delete"}
              onClick={() => {
                handleDeleteBot();
              }}
            >
              {busyAction === "delete" ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
