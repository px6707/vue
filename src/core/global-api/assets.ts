import { ASSET_TYPES } from 'shared/constants'
import type { GlobalAPI } from 'types/global-api'
import { isFunction, isPlainObject, validateComponentName } from '../util/index'

// 初始化全局注册函数
export function initAssetRegisters(Vue: GlobalAPI) {
  /**
   * Create asset registration methods.
   */
  // 对于 ['component', 'directive', 'filter'] 这三个类型进行注册
  ASSET_TYPES.forEach(type => {
    // @ts-expect-error function is not exact same type
    Vue[type] = function (
      id: string,
      definition?: Function | Object
    ): Function | Object | void {
      // 如果不存在定义函数，说明是想要返回id代表的 组件、指令或者过滤器
      // 如下用法：Vue.component('my-component')  // 获取已注册的组件
      if (!definition) {
        return this.options[type + 's'][id]
      } else {
        /* istanbul ignore if */
        if (__DEV__ && type === 'component') {
          // 如果是组件，需要检验组件名称
          validateComponentName(id)
        }
        if (type === 'component' && isPlainObject(definition)) {
          // 如果定义是对象
          // @ts-expect-error
          // 设置组件名称
          definition.name = definition.name || id
          // 添加组件设置
          definition = this.options._base.extend(definition)
        }
        if (type === 'directive' && isFunction(definition)) {
          // 如果是指令，需要设置bind和update
          // 简写形式
          // Vue.directive('focus', function(el) {
          //   el.focus()
          // })

          // 会被转换为
          // Vue.directive('focus', {
          //   bind: function(el) { el.focus() },
          //   update: function(el) { el.focus() }
          // })
          definition = { bind: definition, update: definition }
        }
        // 过滤器直接添加到options中
        this.options[type + 's'][id] = definition
        return definition
      }
    }
  })
}
