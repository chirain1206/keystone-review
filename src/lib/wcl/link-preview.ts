/**
 * 前端"粘贴 WCL 链接"预览流程的纯选择逻辑（FR-1 两段式，无网络依赖，便于单测）。
 * 客户端可安全引入（本模块与 players.ts 均为纯函数，无 process.env/fs 依赖）。
 */

/** 选择逻辑所需的最小战斗形状（与实际 WclFight/LinkFight 结构兼容）。 */
export interface FightOption {
  id: number;
}

/**
 * 单场大秘境报告自动跳过"选战斗"步骤：
 * 报告只有 1 场大秘境时无需用户选场，前端直接进入"选复盘对象"；
 * 多场（>1）时保持战斗列表选择。带 ?fight=N 预选的现有逻辑不受影响
 * （预选由服务端 selectFight 完成，此处只决定是否展示选场 UI）。
 */
export function shouldShowFightSelector(fights: readonly FightOption[]): boolean {
  return fights.length > 1;
}
