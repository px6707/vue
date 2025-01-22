import he from 'he'
import { parseHTML } from './html-parser'
import { parseText } from './text-parser'
import { parseFilters } from './filter-parser'
import { genAssignmentCode } from '../directives/model'
import { extend, cached, no, camelize, hyphenate } from 'shared/util'
import { isIE, isEdge, isServerRendering } from 'core/util/env'

import {
  addProp,
  addAttr,
  baseWarn,
  addHandler,
  addDirective,
  getBindingAttr,
  getAndRemoveAttr,
  getRawBindingAttr,
  pluckModuleFunction,
  getAndRemoveAttrByRegex
} from '../helpers'

import {
  ASTAttr,
  ASTElement,
  ASTIfCondition,
  ASTNode,
  ASTText,
  CompilerOptions
} from 'types/compiler'

export const onRE = /^@|^v-on:/
export const dirRE = process.env.VBIND_PROP_SHORTHAND
  ? /^v-|^@|^:|^\.|^#/
  : /^v-|^@|^:|^#/
// 匹配表达式中的in或者of
export const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/
// 匹配迭代器 例如: "item, index" 中的 "index"
export const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
// 去除括号
const stripParensRE = /^\(|\)$/g
// 动态参数，即在[]中的参数 
const dynamicArgRE = /^\[.*\]$/

const argRE = /:(.*)$/
export const bindRE = /^:|^\.|^v-bind:/
const propBindRE = /^\./
const modifierRE = /\.[^.\]]+(?=[^\]]*$)/g
// 正则匹配v-slot 或者 #
export const slotRE = /^v-slot(:|$)|^#/

