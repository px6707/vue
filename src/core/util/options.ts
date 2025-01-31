import config from '../config'
import { warn } from './debug'
import { set } from '../observer/index'
import { unicodeRegExp } from './lang'
import { nativeWatch, hasSymbol } from './env'
import { isArray, isFunction } from 'shared/util'

import { ASSET_TYPES, LIFECYCLE_HOOKS } from 'shared/constants'

import {
  extend,
  hasOwn,
  camelize,
  toRawType,
  capitalize,
  isBuiltInTag,
  isPlainObject
} from 'shared/util'
import type { Component } from 'types/component'
import type { ComponentOptions } from 'types/options'

/**
 * Option overwriting strategies are functions that handle
 * how to merge a parent option value and a child option
 * value into the final value.
 */
// 合并策略对象
const strats = config.optionMergeStrategies

/**
 * Options with restrictions
 */
if (__DEV__) {
  strats.el = strats.propsData = function (
    parent: any,
    child: any,
    vm: any,
    key: any
  ) {
    // 没有传入vm说明不是在实例化的过程中进行的合并，说明el和props属性不是在new的时候指定的
    if (!vm) {
      warn(
        `option "${key}" can only be used during instance ` +
          'creation with the `new` keyword.'
      )
    }
    return defaultStrat(parent, child)
  }
}

/**
 * Helper that recursively merges two data objects together.
 */
function mergeData(
  to: Record<string | symbol, any>,
  from: Record<string | symbol, any> | null,
  recursive = true
): Record<PropertyKey, any> {
  // 把其他配置，merge到组件自己的配置上
  if (!from) return to
  let key, toVal, fromVal
  // 如果环境中有symbol，则使用ownKeys获取所有key，否则使用keys
  const keys = hasSymbol
    ? (Reflect.ownKeys(from) as string[])
    : Object.keys(from)

  for (let i = 0; i < keys.length; i++) {
    key = keys[i]
    // in case the object is already observed...
    // 如果数据已经被劫持
    if (key === '__ob__') continue
    toVal = to[key]
    fromVal = from[key]
    // 如果不递归，或者to中没有该属性
    if (!recursive || !hasOwn(to, key)) {
      // 直接给to设置值
      set(to, key, fromVal)
    } else if (
      // 如果fromVal和toVal不同
      toVal !== fromVal &&
      // fromVal和toVal都是对象
      isPlainObject(toVal) &&
      isPlainObject(fromVal)
    ) {
      // 递归合并
      mergeData(toVal, fromVal)
    }
  }
  return to
}

/**
 * Data
 */
// 返回一个函数，这个函数在mergeOption时并没有执行
export function mergeDataOrFn(
  parentVal: any,
  childVal: any,
  vm?: Component
): Function | null {
  // 如果不是在new 过程中进行的合并
  if (!vm) {
    // in a Vue.extend merge, both should be functions
    // 子选项无值，直接返回父选项
    if (!childVal) {
      return parentVal
    }
    // 复选项没有，直接返回子选项
    if (!parentVal) {
      return childVal
    }
    // when parentVal & childVal are both present,
    // we need to return a function that returns the
    // merged result of both functions... no need to
    // check if parentVal is a function here because
    // it has to be a function to pass previous merges.
    return function mergedDataFn() {
      // 如果选项是函数，则先执行这个函数，返回值作为需要merge的data
      return mergeData(
        isFunction(childVal) ? childVal.call(this, this) : childVal,
        isFunction(parentVal) ? parentVal.call(this, this) : parentVal
      )
    }
  } else {
    return function mergedInstanceDataFn() {
      // instance merge
      const instanceData = isFunction(childVal)
        ? childVal.call(vm, vm)
        : childVal
      const defaultData = isFunction(parentVal)
        ? parentVal.call(vm, vm)
        : parentVal
      if (instanceData) {
        return mergeData(instanceData, defaultData)
      } else {
        return defaultData
      }
    }
  }
}
// 数据合并策略
strats.data = function (
  parentVal: any, // 一般是mixin中的配置
  childVal: any, // 一般是组件自己的配置
  vm?: Component
): Function | null {
  // 如果数据不是在new 的时候传入的，这里的意思是，如果是在new的时候传入的，那么data可以使用对象
  // 在组件定义时，都会使用extends转换成构造函数，这时候vm则为空，或者是mixin时，vm也为空，这时候需要校验data是不是函数
  if (!vm) {
    // 如果子选项中的data不是函数，警告，vue2中data使用函数，保证组件复用时数据独立
    if (childVal && typeof childVal !== 'function') {
      __DEV__ &&
        warn(
          'The "data" option should be a function ' +
            'that returns a per-instance value in component ' +
            'definitions.',
          vm
        )

      return parentVal
    }
    return mergeDataOrFn(parentVal, childVal)
  }

  return mergeDataOrFn(parentVal, childVal, vm)
}

