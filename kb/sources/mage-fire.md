---
class: Mage
spec: Fire
dungeon: "*"
patch: 12.1
type: intent_pattern
source_url: https://bbs.nga.cn/read.php?tid=46306031&rand=899
---

# 火焰法师打法要点（至暗之夜 12.1 / 大秘境 S2）

## 意图模式：怪聚齐前打资源赌 Hot Streak 触发

火焰法师常见的"看似在划水"阶段：坦克聚怪时不停用 Fireball 打边缘目标，目的是赌暴击触发 Hot Streak（瞬发 Pyroblast），并提前挂好 Scorch 易伤。聚怪完成后带着 1 层 Hot Streak + 双增益第一时间开 Combustion 爆发。该操作是"聚怪期资源铺垫"，不是输出浪费。

<!-- dungeon: Mists of Tirna Scithe -->

## 意图模式：易伤阶段前 5 秒内留 Combustion 不开

若 BOSS 易伤窗口固定（如 Mistcaller 的 Vulnerable 阶段），高手会刻意延后 Combustion 到易伤开启前 5 秒内，保证爆发全程覆盖易伤。log 上表现为"无增益状态持续数十秒"，实为等待机制对齐。

## 爆发规划：Combustion 12 秒窗口的固定循环

Combustion 期间固定循环：Fire Blast → Pyroblast（Hot Streak）穿插 Phoenix Flames 补冲能，保证每次 GCD 都有瞬发可用；提前 3 秒喝爆发药水（Tempered Potion / Elemental Potion of Ultimate Power）使药水窗口与 Combustion 完全重叠。

<!-- type: resource_management -->

## 资源管理：Hot Streak 与 Heating Up 的转化

Fireball 暴击触发 Heating Up，连续两次暴击转化为 Hot Streak（瞬发 Pyroblast）。打瞬发 Pyroblast 前若只剩 Heating Up，应先用 Fire Blast 保证转化，避免浪费暴击层数。

## 资源管理：Phoenix Flames 是移动填充技

Phoenix Flames 有 2 层充能、可在移动中施放。机制走位期间用它保持输出不断档；静止期优先 Fireball/Pyroblast，不要空耗充能。

## 爆发规划：爆发药水对齐易伤而非开场

12.1 赛季主流打法：爆发药水不再无脑开场喝，而是卡在 Combustion 与易伤阶段的重叠窗口；若离易伤超过 4 分钟且药水 CD 5 分钟，可在无爆发期先喝一瓶"垫 CD"，使下一次药水恰好在易伤阶段转好。

<!-- type: dungeon_mechanic -->

## 副本机制：Mists of Tirna Scithe 的 Mistcaller 易伤

Mistcaller 战斗中 BOSS 周期性进入 Vulnerable（易伤）阶段，期间承伤大幅提高。火焰法师应把 Combustion 与药水集中在该窗口，并提前保留 Phoenix Flames 充能。

<!-- dungeon: Grim Batol -->

## 副本机制：Grim Batol 龙怪波次的聚怪节奏

Grim Batol 的龙怪波次需要坦克长距离拉怪，火焰法师在此期间打资源、不交爆发；等怪群到位进入斩杀线再开爆发清场，可显著缩短波次时间。

<!-- type: patch_change -->

## 补丁变动：12.1 对火焰法师的影响

12.1 版本 Pyroblast 基础伤害上调、Phoenix Flames 充能时间缩短，Hot Streak 触发链收益提高；旧版"全程硬读 Fireball"的打法已过时，应围绕瞬发链重构输出循环。

## 通用原理（跨版本）：火焰法师的输出节奏

火焰法师输出 = 高质量瞬发 Pyroblast 数量 × 易伤/爆发窗口覆盖。所有资源决策（火冲、凤凰、燃烧）都应围绕"让更多瞬发 Pyroblast 落在增益窗口内"展开。

## 意图模式：斩杀期故意停手等药水 CD

斩杀期若 BOSS 剩余血量安全且爆发药水 CD 还差 20 秒以内，高手会刻意放缓输出（只打填充技能）等药水转好，配合下一轮增益一起交——"停手等 CD"是有规划的行为。

## 爆发规划：双目标战斗的 Combustion 传染

双目标 BOSS（如双龙组合）开 Combustion 后，用 Phoenix Flames 与 Fire Blast 同时点燃两个目标，保持双目标 Ignite 灼烧，总伤显著高于单目标爆发。
