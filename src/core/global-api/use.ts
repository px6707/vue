import type { GlobalAPI } from 'types/global-api'
import { toArray, isFunction } from '../util/index'

export function initUse(Vue: GlobalAPI) {
  Vue.use = function (plugin: Function | any) {
    const installedPlugins =
      this._installedPlugins || (this._installedPlugins = [])
      // 插件被初始化过，就直接返回vue实例，不再重复初始化
    if (installedPlugins.indexOf(plugin) > -1) {
      return this
    }

    // additional parameters
    const args = toArray(arguments, 1)
    // install函数的第一个参数是vue实例
    args.unshift(this)
    // 如果插件具有install函数，直接执行它
    if (isFunction(plugin.install)) {
      plugin.install.apply(plugin, args)
    } else if (isFunction(plugin)) {
      // 如果插件本身是函数，直接执行
      plugin.apply(null, args)
    }
    installedPlugins.push(plugin)
    // 返回vue实例
    return this
  }
}