/**
 * Hooks and props are merged as arrays.
 */
export function mergeLifecycleHook(
  parentVal: Array<Function> | null,
  childVal: Function | Array<Function> | null
): Array<Function> | null {
  const res = childVal
    ? parentVal
      ? parentVal.concat(childVal)
      : isArray(childVal)
      ? childVal
      : [childVal]
    : parentVal
  return res ? dedupeHooks(res) : res
}

function dedupeHooks(hooks: any) {
  const res: Array<any> = []
  for (let i = 0; i < hooks.length; i++) {
    if (res.indexOf(hooks[i]) === -1) {
      res.push(hooks[i])
    }
  }
  return res
}

LIFECYCLE_HOOKS.forEach(hook => {
  strats[hook] = mergeLifecycleHook
})

/**
 * Assets
 *
 * When a vm is present (instance creation), we need to do
 * a three-way merge between constructor options, instance
 * options and parent options.
 */
function mergeAssets(
  parentVal: Object | null,
  childVal: Object | null,
  vm: Component | null,
  key: string
): Object {
  const res = Object.create(parentVal || null)
  if (childVal) {
    __DEV__ && assertObjectType(key, childVal, vm)
    return extend(res, childVal)
  } else {
    return res
  }
}

ASSET_TYPES.forEach(function (type) {
  strats[type + 's'] = mergeAssets
})

/**
 * Watchers.
 *
 * Watchers hashes should not overwrite one
 * another, so we merge them as arrays.
 */
strats.watch = function (
  parentVal: Record<string, any> | null,
  childVal: Record<string, any> | null,
  vm: Component | null,
  key: string
): Object | null {
  // work around Firefox's Object.prototype.watch...
  //@ts-expect-error work around
  if (parentVal === nativeWatch) parentVal = undefined
  //@ts-expect-error work around
  if (childVal === nativeWatch) childVal = undefined
  /* istanbul ignore if */
  if (!childVal) return Object.create(parentVal || null)
  if (__DEV__) {
    assertObjectType(key, childVal, vm)
  }
  if (!parentVal) return childVal
  const ret: Record<string, any> = {}
  extend(ret, parentVal)
  for (const key in childVal) {
    let parent = ret[key]
    const child = childVal[key]
    if (parent && !isArray(parent)) {
      parent = [parent]
    }
    ret[key] = parent ? parent.concat(child) : isArray(child) ? child : [child]
  }
  return ret
}

/**
 * Other object hashes.
 */
strats.props =
  strats.methods =
  strats.inject =
  strats.computed =
    function (
      parentVal: Object | null,
      childVal: Object | null,
      vm: Component | null,
      key: string
    ): Object | null {
      if (childVal && __DEV__) {
        assertObjectType(key, childVal, vm)
      }
      if (!parentVal) return childVal
      const ret = Object.create(null)
      extend(ret, parentVal)
      if (childVal) extend(ret, childVal)
      return ret
    }

