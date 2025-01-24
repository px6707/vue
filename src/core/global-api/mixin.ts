import type { GlobalAPI } from 'types/global-api'
import { mergeOptions } from '../util/index'

export function initMixin(Vue: GlobalAPI) {
  Vue.mixin = function (mixin: Object) {
    // 使用mergeOptions合并选项
    this.options = mergeOptions(this.options, mixin)
    return this
  }
}
