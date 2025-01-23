import { emptyObject } from 'shared/util'
import { ASTElement, ASTModifiers } from 'types/compiler'
import { parseFilters } from './parser/filter-parser'

type Range = { start?: number; end?: number }

/* eslint-disable no-unused-vars */
export function baseWarn(msg: string, range?: Range) {
  console.error(`[Vue compiler]: ${msg}`)
}
/* eslint-enable no-unused-vars */
// 在module中找到所有对应key的方法
export function pluckModuleFunction<T, K extends keyof T>(
  modules: Array<T> | undefined,
  key: K
): Array<Exclude<T[K], undefined>> {
  return modules ? (modules.map(m => m[key]).filter(_ => _) as any) : []
}

// 关于property和attribute的区别
// property是DOM节点对象本身具有的属性，可以有多种数据类型，包括了value、type等；property更新不会引起attribute更新，大小写敏感，href返回完整url
// attribute是标签上的特性，只能有字符串类型，例如id、class等;attribute更新会引起property更新，大小写不敏感，href返回设置的值
// 给DOM添加property
export function addProp(
  el: ASTElement,
  name: string,
  value: string,
  range?: Range,
  dynamic?: boolean
) {
  ;(el.props || (el.props = [])).push(
    rangeSetItem({ name, value, dynamic }, range)
  )
  el.plain = false
}
// 给节点添加属性
export function addAttr(
  el: ASTElement,
  name: string,
  value: any,
  range?: Range,
  dynamic?: boolean
) {
  // 如果是动态的，获取动态属性列表，否则获取属性列表
  const attrs = dynamic
    ? el.dynamicAttrs || (el.dynamicAttrs = [])
    : el.attrs || (el.attrs = [])
    // 在属性列表上，添加一个属性
  attrs.push(rangeSetItem({ name, value, dynamic }, range))
  // 添加属性之后，这就不是普通节点了
  el.plain = false
}
// 在el上，添加一个属性和对应的值
// add a raw attr (use this in preTransforms)
export function addRawAttr(
  el: ASTElement,
  name: string,
  value: any,
  range?: Range
) {
  el.attrsMap[name] = value
  el.attrsList.push(rangeSetItem({ name, value }, range))
}

export function addDirective(
  el: ASTElement,
  name: string,
  rawName: string,
  value: string,
  arg?: string,
  isDynamicArg?: boolean,
  modifiers?: ASTModifiers,
  range?: Range
) {
  ;(el.directives || (el.directives = [])).push(
    rangeSetItem(
      {
        name,
        rawName,
        value,
        arg,
        isDynamicArg,
        modifiers
      },
      range
    )
  )
  el.plain = false
}

function prependModifierMarker(
  symbol: string,
  name: string,
  dynamic?: boolean
): string {
  return dynamic ? `_p(${name},"${symbol}")` : symbol + name // mark the event as captured
}

export function addHandler(
  el: ASTElement,
  name: string,
  value: string,
  modifiers?: ASTModifiers | null,
  important?: boolean,
  warn?: Function,
  range?: Range,
  dynamic?: boolean
) {
  modifiers = modifiers || emptyObject
  // warn prevent and passive modifier
  /* istanbul ignore if */
  // passive 诉浏览器这个事件处理器不会调用 preventDefault()
  // 用于优化滚动性能，让浏览器可以立即开始滚动，而不用等待事件处理器执行完成
  // 因此prevent和passive不能同时使用
  if (__DEV__ && warn && modifiers.prevent && modifiers.passive) {
    warn(
      "passive and prevent can't be used together. " +
        "Passive handler can't prevent default event.",
      range
    )
  }

  // normalize click.right and click.middle since they don't actually fire
  // this is technically browser-specific, but at least for now browsers are
  // the only target envs that have right/middle clicks.
  // 如果是鼠标右键
  if (modifiers.right) {
    // 动态事件名
    if (dynamic) {
      // contextmenu能够更精确的捕获右键事件
      name = `(${name})==='click'?'contextmenu':(${name})`
    } else if (name === 'click') {
      name = 'contextmenu'
      delete modifiers.right
    }
  } else if (modifiers.middle) {
    // 如果是鼠标中键
    if (dynamic) {
      name = `(${name})==='click'?'mouseup':(${name})`
    } else if (name === 'click') {
      name = 'mouseup'
    }
  }

  // 给各种修饰符添加标记
  // check capture modifier
  if (modifiers.capture) {
    delete modifiers.capture
    // <div @click.capture="handler"> ===》 !click
    // <div @[eventName].capture="handler"> ===》_p(click,！)
    name = prependModifierMarker('!', name, dynamic)
  }
  if (modifiers.once) {
    delete modifiers.once
    name = prependModifierMarker('~', name, dynamic)
  }
  /* istanbul ignore if */
  if (modifiers.passive) {
    delete modifiers.passive
    name = prependModifierMarker('&', name, dynamic)
  }
  // 事件的原生标记
  let events
  if (modifiers.native) {
    delete modifiers.native
    events = el.nativeEvents || (el.nativeEvents = {})
  } else {
    events = el.events || (el.events = {})
  }

  const newHandler: any = rangeSetItem({ value: value.trim(), dynamic }, range)
  if (modifiers !== emptyObject) {
    newHandler.modifiers = modifiers
  }
  // 事件数组中获取当前事件已存在的处理函数
  const handlers = events[name]
  /* istanbul ignore if */
  if (Array.isArray(handlers)) {
    // 重要事件放在前面
    important ? handlers.unshift(newHandler) : handlers.push(newHandler)
  } else if (handlers) {
    events[name] = important ? [newHandler, handlers] : [handlers, newHandler]
  } else {
    events[name] = newHandler
  }
  // 有事件的节点不再是普通节点
  el.plain = false
}

