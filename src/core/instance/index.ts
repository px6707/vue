import { initMixin } from './init'
import { stateMixin } from './state'
import { renderMixin } from './render'
import { eventsMixin } from './events'
import { lifecycleMixin } from './lifecycle'
import { warn } from '../util/index'
import type { GlobalAPI } from 'types/global-api'

// vue的构造函数， vue 的本体 vue2 中， new Vue ，就是new 的这个构造函数
function Vue(options) {
  if (__DEV__ && !(this instanceof Vue)) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  this._init(options)
}

// 给Vue类 添加能力
//@ts-expect-error Vue has function type
// 添加初始化函数_init ,同时初始化生命周期，添加父子组件关系，初始化事件、slot、注入、数据和provide
// 并向当前实例挂载_events、$slots、props、methods、data、computed\_provide属性、给_provide设置父组件的_provide作为原型
initMixin(Vue)
//@ts-expect-error Vue has function type
stateMixin(Vue)
//@ts-expect-error Vue has function type
eventsMixin(Vue)
//@ts-expect-error Vue has function type
lifecycleMixin(Vue)
//@ts-expect-error Vue has function type
renderMixin(Vue)

export default Vue as unknown as GlobalAPI
