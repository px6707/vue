import { def } from 'core/util/lang'
import { normalizeChildren } from 'core/vdom/helpers/normalize-children'
import { emptyObject, isArray } from 'shared/util'
import { isAsyncPlaceholder } from './is-async-placeholder'
import type VNode from '../vnode'
import { Component } from 'types/component'
import { currentInstance, setCurrentInstance } from 'v3/currentInstance'

export function normalizeScopedSlots(
  ownerVm: Component,
  scopedSlots: { [key: string]: Function } | undefined,
  normalSlots: { [key: string]: VNode[] },
  prevScopedSlots?: { [key: string]: Function }
): any {
  let res
  // 是否具有普通插槽
  const hasNormalSlots = Object.keys(normalSlots).length > 0
  // 判断作用域插槽是否稳定：如果有作用域插槽则看其$stable属性，否则取决于是否有普通插槽
  const isStable = scopedSlots ? !!scopedSlots.$stable : !hasNormalSlots
   // 获取作用域插槽的key值
  const key = scopedSlots && scopedSlots.$key
  // 不存在作用域插槽，返回空对象
  if (!scopedSlots) {
    res = {}
  } else if (scopedSlots._normalized) {
    // fast path 1: child component re-render only, parent did not change
    // 如果已经规范化过，直接返回缓存的结果
    return scopedSlots._normalized
  } else if (
    isStable &&
    prevScopedSlots &&
    prevScopedSlots !== emptyObject &&
    key === prevScopedSlots.$key &&
    !hasNormalSlots &&
    !prevScopedSlots.$hasNormal
  ) {
    // fast path 2: stable scoped slots w/ no normal slots to proxy,
    // only need to normalize once
    // 稳定的作用域插槽，没有普通插槽需要代理，只需要规范化一次
    return prevScopedSlots
  } else {
    res = {}
    // 遍历所有作用域插槽
    for (const key in scopedSlots) {
      // 处理非$开头的插槽（排除内部属性）
      if (scopedSlots[key] && key[0] !== '$') {
        // 规范化单个作用域插槽
        res[key] = normalizeScopedSlot(
          ownerVm,
          normalSlots,
          key,
          scopedSlots[key]
        )
      }
    }
  }
  // expose normal slots on scopedSlots
  // 将普通插槽也添加到结果中
  for (const key in normalSlots) {
    if (!(key in res)) {
      // 为普通插槽创建代理
      res[key] = proxyNormalSlot(normalSlots, key)
    }
  }
  // avoriaz seems to mock a non-extensible $scopedSlots object
  // and when that is passed down this would cause an error
  if (scopedSlots && Object.isExtensible(scopedSlots)) {
    // 缓存规范化的结果
    scopedSlots._normalized = res
  }
  def(res, '$stable', isStable)
  def(res, '$key', key)
  def(res, '$hasNormal', hasNormalSlots)
  return res
}

function normalizeScopedSlot(vm, normalSlots, key, fn) {
  const normalized = function () {
    const cur = currentInstance
    setCurrentInstance(vm)
    // 执行插槽函数
    let res = arguments.length ? fn.apply(null, arguments) : fn({})
    // 结果规范化
    res =
      res && typeof res === 'object' && !isArray(res)
        ? [res] // single vnode
        : normalizeChildren(res)
    const vnode: VNode | null = res && res[0]
    setCurrentInstance(cur)
    return res &&
      (!vnode ||
        (res.length === 1 && vnode.isComment && !isAsyncPlaceholder(vnode))) // #9658, #10391
      ? undefined
      : res
  }
  // this is a slot using the new v-slot syntax without scope. although it is
  // compiled as a scoped slot, render fn users would expect it to be present
  // on this.$slots because the usage is semantically a normal slot.
//   如果插槽函数有 proxy 标记，说明这是使用新的 v-slot 语法但没有作用域的插槽
// 将其添加到 normalSlots 中，使其可以通过 this.$slots 访问
  if (fn.proxy) {
    Object.defineProperty(normalSlots, key, {
      get: normalized,
      enumerable: true,
      configurable: true
    })
  }
  return normalized
}

function proxyNormalSlot(slots, key) {
  return () => slots[key]
}