// 关于attrsMap和rawAttrsMap的区别
// attrsMap:属性名：属性值的映射表attrsMap = {'class': 'btn',':title': 'message','v-if': 'isShow'}
// rawAttrsMap:属性名：属性值完整属性信息 
//rawAttrsMap = {
  // 'class': {
  //   name: 'class',
  //   value: 'btn',
  //   start: 5,
  //   end: 15
  // },
  // ':title': {
  //   name: 'title',
  //   value: 'message',
  //   dynamic: true,
  //   start: 16,
  //   end: 32
  // }
// }

export function getRawBindingAttr(el: ASTElement, name: string) {
  // 依次查找 :name，v-bind:name，name 的值
  return (
    el.rawAttrsMap[':' + name] ||
    el.rawAttrsMap['v-bind:' + name] ||
    el.rawAttrsMap[name]
  )
}

export function getBindingAttr(
  el: ASTElement,
  name: string,
  getStatic?: boolean
): string | undefined {
  // 从el的属性中获取  :name 的值，或者 v-bind:name的值
  const dynamicValue =
    getAndRemoveAttr(el, ':' + name) || getAndRemoveAttr(el, 'v-bind:' + name)
  if (dynamicValue != null) {
    // 如果有绑定，则获取其中的过滤器
    return parseFilters(dynamicValue)
  } else if (getStatic !== false) {
    // 如果没有绑定，且要求获取静态值，则返回这个属性的静态值
    const staticValue = getAndRemoveAttr(el, name)
    if (staticValue != null) {
      return JSON.stringify(staticValue)
    }
  }
}

// note: this only removes the attr from the Array (attrsList) so that it
// doesn't get processed by processAttrs.
// By default it does NOT remove it from the map (attrsMap) because the map is
// needed during codegen.
export function getAndRemoveAttr(
  el: ASTElement,
  name: string,
  removeFromMap?: boolean
): string | undefined {
  // el上面有两个关于属性的集合
  // 一个是attrsMap，一个是attrsList
  // 默认情况下，从attrsList中删除,在attrsMap中保留，保留的属性可能在之后的编译过程中会用到
  let val
  if ((val = el.attrsMap[name]) != null) {
    const list = el.attrsList
    for (let i = 0, l = list.length; i < l; i++) {
      if (list[i].name === name) {
        // 从attrsList数组中删除对应的属性
        list.splice(i, 1)
        break
      }
    }
  }
  // 如果明确指出需要从map中删除，则从map中删除
  if (removeFromMap) {
    delete el.attrsMap[name]
  }
  return val
}
// 从正则匹配对应属性的值
export function getAndRemoveAttrByRegex(el: ASTElement, name: RegExp) {
  const list = el.attrsList
  for (let i = 0, l = list.length; i < l; i++) {
    const attr = list[i]
    if (name.test(attr.name)) {
      list.splice(i, 1)
      return attr
    }
  }
}

// 给item添加start和end
function rangeSetItem(item: any, range?: { start?: number; end?: number }) {
  if (range) {
    if (range.start != null) {
      item.start = range.start
    }
    if (range.end != null) {
      item.end = range.end
    }
  }
  return item
}
