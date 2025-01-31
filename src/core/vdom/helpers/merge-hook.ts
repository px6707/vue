import VNode from '../vnode'
import { createFnInvoker } from './update-listeners'
import { remove, isDef, isUndef, isTrue } from 'shared/util'

export function mergeVNodeHook(
  def: Record<string, any>,
  hookKey: string,
  hook: Function
) {
  if (def instanceof VNode) {
    def = def.data!.hook || (def.data!.hook = {})
  }
  let invoker
  const oldHook = def[hookKey]

  function wrappedHook() {
    hook.apply(this, arguments)
    // important: remove merged hook to ensure it's called only once
    // and prevent memory leak
    remove(invoker.fns, wrappedHook)
  }

  if (isUndef(oldHook)) {
    // no existing hook
    // 使用统一的错误处理包装wrappedHook
    invoker = createFnInvoker([wrappedHook])
  } else {
    /* istanbul ignore if */
    if (isDef(oldHook.fns) && isTrue(oldHook.merged)) {
      // 如果之前的hook已经是包装过的，就不用再包装了，只需要把wrappedHook添加进去
      // already a merged invoker
      invoker = oldHook
      invoker.fns.push(wrappedHook)
    } else {
      // existing plain hook
      invoker = createFnInvoker([oldHook, wrappedHook])
    }
  }
  // 设置合并过的标志
  invoker.merged = true
  def[hookKey] = invoker
}
