# 技术可行性调研：技术与成本维度

> 调研员：子 Agent 0de9c9a1（阶段 1 想法验证）
> 判断：**有条件可行。MVP 技术上完全做得出来，成本近零；真正风险在"AI 分析质量"和"合规变现边界"。**

## 1. 数据来源（log 获取与解析）

- Warcraft Logs 有公开 **v2 GraphQL API**（OAuth2，可免费建 client，但按"点数预算"限流、1 小时滚动窗口）。
- **可完全绕开 WCL**：玩家在游戏内用 /combatlog 开启 Advanced Combat Log，生成 WoWCombatLog.txt；格式公开（Wowpedia COMBAT_LOG_EVENT），有现成开源解析器（wow-combat-log-parser、rp4rk/wowp）和知名开源分析项目 WoWAnalyzer 可参考。
- 建议：MVP 走"玩家上传原生 log"主路径，成本 0。

## 2. 视频-log 同步可行性

- Warcraft Recorder（aza547/wow-recorder）许可证为 **GPL v2**；每段视频写一个 JSON 元数据文件，含 challengeModeTimeline 时间轴（每片段有 logStart/logEnd 战斗日志时间 + timestamp 视频内时间 + encounterId）、deaths、affixes、keystoneLevel 等。
- 第三方可直接读这些元数据文件拿到"视频↔事件"同步，无需改其代码（修改/再分发其代码才触发 GPL）。成本 0。

## 3. AI 分析方案与成本

- DeepSeek V4 Flash 官方价 $0.22–0.44/M 输入、$0.66–1.32/M 输出、1M 上下文（峰谷定价）。
- 单次复盘分析（5 万 token 结构化输入 + 3 千输出）≈ 1–2 美分；一个月 1000 次分析 ≈ $15–50。
- 上下文足够（需先解析成结构化数据、勿直喂原始几十 MB log）。
- 无现成"WoW log + LLM 问答"开源成品——空白机会。

## 4. 部署方案与成本

- Cloudflare Pages/Workers/R2 + Supabase/Neon 免费层可做到基础架构 **$0/月**，唯一变量是 AI 调用费（约 $5–50/月）。
- MVP 建议不上传视频（存储/带宽贵），只传 log；视频留本地、用元数据同步。

## 5. 法律与合规

- 暴雪视频政策：禁止对游戏内容设付费墙/直接出售；粉丝内容需声明"非官方、与暴雪无关"、禁用商标暗示背书。
- 关键结论：卖"自己的 AI 分析/教练服务"**可以收费**，卖"暴雪游戏内容/视频"受限。
- 收费点设计在分析服务上，加免责声明；收费前律师确认一次（几百～几千元一次性）。

## 6. 总体结论与风险

主要风险排序：
1. **AI 分析准确度**（产品成败点）
2. **合规变现边界**（暴雪政策）
3. **WCL 配额/条款依赖**
4. 非技术个人开发的执行纪律（有流水线把关，可控）

下一步建议：产品经理聚焦"分析准确度"差异化点。
