import { describe, expect, it } from "vitest";
import {
  ASR_MAX_BYTES,
  SEGMENT_SECONDS,
  needsAudioSplit,
} from "@/lib/video/asr";

/**
 * ASR 长音频切分判定与切段参数测试（无需真实 ffmpeg/网络）。
 */
describe("ASR 音频切分判定", () => {
  it("≤20MB 不需要切分（边界内）", () => {
    expect(needsAudioSplit(ASR_MAX_BYTES)).toBe(false);
    expect(needsAudioSplit(10 * 1024 * 1024)).toBe(false);
  });

  it(">20MB 需要切分（边界外）", () => {
    expect(needsAudioSplit(ASR_MAX_BYTES + 1)).toBe(true);
  });

  it("切段时长 14 分钟：最高码率 95kbps 下单段约 10MB，低于 20MB 上限", () => {
    const segBytes = (SEGMENT_SECONDS * 95_000) / 8;
    expect(segBytes).toBeLessThan(ASR_MAX_BYTES);
    expect(SEGMENT_SECONDS).toBeGreaterThan(0);
  });
});
