import { warn, hasSymbol, isFunction, isObject } from '../util/index'
import { defineReactive, toggleObserving } from '../observer/index'
import type { Component } from 'types/component'
import { resolveProvided } from 'v3/apiInject'

export function initProvide(vm: Component) {
  // 获取选项上的provide
  const provideOption = vm.$options.provide
  if (provideOption) {
    // 对象形式：
    // {
    //   provide: {
    //     foo: 'bar',
    //     baz: 'qux'
    //   }
    // }
    // 函数形式：
    // {
    //   provide() {
    //     return {
    //       foo: this.foo,  // 可以访问组件实例
    //       baz: 'qux'
    //     }
    //   }
    // }
    // 选项上有provide的情况下，如果provide是函数
    const provided = isFunction(provideOption)
    // 如果是函数，执行获取结果
      ? provideOption.call(vm)
      // 如果是对象，直接使用
      : provideOption
      // 确保 provided 是对象
    if (!isObject(provided)) {
      return
    }
    // 当前组件的_provide 的原型上添加父组件的_provide，使得后续inject的值，可以取得祖先元素上提供的数据
    const source = resolveProvided(vm)
    // IE9 doesn't support Object.getOwnPropertyDescriptors so we have to
    // iterate the keys ourselves.
    const keys = hasSymbol ? Reflect.ownKeys(provided) : Object.keys(provided)
    for (let i = 0; i < keys.length; i++) {
      // 遍历provide对象
      const key = keys[i]
      // 原对象
      // const provided = {
      //   get() { return this.value },
      //   set(val) { this.value = val }
      // }
      // 将定义在provide上的数据描述配置完整的复制给对当前组件的_provide
      // 这样_provide上的数据也具有了用户设置的get、set等
      Object.defineProperty(
        source,
        key,
        Object.getOwnPropertyDescriptor(provided, key)!
      )
    }
  }
}

export function initInjections(vm: Component) {
  // 从provide中获取注入的结果
  const result = resolveInject(vm.$options.inject, vm)
  if (result) {
    // 暂时关闭observer
    toggleObserving(false)
    Object.keys(result).forEach(key => {
      /* istanbul ignore else */
      if (__DEV__) {
        defineReactive(vm, key, result[key], () => {
          // 添加警告回调，当用户直接修改注入的值时触发
          warn(
            `Avoid mutating an injected value directly since the changes will be ` +
              `overwritten whenever the provided component re-renders. ` +
              `injection being mutated: "${key}"`,
            vm
          )
        })
      } else {
        // 能够从vm上直接获取注入的值
        defineReactive(vm, key, result[key])
      }
    })
    toggleObserving(true)
  }
}

export function resolveInject(
  inject: any,
  vm: Component
): Record<string, any> | undefined | null {
  // 如果有注入属性
  if (inject) {
    // inject is :any because flow is not smart enough to figure out cached
    const result = Object.create(null)
    // 环境中有Symbol的情况下使用ownKey遍历属性
    const keys = hasSymbol ? Reflect.ownKeys(inject) : Object.keys(inject)
    // 遍历所有inject
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      // #6574 in case the inject object is observed...
      // 如果注入的属性是响应式的，不再处理
      if (key === '__ob__') continue
      // 获取提供值的键名
      const provideKey = inject[key].from
      if (provideKey in vm._provided) {
        //  如果在_provided中找到对应的值，直接使用
        result[key] = vm._provided[provideKey]
      } else if ('default' in inject[key]) {
        // 如果没找到但有默认值，使用默认值
        const provideDefault = inject[key].default
        result[key] = isFunction(provideDefault)
        // 如果默认值是函数，执行它
          ? provideDefault.call(vm)
          : provideDefault
      } else if (__DEV__) {
        //  如果在_provided中找不到对应的值，且没有默认值，报错
        warn(`Injection "${key as string}" not found`, vm)
      }
    }
    return result
  }
}
