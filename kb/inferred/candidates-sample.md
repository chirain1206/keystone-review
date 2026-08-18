---
class: Hunter
spec: Beast Mastery
dungeon: "*"
patch: 12.1
type: intent_pattern
source_url: internal:inference
---

# log 推断候选条目（origin=inferred, status=candidate，绝不注入正式分析）

## 疑似技巧：转阶段前宠物提前就位

从玩家 log 聚类/意图引擎发现：转阶段（BOSS 阶段切换/落地伤害机制）前 20 秒内，宠物多次移动到固定位置（非跟随玩家），随后机制期宠物未受到落地伤害。推断为"提前指挥宠物走位规避机制伤害"的高阶技巧，待人工审查转正。

<!-- type: intent_pattern -->

## 疑似技巧：爆发前 8 秒蓄能停手

多次观察到玩家在爆发开启前 8–12 秒内停止一切施放（无技能记录），随后带着满资源开启爆发。推断为"停手攒资源等触发"的技巧，与火焰法师"赌 Hot Streak"相似，待对照更多样本与攻略确认。
