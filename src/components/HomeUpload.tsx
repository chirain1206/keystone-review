"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { parseFileInWorker } from "@/lib/parser/client";
import { toProcessedLog, type CombatRun, type ParseResult } from "@/lib/parser/parser";
import { estimateProcessedLogTokens } from "@/lib/ai/tokens";
import { getTurnstileToken } from "@/lib/client/turnstile";
import { dungeonDisplayName } from "@/lib/wcl/dungeon-names";
import { classDisplayName, specDisplayName } from "@/lib/wcl/class-spec-names";
import { filterPlayersByFight } from "@/lib/wcl/players";
import { shouldShowFightSelector } from "@/lib/wcl/link-preview";

/** from-link 预览返回的战斗与角色。 */
interface LinkFight {
  id: number;
  name: string;
  level: number | null;
  success: boolean;
  durationSec: number;
  affixes: string[];
  selected?: boolean;
  /** 该场战斗实际参与的玩家 actor id 列表（WCL Fight.friendlyPlayers），用于复盘对象按场次过滤。 */
  playerIds?: number[] | null;
}
interface LinkPlayer {
  id: number;
  name: string;
  class: string;
  spec: string;
  role: string;
  isUploader?: boolean;
}

/**
 * 首页核心交互（T12）：
 *  - FR-1 粘贴 WCL 链接 → from-link 接口
 *  - FR-2 选择 WoWCombatLog.txt → Web Worker 本地解析 → 战斗列表选择
 *  - FR-3 可选对比链接；专精可修正
 *  - 原始文件只在本机解析，绝不上传
 */