strats.provide = function (parentVal: Object | null, childVal: Object | null) {
  if (!parentVal) return childVal
  return function () {
    const ret = Object.create(null)
    mergeData(ret, isFunction(parentVal) ? parentVal.call(this) : parentVal)
    if (childVal) {
      mergeData(
        ret,
        isFunction(childVal) ? childVal.call(this) : childVal,
        false // non-recursive
      )
    }
    return ret
  }
}

/**
 * Default strategy.
 */
const defaultStrat = function (parentVal: any, childVal: any): any {
  return childVal === undefined ? parentVal : childVal
}

/**
 * Validate component names
 */
function checkComponents(options: Record<string, any>) {
  for (const key in options.components) {
    validateComponentName(key)
  }
}

export function validateComponentName(name: string) {
  if (
    !new RegExp(`^[a-zA-Z][\\-\\.0-9_${unicodeRegExp.source}]*$`).test(name)
  ) {
    // 检验合法组件名称
    warn(
      'Invalid component name: "' +
        name +
        '". Component names ' +
        'should conform to valid custom element name in html5 specification.'
    )
  }
  if (isBuiltInTag(name) || config.isReservedTag(name)) {
    // 不能使用 slot component 和原生html标签作为组件名称
    warn(
      'Do not use built-in or reserved HTML elements as component ' +
        'id: ' +
        name
    )
  }
}

/**
 * Ensure all props option syntax are normalized into the
 * Object-based format.
 */
function normalizeProps(options: Record<string, any>, vm?: Component | null) {
  const props = options.props
  if (!props) return
  const res: Record<string, any> = {}
  let i, val, name
  if (isArray(props)) {
    i = props.length
    // 如果props是数组，遍历每个props
    // 
    while (i--) {
      val = props[i]
      if (typeof val === 'string') {
        // 如果prop是字符串，转换成驼峰命名
        name = camelize(val)
        res[name] = { type: null }
      } else if (__DEV__) {
        // prop不是字符串，警告
        warn('props must be strings when using array syntax.')
      }
    }
  } else if (isPlainObject(props)) {
    // 如果props是对象，遍历每个key
    for (const key in props) {
      val = props[key]
      name = camelize(key)
      // prop转驼峰，存储类型
      // {
      //   name：string
      // }
      // ===》res={name：{type：string}}
      res[name] = isPlainObject(val) ? val : { type: val }
    }
  } else if (__DEV__) {
    warn(
      `Invalid value for option "props": expected an Array or an Object, ` +
        `but got ${toRawType(props)}.`,
      vm
    )
  }
  options.props = res
}

/**
 * Normalize all injections into Object-based format
 */
function normalizeInject(options: Record<string, any>, vm?: Component | null) {
  // 将inject都装换成对象
  // 原始写法
  // inject: ['foo', 'bar']

  // 规范化后
  // inject: {
  //     foo: { from: 'foo' },
  //     bar: { from: 'bar' }
  // }

  // 原始写法
  // inject: {
  //   foo: 'bar'  // 从bar注入到foo
  // }
  // 规范化后
  // inject: {
  //   foo: { from: 'bar' }
  // }
  const inject = options.inject
  if (!inject) return
  const normalized: Record<string, any> = (options.inject = {})
  // inject是数组
  if (isArray(inject)) {
    for (let i = 0; i < inject.length; i++) {
      normalized[inject[i]] = { from: inject[i] }
    }
  } else if (isPlainObject(inject)) {
    for (const key in inject) {
      const val = inject[key]
      normalized[key] = isPlainObject(val)
        ? extend({ from: key }, val)
        : { from: val }
    }
  } else if (__DEV__) {
    warn(
      `Invalid value for option "inject": expected an Array or an Object, ` +
        `but got ${toRawType(inject)}.`,
      vm
    )
  }
}

/**
 * Normalize raw function directives into object format.
 */
// 指令的两种书写方式
// 方式1：函数形式（简写）
// directives: {
//   focus: function(el) { // 这个函数会被用于 bind 和 update
//       el.focus()
//   }
// }

