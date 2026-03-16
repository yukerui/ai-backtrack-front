"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
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
      "im:message.reactions:write_only"
    ],
    "user": []
  }
}`;

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
  const [selectedBotSlug, setSelectedBotSlug] = useState<string | null>(null);
  const [editingBotSlug, setEditingBotSlug] = useState<string | null>(null);
  const [createForm, setCreateForm] =
    useState<CreateFormState>(DEFAULT_CREATE_FORM);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [consoleOutput, setConsoleOutput] = useState("");
  const [logLines, setLogLines] = useState("120");

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

  useEffect(() => {
    if (!botList.length) {
      if (selectedBotSlug !== null) {
        setSelectedBotSlug(null);
      }
      return;
    }
    if (
      !selectedBotSlug ||
      !botList.some((bot) => bot.bot_slug === selectedBotSlug)
    ) {
      setSelectedBotSlug(botList[0]?.bot_slug || null);
    }
  }, [botList, selectedBotSlug]);

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
    const editingSlug = editingBotSlug;
    setBusyAction("create");
    try {
      const result = await callApi<ActionResponse>("/api/bot-father/bots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          botSlug: createForm.botSlug,
          displayName: createForm.displayName,
          ownerOpenId: createForm.ownerOpenId,
          ownerName: createForm.ownerName,
          appId: createForm.appId,
          appSecret: createForm.appSecret,
          allowedUsers: splitCsv(createForm.allowedUsersCsv),
          start: createForm.start,
          force: createForm.force,
        }),
      });
      setConsoleOutput(result.output || "创建完成");
      setCreateForm(DEFAULT_CREATE_FORM);
      setEditingBotSlug(null);
      setSelectedBotSlug(createForm.botSlug);
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
    setConsoleOutput(
      `已将 ${selectedBot.bot_slug} 的配置载入表单。出于安全原因，App Secret 不会自动回填。`
    );
    window.requestAnimationFrame(() => {
      document.getElementById("channel-form-card")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
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
      resetCreateBotForm();
      setSelectedBotSlug(null);
      await Promise.all([mutateBots(), mutateDetail()]);
      toast.success("Bot 已删除");
    } catch (error) {
      toast.error(getClientErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="flex h-full flex-col gap-6 p-4 md:p-6">
      <div className="space-y-2">
        <h1 className="font-semibold text-2xl tracking-tight">Channels</h1>
        <p className="text-muted-foreground text-sm">
          {isAdmin
            ? `已登录管理员：${currentUserEmail}。这里直接管理全部 Feishu channels 的注册、编辑、启停、日志、重建和删除，不再依赖聊天命令。`
            : `当前登录账号：${currentUserEmail}。你可以创建新的 Feishu channel，并管理当前账号名下的全部 channels。`}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{isAdmin ? "飞书接入说明" : "创建前准备"}</CardTitle>
              <CardDescription>
                先在飞书开放平台创建企业自建应用，再把 App ID / App Secret
                填到右侧表单。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                <li>
                  打开{" "}
                  <a
                    className="font-medium text-foreground underline underline-offset-4"
                    href="https://open.feishu.cn/app"
                    rel="noreferrer"
                    target="_blank"
                  >
                    飞书开放平台
                  </a>{" "}
                  创建企业自建应用
                </li>
                <li>在“凭证与基础信息”里复制 App ID 和 App Secret</li>
                <li>
                  获取 Owner Open ID 并填到右侧表单；可在{" "}
                  <a
                    className="font-medium text-foreground underline underline-offset-4"
                    href="https://open.feishu.cn/document/faq/trouble-shooting/how-to-obtain-openid"
                    rel="noreferrer"
                    target="_blank"
                  >
                    如何获取 OpenID
                  </a>{" "}
                  查看
                </li>
                <li>在“添加应用能力”里启用 Bot</li>
                <li>
                  在“事件与回调”里选择长连接，并添加 im.message.receive_v1
                </li>
                <li>在“版本管理与发布”里创建版本并发布</li>
                {isAdmin ? null : (
                  <li>通过这个页面创建的 bot 会自动归属到当前网站账号</li>
                )}
              </ol>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">权限配置</p>
                  <p className="text-muted-foreground">
                    在飞书开放平台进入“权限管理 -&gt; 批量导入/导出权限 -&gt;
                    导入权限”，复制以下内容导入。
                  </p>
                </div>
                <Collapsible className="mt-3" defaultOpen={false}>
                  <CollapsibleTrigger asChild>
                    <Button size="sm" type="button" variant="outline">
                      查看权限导入 JSON
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="mt-3 overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs text-foreground">
                      {FEISHU_PERMISSION_IMPORT_JSON}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </CardContent>
          </Card>

          {isAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle>运行环境</CardTitle>
                <CardDescription>
                  当前 Channels 页面连接的后端配置。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
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
              </CardContent>
            </Card>
          ) : null}

          <Card id="channel-form-card">
            <CardHeader>
              <CardTitle>
                {editingBotSlug
                  ? `编辑 Channel：${editingBotSlug}`
                  : "创建 / 更新 Channel"}
              </CardTitle>
              <CardDescription>
                {editingBotSlug
                  ? "已将当前 channel 回填到表单。保存修改时需要重新输入 App Secret。"
                  : isAdmin
                    ? "这里直接一次性提交完整字段，创建或覆盖一个 Feishu channel。"
                    : "创建成功后，当前登录账号会自动获得这个 channel 的网页管理权限。"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateBot}>
                {editingBotSlug ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={busyAction !== null}
                      onClick={resetCreateBotForm}
                      type="button"
                      variant="outline"
                    >
                      取消编辑
                    </Button>
                  </div>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="botSlug">自定义标识</Label>
                    <Input
                      id="botSlug"
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          botSlug: event.target.value,
                        }))
                      }
                      placeholder="nasdaq_helper"
                      readOnly={Boolean(editingBotSlug)}
                      value={createForm.botSlug}
                    />
                    {editingBotSlug ? (
                      <p className="text-muted-foreground text-xs">
                        编辑已有 channel 时不可修改 slug。
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="displayName">显示名称</Label>
                    <Input
                      id="displayName"
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
                    <Label htmlFor="ownerOpenId">Owner Open ID</Label>
                    <Input
                      id="ownerOpenId"
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
                      {editingBotSlug
                        ? "编辑时可直接修改 owner open id。"
                        : null}
                      {editingBotSlug ? " " : null}
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
                    <Label htmlFor="ownerName">Owner 名称</Label>
                    <Input
                      id="ownerName"
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
                    <Label htmlFor="appId">App ID</Label>
                    <Input
                      id="appId"
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
                  <div className="space-y-2">
                    <Label htmlFor="appSecret">App Secret</Label>
                    <Input
                      id="appSecret"
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          appSecret: event.target.value,
                        }))
                      }
                      placeholder={
                        editingBotSlug
                          ? "编辑时需要重新输入 App Secret"
                          : "输入后不会在页面回显"
                      }
                      type="password"
                      value={createForm.appSecret}
                    />
                    {editingBotSlug ? (
                      <p className="text-muted-foreground text-xs">
                        出于安全原因，现有 App Secret 不会回填到表单。
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="allowedUsers">附加允许用户</Label>
                  <Textarea
                    id="allowedUsers"
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
                    创建后立即启动
                  </label>
                  {isAdmin ? (
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

                <Button disabled={busyAction === "create"} type="submit">
                  {busyAction === "create"
                    ? "提交中..."
                    : editingBotSlug
                      ? "保存修改"
                      : "创建 / 更新 Channel"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Channels</CardTitle>
              <CardDescription>
                {isAdmin
                  ? "这里展示全部 channels，你可以直接查看详情、编辑、启停、诊断、日志、重建和删除。"
                  : "这里只显示当前登录账号拥有的 channels，你可以直接查看详情、编辑、启停、诊断、日志、重建和删除。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busyAction !== null}
                  onClick={() => {
                    mutateBots();
                    mutateDetail();
                  }}
                  type="button"
                  variant="outline"
                >
                  刷新列表
                </Button>
              </div>
              {botsLoading ? (
                <p className="text-sm text-muted-foreground">加载中...</p>
              ) : null}
              {botsError ? (
                <p className="text-destructive text-sm">
                  {getClientErrorMessage(botsError)}
                </p>
              ) : null}
              {!botsLoading && botList.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {isAdmin
                    ? "当前还没有注册任何 channel。"
                    : "你还没有创建任何 channel。"}
                </p>
              ) : null}
              <div className="space-y-3">
                {botList.map((bot) => {
                  const isActive = bot.bot_slug === selectedBotSlug;
                  return (
                    <button
                      className={`flex w-full flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors ${
                        isActive
                          ? "border-foreground/30 bg-muted"
                          : "border-border hover:bg-muted/50"
                      }`}
                      key={bot.bot_slug}
                      onClick={() => setSelectedBotSlug(bot.bot_slug)}
                      type="button"
                    >
                      <div className="flex w-full items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {bot.bot_slug}
                          </div>
                          <div className="truncate text-muted-foreground text-sm">
                            {bot.display_name || "未设置显示名称"}
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
                        app_id={bot.app_id}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Channel 详情与操作</CardTitle>
              <CardDescription>
                选中一个 channel 后，可按配置、运行、诊断和危险操作分组管理。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {selectedBotSlug ? null : (
                <p className="text-muted-foreground text-sm">
                  先从上方选择一个 channel。
                </p>
              )}
              {detailLoading ? (
                <p className="text-muted-foreground text-sm">正在加载详情...</p>
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
                              运行中暂不可编辑
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
                            当前 channel
                            已就绪，可在下方按分组执行配置、运行和诊断操作。
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

                  <div className="grid gap-3 md:grid-cols-2">
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
                      <div className="text-muted-foreground text-xs">状态</div>
                      <div className="mt-1">
                        <Badge variant={stateVariant(selectedBot.state)}>
                          {selectedBot.state}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <Collapsible
                    className="rounded-xl border bg-background/70"
                    defaultOpen={false}
                  >
                    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <div className="font-medium text-sm">更多技术信息</div>
                        <div className="text-muted-foreground text-xs">
                          密钥、工作区路径和配置文件等低频信息默认折叠，避免页面过满。
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

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border bg-background/80 p-4">
                      <div className="space-y-1">
                        <div className="font-medium text-sm">配置</div>
                        <div className="text-muted-foreground text-xs">
                          调整 channel 配置并刷新当前详情。
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
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
                          编辑配置
                        </Button>
                        <Button
                          disabled={busyAction !== null}
                          onClick={() => {
                            refreshCurrentBot();
                          }}
                          type="button"
                          variant="outline"
                        >
                          刷新详情
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-xl border bg-background/80 p-4">
                      <div className="space-y-1">
                        <div className="font-medium text-sm">运行控制</div>
                        <div className="text-muted-foreground text-xs">
                          查看运行状态，并执行启动或停止。
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          disabled={busyAction !== null || selectedBotRunning}
                          onClick={() => {
                            handleBotAction("start");
                          }}
                          type="button"
                          variant="default"
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
                          disabled={busyAction !== null}
                          onClick={() => {
                            handleBotAction("status");
                          }}
                          type="button"
                          variant="outline"
                        >
                          状态
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-xl border bg-background/80 p-4 md:col-span-2">
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                        <div>
                          <div className="space-y-1">
                            <div className="font-medium text-sm">
                              诊断与维护
                            </div>
                            <div className="text-muted-foreground text-xs">
                              诊断、重建并查看运行日志。
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
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
                        <div className="grid gap-2">
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
                    </div>
                  </div>

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
                          删除 channel 的操作默认折叠，避免误触和占用过多空间。
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
                        <div className="mb-3 text-muted-foreground text-xs">
                          删除 channel 后，会同时移除 tenant 工作区和注册记录。
                        </div>
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

              <div className="space-y-2">
                <Label htmlFor="botConsole">执行输出</Label>
                <Textarea
                  className="min-h-[260px] font-mono text-xs"
                  id="botConsole"
                  readOnly
                  value={consoleOutput}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
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
