import type { KbStore } from "@/lib/kb/store";
import type { KbListFilter, KbListRow, KbMeta } from "@/lib/kb/types";

/**
 * 知识库运维管理逻辑（T20）：供 scripts/kb-manage.mjs 与单测共用。
 *  - list / deprecate / reactivate / delete / stats 五子命令
 *  - 纯 Node 参数解析（无新依赖）；输出中文、对齐可读
 *  - id 前缀须唯一匹配（歧义/未命中给明确提示）；delete 默认 dry-run，--yes 才真删
 *  - 仅存储层（Supabase/File），不依赖嵌入（SUPABASE_* 与 EMBEDDING_* 无需嵌入密钥）
 */

export interface ManageArgs {
  cmd: string;
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export interface CommandIO {
  log: (s: string) => void;
  error: (s: string) => void;
}

const STATUSES = ["active", "candidate", "deprecated"] as const;
const ORIGINS = ["curated", "inferred", "community"] as const;

/** 需要取值的旗标（其余视为布尔开关，如 --yes）。 */
const VALUE_FLAGS = new Set([
  "--patch",
  "--status",
  "--origin",
  "--class",
  "--limit",
  "--reason",
  "--all-patch",
]);

export const USAGE = [
  "用法：node scripts/kb-manage.mjs <子命令> [选项]",
  "子命令：",
  "  list       [--patch 12.1] [--status active|candidate|deprecated] [--origin curated|inferred|community] [--class X] [--limit N]",
  "  deprecate  <id前缀 | --all-patch 12.0> [--reason 备注]   # 把 status 置为 deprecated",
  "  reactivate <id前缀>                                      # deprecated → active",
  "  delete     <id前缀 | --patch 12.0 | --status deprecated> [--yes]   # 物理删除，默认 dry-run",
  "  stats                                                     # 按 patch/status/origin 统计",
].join("\n");

export function parseManageArgs(argv: string[]): ManageArgs {
  const cmd = argv[0] ?? "";
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = eq >= 0 ? a.slice(0, eq) : a;
      if (eq >= 0) {
        flags[key] = a.slice(eq + 1);
      } else if (VALUE_FLAGS.has(key)) {
        const v = argv[i + 1];
        if (v !== undefined && !v.startsWith("--")) {
          flags[key] = v;
          i++;
        } else {
          flags[key] = "";
        }
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { cmd, flags, positionals };
}

function parseStatus(v: string | boolean | undefined): KbMeta["status"] {
  const s = String(v ?? "");
  if (!(STATUSES as readonly string[]).includes(s)) {
    throw new Error(`非法 status "${s}"（可选：${STATUSES.join(" | ")}）`);
  }
  return s as KbMeta["status"];
}

function parseOrigin(v: string | boolean | undefined): KbMeta["origin"] {
  const s = String(v ?? "");
  if (!(ORIGINS as readonly string[]).includes(s)) {
    throw new Error(`非法 origin "${s}"（可选：${ORIGINS.join(" | ")}）`);
  }
  return s as KbMeta["origin"];
}

function parseLimit(v: string | boolean | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--limit 必须是正整数，收到 "${String(v)}"`);
  }
  return n;
}

/** 展示宽度：CJK 按 2 计，用于等宽对齐。 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0xff ? 2 : 1;
  return w;
}

function pad(s: string, width: number): string {
  const need = width - displayWidth(s);
  return s + (need > 0 ? " ".repeat(need) : " ");
}

function printList(rows: KbListRow[], io: CommandIO): void {
  io.log(`共 ${rows.length} 条片段`);
  if (rows.length === 0) return;
  const H = { id: 8, patch: 8, status: 10, origin: 9, class: 26 };
  io.log(
    [pad("ID", H.id), pad("PATCH", H.patch), pad("STATUS", H.status), pad("ORIGIN", H.origin), pad("CLASS/SPEC", H.class)]
      .join("  ") + "  TEXT（前 60 字） / SOURCE",
  );
  for (const r of rows) {
    const cls = `${r.meta.class}/${r.meta.spec}`;
    const fixed =
      [pad(r.id.slice(0, 8), H.id), pad(r.meta.patch, H.patch), pad(r.meta.status, H.status), pad(r.meta.origin, H.origin), pad(cls, H.class)].join("  ") +
      "  ";
    const text = r.chunkText.length > 60 ? `${r.chunkText.slice(0, 60)}…` : r.chunkText;
    io.log(fixed + text);
    io.log(" ".repeat(displayWidth(fixed)) + r.meta.source_url);
  }
}

function printGroup(title: string, map: Map<string, number>, io: CommandIO): void {
  io.log(`${title}：`);
  const keys = [...map.keys()].sort();
  for (const k of keys) io.log(`  ${k}  ${map.get(k)}`);
}

/** 按 id 前缀唯一匹配；歧义/未命中抛错。 */
export async function resolveByPrefix(store: KbStore, prefix: string): Promise<KbListRow> {
  const rows = await store.list({ idPrefix: prefix });
  if (rows.length === 0) {
    throw new Error(`未找到 id 前缀为 "${prefix}" 的片段（请用 list 核对 id）。`);
  }
  if (rows.length > 1) {
    const ids = rows.map((r) => `${r.id.slice(0, 8)}  [${r.meta.status}] ${r.meta.patch}`).join("\n");
    throw new Error(`id 前缀 "${prefix}" 命中 ${rows.length} 条（不唯一），请提供更长的前缀：\n${ids}`);
  }
  return rows[0];
}

async function cmdList(store: KbStore, flags: ManageArgs["flags"], positionals: string[], io: CommandIO): Promise<number> {
  if (positionals.length > 0) {
    io.error("list 不接受位置参数，只接受过滤旗标（见 --help 用法）。");
    return 2;
  }
  const filter: KbListFilter = {};
  if (flags["--patch"] !== undefined && flags["--patch"] !== "") filter.patch = String(flags["--patch"]);
  if (flags["--status"] !== undefined && flags["--status"] !== "") filter.status = parseStatus(flags["--status"]);
  if (flags["--origin"] !== undefined && flags["--origin"] !== "") filter.origin = parseOrigin(flags["--origin"]);
  if (flags["--class"] !== undefined && flags["--class"] !== "") filter.class = String(flags["--class"]);
  filter.limit = parseLimit(flags["--limit"]);
  printList(await store.list(filter), io);
  return 0;
}

async function cmdDeprecate(store: KbStore, flags: ManageArgs["flags"], positionals: string[], io: CommandIO): Promise<number> {
  const reason = flags["--reason"] !== undefined && flags["--reason"] !== "" ? String(flags["--reason"]) : undefined;
  const hasPrefix = positionals.length > 0;
  const hasAllPatch = flags["--all-patch"] !== undefined && flags["--all-patch"] !== "";
  if (hasPrefix && hasAllPatch) {
    io.error("deprecate 只能指定 id 前缀或 --all-patch 之一，不能同时。");
    return 2;
  }
  if (!hasPrefix && !hasAllPatch) {
    io.error("deprecate 需要目标：<id前缀> 或 --all-patch <补丁>。");
    return 2;
  }
  if (hasPrefix && positionals.length > 1) {
    io.error("deprecate 一次只能指定一个 id 前缀。");
    return 2;
  }

  let rows: KbListRow[];
  if (hasPrefix) {
    rows = [await resolveByPrefix(store, positionals[0])];
  } else {
    const patch = String(flags["--all-patch"]);
    rows = await store.list({ patch });
    if (rows.length === 0) {
      io.error(`补丁 ${patch} 没有匹配片段。`);
      return 1;
    }
  }

  const already = rows.filter((r) => r.meta.status === "deprecated");
  const toChange = rows.filter((r) => r.meta.status !== "deprecated");
  if (toChange.length > 0) {
    const n = await store.updateStatus(toChange.map((r) => r.id), "deprecated");
    io.log(`已下线 ${n} 条片段（status → deprecated）${reason ? `，备注：${reason}` : ""}。`);
  }
  if (already.length > 0) {
    io.log(`跳过 ${already.length} 条：本已处于 deprecated 状态（已下线）。`);
  }
  if (toChange.length === 0) {
    io.log("结果：目标全部已下线，无需变更。");
  }
  return 0;
}

async function cmdReactivate(store: KbStore, _flags: ManageArgs["flags"], positionals: string[], io: CommandIO): Promise<number> {
  if (positionals.length !== 1) {
    io.error("reactivate 需要且只能指定一个 id 前缀。");
    return 2;
  }
  const row = await resolveByPrefix(store, positionals[0]);
  if (row.meta.status === "active") {
    io.log(`片段 ${row.id.slice(0, 8)} 本已是 active，无需激活。`);
    return 0;
  }
  if (row.meta.status === "candidate") {
    io.error(`片段 ${row.id.slice(0, 8)} 当前是 candidate（候选）。reactivate 仅用于 deprecated → active；候选转正请走审核流程。`);
    return 1;
  }
  const n = await store.updateStatus([row.id], "active");
  io.log(`已激活 ${n} 条片段（status → active）。`);
  return 0;
}

async function cmdDelete(store: KbStore, flags: ManageArgs["flags"], positionals: string[], io: CommandIO): Promise<number> {
  const hasPrefix = positionals.length > 0;
  const hasPatch = flags["--patch"] !== undefined && flags["--patch"] !== "";
  const hasStatus = flags["--status"] !== undefined && flags["--status"] !== "";
  const modes = [hasPrefix, hasPatch, hasStatus].filter(Boolean).length;
  if (modes !== 1) {
    io.error("delete 需要且只能指定一个目标：<id前缀> / --patch <补丁> / --status <状态>。");
    return 2;
  }
  if (hasPrefix && positionals.length > 1) {
    io.error("delete 一次只能指定一个 id 前缀。");
    return 2;
  }

  let rows: KbListRow[];
  let label: string;
  if (hasPrefix) {
    rows = [await resolveByPrefix(store, positionals[0])];
    label = `id 前缀 "${positionals[0]}"`;
  } else if (hasPatch) {
    const patch = String(flags["--patch"]);
    rows = await store.list({ patch });
    label = `补丁 ${patch}`;
  } else {
    const status = parseStatus(flags["--status"]);
    rows = await store.list({ status });
    label = `状态 ${status}`;
  }

  io.log(`将删除 ${rows.length} 条片段（目标：${label}）：`);
  printList(rows, io);

  if (rows.length === 0) {
    io.log("没有可删除的片段。");
    return 0;
  }

  if (flags["--yes"] !== true) {
    io.log("未加 --yes，仅预览（dry-run），未执行删除。确认无误后加 --yes 才会真正删除。");
    return 0;
  }

  const n = await store.deleteByIds(rows.map((r) => r.id));
  io.log(`已物理删除 ${n} 条片段。`);
  return 0;
}

async function cmdStats(store: KbStore, _flags: ManageArgs["flags"], positionals: string[], io: CommandIO): Promise<number> {
  if (positionals.length > 0) {
    io.error("stats 不接受位置参数。");
    return 2;
  }
  const rows = await store.list();
  const byPatch = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byOrigin = new Map<string, number>();
  for (const r of rows) {
    byPatch.set(r.meta.patch, (byPatch.get(r.meta.patch) ?? 0) + 1);
    byStatus.set(r.meta.status, (byStatus.get(r.meta.status) ?? 0) + 1);
    byOrigin.set(r.meta.origin, (byOrigin.get(r.meta.origin) ?? 0) + 1);
  }
  io.log(`库内片段总数：${rows.length}`);
  printGroup("按补丁", byPatch, io);
  printGroup("按状态", byStatus, io);
  printGroup("按来源", byOrigin, io);
  return 0;
}

/**
 * 执行一条运维子命令；返回进程退出码（0 成功 / 1 运行时错误 / 2 用法错误）。
 * io 可注入（测试捕获输出），缺省打印到控制台。
 */
export async function runManage(
  store: KbStore,
  args: ManageArgs,
  io: CommandIO = { log: console.log, error: console.error },
): Promise<number> {
  const { cmd, flags, positionals } = args;
  try {
    switch (cmd) {
      case "list":
        return await cmdList(store, flags, positionals, io);
      case "deprecate":
        return await cmdDeprecate(store, flags, positionals, io);
      case "reactivate":
        return await cmdReactivate(store, flags, positionals, io);
      case "delete":
        return await cmdDelete(store, flags, positionals, io);
      case "stats":
        return await cmdStats(store, flags, positionals, io);
      default:
        io.error(`未知子命令 "${cmd}"。\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    io.error(`错误：${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
