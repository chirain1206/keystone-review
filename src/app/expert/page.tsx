"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { classDisplayName, specDisplayName } from "@/lib/wcl/class-spec-names";

const CLASS_SPECS: Record<string, string[]> = {
  Warrior: ["Arms", "Fury", "Protection"],
  Paladin: ["Holy", "Protection", "Retribution"],
  Hunter: ["Beast Mastery", "Marksmanship", "Survival"],
  Rogue: ["Assassination", "Outlaw", "Subtlety"],
  Priest: ["Discipline", "Holy", "Shadow"],
  "Death Knight": ["Blood", "Frost", "Unholy"],
  Shaman: ["Elemental", "Enhancement", "Restoration"],
  Mage: ["Arcane", "Fire", "Frost"],
  Warlock: ["Affliction", "Demonology", "Destruction"],
  Monk: ["Brewmaster", "Mistweaver", "Windwalker"],
  Druid: ["Balance", "Feral", "Guardian", "Restoration"],
  "Demon Hunter": ["Havoc", "Vengeance", "Devourer"],
  Evoker: ["Devastation", "Preservation", "Augmentation"],
};

interface DuplicateHint {
  id: string;
  title: string;
  summary: string;
  score: number;
}

interface SubmitResult {
  ok: boolean;
  error?: string;
  id?: string;
  patch?: string;
  duplicates?: DuplicateHint[];
}

export default function ExpertSubmitPage() {
  const [cls, setCls] = useState("Monk");
  const [spec, setSpec] = useState("Windwalker");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const specs = useMemo(() => CLASS_SPECS[cls] ?? [], [cls]);

  const onClassChange = (value: string) => {
    setCls(value);
    setSpec((CLASS_SPECS[value] ?? [])[0] ?? "");
  };

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/kb/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class: cls, spec, title, content, sourceUrl }),
      });
      const data = (await res.json()) as SubmitResult;
      setResult(data);
      if (data.ok) {
        setTitle("");
        setContent("");
        setSourceUrl("");
      }
    } catch {
      setResult({ ok: false, error: "网络错误，请稍后重试" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22 }}>专家知识提交</h1>
      <nav style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 14 }}>
        <Link href="/expert">提交</Link>
        <Link href="/expert/review">审核</Link>
        <Link href="/expert/kb">浏览</Link>
      </nav>
      <p style={{ color: "var(--text-dim)" }}>
        提交手法要点，进入「候选」池待审核；审核通过前不会进入正式分析。
      </p>

      <div className="card">
        <label className="label">职业 / 专精</label>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <select className="input" style={{ flex: 1 }} value={cls} onChange={(e) => onClassChange(e.target.value)}>
            {Object.keys(CLASS_SPECS).map((c) => (
              <option key={c} value={c}>{classDisplayName(c)}</option>
            ))}
          </select>
          <select className="input" style={{ flex: 1 }} value={spec} onChange={(e) => setSpec(e.target.value)}>
            <option value="*">通用（All）</option>
            {specs.map((s) => (
              <option key={s} value={s}>{specDisplayName(s)}</option>
            ))}
          </select>
        </div>

        <label className="label">标题</label>
        <input
          className="input"
          style={{ marginBottom: 14 }}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="如：踏风天神爆发起手"
        />

        <label className="label">内容</label>
        <textarea
          className="textarea"
          style={{ minHeight: 180, marginBottom: 14 }}
          value={content}
          maxLength={8000}
          onChange={(e) => setContent(e.target.value)}
          placeholder="按要点分条书写，技能名请用国服标准名。"
        />

        <label className="label">出处链接（可选）</label>
        <input
          className="input"
          style={{ marginBottom: 16 }}
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://…（攻略/视频/社区帖链接）"
        />

        {result && !result.ok && (
          <div className="alert alert-error">提交失败：{result.error}</div>
        )}
        {result?.ok && (result.duplicates?.length ?? 0) > 0 && (
          <div className="alert alert-warn">
            疑似与已有知识重复，请确认是否仍要提交：
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {result.duplicates!.map((d) => (
                <li key={d.id}>
                  {d.title} — {d.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result?.ok && (
          <div className="alert alert-ok">
            提交成功，已进入候选池（补丁 {result.patch}）。请到「审核」页处理。
          </div>
        )}

        <button className="btn btn-primary" disabled={busy} onClick={submit}>
          {busy ? "提交中…" : "提交知识"}
        </button>
      </div>
    </main>
  );
}
