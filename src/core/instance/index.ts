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
  // 始化生命周期，添加父子组件关系，初始化事件、slot、注入、数据和provide
  // 并向当前实例挂载_events、$slots、props、methods、data、computed\_provide属性、给_provide设置父组件的_provide作为原型
  this._init(options)
}

// 给Vue类 添加能力
//@ts-expect-error Vue has function type
// 添加初始化函数_init
initMixin(Vue)
//@ts-expect-error Vue has function type
// Vue类上添加$props $data 的代理添加$watch方法
stateMixin(Vue)
//@ts-expect-error Vue has function type
// 给Vue类上添加$on $off $once $emit方法
eventsMixin(Vue)
//@ts-expect-error Vue has function type
// Vue类上挂载_update、$forceUpdate、$destroy方法
lifecycleMixin(Vue)
//@ts-expect-error Vue has function type
// 挂载生成虚拟节点的方法_render和$nextTick,以及执行render函数需要的各种工具函数
renderMixin(Vue)

export default Vue as unknown as GlobalAPI
