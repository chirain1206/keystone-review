import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 文件版 KV 存储（mock 模式）：验证码、会话、频控状态。
 * 与 file-repo 同目录（.data/，可用 DATA_DIR 重定向）。
 * 带 TTL 的条目读取时惰性过期，写入原子化 + 进程内互斥。
 */

function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
}

const FILE = "auth_kv.json";

interface Entry {
  value: unknown;
  expiresAt: number | null; // null = 永不过期
}

type Store = Record<string, Entry>;

// 注意：Next.js 会为不同路由单独打包，进程内可能存在多份本模块实例，
// 因此不做长驻内存缓存 —— 每次读取都直读磁盘，保证写后可见性。
const cache: { data: Store | null } = { data: null };

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

async function load(): Promise<Store> {
  const fp = path.join(dataDir(), FILE);
  try {
    return JSON.parse(await fs.readFile(fp, "utf8")) as Store;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return {};
  }
}

async function persist(store: Store): Promise<void> {
  const fp = path.join(dataDir(), FILE);
  await withLock(async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    const tmp = fp + `.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store), "utf8");
    await fs.rename(tmp, fp);
  });
}

function prune(store: Store, nowMs: number): void {
  for (const [k, e] of Object.entries(store)) {
    if (e.expiresAt !== null && e.expiresAt <= nowMs) delete store[k];
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const store = await load();
  const entry = store[key];
  if (!entry) return null;
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    delete store[key];
    await persist(store);
    return null;
  }
  return entry.value as T;
}

export async function kvSet(key: string, value: unknown, ttlMs?: number): Promise<void> {
  const store = await load();
  store[key] = {
    value,
    expiresAt: ttlMs ? Date.now() + ttlMs : null,
  };
  await persist(store);
}

export async function kvDelete(key: string): Promise<void> {
  const store = await load();
  if (key in store) {
    delete store[key];
    await persist(store);
  }
}

export async function kvCleanup(): Promise<void> {
  const store = await load();
  prune(store, Date.now());
  await persist(store);
}
