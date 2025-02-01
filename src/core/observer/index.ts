import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  isArray,
  hasProto,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering,
  hasChanged,
  noop
} from '../util/index'
import { isReadonly, isRef, TrackOpTypes, TriggerOpTypes } from '../../v3'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

const NO_INITIAL_VALUE = {}

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

export function toggleObserving(value: boolean) {
  shouldObserve = value
}

// ssr mock dep
const mockDep = {
  notify: noop,
  depend: noop,
  addSub: noop,
  removeSub: noop
} as Dep

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
// 给响应式对象挂上__ob__属性
// ob属性上有dep属性，用于收集依赖
// 处理数组的函数，能够感知到数组变化并下发更新
// 对象的子对象和数组的子元素进行递归响应式
export class Observer {
  dep: Dep
  vmCount: number // number of vms that have this object as root $data
  // mock用于服务端渲染
  constructor(public value: any, public shallow = false, public mock = false) {
    // this.value = value
    // 对象上创建一个dep属性，用于收集依赖
    this.dep = mock ? mockDep : new Dep()
    this.vmCount = 0
    // value上定义一个不可枚举的__ob__属性
    def(value, '__ob__', this)
    // 如果是数组
    if (isArray(value)) {
      // 非mock模式处理数组
      if (!mock) {
        // 如果当前环境中，对象具有__proto__，给当前数组覆盖数组方法，因为Object。defineProperty不能对数组进行劫持
        //  数组的响应式是对数组方法进行覆盖
        // 'push',
        // 'pop',
        // 'shift',
        // 'unshift',
        // 'splice',
        // 'sort',
        // 'reverse'
        // 会覆盖这些数组方法是因为这些方法会改变数组本身，在执行这些方法时，说明数组被修改， vue需要知道数组被修改了，然后重新render
        if (hasProto) {
          /* eslint-disable no-proto */
          ;(value as any).__proto__ = arrayMethods
          /* eslint-enable no-proto */
        } else {
          // 如果当前环境中，对象没有__proto__
          // 遍历需要覆盖的数组方法，挨个添加到value上
          for (let i = 0, l = arrayKeys.length; i < l; i++) {
            const key = arrayKeys[i]
            def(value, key, arrayMethods[key])
          }
        }
      }
      // 如果不是浅响应，需要对数组元素observe
      if (!shallow) {
        this.observeArray(value)
      }
    } else {
      /**
       * Walk through all properties and convert them into
       * getter/setters. This method should only be called when
       * value type is Object.
       */
      // 在不是数组的情况下，需要对对象的每一个属性进行响应式
      const keys = Object.keys(value)
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        defineReactive(value, key, NO_INITIAL_VALUE, undefined, shallow, mock)
      }
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray(value: any[]) {
    // 数组响应式，每个元素调用oberve进行响应式
    for (let i = 0, l = value.length; i < l; i++) {
      observe(value[i], false, this.mock)
    }
  }
}

// helpers

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
// 负责把对象整体变成响应式
export function observe(
  value: any,
  shallow?: boolean,
  ssrMockReactivity?: boolean
): Observer | void {
  // 如果value上存在__ob__ 说明，value已经被观察过，直接返回
  if (value && hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    return value.__ob__
  }
  if (
    shouldObserve &&
    (ssrMockReactivity || !isServerRendering()) && // 服务端渲染判断
    (isArray(value) || isPlainObject(value)) && // 类型判断
    Object.isExtensible(value) && // 是否可扩展
    !value.__v_skip /* ReactiveFlags.SKIP */ && // 不是被skip跳过观察的对象
    !isRef(value) && // 不是ref，因为ref已经是响应式的了
    !(value instanceof VNode) // 不是vnode
  ) {
    // 返回一个Observer实例
    return new Observer(value, shallow, ssrMockReactivity)
  }
}

/**
 * Define a reactive property on an Object.
 */
// 负责把一个对象的属性变成响应式
export function defineReactive(
  obj: object,
  key: string,
  val?: any,
  customSetter?: Function | null,
  shallow?: boolean,
  mock?: boolean,
  observeEvenIfShallow = false
) {
  // 一个key一个dep
  const dep = new Dep()
  // 如果obj不可配置，则不能响应式
  const property = Object.getOwnPropertyDescriptor(obj, key)
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get
  const setter = property && property.set
  if (
    (!getter || setter) &&
    // 如果没有value，则需要获取value  如果getter被设置，则在后续需要使用设置的getter来获取值
    (val === NO_INITIAL_VALUE || arguments.length === 2)
  ) {
    val = obj[key]
  }
  // 如果shallow === true ，说明是浅响应，不再对值进行响应式
  let childOb = shallow ? val && val.__ob__ : observe(val, false, mock)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter() {
      // 如果对象的getter设置了，需要使用设置的getter来获取值
      const value = getter ? getter.call(obj) : val
      // 存在当前收集依赖的watcher，调用dep.depend 收集依赖
      if (Dep.target) {
        if (__DEV__) {
          dep.depend({
            target: obj,
            type: TrackOpTypes.GET,
            key
          })
        } else {
          dep.depend()
        }
        // 如果存在嵌套对象，说明子对象的改变也会导致当前watcher进行重新渲染，需要对子对象进行依赖收集
        if (childOb) {
          childOb.dep.depend()
          if (isArray(value)) {
            dependArray(value)  
          }
        }
      }
      // isRef 支持vue3
      return isRef(value) && !shallow ? value.value : value
    },
    set: function reactiveSetter(newVal) {
      const value = getter ? getter.call(obj) : val
      // 数据没变化直接返回
      if (!hasChanged(value, newVal)) {
        return
      }
      if (__DEV__ && customSetter) {
        customSetter()
      }
      // 如果对象设置了setter，调用setter 来赋值
      if (setter) {
        setter.call(obj, newVal)
      } else if (getter) {
        // #7981: for accessor properties without setter
        // 如果没有setter，只有getter，说明这个对象在使用时，get的值是由用户决定的
        return
      } else if (!shallow && isRef(value) && !isRef(newVal)) {
        // 如果是vue3 的ref，则需要给value.value 赋值,这是对vue3写法的兼容
        value.value = newVal
        return
      } else {
        val = newVal
      }
      // 需要对新的值进行响应式
      childOb = shallow ? newVal && newVal.__ob__ : observe(newVal, false, mock)
      // 既然值已经发生变化，就需要下发更新通知
      if (__DEV__) {
        dep.notify({
          type: TriggerOpTypes.SET,
          target: obj,
          key,
          newValue: newVal,
          oldValue: value
        })
      } else {
        dep.notify()
      }
    }
  })

  return dep
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
export function set<T>(array: T[], key: number, value: T): T
export function set<T>(object: object, key: string | number, value: T): T
export function set(
  target: any[] | Record<string, any>,
  key: any,
  val: any
): any {
  if (__DEV__ && (isUndef(target) || isPrimitive(target))) {
    // 不能给undefined,null和基本类型设置响应式属性
    warn(
      `Cannot set reactive property on undefined, null, or primitive value: ${target}`
    )
  }
  // 只读属性不能设置
  if (isReadonly(target)) {
    __DEV__ && warn(`Set operation on key "${key}" failed: target is readonly.`)
    return
  }
  const ob = (target as any).__ob__
  // 如果原始对象是个数组
  if (isArray(target) && isValidArrayIndex(key)) {
    // 给原始数组设置长度
    target.length = Math.max(target.length, key)
    // 将key索引处的值替换成新值
    target.splice(key, 1, val)
    // when mocking for SSR, array methods are not hijacked
    // 对新的数组响应式
    if (ob && !ob.shallow && ob.mock) {
      observe(val, false, true)
    }
    return val
  }
  // 如果target已经有这个key，则直接赋值， 不会覆盖原型链上的属性
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  // 如果target是Vue实例 或者 再被Observer劫持的情况下有vmCount，则不允许设置响应式属性 vmCount存在说明多个实例使用这个对象作为根级别的data
  // 性能考虑：
  // 根级响应式数据的变化会触发整个组件树的重新渲染
  // 运行时添加根级属性可能导致不必要的性能开销
  // 可维护性：
  // 强制开发者在 data 选项中声明所有根级属性
  // 使得数据结构更清晰，代码更易维护
  if ((target as any)._isVue || (ob && ob.vmCount)) {
    __DEV__ &&
      warn(
        'Avoid adding reactive properties to a Vue instance or its root $data ' +
          'at runtime - declare it upfront in the data option.'
      )
    return val
  }
  // 如果当前的数据是没有被劫持的，直接赋值，因为targe不需要劫持，那么新设置的值也不需要劫持
  if (!ob) {
    target[key] = val
    return val
  }
  defineReactive(ob.value, key, val, undefined, ob.shallow, ob.mock)
  // 设置新的key、value，说明数据有变化，下发更新通知
  if (__DEV__) {
    ob.dep.notify({
      type: TriggerOpTypes.ADD,
      target: target,
      key,
      newValue: val,
      oldValue: undefined
    })
  } else {
    ob.dep.notify()
  }
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del<T>(array: T[], key: number): void
export function del(object: object, key: string | number): void
export function del(target: any[] | object, key: any) {
  if (__DEV__ && (isUndef(target) || isPrimitive(target))) {
    // 不能删除undefined,null以及基本类型的属性
    warn(
      `Cannot delete reactive property on undefined, null, or primitive value: ${target}`
    )
  }
  if (isArray(target) && isValidArrayIndex(key)) {
    // 数组删除元素
    target.splice(key, 1)
    return
  }
  const ob = (target as any).__ob__
  // 如果target是Vue实例 或者 在被Observer劫持的情况下有vmCount，则不允许删除响应式属性 vm存在说明是根级别的data
  if ((target as any)._isVue || (ob && ob.vmCount)) {
    __DEV__ &&
      warn(
        'Avoid deleting properties on a Vue instance or its root $data ' +
          '- just set it to null.'
      )
    return
  }
  // 只读对象不能删除属性
  if (isReadonly(target)) {
    __DEV__ &&
      warn(`Delete operation on key "${key}" failed: target is readonly.`)
    return
  }
  // target本身不具备这个key，无从删除
  if (!hasOwn(target, key)) {
    return
  }
  // 从对象上删除这个key
  delete target[key]
  if (!ob) {
    return
  }
  // 如果存在ob，说明对象被劫持过，下发通知
  if (__DEV__) {
    ob.dep.notify({
      type: TriggerOpTypes.DELETE,
      target: target,
      key
    })
  } else {
    ob.dep.notify()
  }
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray(value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    if (e && e.__ob__) {
      e.__ob__.dep.depend()
    }
    if (isArray(e)) {
      dependArray(e)
    }
  }
}
