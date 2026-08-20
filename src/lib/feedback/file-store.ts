import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FeedbackStore } from "@/lib/feedback/store";
import type {
  FeedbackCreateInput,
  FeedbackListFilter,
  FeedbackRow,
  FeedbackStatus,
} from "@/lib/feedback/types";

/**
 * 开发/mock 反馈存储（FEEDBACK）：本地 JSON（.data/feedback.json）。
 * 行为语义与 Supabase 版本一致：写操作锁内读-改-写（原子 rename），
 * 读操作直读磁盘（Next 按路由分包，多实例写后可见）。
 * 仅用于本地开发与自动化测试；部署阶段配置 Supabase 环境变量后自动切换
 * 到 supabase-store.ts（见 index.ts）。
 */

function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
}

const FILE = "feedback.json";
const DEFAULT_LIMIT = 100;

let tail: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(
    () => fn(),
    () => fn(),
  );
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function loadAll(): Promise<FeedbackRow[]> {
  const fp = path.join(dataDir(), FILE);
  try {
    return JSON.parse(await fs.readFile(fp, "utf8")) as FeedbackRow[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }
}

/** 不加锁的落盘（须在 withLock 内调用）。 */
async function writeAll(rows: FeedbackRow[]): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  const fp = path.join(dataDir(), FILE);
  const tmp = fp + `.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rows), "utf8");
  await fs.rename(tmp, fp);
}

export class FileFeedbackStore implements FeedbackStore {
  async create(input: FeedbackCreateInput): Promise<FeedbackRow> {
    const row: FeedbackRow = {
      id: randomUUID(),
      userId: input.userId,
      email: input.email,
      category: input.category,
      content: input.content,
      pageUrl: input.pageUrl,
      status: "new",
      createdAt: Date.now(),
    };
    await withLock(async () => {
      const all = await loadAll();
      all.push(row);
      await writeAll(all);
    });
    return row;
  }

  async list(filter: FeedbackListFilter = {}): Promise<FeedbackRow[]> {
    const all = await loadAll();
    const rows = filter.status ? all.filter((r) => r.status === filter.status) : all;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : DEFAULT_LIMIT;
    return [...rows].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  async get(id: string): Promise<FeedbackRow | null> {
    const all = await loadAll();
    return all.find((r) => r.id === id) ?? null;
  }

  async updateStatus(id: string, status: FeedbackStatus): Promise<boolean> {
    let changed = false;
    await withLock(async () => {
      const all = await loadAll();
      const row = all.find((r) => r.id === id);
      if (row && row.status !== status) {
        row.status = status;
        changed = true;
        await writeAll(all);
      }
    });
    return changed;
  }
}
