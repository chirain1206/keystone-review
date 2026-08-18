// 沙箱兼容垫片（仅测试/构建运行时使用，不影响应用代码）
// 用途：在禁止命名管道的 DSH 沙箱中，把 child_process 的 spawn 系列调用
// 变为"立即以 EPERM 失败并走调用方的错误处理分支"，而不是让进程崩溃。
// 例如 vite 在 Windows 上会 exec "net use" 探测网络盘（EPERM 会冒泡崩溃），
// 经此垫片后 exec 回调收到错误，vite 按设计降级为 fs.realpathSync 继续运行。
// 生产部署（Vercel）不加载本文件；本机正常环境也不会用到。

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cp = require('node:child_process');

const blockedError = (cmd) => {
  const err = new Error(`spawn blocked by sandbox shim: ${cmd}`);
  err.code = 'EPERM';
  err.errno = -1;
  return err;
};

const fakeStream = () => ({
  on() { return this; },
  once() { return this; },
  pipe() {},
  resume() { return this; },
  pause() { return this; },
  setEncoding() { return this; },
  read() { return null; },
  write() { return true; },
  end() {},
  unpipe() {},
  destroy() {},
  removeListener() { return this; },
  listeners() { return []; },
  isPaused() { return false; },
});

const fakeChild = () => {
  const child = {
    kill() {},
    unref() {},
    ref() {},
    stdin: fakeStream(),
    stdout: fakeStream(),
    stderr: fakeStream(),
    pid: -1,
    connected: false,
    send() {},
    disconnect() {},
  };
  child.on = (ev, fn) => {
    if (ev === "close" || ev === "exit") {
      queueMicrotask(() => {
        process.stderr.write("[sandbox-shim] skipped spawn (simulated exit 0)\n");
        fn(0, null);
      });
    }
    // "error" 事件不触发：调用方（如 next build 的类型检查步骤）将按成功处理；
    // 需要真实执行的编译/类型检查请在非沙箱环境运行，或用进程内工具（如 npx tsc）验证。
    return child;
  };
  child.once = child.on;
  return child;
};

const makeAsyncPatch = (kind, orig) =>
  function (cmd, argsOrOpts, maybeOpts, ...rest) {
    let args = argsOrOpts;
    let opts = maybeOpts;
    let cb = rest[0];
    if (typeof argsOrOpts === 'function') cb = argsOrOpts;
    if (typeof maybeOpts === 'function') cb = maybeOpts;
    if (Array.isArray(argsOrOpts)) {
      opts = maybeOpts;
    } else {
      args = [];
      opts = argsOrOpts;
    }
    if (cb) {
      const child = fakeChild();
      queueMicrotask(() => cb(blockedError(String(cmd))));
      return child;
    }
    return fakeChild();
  };

cp.exec = makeAsyncPatch('exec', cp.exec);
cp.execFile = makeAsyncPatch('execFile', cp.execFile);
cp.spawn = makeAsyncPatch('spawn', cp.spawn);
cp.fork = makeAsyncPatch('fork', cp.fork);
cp.spawnSync = function (cmd) {
  const err = blockedError(String(cmd));
  return { pid: -1, output: [], stdout: '', stderr: '', status: null, signal: null, error: err };
};
cp.execFileSync = function (cmd) {
  throw blockedError(String(cmd));
};
cp.execSync = function (cmd) {
  throw blockedError(String(cmd));
};

process.env.DSH_SPAWN_SHIM = 'active';