const lineBreakRE = /[\r\n]/
const whitespaceRE = /[ \f\t\r\n]+/g
// 检测属性名中的非法字符 匹配哦 空白符、单引号、双引号、尖括号 斜杠 等号
const invalidAttributeRE = /[\s"'<>\/=]/
// he.decode 用于解码html中的特殊字符， he.decode('&lt;div&gt;') // 输出: '<div>'
const decodeHTMLCached = cached(he.decode)

export const emptySlotScopeToken = `_empty_`

// configurable state
export let warn: any
let delimiters
let transforms
let preTransforms
let postTransforms
let platformIsPreTag
let platformMustUseProp
let platformGetTagNamespace
let maybeComponent

// 创建AST元素
/**
 * 
 * @description 创建一个 AST 元素
 * @param tag 标签名
 * @param attrs 属性列表
 * @param parent 父节点
 * @returns AST元素
 */
export function createASTElement(
  tag: string,
  attrs: Array<ASTAttr>,
  parent: ASTElement | void
): ASTElement {
  return {
    type: 1,
    tag,
    attrsList: attrs,
    attrsMap: makeAttrsMap(attrs),
    rawAttrsMap: {},
    parent,
    children: []
  }
}

/**
 * Convert HTML string to AST.
 */
export function parse(template: string, options: CompilerOptions): ASTElement {
  warn = options.warn || baseWarn
  // 是不是pre标签
  platformIsPreTag = options.isPreTag || no
  // 属性是否使用prop
  platformMustUseProp = options.mustUseProp || no
  // 获取svg、math标签的命名空间
  platformGetTagNamespace = options.getTagNamespace || no
  // 是否是html或者svg标签
  const isReservedTag = options.isReservedTag || no
  // 判断是否是组件 如果具有el.component 或者 :is 或者 v-bind:is 说明是组件
  maybeComponent = (el: ASTElement) =>
    !!(
      el.component ||
      el.attrsMap[':is'] ||
      el.attrsMap['v-bind:is'] ||
      // 如果el中有is属性，判断是否是保留标签
      // 如果不是保留标签，判断可能是自定义组件
      !(el.attrsMap.is ? isReservedTag(el.attrsMap.is) : isReservedTag(el.tag))
    )
  // 找出模块中的所有transformNode函数函数
  transforms = pluckModuleFunction(options.modules, 'transformNode')
  preTransforms = pluckModuleFunction(options.modules, 'preTransformNode')
  postTransforms = pluckModuleFunction(options.modules, 'postTransformNode')
  // 默认双大括号{{}} 或自定义的分隔符
  delimiters = options.delimiters

  const stack: any[] = []
  const preserveWhitespace = options.preserveWhitespace !== false
  const whitespaceOption = options.whitespace
  let root
  let currentParent
  // 是否在v-pre的指令中 vue中的v-pre会导致节点内部不再编译，直接显示原始html
  let inVPre = false
  // 是否在pre标签中 html 的pre标签能够显示原始的JSON对象结构
  let inPre = false
  let warned = false

  // 警告一次函数
  function warnOnce(msg, range) {
    if (!warned) {
      warned = true
      warn(msg, range)
    }
  }
  // 结束这个element标签
  function closeElement(element) {
    // 移除element的子节点中尾部的空白符
    trimEndingWhitespace(element)
    // 如果节点不再pre节点中，且还未处理
    if (!inVPre && !element.processed) {
      // 处理这个节点
      element = processElement(element, options)
    }
    // tree management
    // 如果stack中没有元素 且element不是上一个root， 说明当前节点是另一个根节点
    if (!stack.length && element !== root) {
      // allow root elements with v-if, v-else-if and v-else
      // 如果上一个root节点有if 并且当前节点有elseif 或者 else
      if (root.if && (element.elseif || element.else)) {
        if (__DEV__) {
          checkRootConstraints(element)
        }
        // 给当前root节点添加if条件
        addIfCondition(root, {
          exp: element.elseif,
          block: element
        })
      } else if (__DEV__) {
        // 说明有两个根节点
        warnOnce(
          `Component template should contain exactly one root element. ` +
          `If you are using v-if on multiple elements, ` +
          `use v-else-if to chain them instead.`,
          { start: element.start }
        )
      }
    }
    // 如果有父节点且不是禁止的
    if (currentParent && !element.forbidden) {
      // 如果节点具有elseif 或者 else
      if (element.elseif || element.else) {
        // 添加对应的if条件
        processIfConditions(element, currentParent)
      } else {
        // 如果节点是插槽
        if (element.slotScope) {
          // scoped slot
          // keep it in the children list so that v-else(-if) conditions can
          // find it as the prev node.
          // 找到插槽名称
          const name = element.slotTarget || '"default"'
            // 在父节点的scopedSlots中放入当前节点，因为当前节点是插槽
            ; (currentParent.scopedSlots || (currentParent.scopedSlots = {}))[
              name
            ] = element
        }
        // 父子节点建立关系
        // 当前父节点添加子节点
        currentParent.children.push(element)
        // 当前子节点添加父节点
        element.parent = currentParent
      }
    }

    // final children cleanup
    // filter out scoped slots
    // 获取element的不是插槽的子节点， 因为 processElement 已经处理过插槽了，处理过的插槽都放入到了scopedSlots中，因此子节点中的插槽可已删除了
    element.children = element.children.filter(c => !c.slotScope)
    // remove trailing whitespace node again
    // 再次删除文本节点的尾部空白，因为插槽的删除可能导致新增尾部空白
    trimEndingWhitespace(element)

    // check pre state
    // 如果节点上有v-pre标记 因为是closeElement， 所以结束pre处理
    if (element.pre) {
      inVPre = false
    }
    // 当前节点不是pre标签
    if (platformIsPreTag(element.tag)) {
      inPre = false
    }
    // apply post-transforms
    // 使用module中的后置转换处理
    for (let i = 0; i < postTransforms.length; i++) {
      postTransforms[i](element, options)
    }
  }

  function trimEndingWhitespace(el) {
    // remove trailing whitespace node
    if (!inPre) {
      let lastNode
      while (
        // 最后一个node存在
        (lastNode = el.children[el.children.length - 1]) &&
        // 最后一个node是文本
        lastNode.type === 3 &&
        // 最后一个node是空格
        lastNode.text === ' '
      ) {
        // 移除最后这个空白符
        el.children.pop()
      }
    }
  }
  // 检查根节点上的属性
  function checkRootConstraints(el) {
    // 如果节点是插槽或者tempalte
    if (el.tag === 'slot' || el.tag === 'template') {
      // 警告 不能使用插槽和tempalte作为根节点
      warnOnce(
        `Cannot use <${el.tag}> as component root element because it may ` +
        'contain multiple nodes.',
        { start: el.start }
      )
    }
    // 如果节点有v-for
    if (el.attrsMap.hasOwnProperty('v-for')) {
      warnOnce(
        'Cannot use v-for on stateful component root element because ' +
        'it renders multiple elements.',
        el.rawAttrsMap['v-for']
      )
    }
  }

  parseHTML(template, {
    warn,
    expectHTML: options.expectHTML,
    isUnaryTag: options.isUnaryTag,
    canBeLeftOpenTag: options.canBeLeftOpenTag,
    shouldDecodeNewlines: options.shouldDecodeNewlines,
    shouldDecodeNewlinesForHref: options.shouldDecodeNewlinesForHref,
    shouldKeepComment: options.comments,
    outputSourceRange: options.outputSourceRange,
    // 创建开始标签
    start(tag, attrs, unary, start, end) {
      // check namespace.
      // inherit parent ns if there is one
      // 获取当前父节点的命名空间 svg 或则math
      const ns =
        (currentParent && currentParent.ns) || platformGetTagNamespace(tag)

      // handle IE svg bug
      /* istanbul ignore if */
      // 处理IE浏览器svg问题
      if (isIE && ns === 'svg') {
        attrs = guardIESVGBug(attrs)
      }
      // 创建开始标签的AST
      let element: ASTElement = createASTElement(tag, attrs, currentParent)
      // 给当前元素添加命名空间 之后它的子节点也能获取它的命名空间
      if (ns) {
        element.ns = ns
      }

      if (__DEV__) {
        // 开发模式下添加更多信息
        if (options.outputSourceRange) {
          element.start = start
          element.end = end
          element.rawAttrsMap = element.attrsList.reduce((cumulated, attr) => {
            cumulated[attr.name] = attr
            return cumulated
          }, {})
        }
        attrs.forEach(attr => {
          // 如果属性名有非法字符，警告
          if (invalidAttributeRE.test(attr.name)) {
            warn(
              `Invalid dynamic argument expression: attribute names cannot contain ` +
              `spaces, quotes, <, >, / or =.`,
              options.outputSourceRange
                ? {
                  start: attr.start! + attr.name.indexOf(`[`),
                  end: attr.start! + attr.name.length
                }
                : undefined
            )
          }
        })
      }
      // 如果是禁止标签并且不是服务端渲染
      if (isForbiddenTag(element) && !isServerRendering()) {
        // 添加禁止标记
        element.forbidden = true
        __DEV__ &&
          warn(
            'Templates should only be responsible for mapping the state to the ' +
            'UI. Avoid placing tags with side-effects in your templates, such as ' +
            `<${tag}>` +
            ', as they will not be parsed.',
            { start: element.start }
          )
      }
      // module的前置转换
      // apply pre-transforms
      for (let i = 0; i < preTransforms.length; i++) {
        element = preTransforms[i](element, options) || element
      }

      // 如果不在v-pre模式下
      if (!inVPre) {
        // 处理节点 在pre模式下，则不需要处理节点，按照原样显示
        processPre(element)
        // 如果有v-pre， 标记为在v-pre模式下
        if (element.pre) {
          inVPre = true
        }
      }
      // 当前节点是不是pre标签
      if (platformIsPreTag(element.tag)) {
        inPre = true
      }
      // 如果在pre模式下
      if (inVPre) {
        processRawAttrs(element)
      } else if (!element.processed) {
        // 未被处理过的节点进行处理
        // structural directives
        processFor(element)
        processIf(element)
        processOnce(element)
      }
      // 如果没有根节点，说明当前节点是根节点
      if (!root) {
        root = element
        if (__DEV__) {
          // 开发模式下，看根节点是否符合根节点的要求
          checkRootConstraints(root)
        }
      }
      // 不是自闭合节点
      if (!unary) {
        // 那么他可能有子节点，当前节点就作为当前的父节点
        currentParent = element
        // 把当前节点添加到栈中
        stack.push(element)
      } else {
        // 如果是自闭合节点，直接关闭这个节点
        closeElement(element)
      }
    },

    end(tag, start, end) {
      // stack中的最后一个元素，就是结束标签
      const element = stack[stack.length - 1]
      // pop stack
      // 栈中去掉最后一个元素
      stack.length -= 1
      // 获取元素的父节点
      currentParent = stack[stack.length - 1]
      if (__DEV__ && options.outputSourceRange) {
        element.end = end
      }
      closeElement(element)
    },
    // 文本节点处理函数
    chars(text: string, start?: number, end?: number) {
      if (!currentParent) {
        // 如果不存在父节点
        if (__DEV__) {
          // 如果纯文本和当前模版相同，警告
          if (text === template) {
            warnOnce(
              'Component template requires a root element, rather than just text.',
              { start }
            )
          } else if ((text = text.trim())) {
            // 如果纯文本没有父节点，警告
            warnOnce(`text "${text}" outside root element will be ignored.`, {
              start
            })
          }
        }
        return
      }
      // IE textarea placeholder bug
      /* istanbul ignore if */
      // 在IE中，标签是textarea并且父节点的placeholder属性和文本相同，就不要渲染
      if (
        isIE &&
        currentParent.tag === 'textarea' &&
        currentParent.attrsMap.placeholder === text
      ) {
        return
      }
      const children = currentParent.children
      // 在pre标签内部，或者文本不为空
      if (inPre || text.trim()) {
        // 如果父标签是script或者style则不对内容解码
        text = isTextTag(currentParent)
          ? text
          : (decodeHTMLCached(text) as string)
      } else if (!children.length) {
        // 如果父节点没有子节点
        // remove the whitespace-only node right after an opening tag
        text = ''
      } else if (whitespaceOption) {
        // 空白压缩模式
        if (whitespaceOption === 'condense') {
          // in condense mode, remove the whitespace node if it contains
          // line break, otherwise condense to a single space
          // 换行转换成''
          text = lineBreakRE.test(text) ? '' : ' '
        } else {
          text = ' '
        }
      } else {
        // 是否保留空白
        text = preserveWhitespace ? ' ' : ''
      }
      if (text) {
        // 如果文本存在
        // 如果不在pre节点中间，且压缩空白符
        if (!inPre && whitespaceOption === 'condense') {
          // condense consecutive whitespaces into single space
          // 将回车换成空格
          text = text.replace(whitespaceRE, ' ')
        }
        let res
        let child: ASTNode | undefined
        // 如果不在v-pre模式下 并且文本不是空格 并且 有插值表达式 {{}}
        if (!inVPre && text !== ' ' && (res = parseText(text, delimiters))) {
          // 创建文本节点
          child = {
            type: 2, // 表达式文本
            expression: res.expression,
            tokens: res.tokens,
            text
          }
        } else if (
          text !== ' ' ||
          !children.length ||
          children[children.length - 1].text !== ' '
        ) {
          // 纯文本
          child = {
            type: 3, // 纯文本
            text
          }
        }
        if (child) {
          if (__DEV__ && options.outputSourceRange) {
            child.start = start
            child.end = end
          }
          // 文本节点添加到父节点的子节点中
          children.push(child)
        }
      }
    },
    // 处理注释
    comment(text: string, start, end) {
      // adding anything as a sibling to the root node is forbidden
      // comments should still be allowed, but ignored
      // 是否有父节点
      if (currentParent) {
        const child: ASTText = {
          type: 3,
          text,
          isComment: true
        }
        if (__DEV__ && options.outputSourceRange) {
          child.start = start
          child.end = end
        }
        // 添加到父节点的子节点中
        currentParent.children.push(child)
      }
    }
  })
  return root
}
// 获取v-pre的值添加 pre标记
function processPre(el) {
  if (getAndRemoveAttr(el, 'v-pre') != null) {
    el.pre = true
  }
}
// v-pre的指令，不处理绑定内容，只添加属性
function processRawAttrs(el) {
  const list = el.attrsList
  const len = list.length
  if (len) {
    const attrs: Array<ASTAttr> = (el.attrs = new Array(len))
    for (let i = 0; i < len; i++) {
      attrs[i] = {
        name: list[i].name,
        value: JSON.stringify(list[i].value)
      }
      if (list[i].start != null) {
        attrs[i].start = list[i].start
        attrs[i].end = list[i].end
      }
    }
  } else if (!el.pre) {
    // 该节点没有属性，则是普通节点
    // non root node in pre blocks with no attributes
    el.plain = true
  }
}

export function processElement(element: ASTElement, options: CompilerOptions) {
  processKey(element)

  // determine whether this is a plain element after
  // removing structural attributes
  // 如果element上不存在key并且不存在插槽并且不存在属性列表，说明是普通元素。没有额外属性、key或者插槽时可以简单处理，并作性能优化
  element.plain =
    !element.key && !element.scopedSlots && !element.attrsList.length
  // 处理ref，给element添加ref和refInFor
  processRef(element)
  // 处理插槽
  processSlotContent(element)
  // 处理本身是插槽的情况
  processSlotOutlet(element)
  processComponent(element)
  // 转换函数的数组，分别对元素进行处理
  for (let i = 0; i < transforms.length; i++) {
    element = transforms[i](element, options) || element
  }
  processAttrs(element)
  return element
}

function processKey(el) {
  // 在el上面获取动态绑定的key
  const exp = getBindingAttr(el, 'key')
  if (exp) {
    if (__DEV__) {
      // 如果动态绑定的key是在template标签上面，则警告，template不支持key
      if (el.tag === 'template') {
        warn(
          `<template> cannot be keyed. Place the key on real elements instead.`,
          getRawBindingAttr(el, 'key')
        )
      }
      // 如果el上面有for指令
      if (el.for) {
        // 获取for表达式的索引 index
        const iterator = el.iterator2 || el.iterator1
        const parent = el.parent
        if (
          iterator &&
          iterator === exp &&
          parent &&
          parent.tag === 'transition-group'
        ) {
          // 如果有for，且for表达式的索引index等于动态绑定的key，且父节点是transition-group，警告 不能使用循环的inde行索引在动画上
          warn(
            `Do not use v-for index as key on <transition-group> children, ` +
            `this is the same as not using keys.`,
            getRawBindingAttr(el, 'key'),
            true /* tip */
          )
        }
      }
    }
    // 给key赋值
    el.key = exp
  }
}

function processRef(el) {
  // 获取绑定的ref
  const ref = getBindingAttr(el, 'ref')
  if (ref) {
    el.ref = ref
    // 如果ref在for循环中，则refInFor为true
    el.refInFor = checkInFor(el)
  }
}
// 处理for表达是，获取for相关的对象
export function processFor(el: ASTElement) {
  let exp
  // 获取for表达式
  if ((exp = getAndRemoveAttr(el, 'v-for'))) {
    // 解析for表达式 获取for对象
    const res = parseFor(exp)
    if (res) {
      extend(el, res)
    } else if (__DEV__) {
      warn(`Invalid v-for expression: ${exp}`, el.rawAttrsMap['v-for'])
    }
  }
}

type ForParseResult = {
  for: string
  alias: string
  iterator1?: string
  iterator2?: string
}

export function parseFor(exp: string): ForParseResult | undefined {
  // 匹配表达式中的in或of
  // "(item, index) in items".match(/([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/)
  // [
  //   '(item, index) in items',
  //   '(item, index)',
  //   'items',
  //   index: 0,
  //   input: '(item, index) in items',
  //   groups: undefined
  // ]
  const inMatch = exp.match(forAliasRE)
  if (!inMatch) return
  const res: any = {}
  res.for = inMatch[2].trim() //items
  const alias = inMatch[1].trim().replace(stripParensRE, '')// item, index
  const iteratorMatch = alias.match(forIteratorRE)
  if (iteratorMatch) {
    // "(value, key, index) in object" 的情况下 iterator1 = key iterator2 = index
    res.alias = alias.replace(forIteratorRE, '').trim() // item
    res.iterator1 = iteratorMatch[1].trim() // index
    if (iteratorMatch[2]) {
      res.iterator2 = iteratorMatch[2].trim()
    }
  } else {
    // 如果没有迭代器，别名就是表达式
    res.alias = alias // item
  }
  // 返回的结果为
  // "(value, key, index) in object"
  // {
  //   for: "object",
  //   alias: "value",
  //   iterator1: "key",
  //   iterator2: "index"
  // }
  return res
}
// 处理if指令
function processIf(el) {
  // 获取if的表达式
  const exp = getAndRemoveAttr(el, 'v-if')
  if (exp) {
    // 如果表达式存在就把 条件添加到el上
    el.if = exp
    addIfCondition(el, {
      exp: exp,
      block: el
    })
  } else {
    // if 表达是存在就看他有没有v-else条件
    if (getAndRemoveAttr(el, 'v-else') != null) {
      el.else = true
    }
    // 查看有没有 v-else-if 条件
    const elseif = getAndRemoveAttr(el, 'v-else-if')
    if (elseif) {
      el.elseif = elseif
    }
  }
}

function processIfConditions(el, parent) {
  const prev = findPrevElement(parent.children)
  if (prev && prev.if) {
    addIfCondition(prev, {
      exp: el.elseif,
      block: el
    })
  } else if (__DEV__) {
    warn(
      `v-${el.elseif ? 'else-if="' + el.elseif + '"' : 'else'} ` +
      `used on element <${el.tag}> without corresponding v-if.`,
      el.rawAttrsMap[el.elseif ? 'v-else-if' : 'v-else']
    )
  }
}

function findPrevElement(children: Array<any>): ASTElement | void {
  let i = children.length
  while (i--) {
    if (children[i].type === 1) {
      return children[i]
    } else {
      if (__DEV__ && children[i].text !== ' ') {
        warn(
          `text "${children[i].text.trim()}" between v-if and v-else(-if) ` +
          `will be ignored.`,
          children[i]
        )
      }
      children.pop()
    }
  }
}

// 给el添加ifCondition
export function addIfCondition(el: ASTElement, condition: ASTIfCondition) {
  if (!el.ifConditions) {
    el.ifConditions = []
  }
  el.ifConditions.push(condition)
}

function processOnce(el) {
  // 处理v-once指令，
  const once = getAndRemoveAttr(el, 'v-once')
  if (once != null) {
    el.once = true
  }
}

// handle content being passed to a component as slot,
// e.g. <template slot="xxx">, <div slot-scope="xxx">
function processSlotContent(el) {
  let slotScope
  // 如果是template
  if (el.tag === 'template') {
    // 在template上获取scope属性 <template scope="header">
    slotScope = getAndRemoveAttr(el, 'scope')
    // 旧语法的slot做警告
    /* istanbul ignore if */
    if (__DEV__ && slotScope) {
      warn(
        `the "scope" attribute for scoped slots have been deprecated and ` +
        `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
        `can also be used on plain elements in addition to <template> to ` +
        `denote scoped slots.`,
        el.rawAttrsMap['scope'],
        true
      )
    }
    el.slotScope = slotScope || getAndRemoveAttr(el, 'slot-scope')
  } else if ((slotScope = getAndRemoveAttr(el, 'slot-scope'))) {
    // 如果节点上有slot-scope的旧语法，且在for循环中，做警告，for和插槽，组合上摸棱两可，for优先级更高
    /* istanbul ignore if */
    if (__DEV__ && el.attrsMap['v-for']) {
      warn(
        `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
        `(v-for takes higher priority). Use a wrapper <template> for the ` +
        `scoped slot to make it clearer.`,
        el.rawAttrsMap['slot-scope'],
        true
      )
    }
    el.slotScope = slotScope
  }
  // 获取节点上的slot属性 <template slot="header">
  // slot="xxx"
  const slotTarget = getBindingAttr(el, 'slot')
  if (slotTarget) {
    // 如果插槽名为空，则是default默认插槽
    el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget
    // 如果slot是动态绑定的
    el.slotTargetDynamic = !!(
      el.attrsMap[':slot'] || el.attrsMap['v-bind:slot']
    )
    // 如果标签不是template，且不存在插槽。这说明el是一个shadow dom，他上面有slot属性，这个属性需要添加到attr上面，在生成真实dom时保留这个slot属性
    // preserve slot as an attribute for native shadow DOM compat
    // only for non-scoped slots.
    if (el.tag !== 'template' && !el.slotScope) {
      // el上添加slot属性
      addAttr(el, 'slot', slotTarget, getRawBindingAttr(el, 'slot'))
    }
  }

  // 如果支持新的slot 或则#xxx语法
  // 2.6 v-slot syntax
  if (process.env.NEW_SLOT_SYNTAX) {
    if (el.tag === 'template') {
      // v-slot on <template>
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        if (__DEV__) {
          // 如果v-slot和slot-scope或者slot同时出现，做警告
          if (el.slotTarget || el.slotScope) {
            warn(`Unexpected mixed usage of different slot syntaxes.`, el)
          }
          // 如果el有父节点，且父节点不是组件，做警告
          if (el.parent && !maybeComponent(el.parent)) {
            warn(
              `<template v-slot> can only appear at the root level inside ` +
              `the receiving component`,
              el
            )
          }
        }
        // 获取插槽名称和是否是动态插槽
        const { name, dynamic } = getSlotName(slotBinding)
        el.slotTarget = name
        el.slotTargetDynamic = dynamic
        el.slotScope = slotBinding.value || emptySlotScopeToken // force it into a scoped slot for perf
      }
    } else {
      // 如果v-slot用在组件上 
      // <my-component v-slot:header="headerProps">
      //   <div>普通内容</div>               <!-- 会被移到template中 -->
      //   <template v-slot:footer>          <!-- 有slotScope，不会被移动 -->
      //     <div>页脚内容</div>
      //   </template>
      // </my-component>
      // 这种情况下，会创建一个tempalte节点，放入到my-component的插槽对象中
      // 非插槽子节点会被移到template中并且设置slotTarget = header
      // v-slot on component, denotes default slot
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        if (__DEV__) {
          // 如果不是组件，做警告
          if (!maybeComponent(el)) {
            warn(
              `v-slot can only be used on components or <template>.`,
              slotBinding
            )
          }
          // 混用旧插槽语法，警告
          if (el.slotScope || el.slotTarget) {
            warn(`Unexpected mixed usage of different slot syntaxes.`, el)
          }
          // 有具名插槽，默认插槽也应该用template语法
          if (el.scopedSlots) {
            warn(
              `To avoid scope ambiguity, the default slot should also use ` +
              `<template> syntax when there are other named slots.`,
              slotBinding
            )
          }
        }
        // 把当前组件的非插槽子节点放入一个tempalte中
        // add the component's children to its default slot
        // 获取所有插槽
        const slots = el.scopedSlots || (el.scopedSlots = {})
        // 获取component上绑定的插槽名称和是否是动态绑定
        const { name, dynamic } = getSlotName(slotBinding)
        // 创建一个tempalte节点，并放入到当前节点的插槽中
        const slotContainer = (slots[name] = createASTElement(
          'template',
          [],
          el
        ))
        // 设置这个插槽的目标和动态参数
        slotContainer.slotTarget = name
        slotContainer.slotTargetDynamic = dynamic
        slotContainer.children = el.children.filter((c: any) => {
          // 没有slotscope的子节点作为当前绑定的插槽的子节点
          // 有slotscope说明是别的具名插槽的内容
          if (!c.slotScope) {
            c.parent = slotContainer
            return true
          }
        })
        slotContainer.slotScope = slotBinding.value || emptySlotScopeToken
        // remove children as they are returned from scopedSlots now
        el.children = []
        // mark el non-plain so data gets generated
        el.plain = false
      }
    }
  }
}

