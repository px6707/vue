import VNode from 'core/vdom/vnode'
import { isDef, isObject } from 'shared/util'
import type { VNodeData, VNodeWithData } from 'types/vnode'

export function genClassForVnode(vnode: VNodeWithData): string {
  let data = vnode.data
  let parentNode: VNode | VNodeWithData | undefined = vnode
  let childNode: VNode | VNodeWithData = vnode
  // 子组件继承父组件的class
  while (isDef(childNode.componentInstance)) {
    childNode = childNode.componentInstance._vnode!
    if (childNode && childNode.data) {
      data = mergeClassData(childNode.data, data)
    }
  }
  // @ts-expect-error parentNode.parent not VNodeWithData
  while (isDef((parentNode = parentNode.parent))) {
    if (parentNode && parentNode.data) {
      data = mergeClassData(data, parentNode.data)
    }
  }
  return renderClass(data.staticClass!, data.class)
}

function mergeClassData(
  child: VNodeData,
  parent: VNodeData
): {
  staticClass: string
  class: any
} {
  return {
    staticClass: concat(child.staticClass, parent.staticClass),
    class: isDef(child.class) ? [child.class, parent.class] : parent.class
  }
}

export function renderClass(
  staticClass: string | null | undefined,
  dynamicClass: any
): string {
  if (isDef(staticClass) || isDef(dynamicClass)) {
    // 组合静态class和动态class
    return concat(staticClass, stringifyClass(dynamicClass))
  }
  /* istanbul ignore next */
  return ''
}

export function concat(a?: string | null, b?: string | null): string {
  return a ? (b ? a + ' ' + b : a) : b || ''
}

export function stringifyClass(value: any): string {
  // 如果class是数组，调用stringifyArray
  if (Array.isArray(value)) {
    return stringifyArray(value)
  }
  // 如果class是对象，调用stringifyObject
  if (isObject(value)) {
    return stringifyObject(value)
  }
  // 如果class是字符串，直接返回
  if (typeof value === 'string') {
    return value
  }
  /* istanbul ignore next */
  return ''
}

function stringifyArray(value: Array<any>): string {
  let res = ''
  let stringified
  for (let i = 0, l = value.length; i < l; i++) {
    if (isDef((stringified = stringifyClass(value[i]))) && stringified !== '') {
      if (res) res += ' '
      res += stringified
    }
  }
  return res
}

function stringifyObject(value: Object): string {
  let res = ''
  // 如果是对象，遍历每个key，如果值为true，拼接key
  for (const key in value) {
    if (value[key]) {
      if (res) res += ' '
      res += key
    }
  }
  return res
}
