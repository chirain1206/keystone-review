#!/usr/bin/env node
/**
 * 知识库运维管理 CLI（T20）。
 * 子命令：list / deprecate / reactivate / delete / stats（用法见 docs/DEV-HANDOVER-REPORT.md 末尾）。
 * 仅存储层（Supabase/File），无需嵌入密钥；环境变量与 ingest 一致（SUPABASE_*）。
 * 运行：node scripts/kb-manage.mjs <子命令> [选项]（经 tsx 加载 TS 模块）。
 */
import "tsx/esm";

process.on("uncaughtException", (err) => {
  if (err && (err.code === "EPERM" || String(err.message).includes("spawn"))) {
    console.error(
      "[kb-manage] 当前环境禁止子进程（如 DSH 沙箱），无法启动 tsx 转换器。" +
        "请在正常开发环境运行本脚本；沙箱内等价验证由 src/lib/kb/kb-manage.test.ts 覆盖。",
    );
    process.exit(1);
  }
  throw err;
});

const { runManage, parseManageArgs } = await import("../src/lib/kb/manage.ts");
const { getKbStore } = await import("../src/lib/kb/index.ts");

const args = parseManageArgs(process.argv.slice(2));
const exit = await runManage(getKbStore(), args, {
  log: (s) => console.log(s),
  error: (s) => console.error(s),
});
process.exit(exit);
