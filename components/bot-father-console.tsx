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
};

type CreateFormState = {
  botSlug: string;
  displayName: string;
  ownerOpenId: string;
  ownerName: string;
  appId: string;
  appSecret: string;
  allowedUsersCsv: string;
  start: boolean;
  force: boolean;
};

type ViewMode = "onboard" | "manage";

type BotStateFilter = "all" | "running" | "stopped" | "error";

const DEFAULT_CREATE_FORM: CreateFormState = {
  botSlug: "",
  displayName: "",
  ownerOpenId: "",
  ownerName: "",
  appId: "",
  appSecret: "",
  allowedUsersCsv: "",
  start: true,
  force: false,
};

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
  const [viewMode, setViewMode] = useState<ViewMode>("manage");
  const [selectedBotSlug, setSelectedBotSlug] = useState<string | null>(null);
  const [editingBotSlug, setEditingBotSlug] = useState<string | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [createForm, setCreateForm] =
    useState<CreateFormState>(DEFAULT_CREATE_FORM);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [consoleOutput, setConsoleOutput] = useState("");
  const [logLines, setLogLines] = useState("120");
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<BotStateFilter>("all");
  const [lastSetupOutput, setLastSetupOutput] = useState("");
  const [lastSetupBotSlug, setLastSetupBotSlug] = useState<string | null>(null);
  const [lastSetupStarted, setLastSetupStarted] = useState(false);

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

  const botList = botsData?.bots || [];
  const hasBots = botList.length > 0;
  const runningBotCount = botList.filter(
    (bot) => bot.state === "running"
  ).length;
  const errorBotCount = botList.filter((bot) => bot.state === "error").length;
  const activeViewMode: ViewMode = hasBots ? viewMode : "onboard";

  const filteredBotList = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return botList.filter((bot) => {
      if (stateFilter !== "all" && bot.state !== stateFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return [bot.bot_slug, bot.display_name || "", bot.owner_open_id]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [botList, searchQuery, stateFilter]);

  useEffect(() => {
    if (!filteredBotList.length) {
      if (selectedBotSlug !== null) {
        setSelectedBotSlug(null);
      }
      return;
    }
    if (
      !selectedBotSlug ||
      !filteredBotList.some((bot) => bot.bot_slug === selectedBotSlug)
    ) {
      setSelectedBotSlug(filteredBotList[0]?.bot_slug || null);
    }
  }, [filteredBotList, selectedBotSlug]);

  const detailKey = useMemo(() => {
    if (!selectedBotSlug) {
      return null;
    }
    return `/api/bot-father/bots/${encodeURIComponent(selectedBotSlug)}`;
  }, [selectedBotSlug]);

  const {
    data: detailData,
    error: detailError,
    isLoading: detailLoading,
    mutate: mutateDetail,
  } = useSWR<DetailResponse>(detailKey, fetcher);

  const selectedBot = detailData?.bot || null;
  const selectedBotRunning = selectedBot?.state === "running";

  async function refreshCurrentBot() {
    await Promise.all([mutateBots(), mutateDetail()]);
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
          ownerOpenId: submittedForm.ownerOpenId,
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
        setLastSetupOutput(result.output || "创建完成");
        setLastSetupBotSlug(submittedForm.botSlug);
        setLastSetupStarted(submittedForm.start);
        setConsoleOutput("");
      }
      setSelectedBotSlug(submittedForm.botSlug);
      setViewMode("manage");
      await Promise.all([mutateBots(), mutateDetail()]);
      toast.success(editingSlug ? "Channel 已更新" : "Channel 已创建");
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
      ownerOpenId: selectedBot.owner_open_id,
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
    setBusyAction("delete");
    try {
      const result = await callApi<ActionResponse>(
        `/api/bot-father/bots/${encodeURIComponent(selectedBotSlug)}`,
        {
          method: "DELETE",
        }
      );
      setDeleteDialogOpen(false);
      setConsoleOutput(result.output || `已删除 ${selectedBotSlug}`);
      if (lastSetupBotSlug === selectedBotSlug) {
        setLastSetupBotSlug(null);
        setLastSetupOutput("");
        setLastSetupStarted(false);
      }
      closeEditSheet();
      setSelectedBotSlug(null);
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
            完成左侧准备后，在这里一次性提交连接信息。默认会在创建后自动启动。
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
            <Label htmlFor={inSheet ? "sheet-ownerOpenId" : "ownerOpenId"}>
              Owner Open ID
            </Label>
            <Input
              id={inSheet ? "sheet-ownerOpenId" : "ownerOpenId"}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  ownerOpenId: event.target.value,
                }))
              }
              placeholder="ou_xxx"
              value={createForm.ownerOpenId}
            />
            <p className="text-muted-foreground text-xs">
              不知道怎么获取可查看{" "}
              <a
                className="underline underline-offset-4"
                href="https://open.feishu.cn/document/faq/trouble-shooting/how-to-obtain-openid"
                rel="noreferrer"
                target="_blank"
              >
                飞书 OpenID 获取说明
              </a>
            </p>
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

        <div className="flex flex-wrap gap-3">
          <Button disabled={busyAction === "create"} type="submit">
            {busyAction === "create"
              ? "提交中..."
              : isEditing
                ? "保存修改"
                : createForm.start
                  ? "创建并启动"
                  : "创建 Channel"}
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <h1 className="font-semibold text-2xl tracking-tight">Channels</h1>
          <p className="max-w-3xl text-muted-foreground text-sm">
            {isAdmin
              ? `已登录管理员：${currentUserEmail}。把“首次接入”和“日常管理”拆开处理，减少操作判断和页面拥挤。`
              : `当前登录账号：${currentUserEmail}。先完成接入，再到管理视图里统一查看状态、编辑、启停和排障。`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              resetCreateBotForm();
              setViewMode("onboard");
            }}
            type="button"
            variant={activeViewMode === "onboard" ? "default" : "outline"}
          >
            接入新 Channel
          </Button>
          <Button
            disabled={!hasBots}
            onClick={() => {
              setViewMode("manage");
            }}
            type="button"
            variant={activeViewMode === "manage" ? "default" : "outline"}
          >
            管理已有 Channel
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          hint="当前账号可管理的 Channel 数量"
          label="Channels"
          value={String(botList.length)}
        />
        <SummaryCard
          hint="正在运行中的 Bridge 数量"
          label="运行中"
          value={String(runningBotCount)}
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
                <CardTitle>4 步完成接入</CardTitle>
                <CardDescription>
                  新手只需要按顺序准备飞书应用，再在右侧提交表单，不用在说明和管理区之间来回切换。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <StepCard
                  description="在飞书开放平台创建企业自建应用，后续所有配置都在这个应用里完成。"
                  step={1}
                  title="创建飞书应用"
                >
                  <a
                    className="inline-flex text-sm text-foreground underline underline-offset-4"
                    href="https://open.feishu.cn/app"
                    rel="noreferrer"
                    target="_blank"
                  >
                    打开飞书开放平台
                  </a>
                </StepCard>
                <StepCard
                  description="进入“凭证与基础信息”，复制 App ID 和 App Secret，稍后直接填到右侧表单。"
                  step={2}
                  title="准备应用凭证"
                />
                <StepCard
                  description="获取当前拥有者的 Open ID；创建成功后，这个 owner 会自动拥有网页管理权限。"
                  step={3}
                  title="获取 Owner Open ID"
                >
                  <a
                    className="inline-flex text-sm text-foreground underline underline-offset-4"
                    href="https://open.feishu.cn/document/faq/trouble-shooting/how-to-obtain-openid"
                    rel="noreferrer"
                    target="_blank"
                  >
                    查看 Open ID 获取方法
                  </a>
                </StepCard>
                <StepCard
                  description="把权限、Bot 能力、长连接和消息事件一次配置好，后面就能稳定收发消息。"
                  step={4}
                  title="配置权限与事件"
                >
                  <div className="space-y-3">
                    <Collapsible
                      className="rounded-xl border bg-muted/30"
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
                      <CollapsibleContent>
                        <pre className="mx-3 mb-3 overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs text-foreground">
                          {FEISHU_PERMISSION_IMPORT_JSON}
                        </pre>
                      </CollapsibleContent>
                    </Collapsible>
                    <div className="rounded-xl border bg-muted/30 p-3 text-muted-foreground text-xs">
                      <p>1. 在“添加应用能力”里启用 Bot。</p>
                      <p>2. 在“事件与回调”里选择长连接。</p>
                      <p>3. 添加事件 `im.message.receive_v1`。</p>
                      <p>4. 最后在“版本管理与发布”里创建版本并发布。</p>
                    </div>
                  </div>
                </StepCard>
              </CardContent>
            </Card>
          </div>

          <Card id="channel-form-card">
            <CardHeader>
              <CardTitle>接入新 Channel</CardTitle>
              <CardDescription>
                这里只保留最少必填字段。默认会在创建后立即启动，完成后自动切到管理视图。
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
                <CardTitle>我的 Channels</CardTitle>
                <CardDescription>
                  先选中一个
                  Channel，再到右侧执行启动、停止、编辑、诊断或日志操作。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <Input
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                    }}
                    placeholder="搜索名称、标识或 owner open id"
                    value={searchQuery}
                  />
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "全部", value: "all" },
                      { label: "运行中", value: "running" },
                      { label: "已停止", value: "stopped" },
                      { label: "异常", value: "error" },
                    ].map((filter) => (
                      <Button
                        key={filter.value}
                        onClick={() => {
                          setStateFilter(filter.value as BotStateFilter);
                        }}
                        size="sm"
                        type="button"
                        variant={
                          stateFilter === filter.value ? "default" : "outline"
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
                  {filteredBotList.map((bot) => {
                    const isActive = bot.bot_slug === selectedBotSlug;
                    return (
                      <button
                        className={cn(
                          "flex w-full flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors",
                          isActive
                            ? "border-foreground/30 bg-muted"
                            : "border-border hover:bg-muted/50"
                        )}
                        key={bot.bot_slug}
                        onClick={() => setSelectedBotSlug(bot.bot_slug)}
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
                          <Badge variant={stateVariant(bot.state)}>
                            {bot.state}
                          </Badge>
                        </div>
                        <div className="w-full text-muted-foreground text-xs">
                          owner={bot.owner_open_id}
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
                  <CardTitle>最近接入结果</CardTitle>
                  <CardDescription>
                    `{lastSetupBotSlug}` 已完成接入，系统已经替你做好以下动作。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid gap-2 text-muted-foreground">
                    <div>凭证已通过校验，Channel 注册信息已经保存。</div>
                    <div>
                      接入结果已自动切换到管理视图，便于继续查看状态和日志。
                    </div>
                    <div>
                      {lastSetupStarted
                        ? "已按默认策略请求启动 Bridge。"
                        : "本次仅创建 Channel，未自动启动 Bridge。"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        if (lastSetupBotSlug) {
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
                  高频操作前置，低频技术信息和危险操作折叠，减少管理视图的视觉噪音。
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
                              {selectedBot.state}
                            </Badge>
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
                            <span>Owner: {selectedBot.owner_open_id}</span>
                            <span>App ID: {selectedBot.app_id}</span>
                          </div>
                          {selectedBot.last_error ? (
                            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm">
                              最近错误：{selectedBot.last_error}
                            </div>
                          ) : (
                            <div className="text-muted-foreground text-sm">
                              当前 Channel
                              已就绪，可以直接进行启停、编辑和排障。
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
                            {selectedBot.state}
                          </Badge>
                        </div>
                      </div>
                      <div className="rounded-xl border bg-background/80 p-4">
                        <div className="text-muted-foreground text-xs">
                          Owner Open ID
                        </div>
                        <div className="mt-1 break-all font-medium text-sm">
                          {selectedBot.owner_open_id}
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
