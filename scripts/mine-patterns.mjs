#!/usr/bin/env node
/**
 * 高阶技巧批量挖掘脚本（T20，FR-11 多 log 交叉挖掘）。
 * 团队侧离线工具（非用户功能）。
 *
 * 用法：
 *   node scripts/mine-patterns.mjs <log1.txt> [log2.txt ...] [WCL链接 ...]
 *       [--class=Hunter] [--spec="Beast Mastery"] [--patch=12.1] [--out=kb/inferred]
 *
 * 输入：同一高端玩家同副本/日期相近的多份 WoWCombatLog.txt（本地路径列表）；
 *       WCL 链接可选（走现有 adapter，仅元数据、无事件级数据 → 无法挖掘；配额失败提示用本地文件）。
 * 流程：逐份解析 → 提取"疑似/知识库无法解释"操作 → 以副本时间轴（转阶段/易伤窗口）
 *       为锚归一化相对时间 → 重复性检测（同类型操作在 ≥2 份 log 的相似相对时间 ±容差
 *       重复出现）→ 输出候选 + 证据汇总 + 置信度 → 写入 kb/inferred/（幂等）。
 * T23 集成：按路线指纹"同路线分组"（同路线不同波次的 log 归同组一起挖掘，不丢数据源）。
 */
import "tsx/esm";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.on("uncaughtException", (err) => {
  if (err && (err.code === "EPERM" || String(err.message).includes("spawn"))) {
    console.error(
      "[mine-patterns] 当前环境禁止子进程（如 DSH 沙箱），无法启动 tsx 转换器。" +
        "请在正常开发环境运行本脚本；沙箱内等价验证由 src/lib/mining/mine.test.ts 覆盖。",
    );
    process.exit(1);
  }
  throw err;
});

const { parseMiningLogs, minePatterns, writeCandidateFile } = await import("../src/lib/mining/mine.ts");
const { detectTacticalPulls } = await import("../src/lib/parser/tactical-pulls.ts");
const { buildRouteFingerprint } = await import("../src/lib/route/fingerprint.ts");
const { groupByRoute } = await import("../src/lib/route/grouping.ts");
const { getWclReportMeta } = await import("../src/lib/wcl/adapter.ts");

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
const flags = new Map();
const inputs = [];
for (const a of args) {
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1));
    else flags.set(a.slice(2), "true");
  } else {
    inputs.push(a);
  }
}

const localFiles = inputs.filter((x) => !/^https?:\/\//i.test(x));
const wclLinks = inputs.filter((x) => /^https?:\/\//i.test(x));

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(flags.get("out") ?? path.join(root, "kb", "inferred"));
const patch = flags.get("patch") ?? process.env.ACTIVE_PATCH ?? "12.1";

if (localFiles.length === 0 && wclLinks.length === 0) {
  console.error(
    "[mine-patterns] 用法：node scripts/mine-patterns.mjs <log1.txt> [log2.txt ...] [WCL链接 ...] [--class=... --spec=... --patch=12.1]",
  );
  process.exit(1);
}

// ---------- WCL 链接（可选，仅元数据，无事件级数据无法挖掘） ----------
for (const link of wclLinks) {
  try {
    const r = await getWclReportMeta(link);
    if (!r.ok) {
      console.warn(`[mine-patterns] WCL 链接跳过：${r.message}${r.code === "FETCH_FAILED" ? "（请改用本地 WoWCombatLog.txt）" : ""}`);
    } else {
      console.warn(
        `[mine-patterns] WCL 链接 ${link}：仅提供元数据（副本/层数），无事件级时间线，无法逐事件挖掘；请改用本地 WoWCombatLog.txt 文件。`,
      );
    }
  } catch (err) {
    console.warn(`[mine-patterns] WCL 链接跳过（${err instanceof Error ? err.message : String(err)}），请改用本地文件。`);
  }
}

// ---------- 本地文件解析 + 路线指纹 ----------
const entries = []; // { file, miningLogs, fingerprints }
for (const file of localFiles) {
  let rawText;
  try {
    rawText = await fs.readFile(file, "utf8");
  } catch (err) {
    console.warn(`[mine-patterns] 无法读取 ${file}：${err instanceof Error ? err.message : String(err)}，已跳过。`);
    continue;
  }
  const miningLogs = parseMiningLogs(file, rawText);
  if (miningLogs.length === 0) {
    console.warn(`[mine-patterns] ${file} 未解析到可挖掘的大秘境战斗，已跳过。`);
    continue;
  }
  const runs = detectTacticalPulls(rawText).runs;
  const fingerprints = runs.map(buildRouteFingerprint);
  entries.push({ file, miningLogs, fingerprints });
}

if (entries.length === 0) {
  console.error("[mine-patterns] 没有可挖掘的本地日志文件。");
  process.exit(1);
}

// ---------- T23 同路线分组 ----------
const profiles = [];
const byId = new Map();
for (const e of entries) {
  for (let i = 0; i < e.miningLogs.length; i++) {
    const log = e.miningLogs[i];
    const route = e.fingerprints[i];
    profiles.push({ id: log.id, route });
    byId.set(log.id, log);
  }
}
const groups = groupByRoute(profiles);

// 无路线数据的独立组：单份不足以交叉挖掘（support ≥2），提示但不报错
for (const g of groups.filter((x) => !x.sameRoute)) {
  console.warn(
    `[mine-patterns] 组 [${g.ids.join(", ")}] 无路线数据或单份，不足以交叉挖掘（需同路线 ≥2 份），已跳过。`,
  );
}

// ---------- 逐组挖掘 + 写入 ----------
const classOverride = flags.get("class");
const specOverride = flags.get("spec");
let totalWritten = 0;
let totalSkipped = 0;

for (const g of groups.filter((x) => x.sameRoute)) {
  const logs = g.ids.map((id) => byId.get(id)).filter(Boolean);
  const { patterns } = minePatterns(logs);
  if (patterns.length === 0) {
    console.log(`[mine-patterns] 组 [${g.ids.join(", ")}]：未发现重复模式。`);
    continue;
  }
  // 元数据：取组内第一份（同一玩家同副本）
  const first = logs[0];
  const meta = {
    class: classOverride ?? first.class ?? "Unknown",
    spec: specOverride ?? first.spec ?? "Unknown",
    dungeon: first.dungeon ?? "Unknown",
    patch,
  };
  console.log(`[mine-patterns] 组 [${g.ids.join(", ")}]（副本 ${meta.dungeon}）发现 ${patterns.length} 个重复模式：`);
  for (const p of patterns) {
    const res = await writeCandidateFile(outDir, p, meta);
    console.log(`  - ${p.evidence}（置信度 ${Math.round(p.confidence * 100)}%）${res.wrote ? "→ 已写入" : "→ 已存在（幂等跳过）"} ${path.relative(root, res.file)}`);
    if (res.wrote) totalWritten++;
    else totalSkipped++;
  }
}

console.log(`[mine-patterns] 完成：写入候选 ${totalWritten}，幂等跳过 ${totalSkipped}，输出目录 ${path.relative(root, outDir)}`);
console.log(
  `[mine-patterns] 候选条目为 origin=inferred / status=candidate，绝不注入正式分析；请经主 Agent 初审 + 内测专家终审后转正（candidate→active）。`,
);
process.exit(0);
