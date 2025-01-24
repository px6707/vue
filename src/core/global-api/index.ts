import config from '../config'
import { initUse } from './use'
import { initMixin } from './mixin'
import { initExtend } from './extend'
import { initAssetRegisters } from './assets'
import { set, del } from '../observer/index'
import { ASSET_TYPES } from 'shared/constants'
import builtInComponents from '../components/index'
import { observe } from 'core/observer/index'

import {
  warn,
  extend,
  nextTick,
  mergeOptions,
  defineReactive
} from '../util/index'
import type { GlobalAPI } from 'types/global-api'

// 初始化全局API
export function initGlobalAPI(Vue: GlobalAPI) {
  // config
  const configDef: Record<string, any> = {}
  configDef.get = () => config
  if (__DEV__) {
    // 不能使用vue.config = {}，因为这样会覆盖引用；只能vue.congif.设置 = xx
    configDef.set = () => {
      warn(
        'Do not replace the Vue.config object, set individual fields instead.'
      )
    }
  }
  Object.defineProperty(Vue, 'config', configDef)

  // exposed util methods.
  // NOTE: these are not considered part of the public API - avoid relying on
  // them unless you are aware of the risk.
  // 给Vue挂载多种工具函数
  Vue.util = {
    warn,
    extend,
    mergeOptions,
    defineReactive
  }
// 挂载多个API
  Vue.set = set
  Vue.delete = del
  Vue.nextTick = nextTick

  // 2.6 explicit observable API
  Vue.observable = <T>(obj: T): T => {
    observe(obj)
    return obj
  }

  Vue.options = Object.create(null)
  // ['component', 'directive', 'filter'] 添加对应的空对象配置
  ASSET_TYPES.forEach(type => {
    Vue.options[type + 's'] = Object.create(null)
  })

  // this is used to identify the "base" constructor to extend all plain-object
  // components with in Weex's multi-instance scenarios.
  Vue.options._base = Vue

  // 添加vue内置的keep-alive组件
  extend(Vue.options.components, builtInComponents)
  // Vue类添加use方法
  initUse(Vue)
  // Vue类添加mixin方法
  initMixin(Vue)
  // Vue类添加extend方法
  initExtend(Vue)
  initAssetRegisters(Vue)
}
