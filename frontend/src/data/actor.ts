// 当前操作人（岗位）口径：跨单位只读、越权提交拒绝都按这份判断。
// 页面切换岗位走 session store，服务层从这里取，保证「页面不做业务判断」。
export type Actor = {
  operator: string
  unit: string
  post: string
}

export const DEFAULT_ACTOR: Actor = {
  operator: '值班管理员',
  unit: '管廊运营中心',
  post: '能耗计量岗',
}

// 可切换的岗位清单：前两个是本单位岗位，最后一个是外单位（只读演示）。
export const ACTOR_OPTIONS: Actor[] = [
  DEFAULT_ACTOR,
  { operator: '值班管理员', unit: '管廊运营中心', post: '运维值班岗' },
  { operator: '外单位观摩员', unit: '自来水公司', post: '供水计量岗' },
]

let current: Actor = DEFAULT_ACTOR

export function getActor(): Actor {
  return current
}

export function setActor(actor: Actor): void {
  current = actor
}
