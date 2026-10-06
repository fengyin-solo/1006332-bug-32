import { defineStore } from 'pinia'

import { ACTOR_OPTIONS, DEFAULT_ACTOR, setActor } from '@/data/actor'

// 会话里的岗位就是服务层判权限的身份：切换岗位会同步写进 data/actor，
// 跨单位/跨岗位的记录在服务层一律只读，页面不自己做判断。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: DEFAULT_ACTOR.operator,
    unit: DEFAULT_ACTOR.unit,
    post: DEFAULT_ACTOR.post,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下综合管廊运行维护管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    actorOptions: () => ACTOR_OPTIONS,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setPost(post: string) {
      const option = ACTOR_OPTIONS.find((item) => item.post === post)
      if (!option) {
        return
      }
      this.operator = option.operator
      this.unit = option.unit
      this.post = option.post
      setActor({ operator: option.operator, unit: option.unit, post: option.post })
    },
  },
})
