import type VNode from 'core/vdom/vnode'
import type { Component } from 'types/component'

/**
 * Runtime helper for resolving raw children VNodes into a slot object.
 */
export function resolveSlots(
  children: Array<VNode> | null | undefined,
  context: Component | null
): { [key: string]: Array<VNode> } {
  if (!children || !children.length) {
    return {}
  }
  const slots: Record<string, any> = {}
  // 遍历子节点
  for (let i = 0, l = children.length; i < l; i++) {
    const child = children[i]
    const data = child.data
    // remove slot attribute if the node is resolved as a Vue slot node
    // 如果存在插槽属性
    if (data && data.attrs && data.attrs.slot) {
      // 移除插槽属性
      delete data.attrs.slot
    }
    // named slots should only be respected if the vnode was rendered in the
    // same context.
    // 如果是统一上下文，并且有插槽属性
    if (
      (child.context === context || child.fnContext === context) &&
      data &&
      data.slot != null
    ) {
      // 有名称，是具名插槽
      const name = data.slot
      const slot = slots[name] || (slots[name] = [])
      if (child.tag === 'template') {
        // 如果插槽是一个tempalte，则其子节点也在插槽中
        slot.push.apply(slot, child.children || [])
      } else {
        slot.push(child)
      }
    } else {
      // 否则就是默认插槽
      ;(slots.default || (slots.default = [])).push(child)
    }
  }
  // ignore slots that contains only whitespace
  for (const name in slots) {
    // 一个名字的插槽内容都是空的，就删除
    if (slots[name].every(isWhitespace)) {
      delete slots[name]
    }
  }
  return slots
}

function isWhitespace(node: VNode): boolean {
  return (node.isComment && !node.asyncFactory) || node.text === ' '
}
