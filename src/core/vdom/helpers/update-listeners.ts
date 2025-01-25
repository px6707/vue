import { warn, invokeWithErrorHandling } from 'core/util/index'
import { cached, isUndef, isTrue, isArray } from 'shared/util'
import type { Component } from 'types/component'

const normalizeEvent = cached(
  (
    name: string
  ): {
    name: string
    once: boolean
    capture: boolean
    passive: boolean
    handler?: Function
    params?: Array<any>
  } => {
    // & : passive 修饰符（表示事件监听器是被动的）
    // ~ : once 修饰符（表示事件只触发一次）
    // ! : capture 修饰符（表示事件在捕获阶段处理）
    // 获取事件名称，以及是否有修饰符的标识
    const passive = name.charAt(0) === '&'
    name = passive ? name.slice(1) : name
    const once = name.charAt(0) === '~' // Prefixed last, checked first
    name = once ? name.slice(1) : name
    const capture = name.charAt(0) === '!'
    name = capture ? name.slice(1) : name
    return {
      name,
      once,
      capture,
      passive
    }
  }
)

export function createFnInvoker(
  fns: Function | Array<Function>,
  vm?: Component
): Function {
  function invoker() {
    const fns = invoker.fns
    if (isArray(fns)) {
      const cloned = fns.slice()
      for (let i = 0; i < cloned.length; i++) {
        // 调用函数，并使用统一的错误处理
        invokeWithErrorHandling(
          cloned[i],
          null,
          arguments as any,
          vm,
          `v-on handler`
        )
      }
    } else {
      // return handler return value for single handlers
      return invokeWithErrorHandling(
        fns,
        null,
        arguments as any,
        vm,
        `v-on handler`
      )
    }
  }
  invoker.fns = fns
  return invoker
}

export function updateListeners(
  on: Object,
  oldOn: Object,
  add: Function,
  remove: Function,
  createOnceHandler: Function,
  vm: Component
) {
  let name, cur, old, event
  for (name in on) {
    // 遍历事件
    cur = on[name]
    old = oldOn[name]
    event = normalizeEvent(name)
    if (isUndef(cur)) {
      // 如果未定义， 警告
      __DEV__ &&
        warn(
          `Invalid handler for event "${event.name}": got ` + String(cur),
          vm
        )
    } else if (isUndef(old)) {
      // 如果老的事件不存在，且函数未使用createFnInvoker包装过，则去包装
      if (isUndef(cur.fns)) {
        // reateFnInvoker 函数中，会给包装后的函数添加一个 fns 属性，上面判断这个属性没有就是没包装过
        cur = on[name] = createFnInvoker(cur, vm)
      }
      // 如果有once修饰符
      if (isTrue(event.once)) {
        // 使用createOnceHandler包装
        cur = on[name] = createOnceHandler(event.name, cur, event.capture)
      }
      // 在当前实例上添加对应的事件函数
      add(event.name, cur, event.capture, event.passive, event.params)
    } else if (cur !== old) {
      // 新老事件不一致，更新他们
      old.fns = cur
      on[name] = old
    }
  }
  for (name in oldOn) {
    // 旧事件不在on中了，就取消对旧事件的监听
    if (isUndef(on[name])) {
      event = normalizeEvent(name)
      remove(event.name, oldOn[name], event.capture)
    }
  }
}
