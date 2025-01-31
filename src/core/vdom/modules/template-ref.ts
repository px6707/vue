import {
  remove,
  isDef,
  hasOwn,
  isArray,
  isFunction,
  invokeWithErrorHandling,
  warn
} from 'core/util'
import type { VNodeWithData } from 'types/vnode'
import { Component } from 'types/component'
import { isRef } from 'v3'

export default {
  create(_: any, vnode: VNodeWithData) {
    registerRef(vnode)
  },
  update(oldVnode: VNodeWithData, vnode: VNodeWithData) {
    if (oldVnode.data.ref !== vnode.data.ref) {
      // 清除旧的ref
      registerRef(oldVnode, true)
      // 注册新的ref
      registerRef(vnode)
    }
  },
  destroy(vnode: VNodeWithData) {
    // 销毁时，清除ref
    registerRef(vnode, true)
  }
}

export function registerRef(vnode: VNodeWithData, isRemoval?: boolean) {
  const ref = vnode.data.ref
  if (!isDef(ref)) return

  const vm = vnode.context
  const refValue = vnode.componentInstance || vnode.elm
  const value = isRemoval ? null : refValue
  const $refsValue = isRemoval ? undefined : refValue
  // 如果ref是一个函数，则调用
  if (isFunction(ref)) {
    invokeWithErrorHandling(ref, vm, [value], vm, `template ref function`)
    return
  }

  const isFor = vnode.data.refInFor
  const _isString = typeof ref === 'string' || typeof ref === 'number'
  const _isRef = isRef(ref)
  const refs = vm.$refs
  // 如果是字符串
  if (_isString || _isRef) {
    // 在for循环内部
    if (isFor) {
      const existing = _isString ? refs[ref] : ref.value
      if (isRemoval) {
        // 如果是清除，在已经有的ref中删除
        isArray(existing) && remove(existing, refValue)
      } else {
        if (!isArray(existing)) {
          if (_isString) {
            refs[ref] = [refValue]
            setSetupRef(vm, ref, refs[ref])
          } else {
            ref.value = [refValue]
          }
        } else if (!existing.includes(refValue)) {
          existing.push(refValue)
        }
      }
    } else if (_isString) {
      if (isRemoval && refs[ref] !== refValue) {
        return
      }
      refs[ref] = $refsValue
      setSetupRef(vm, ref, value)
    } else if (_isRef) {
      if (isRemoval && ref.value !== refValue) {
        return
      }
      ref.value = value
    } else if (__DEV__) {
      warn(`Invalid template ref type: ${typeof ref}`)
    }
  }
}

function setSetupRef(
  { _setupState }: Component,
  key: string | number,
  val: any
) {
  if (_setupState && hasOwn(_setupState, key as string)) {
    if (isRef(_setupState[key])) {
      _setupState[key].value = val
    } else {
      _setupState[key] = val
    }
  }
}