function getSlotName(binding) {
  // 获取插槽名称v-slot:name #name获取这个name
  let name = binding.name.replace(slotRE, '')
  if (!name) {
    // 如果不是以#开头 说明写了 v-slot 就是默认插槽
    if (binding.name[0] !== '#') {
      name = 'default'
    } else if (__DEV__) {
      warn(`v-slot shorthand syntax requires a slot name.`, binding)
    }
  }
  // 匹配动态参数
  return dynamicArgRE.test(name)
    ? // dynamic [name]
    { name: name.slice(1, -1), dynamic: true }
    : // static name
    { name: `"${name}"`, dynamic: false }
}
// 处理插槽
// handle <slot/> outlets
function processSlotOutlet(el) {
  // 如果本身是一个slot
  if (el.tag === 'slot') {
    // 给这个节点绑定插槽名称
    el.slotName = getBindingAttr(el, 'name')
    if (__DEV__ && el.key) {
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
        `and can possibly expand into multiple elements. ` +
        `Use the key on a wrapping element instead.`,
        getRawBindingAttr(el, 'key')
      )
    }
  }
}

function processComponent(el) {
  let binding
  // 如过el上有is，获取这个值放入component
  if ((binding = getBindingAttr(el, 'is'))) {
    el.component = binding
  }
  // 如果有inline-template属性，设置为true
  // 这个属性是vue的一个特殊用法，可以使用组件内部的内容作为组件的模版
  // <!-- 普通组件使用 -->
  // <my-component>
  //   <!-- 这些内容会作为默认插槽内容 -->
  //   <p>Some content</p>
  // </my-component>

  // <!-- 使用 inline-template -->
  // <my-component inline-template>
  //   <!-- 这些内容会作为组件的模板 -->
  //   <div>
  //     <p>{{ componentData }}</p>
  //     <button @click="componentMethod">Click</button>
  //   </div>
  // </my-component>
  // inline-template 使用时只能获取组件内部的变量，无法获取父组件的变量
  // 但作用域不清晰，可维护性差
  if (getAndRemoveAttr(el, 'inline-template') != null) {
    el.inlineTemplate = true
  }
}

