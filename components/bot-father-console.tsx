"use client";

import useSWR from "swr";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { getClientErrorMessage } from "@/lib/errors";
import { fetcher } from "@/lib/utils";
import type { BadgeProps } from "@/components/ui/badge";

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
}: {
  currentUserEmail: string;
}) {
  const [selectedBotSlug, setSelectedBotSlug] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateFormState>(DEFAULT_CREATE_FORM);
  const [secretForm, setSecretForm] = useState({
    appSecret: "",
    restart: true,
  });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [consoleOutput, setConsoleOutput] = useState("");
  const [logLines, setLogLines] = useState("120");

  const {
    data: infoData,
    error: infoError,
    isLoading: infoLoading,
  } = useSWR<InfoResponse>("/api/bot-father/info", fetcher);
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
    if (!selectedBotSlug || !botList.some((bot) => bot.bot_slug === selectedBotSlug)) {
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

  async function refreshCurrentBot() {
    await Promise.all([mutateBots(), mutateDetail()]);
  }

  async function handleCreateBot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setSelectedBotSlug(createForm.botSlug);
      setSecretForm({ appSecret: "", restart: true });
      await Promise.all([mutateBots(), mutateDetail()]);
      toast.success("Bot 已创建");
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

  async function handleRotateSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBotSlug) {
      return;
    }
    setBusyAction("rotate-secret");
    try {
      const result = await callApi<ActionResponse>(
        `/api/bot-father/bots/${encodeURIComponent(selectedBotSlug)}/rotate-secret`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            appSecret: secretForm.appSecret,
            restart: secretForm.restart,
          }),
        }
      );
      setSecretForm({ appSecret: "", restart: true });
      setConsoleOutput(result.output || "密钥轮换完成");
      await refreshCurrentBot();
      toast.success("已轮换密钥");
    } catch (error) {
      toast.error(getClientErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteBot() {
    if (!selectedBotSlug) {
      return;
    }
    if (!window.confirm(`确认删除 ${selectedBotSlug} 吗？这会移除 tenant 工作区和注册记录。`)) {
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
      setConsoleOutput(result.output || `已删除 ${selectedBotSlug}`);
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
        <h1 className="font-semibold text-2xl tracking-tight">Bot Father 管理台</h1>
        <p className="text-muted-foreground text-sm">
          已登录管理员：{currentUserEmail}。这里直接管理 Feishu Bot Father 的租户注册、
          启停、日志、重建、密钥轮换和删除，不再依赖聊天命令。
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>飞书接入说明</CardTitle>
              <CardDescription>
                先在飞书开放平台创建企业自建应用，再把 App ID / App Secret 填到右侧表单。
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
                <li>在“添加应用能力”里启用 Bot</li>
                <li>在“事件与回调”里选择长连接，并添加 im.message.receive_v1</li>
                <li>在“版本管理与发布”里创建版本并发布</li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>运行环境</CardTitle>
              <CardDescription>当前网页管理台连接的 Bot Father 后端配置。</CardDescription>
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
                  <div>Registry: {infoData.info.registryExists ? "ok" : "missing"}</div>
                  <div>Control Plane: {infoData.info.controlPlaneExists ? "ok" : "missing"}</div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>创建 / 更新 Bot</CardTitle>
              <CardDescription>
                对应原来的 `/new` 和 `/register`。这里直接一次性提交完整字段。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateBot}>
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
                      value={createForm.botSlug}
                    />
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
                      placeholder="输入后不会在页面回显"
                      type="password"
                      value={createForm.appSecret}
                    />
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
                </div>

                <Button disabled={busyAction === "create"} type="submit">
                  {busyAction === "create" ? "提交中..." : "创建 / 更新 Bot"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Bot 列表</CardTitle>
              <CardDescription>
                对应原来的 `/list`、`/describe`、`/status`、`/logs`、`/doctor`、`/rebuild` 和 admin 删除操作。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busyAction !== null}
                  onClick={() => {
                    void mutateBots();
                    void mutateDetail();
                  }}
                  type="button"
                  variant="outline"
                >
                  刷新列表
                </Button>
              </div>
              {botsLoading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
              {botsError ? (
                <p className="text-destructive text-sm">
                  {getClientErrorMessage(botsError)}
                </p>
              ) : null}
              {!botsLoading && botList.length === 0 ? (
                <p className="text-muted-foreground text-sm">当前还没有注册任何 bot。</p>
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
                          <div className="truncate font-medium">{bot.bot_slug}</div>
                          <div className="truncate text-muted-foreground text-sm">
                            {bot.display_name || "未设置显示名称"}
                          </div>
                        </div>
                        <Badge variant={stateVariant(bot.state)}>{bot.state}</Badge>
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
              <CardTitle>Bot 详情与操作</CardTitle>
              <CardDescription>
                选中一个 bot 后，可直接查看详情、启停、诊断、日志、重建、轮换密钥和删除。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!selectedBotSlug ? (
                <p className="text-muted-foreground text-sm">先从上方选择一个 bot。</p>
              ) : null}
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
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">自定义标识</div>
                      <div className="break-all font-medium">{selectedBot.bot_slug}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">显示名称</div>
                      <div>{selectedBot.display_name || "-"}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">Owner Open ID</div>
                      <div className="break-all">{selectedBot.owner_open_id}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">App ID</div>
                      <div className="break-all">{selectedBot.app_id}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">密钥</div>
                      <div>{selectedBot.app_secret_masked || "-"}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">状态</div>
                      <div className="flex items-center gap-2">
                        <Badge variant={stateVariant(selectedBot.state)}>
                          {selectedBot.state}
                        </Badge>
                        {selectedBot.last_error ? (
                          <span className="text-destructive text-xs">
                            {selectedBot.last_error}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">Workspace</div>
                      <div className="break-all text-sm">{selectedBot.workspace || "-"}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">Config</div>
                      <div className="break-all text-sm">
                        {selectedBot.config_path || "-"}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">更新时间</div>
                      <div>{formatTimestamp(selectedBot.updated_at)}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-xs">最近启动</div>
                      <div>{formatTimestamp(selectedBot.last_started_at)}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={busyAction !== null}
                      onClick={() => void handleBotAction("start")}
                      type="button"
                      variant="default"
                    >
                      启动
                    </Button>
                    <Button
                      disabled={busyAction !== null}
                      onClick={() => void handleBotAction("stop")}
                      type="button"
                      variant="outline"
                    >
                      停止
                    </Button>
                    <Button
                      disabled={busyAction !== null}
                      onClick={() => void handleBotAction("status")}
                      type="button"
                      variant="outline"
                    >
                      状态
                    </Button>
                    <Button
                      disabled={busyAction !== null}
                      onClick={() => void handleBotAction("doctor")}
                      type="button"
                      variant="outline"
                    >
                      诊断
                    </Button>
                    <Button
                      disabled={busyAction !== null}
                      onClick={() => void handleBotAction("rebuild")}
                      type="button"
                      variant="outline"
                    >
                      重建
                    </Button>
                    <Button
                      disabled={busyAction !== null}
                      onClick={() => void refreshCurrentBot()}
                      type="button"
                      variant="outline"
                    >
                      刷新详情
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="logLines">日志行数</Label>
                        <Input
                          id="logLines"
                          onChange={(event) => setLogLines(event.target.value)}
                          value={logLines}
                        />
                      </div>
                      <Button
                        disabled={busyAction !== null}
                        onClick={() => void handleLoadLogs()}
                        type="button"
                        variant="outline"
                      >
                        加载日志
                      </Button>
                    </div>
                  </div>

                  <form className="space-y-3" onSubmit={handleRotateSecret}>
                    <div className="space-y-2">
                      <Label htmlFor="rotateSecret">轮换 App Secret</Label>
                      <Input
                        id="rotateSecret"
                        onChange={(event) =>
                          setSecretForm((current) => ({
                            ...current,
                            appSecret: event.target.value,
                          }))
                        }
                        placeholder="输入新的 App Secret"
                        type="password"
                        value={secretForm.appSecret}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        checked={secretForm.restart}
                        onChange={(event) =>
                          setSecretForm((current) => ({
                            ...current,
                            restart: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      轮换后自动重启 bot
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busyAction !== null}
                        type="submit"
                        variant="outline"
                      >
                        轮换密钥
                      </Button>
                      <Button
                        disabled={busyAction !== null}
                        onClick={() => void handleDeleteBot()}
                        type="button"
                        variant="destructive"
                      >
                        删除 Bot
                      </Button>
                    </div>
                  </form>
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
    </div>
  );
}
