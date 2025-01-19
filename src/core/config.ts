import { no, noop, identity } from 'shared/util'

import { LIFECYCLE_HOOKS } from 'shared/constants'
import type { Component } from 'types/component'

/**
 * @internal
 */
export interface Config {
  // user
  optionMergeStrategies: { [key: string]: Function }
  silent: boolean
  productionTip: boolean
  performance: boolean
  devtools: boolean
  errorHandler?: (err: Error, vm: Component | null, info: string) => void
  warnHandler?: (msg: string, vm: Component | null, trace: string) => void
  ignoredElements: Array<string | RegExp>
  keyCodes: { [key: string]: number | Array<number> }

  // platform
  isReservedTag: (x: string) => boolean | undefined
  isReservedAttr: (x: string) => true | undefined
  parsePlatformTagName: (x: string) => string
  isUnknownElement: (x: string) => boolean
  getTagNamespace: (x: string) => string | undefined
  mustUseProp: (tag: string, type?: string | null, name?: string) => boolean

  // private
  async: boolean

  // legacy
  _lifecycleHooks: Array<string>
}
// Vue.config配置
// 修改Vue.config可以实现配置的更改，之所以修改Vue.config，能够修改这个导出，是因为在initGlobalAPI时，
// const configDef: Record<string, any> = {}
//   configDef.get = () => config
//   if (__DEV__) {
//     configDef.set = () => {
//       warn(
//         'Do not replace the Vue.config object, set individual fields instead.'
//       )
//     }
//   }
//   Object.defineProperty(Vue, 'config', configDef)
// 这样只能Vue.config.silent = true  而不能直接修改Vue.config = {}
// 因为直接Vue.config = {}，会导致覆盖引用，而导致配置不起作用
export default {
  // 合并策略
  /**
   * Option merge strategies (used in core/util/options)
   */
  // $flow-disable-line
  optionMergeStrategies: Object.create(null),

  /**
   * Whether to suppress warnings.
   */
  silent: false,

  /**
   * Show production mode tip message on boot?
   */
  productionTip: __DEV__,

  /**
   * Whether to enable devtools
   */
  devtools: __DEV__,

  /**
   * Whether to record perf
   */
  performance: false,

  /**
   * Error handler for watcher errors
   */
  errorHandler: null,

  /**
   * Warn handler for watcher warns
   */
  warnHandler: null,

  /**
   * Ignore certain custom elements
   */
  ignoredElements: [],

  /**
   * Custom user key aliases for v-on
   */
  // $flow-disable-line
  keyCodes: Object.create(null),

  /**
   * Check if a tag is reserved so that it cannot be registered as a
   * component. This is platform-dependent and may be overwritten.
   */
  isReservedTag: no,

  /**
   * Check if an attribute is reserved so that it cannot be used as a component
   * prop. This is platform-dependent and may be overwritten.
   */
  isReservedAttr: no,

  /**
   * Check if a tag is an unknown element.
   * Platform-dependent.
   */
  isUnknownElement: no,

  /**
   * Get the namespace of an element
   */
  getTagNamespace: noop,

  /**
   * Parse the real tag name for the specific platform.
   */
  parsePlatformTagName: identity,

  /**
   * Check if an attribute must be bound using property, e.g. value
   * Platform-dependent.
   */
  mustUseProp: no,

  /**
   * Perform updates asynchronously. Intended to be used by Vue Test Utils
   * This will significantly reduce performance if set to false.
   */
  async: true,

  /**
   * Exposed for legacy reasons
   */
  _lifecycleHooks: LIFECYCLE_HOOKS
} as unknown as Config