function processAttrs(el) {
  const list = el.attrsList
  let i, l, name, rawName, value, modifiers, syncGen, isDynamic
  for (i = 0, l = list.length; i < l; i++) {
    name = rawName = list[i].name
    value = list[i].value
    if (dirRE.test(name)) {
      // mark element as dynamic
      el.hasBindings = true
      // modifiers
      modifiers = parseModifiers(name.replace(dirRE, ''))
      // support .foo shorthand syntax for the .prop modifier
      if (process.env.VBIND_PROP_SHORTHAND && propBindRE.test(name)) {
        ; (modifiers || (modifiers = {})).prop = true
        name = `.` + name.slice(1).replace(modifierRE, '')
      } else if (modifiers) {
        name = name.replace(modifierRE, '')
      }
      if (bindRE.test(name)) {
        // v-bind
        name = name.replace(bindRE, '')
        value = parseFilters(value)
        isDynamic = dynamicArgRE.test(name)
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        if (__DEV__ && value.trim().length === 0) {
          warn(
            `The value for a v-bind expression cannot be empty. Found in "v-bind:${name}"`
          )
        }
        if (modifiers) {
          if (modifiers.prop && !isDynamic) {
            name = camelize(name)
            if (name === 'innerHtml') name = 'innerHTML'
          }
          if (modifiers.camel && !isDynamic) {
            name = camelize(name)
          }
          if (modifiers.sync) {
            syncGen = genAssignmentCode(value, `$event`)
            if (!isDynamic) {
              addHandler(
                el,
                `update:${camelize(name)}`,
                syncGen,
                null,
                false,
                warn,
                list[i]
              )
              if (hyphenate(name) !== camelize(name)) {
                addHandler(
                  el,
                  `update:${hyphenate(name)}`,
                  syncGen,
                  null,
                  false,
                  warn,
                  list[i]
                )
              }
            } else {
              // handler w/ dynamic event name
              addHandler(
                el,
                `"update:"+(${name})`,
                syncGen,
                null,
                false,
                warn,
                list[i],
                true // dynamic
              )
            }
          }
        }
        if (
          (modifiers && modifiers.prop) ||
          (!el.component && platformMustUseProp(el.tag, el.attrsMap.type, name))
        ) {
          addProp(el, name, value, list[i], isDynamic)
        } else {
          addAttr(el, name, value, list[i], isDynamic)
        }
      } else if (onRE.test(name)) {
        // v-on
        name = name.replace(onRE, '')
        isDynamic = dynamicArgRE.test(name)
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        addHandler(el, name, value, modifiers, false, warn, list[i], isDynamic)
      } else {
        // normal directives
        name = name.replace(dirRE, '')
        // parse arg
        const argMatch = name.match(argRE)
        let arg = argMatch && argMatch[1]
        isDynamic = false
        if (arg) {
          name = name.slice(0, -(arg.length + 1))
          if (dynamicArgRE.test(arg)) {
            arg = arg.slice(1, -1)
            isDynamic = true
          }
        }
        addDirective(
          el,
          name,
          rawName,
          value,
          arg,
          isDynamic,
          modifiers,
          list[i]
        )
        if (__DEV__ && name === 'model') {
          checkForAliasModel(el, value)
        }
      }
    } else {
      // literal attribute
      if (__DEV__) {
        const res = parseText(value, delimiters)
        if (res) {
          warn(
            `${name}="${value}": ` +
            'Interpolation inside attributes has been removed. ' +
            'Use v-bind or the colon shorthand instead. For example, ' +
            'instead of <div id="{{ val }}">, use <div :id="val">.',
            list[i]
          )
        }
      }
      addAttr(el, name, JSON.stringify(value), list[i])
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation
      if (
        !el.component &&
        name === 'muted' &&
        platformMustUseProp(el.tag, el.attrsMap.type, name)
      ) {
        addProp(el, name, 'true', list[i])
      }
    }
  }
}