// 方式2：对象形式（完整）
// directives: {
//   focus: {
//       bind: function(el) { ... },
//       update: function(el) { ... },
//       // 可能还有其他钩子：inserted、componentUpdated、unbind
//   }
// }
function normalizeDirectives(options: Record<string, any>) {
  const dirs = options.directives
  if (dirs) {
    for (const key in dirs) {
      const def = dirs[key]
      if (isFunction(def)) {
        // 函数式指令配置转为对象 这就是为什么函数式指令 会被用于bind和update
        dirs[key] = { bind: def, update: def }
      }
    }
  }
}

function assertObjectType(name: string, value: any, vm: Component | null) {
  if (!isPlainObject(value)) {
    warn(
      `Invalid value for option "${name}": expected an Object, ` +
        `but got ${toRawType(value)}.`,
      vm
    )
  }
}

/**
 * Merge two option objects into a new one.
 * Core utility used in both instantiation and inheritance.
 */
export function mergeOptions(
  parent: Record<string, any>,
  child: Record<string, any>,
  vm?: Component | null
): ComponentOptions {
  if (__DEV__) {
    // 检验组件名称
    checkComponents(child)
  }

  // 如果 child 是函数
  // 使用 Vue.extend 生成的函数组件，其配置会在options 上，这里都统一成对象配置的形式。方便处理
  if (isFunction(child)) {
    // @ts-expect-error
    child = child.options
  }
  // 规范化props、inject、directives
  normalizeProps(child, vm)
  normalizeInject(child, vm)
  normalizeDirectives(child)

  // Apply extends and mixins on the child options,
  // but only if it is a raw options object that isn't
  // the result of another mergeOptions call.
  // Only merged options has the _base property.
  // 如果不存在_base，这个_base 指向vue构造函数，在initGlobalAPI的时候Vue放入到了Vue.options上
  if (!child._base) {
    // 如果组件是extends来的，递归调用mergeOptions，将被进程的组件合并到父选项中
    if (child.extends) {
      parent = mergeOptions(parent, child.extends, vm)
    }
    if (child.mixins) {
      // 如果具有mixin，对每一个mixin进行合并选项
      for (let i = 0, l = child.mixins.length; i < l; i++) {
        parent = mergeOptions(parent, child.mixins[i], vm)
      }
    }
  }

  const options: ComponentOptions = {} as any
  let key
  for (key in parent) {
    // 先处理父选项中的键
    mergeField(key)
  }
  for (key in child) {
    if (!hasOwn(parent, key)) {
      // 在处理复选项没有的键，默认情况下使用子选项覆盖
      mergeField(key)
    }
  }
  // starts中存储的合并不同配置的合并策略
  function mergeField(key: any) {
    // 获取对应的策略进行合并，默认情况下用child覆盖parent的值
    const strat = strats[key] || defaultStrat
    options[key] = strat(parent[key], child[key], vm, key)
  }
  return options
}

/**
 * Resolve an asset.
 * This function is used because child instances need access
 * to assets defined in its ancestor chain.
 */
export function resolveAsset(
  options: Record<string, any>,
  type: string,
  id: string,
  warnMissing?: boolean
): any {
  /* istanbul ignore if */
  if (typeof id !== 'string') {
    return
  }
  const assets = options[type]
  // check local registration variations first
  // 直接匹配
  if (hasOwn(assets, id)) return assets[id]
  const camelizedId = camelize(id)
  // 驼峰式匹配 (如 v-my-dir -> vMyDir)
  if (hasOwn(assets, camelizedId)) return assets[camelizedId]
  const PascalCaseId = capitalize(camelizedId)
  // 首字母大写匹配 (如 vMyDir -> VMyDir)
  if (hasOwn(assets, PascalCaseId)) return assets[PascalCaseId]
  // fallback to prototype chain
  const res = assets[id] || assets[camelizedId] || assets[PascalCaseId]
  if (__DEV__ && warnMissing && !res) {
    warn('Failed to resolve ' + type.slice(0, -1) + ': ' + id)
  }
  return res
}
