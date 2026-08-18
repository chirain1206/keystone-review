import { Fragment } from "react";

/**
 * 报告章节内容渲染器（markdown-lite → JSX）。
 * 服务端/客户端共用；时间戳（分:秒）自动高亮。
 */

const TS_RE = /\b(\d{1,3}:\d{2})\b/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(TS_RE);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <span key={`${keyPrefix}-${i}`} className="ts">
        {p}
      </span>
    ) : (
      <Fragment key={`${keyPrefix}-${i}`}>{p}</Fragment>
    ),
  );
}

export default function ReportContent({ content }: { content: string }) {
  if (!content) return null;
  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuf: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!listBuf) return;
    if (listBuf.items.length === 0) {
      listBuf = null;
      return;
    }
    const items = listBuf.items;
    const ordered = listBuf.ordered;
    listBuf = null;
    blocks.push(
      ordered ? (
        <ol key={`ol-${key++}`}>
          {items.map((it, i) => (
            <li key={i}>{renderInline(it, `oli-${key}-${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={`ul-${key++}`}>
          {items.map((it, i) => (
            <li key={i}>{renderInline(it, `uli-${key}-${i}`)}</li>
          ))}
        </ul>
      ),
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      blocks.push(
        <h3 key={`h-${key++}`}>{renderInline(line.slice(3), `h-${key}`)}</h3>,
      );
      continue;
    }
    if (line.startsWith("# ")) {
      flushList();
      blocks.push(
        <h2 key={`h2-${key++}`}>{renderInline(line.slice(2), `h2-${key}`)}</h2>,
      );
      continue;
    }
    const ulMatch = /^[-•]\s+/.exec(line);
    if (ulMatch) {
      if (!listBuf || listBuf.ordered) {
        flushList();
        listBuf = { ordered: false, items: [] };
      }
      listBuf.items.push(line.slice(ulMatch[0].length));
      continue;
    }
    const olMatch = /^\d+[.、]\s*/.exec(line);
    if (olMatch) {
      if (!listBuf || !listBuf.ordered) {
        flushList();
        listBuf = { ordered: true, items: [] };
      }
      listBuf.items.push(line.slice(olMatch[0].length));
      continue;
    }
    flushList();
    blocks.push(<p key={`p-${key++}`}>{renderInline(line, `p-${key}`)}</p>);
  }
  flushList();
  return <div className="report-content">{blocks}</div>;
}