function checkInFor(el: ASTElement): boolean {
  let parent: ASTElement | void = el
  while (parent) {
    if (parent.for !== undefined) {
      return true
    }
    parent = parent.parent
  }
  return false
}

function parseModifiers(name: string): Object | void {
  const match = name.match(modifierRE)
  if (match) {
    const ret = {}
    match.forEach(m => {
      ret[m.slice(1)] = true
    })
    return ret
  }
}

function makeAttrsMap(attrs: Array<Record<string, any>>): Record<string, any> {
  const map = {}
  for (let i = 0, l = attrs.length; i < l; i++) {
    if (__DEV__ && map[attrs[i].name] && !isIE && !isEdge) {
      warn('duplicate attribute: ' + attrs[i].name, attrs[i])
    }
    map[attrs[i].name] = attrs[i].value
  }
  return map
}

// for script (e.g. type="x/template") or style, do not decode content
// 标签是script或者style
function isTextTag(el): boolean {
  return el.tag === 'script' || el.tag === 'style'
}
// 查看是不是style或者script标签 这种标签下可能出现插入的js代码，防止脚本动态注入Xss
// <script type="text/template"> <script type="application/json"> 除外
// 因为这些type属性指定了非可执行内容，不会造成脚本注入
function isForbiddenTag(el): boolean {
  return (
    el.tag === 'style' ||
    (el.tag === 'script' &&
      (!el.attrsMap.type || el.attrsMap.type === 'text/javascript'))
  )
}
// 匹配 xmlns:NS1, xmlns:NS2 等
const ieNSBug = /^xmlns:NS\d+/
// 匹配 NS1:, NS2: 等
const ieNSPrefix = /^NS\d+:/