export default function HomeUpload() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"link" | "file">("link");
  const [linkUrl, setLinkUrl] = useState("");
  const [compareUrl, setCompareUrl] = useState("");
  const [busy, setBusy] = useState(false);
  // 链接模式的两个动作 loading 独立：避免"重新获取战斗数据"与"开始复盘"共用一个状态一起转
  const [linkBusy, setLinkBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // 文件解析状态
  const [progress, setProgress] = useState<{ read: number; total: number } | null>(null);
  const [parseStats, setParseStats] = useState<ParseResult["stats"] | null>(null);
  const [runs, setRuns] = useState<CombatRun[] | null>(null);
  const [selected, setSelected] = useState<number>(0);
  const [spec, setSpec] = useState("");

  // WCL 链接预览状态（战斗列表 + 角色列表，两段式：先预览后创建）
  const [linkFights, setLinkFights] = useState<LinkFight[] | null>(null);
  const [linkPlayers, setLinkPlayers] = useState<LinkPlayer[] | null>(null);
  const [selectedFightId, setSelectedFightId] = useState<number | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [linkMock, setLinkMock] = useState(false);

  // 选中战斗对应的参与玩家（复盘对象候选）：单场/多场均按所选场次过滤，而非整份报告玩家
  const selectedFight = linkFights?.find((f) => f.id === selectedFightId) ?? null;
  const visiblePlayers =
    linkPlayers && selectedFight
      ? filterPlayersByFight(linkPlayers, selectedFight.playerIds)
      : linkPlayers;
  // 单场大秘境报告自动跳过"选战斗"步骤；多场保持列表选择
  const showFightSelector = linkFights ? shouldShowFightSelector(linkFights) : false;

  // 切换战斗：同步切换复盘对象候选，并把预选重置为该场的上传者/第一人
  const onFightSelect = (fightId: number) => {
    setSelectedFightId(fightId);
    const fight = linkFights?.find((f) => f.id === fightId);
    const visible =
      fight && linkPlayers ? filterPlayersByFight(linkPlayers, fight.playerIds) : linkPlayers;
    const next = visible?.find((p) => p.isUploader) ?? visible?.[0];
    setSelectedPlayerId(next?.id ?? null);
  };

  const showError = (msg: string) => {
    setError(msg);
    setInfo("");
  };

  // ---------- WCL 链接 ----------
  const submitLink = async () => {
    setError("");
    setInfo("");
    setLinkFights(null);
    setLinkPlayers(null);
    if (!linkUrl.trim()) return showError("请粘贴 Warcraft Logs 报告链接");
    setLinkBusy(true);
    try {
      const turnstileToken = await getTurnstileToken("report_create");
      const res = await fetch("/api/reports/from-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: linkUrl.trim(),
          compareUrl: compareUrl.trim() || undefined,
          turnstileToken,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        if (res.status === 401) {
          setError("请先登录后再生成复盘");
          router.push("/login");
          return;
        }
        return showError(data.error ?? "获取失败，请重试");
      }
      const fights = (data.fights ?? []) as LinkFight[];
      const players = (data.players ?? []) as LinkPlayer[];
      if (fights.length === 0 || players.length === 0) {
        return showError("该报告中没有可分析的大秘境战斗或角色，请更换链接或上传文件");
      }
      setLinkFights(fights);
      setLinkPlayers(players);
      setSelectedFightId(typeof data.selectedFightId === "number" ? data.selectedFightId : fights[0].id);
      setSelectedPlayerId(typeof data.selectedPlayerId === "number" ? data.selectedPlayerId : players[0].id);
      setLinkMock(data.isMock === true);
    } catch {
      showError("网络错误，请稍后重试");
    } finally {
      setLinkBusy(false);
    }
  };

  // ---------- WCL 链接：选定战斗 + 角色后创建复盘 ----------
  const submitSelected = async () => {
    setError("");
    if (selectedFightId == null || selectedPlayerId == null) {
      return showError("请选择一场战斗和一个复盘对象");
    }
    setCreateBusy(true);
    try {
      const turnstileToken = await getTurnstileToken("report_create");
      const res = await fetch("/api/reports/from-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: linkUrl.trim(),
          fightId: selectedFightId,
          playerId: selectedPlayerId,
          compareUrl: compareUrl.trim() || undefined,
          turnstileToken,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        if (res.status === 401) {
          setError("请先登录后再生成复盘");
          router.push("/login");
          return;
        }
        return showError(data.error ?? "创建失败，请重试");
      }
      if (data.compareDegraded) setInfo("对比链接获取失败，本场将不含对比章节（不阻塞复盘）。");
      if (data.dataInsufficient) setInfo("事件数据拉取不足，报告将按元数据分析（建议上传文件获取完整分析）。");
      router.push(`/reports/${data.id}`);
    } catch {
      showError("网络错误，请稍后重试");
    } finally {
      setCreateBusy(false);
    }
  };

  // ---------- 文件解析 ----------
  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setInfo("");
    setRuns(null);
    setProgress({ read: 0, total: file.size });
    try {
      const result = await parseFileInWorker(file, (p) =>
        setProgress({ read: p.readBytes, total: p.total }),
      );
      setProgress(null);
      if (!result.ok) {
        return showError(result.error?.message ?? "解析失败");
      }
      setRuns(result.runs ?? []);
      setParseStats(result.stats ?? null);
      setSelected(0);
      setSpec((result.runs?.[0]?.combat.playerSpec === "Unknown" ? "" : result.runs?.[0]?.combat.playerSpec) ?? "");
    } catch (err) {
      setProgress(null);
      showError(err instanceof Error ? err.message : "解析失败，请重试");
    }
  };

  // ---------- 提交选中的战斗 ----------
  const submitRun = async () => {
    setError("");
    if (!runs || !runs[selected]) return showError("请先选择一场战斗");
    setBusy(true);
    try {
      const run = runs[selected];
      const log = toProcessedLog(run, "file");
      // 专精修正（解析器尽力识别职业，专精需玩家确认/修正）
      if (spec.trim()) {
        log.combat.playerSpec = spec.trim();
      }
      const turnstileToken = await getTurnstileToken("report_create");
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          log,
          rawSize: parseStats?.rawSize ?? 0,
          rawLines: parseStats?.rawLines ?? 0,
          tokenEstimate: estimateProcessedLogTokens(log),
          compareUrl: compareUrl.trim() || undefined,
          turnstileToken,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        if (res.status === 401) {
          setError("请先登录后再生成复盘");
          router.push("/login");
          return;
        }
        return showError(data.error ?? "创建失败，请重试");
      }
      router.push(`/reports/${data.id}`);
    } catch {
      showError("网络错误，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const selectedRun = runs?.[selected];

  return (
    <div>
      {/* 模式切换 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className={`btn ${mode === "link" ? "btn-primary" : ""}`}
          onClick={() => setMode("link")}
        >
          📎 粘贴 WCL 链接（推荐）
        </button>
        <button
          className={`btn ${mode === "file" ? "btn-primary" : ""}`}
          onClick={() => setMode("file")}
        >
          📄 上传战斗日志文件
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {info && <div className="alert alert-info">{info}</div>}

      {mode === "link" && (
        <div className="card">
          <label className="label" htmlFor="wcl-url">
            Warcraft Logs 报告链接（支持 warcraftlogs.com 与 cn.warcraftlogs.com）
          </label>
          <input
            id="wcl-url"
            className="input"
            placeholder="https://www.warcraftlogs.com/reports/AbCdEf"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <div style={{ height: 12 }} />
          <label className="label" htmlFor="compare-url">
            对比链接（可选）：顶尖玩家的本场 log 链接
          </label>
          <input
            id="compare-url"
            className="input"
            placeholder="留空则只复盘自己（报告不含对比章节）"
            value={compareUrl}
            onChange={(e) => setCompareUrl(e.target.value)}
          />
          <div style={{ height: 16 }} />
          <button className="btn btn-primary" disabled={linkBusy} onClick={submitLink}>
            {linkBusy ? <span className="spinner" /> : linkFights ? "重新获取战斗数据" : "获取战斗数据"}
          </button>
          {linkMock && (
            <p className="alert alert-info" style={{ marginTop: 12 }}>
              当前为演示数据（未配置 WCL 密钥），可用于体验流程；真实数据请配置密钥后使用。
            </p>
          )}

          {linkFights && linkPlayers && (
            <div style={{ marginTop: 16 }}>
              <div style={{ height: 4 }} />
              {/* 单场报告自动跳过战斗选择：仅多场展示选场列表 */}
              {showFightSelector && (
                <>
                  <label className="label">选择要复盘的一场战斗：</label>
                  <table className="list">
                    <thead>
                      <tr>
                        <th></th>
                        <th>副本</th>
                        <th>层数</th>
                        <th>时长</th>
                        <th>结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linkFights.map((f) => (
                        <tr key={f.id}>
                          <td>
                            <input
                              type="radio"
                              name="link-fight"
                              checked={selectedFightId === f.id}
                              onChange={() => onFightSelect(f.id)}
                            />
                          </td>
                          <td>{dungeonDisplayName(f.name)}</td>
                          <td>{f.level ?? "-"}</td>
                          <td>
                            {Math.floor(f.durationSec / 60)} 分 {f.durationSec % 60} 秒
                          </td>
                          <td>
                            <span className={`badge ${f.success ? "badge-ok" : "badge-err"}`}>
                              {f.success ? "限时成功" : "未限时"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div style={{ height: 12 }} />
                </>
              )}
              <label className="label">选择复盘对象（本场涉及的角色）：</label>
              <table className="list">
                <thead>
                  <tr>
                    <th></th>
                    <th>角色</th>
                    <th>职业</th>
                    <th>专精</th>
                    <th>定位</th>
                  </tr>
                </thead>
                <tbody>
                  {(visiblePlayers ?? []).map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="radio"
                          name="link-player"
                          checked={selectedPlayerId === p.id}
                          onChange={() => setSelectedPlayerId(p.id)}
                        />
                      </td>
                      <td>
                        {p.name}
                        {p.isUploader && <span style={{ marginLeft: 6, fontSize: 12 }}>📤 上传者</span>}
                      </td>
                      <td>{classDisplayName(p.class)}</td>
                      <td>{p.spec === "Unknown" ? "待确认" : specDisplayName(p.spec)}</td>
                      <td>
                        {p.role === "tank" ? "坦克" : p.role === "healer" ? "治疗" : p.role === "dps" ? "输出" : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ height: 16 }} />
              <button className="btn btn-primary" disabled={createBusy} onClick={submitSelected}>
                {createBusy ? <span className="spinner" /> : "开始复盘"}
              </button>
            </div>
          )}

          <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 12 }}>
            链接方式会按所选角色拉取该场战斗的必要事件（施放/爆发/打断/死亡/易伤），生成真实统计；
            如需最完整的事件级分析，仍可上传 WoWCombatLog.txt 文件（游戏内输入 /combatlog 生成）。
          </p>
        </div>
      )}

      {mode === "file" && (
        <div className="card">
          <label className="label">
            选择 WoWCombatLog.txt（游戏内输入 /combatlog 生成，≤200MB）
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".txt"
            style={{ marginBottom: 12 }}
            onChange={onFileChosen}
          />
          <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
            🔒 隐私：文件在浏览器本地解析（Web Worker 分块读取），原始文件绝不上传服务器，只提交精简后的结构化数据。
          </p>

          {progress && (
            <div>
              <div className="progress" style={{ margin: "8px 0" }}>
                <div
                  style={{
                    width: `${progress.total ? Math.round((progress.read / progress.total) * 100) : 0}%`,
                  }}
                />
              </div>
              <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                本地解析中 {Math.round(progress.read / 1024 / 1024)}MB /{" "}
                {Math.round(progress.total / 1024 / 1024)}MB …
              </span>
            </div>
          )}

          {runs && (
            <>
              <div style={{ height: 8 }} />
              <label className="label">解析出 {runs.length} 场大秘境战斗，选择要复盘的一场：</label>
              <table className="list">
                <thead>
                  <tr>
                    <th></th>
                    <th>副本</th>
                    <th>层数</th>
                    <th>时长</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          type="radio"
                          name="run"
                          checked={selected === i}
                          onChange={() => {
                            setSelected(i);
                            setSpec(r.combat.playerSpec === "Unknown" ? "" : r.combat.playerSpec);
                          }}
                        />
                      </td>
                      <td>{dungeonDisplayName(r.combat.dungeon)}</td>
                      <td>{r.combat.level}</td>
                      <td>
                        {Math.floor(r.combat.durationSec / 60)} 分{" "}
                        {r.combat.durationSec % 60} 秒
                      </td>
                      <td>
                        <span className={`badge ${r.combat.success ? "badge-ok" : "badge-err"}`}>
                          {r.combat.success ? "限时成功" : "未限时"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {selectedRun && (
                <div style={{ marginTop: 12 }}>
                  <label className="label">
                    你的职业：{classDisplayName(selectedRun.combat.playerClass)}（自动识别）；专精（请确认或修正）
                  </label>
                  <input
                    className="input"
                    style={{ maxWidth: 240 }}
                    placeholder="如 Fire / Protection / Restoration"
                    value={spec}
                    onChange={(e) => setSpec(e.target.value)}
                  />
                  <div style={{ height: 12 }} />
                  <label className="label">对比链接（可选）</label>
                  <input
                    className="input"
                    placeholder="顶尖玩家本场 log 的 WCL 链接（可选）"
                    value={compareUrl}
                    onChange={(e) => setCompareUrl(e.target.value)}
                  />
                  <div style={{ height: 16 }} />
                  <button className="btn btn-primary" disabled={busy} onClick={submitRun}>
                    {busy ? <span className="spinner" /> : "开始复盘"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="card" style={{ fontSize: 14, color: "var(--text-dim)" }}>
        <strong style={{ color: "var(--text)" }}>产品能做什么：</strong>
        上传大秘境战斗日志或粘贴 WCL 链接，AI 生成 6 章结构化复盘报告（总体概览 / 关键时机 /
        与顶尖玩家对比 / 可改进点 / <b>战术意图识别</b> / 练习建议），并支持针对本场 log 的追问。
        免费账号每天可生成 3 次复盘。
      </div>
    </div>
  );
}
