/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { TriggerOpTypes } from '../../v3'
import { def } from '../util/index'

const arrayProto = Array.prototype
export const arrayMethods = Object.create(arrayProto)

const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

/**
 * Intercept mutating methods and emit events
 */
methodsToPatch.forEach(function (method) {
  // cache original method
  // 先获取原始的数组方法
  const original = arrayProto[method]
  // 定义一个同名的新方法
  def(arrayMethods, method, function mutator(...args) {
    // 先试用原始的方法 回去结果
    const result = original.apply(this, args)
    const ob = this.__ob__
    let inserted
    // 如果数组函数式push、unshift说明是插入的值是args   [].push(item)
    switch (method) {
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        // 如果是splice方法，说明插入的值是args.slice(2)  [].splice(index, count, item1, item2)
        inserted = args.slice(2)
        break
    }
    // 如果插入的值存在，需要对插入的值进行响应式
    if (inserted) ob.observeArray(inserted)
    // 在数组变化之后，下发通知更新
    // notify change
    if (__DEV__) {
      ob.dep.notify({
        type: TriggerOpTypes.ARRAY_MUTATION,
        target: this,
        key: method
      })
    } else {
      ob.dep.notify()
    }
    return result
  })
})