/* istanbul ignore next */
// 处理svg上的xmlns 属性
// 这里主要是处理IE 浏览器上，svg节点上会出现 xmlns:NS1属性 和NS1这种前缀的问题
// <!-- IE 中可能的输出 -->
// <svg xmlns:NS1="" NS1:xmlns:xlink="http://www.w3.org/1999/xlink">
//     <NS1:image NS1:href="image.jpg" />
// </svg>

// <!-- 期望的输出 -->
// <svg xmlns:xlink="http://www.w3.org/1999/xlink">
//     <image href="image.jpg" />
// </svg>
function guardIESVGBug(attrs) {
  const res: any[] = []
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    // 如果属性不匹配xmlns:NS 
    if (!ieNSBug.test(attr.name)) {
      // 在所有属性上删除 NS1 这种前缀
      attr.name = attr.name.replace(ieNSPrefix, '')
      // 然后把非 xmlns:NS 的属性添加进去
      res.push(attr)
    }
  }
  return res
}

function checkForAliasModel(el, value) {
  let _el = el
  while (_el) {
    if (_el.for && _el.alias === value) {
      warn(
        `<${el.tag} v-model="${value}">: ` +
        `You are binding v-model directly to a v-for iteration alias. ` +
        `This will not be able to modify the v-for source array because ` +
        `writing to the alias is like modifying a function local variable. ` +
        `Consider using an array of objects and use v-model on an object property instead.`,
        el.rawAttrsMap['v-model']
      )
    }
    _el = _el.parent
  }
}
