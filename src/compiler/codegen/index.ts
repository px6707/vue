import { genHandlers } from './events'
import baseDirectives from '../directives/index'
import { camelize, no, extend, capitalize } from 'shared/util'
import { baseWarn, pluckModuleFunction } from '../helpers'
import { emptySlotScopeToken } from '../parser/index'
import {
  ASTAttr,
  ASTDirective,
  ASTElement,
  ASTExpression,
  ASTIfConditions,
  ASTNode,
  ASTText,
  CompilerOptions
} from 'types/compiler'
import { BindingMetadata, BindingTypes } from 'sfc/types'

type TransformFunction = (el: ASTElement, code: string) => string
type DataGenFunction = (el: ASTElement) => string
type DirectiveFunction = (
  el: ASTElement,
  dir: ASTDirective,
  warn: Function
) => boolean

export class CodegenState {
  options: CompilerOptions
  warn: Function
  transforms: Array<TransformFunction>
  dataGenFns: Array<DataGenFunction>
  directives: { [key: string]: DirectiveFunction }
  maybeComponent: (el: ASTElement) => boolean
  onceId: number
  staticRenderFns: Array<string>
  pre: boolean

  constructor(options: CompilerOptions) {
    this.options = options
    this.warn = options.warn || baseWarn
    this.transforms = pluckModuleFunction(options.modules, 'transformCode')
    this.dataGenFns = pluckModuleFunction(options.modules, 'genData')
    // 获取指令处理方法
    this.directives = extend(extend({}, baseDirectives), options.directives)
    // 是否是保留标签
    const isReservedTag = options.isReservedTag || no
    // 是否是组件
    this.maybeComponent = (el: ASTElement) =>
      !!el.component || !isReservedTag(el.tag)
    this.onceId = 0
    // 静态渲染函数
    this.staticRenderFns = []
    this.pre = false
  }
}
// 会发现 生成的render函数中有很多下划线函数，这些函数在 src/core/instance/render-helpers/index.js 中挂载到某些class上，例如: Vue 和  FunctionalRenderContext 上，用于后续处理
// _c: createElement - 创建元素节点
// _c('div', {/* 数据对象 */}, [/* 子节点 */])

// // 例子
// _c('div', { 
//   staticClass: "container",
//   attrs: { id: "app" }
// }, [
//   _c('span', null, ["Hello"])
// ])

// _v: createTextVNode - 创建文本节点
// _v('some text')

// // 例子
// _c('div', null, [
//   _v("Hello World")
// ])


// _s: toString - 将值转换为字符串
// _v(_s(variable))

// // 例子
// _c('div', null, [
//   _v("Count: " + _s(count))
// ])

// _e: createEmptyVNode - 创建空节点
// 用法：通常用于条件渲染
// condition ? _c('div') : _e()

// // 例子
// _c('div', null, [
//   show ? _c('span') : _e()
// ])

// _m: renderStatic - 渲染静态内容
// 用法：用于优化静态内容
// _m(0) // 0是静态树的索引

// // 例子
// {
//   staticRenderFns: [
//     function() {
//       return _c('div', { staticClass: "static" })
//     }
//   ]
// }

// _l: renderList - 渲染列表
// _l((items), function(item) { return _c('div', null, [_v(_s(item))]) })

// // 例子
// _c('div', null, _l((items), function(item) {
//   return _c('span', null, [_v(_s(item.name))])
// }))

// _b: bindObjectProps - 绑定对象属性
// _b(data, tag, props, isSync)

// // 例子
// _b(_c('div'), 'div', { id: id, class: classes }, false)

// _u: resolveScopedSlots - 解析作用域插槽
// // 用法
// _u([{ key: name, fn: function(props){} }])

// // 例子
// _u([{
//   key: "default",
//   fn: function(scope) {
//     return _c('div', null, [_v(_s(scope.text))])
//   }
// }])

// _g: bindObjectListeners - 绑定事件监听器
// // 用法
// _g(data, listeners)

// // 例子
// _g({}, {
//   click: function($event) {
//     return handleClick($event)
//   }
// })


// _d: bindDynamicKeys - 绑定动态键值
// // 用法
// _d(baseObj, [key1, value1, key2, value2])

// // 例子
// _d({ id: "app" }, ["class", dynamicClass])

// _k: checkKeyCodes - 检查按键代码
// // 用法
// _k($event.keyCode, keyName, keyCode)

// // 例子
// _k($event.keyCode, "enter", 13)
// export type CodegenResult = {
//   render: string
//   staticRenderFns: Array<string>
// }

// _n: toNumber - 转换为数字
// // 用法
// _n(value)

// // 例子
// _c('div', null, [_v(_s(_n(value) + 1))])



export function generate(
  ast: ASTElement | void,
  options: CompilerOptions
): CodegenResult {
  const state = new CodegenState(options)
  // fix #11483, Root level <script> tags should not be rendered.
  // ast的根节点是script，不需要渲染， 没有根节点创建一个div
  const code = ast
    ? ast.tag === 'script'
      ? 'null'
      : genElement(ast, state)
    : '_c("div")'
  return {
    render: `with(this){return ${code}}`,
    staticRenderFns: state.staticRenderFns
  }
}

export function genElement(el: ASTElement, state: CodegenState): string {
  // 如果有有父节点， 如果节点是pre标签或者父节点是pre标签， 那么当前节点的pre标志位为true
  if (el.parent) {
    el.pre = el.pre || el.parent.pre
  }

  // 如果节点是静态根节点， 且没有经过静态处理过， 那么调用genStatic方法生成静态渲染函数
  if (el.staticRoot && !el.staticProcessed) {
    return genStatic(el, state)
  } else if (el.once && !el.onceProcessed) {
    // 如果节点是v-once，并且once没有处理过
    return genOnce(el, state)
  } else if (el.for && !el.forProcessed) {
    // 如果节点是v-for，并且if没有处理过
    return genFor(el, state)
  } else if (el.if && !el.ifProcessed) {
    // 如果节点是v-if，并且if没有处理过
    return genIf(el, state)
  } else if (el.tag === 'template' && !el.slotTarget && !state.pre) {
    // 如果节点是template，并且没有slotTarget（不是作为插槽使用）， 且当前节点不是pre标签，只需要生成其子节点
    return genChildren(el, state) || 'void 0'
  } else if (el.tag === 'slot') {
    // 如果节点是slot
    return genSlot(el, state)
  } else {
    // component or element
    let code
    // 如果是组件生成 _c 函数
    if (el.component) {
      code = genComponent(el.component, el, state)
    } else {
      let data
      const maybeComponent = state.maybeComponent(el)
      // el不是简单节点 或者 el是pre标签并且是组件
      if (!el.plain || (el.pre && maybeComponent)) {
        data = genData(el, state)
      }

      let tag: string | undefined
      // check if this is a component in <script setup>
      const bindings = state.options.bindings
      if (maybeComponent && bindings && bindings.__isScriptSetup !== false) {
        tag = checkBindingType(bindings, el.tag)
      }
      if (!tag) tag = `'${el.tag}'`
      // 如果当前元素有内联模板， 则不需要生成子节点
      const children = el.inlineTemplate ? null : genChildren(el, state, true)
      code = `_c(${tag}${
        data ? `,${data}` : '' // data
      }${
        children ? `,${children}` : '' // children
      })`
    }
    // module transforms
    for (let i = 0; i < state.transforms.length; i++) {
      code = state.transforms[i](el, code)
    }
    return code
  }
}

function checkBindingType(bindings: BindingMetadata, key: string) {
  // 转换驼峰
  const camelName = camelize(key)
  // 首字母大写
  const PascalName = capitalize(camelName)
  const checkType = (type) => {
    if (bindings[key] === type) {
      return key
    }
    if (bindings[camelName] === type) {
      return camelName
    }
    if (bindings[PascalName] === type) {
      return PascalName
    }
  }
  const fromConst =
    checkType(BindingTypes.SETUP_CONST) || //  setup 常量
    checkType(BindingTypes.SETUP_REACTIVE_CONST)  // setup 响应式常量
  if (fromConst) {
    return fromConst
  }

  const fromMaybeRef =
    checkType(BindingTypes.SETUP_LET) || // setup let 变量
    checkType(BindingTypes.SETUP_REF) || // setup ref
    checkType(BindingTypes.SETUP_MAYBE_REF)  // setup 可能的 ref
  if (fromMaybeRef) {
    return fromMaybeRef
  }
}

// hoist static sub-trees out
function genStatic(el: ASTElement, state: CodegenState): string {
  // 标记已被静态处理
  el.staticProcessed = true
  // Some elements (templates) need to behave differently inside of a v-pre
  // node.  All pre nodes are static roots, so we can use this as a location to
  // wrap a state change and reset it upon exiting the pre node.
  const originalPreState = state.pre
  // 如果节点是pre节点
  if (el.pre) {
    state.pre = el.pre
  }
  // 添加静态渲染函数
  state.staticRenderFns.push(`with(this){return ${genElement(el, state)}}`)
  state.pre = originalPreState
  // state.staticRenderFns.length - 1 表示静态渲染函数的索引，即刚刚push进去的静态渲染函数索引
  // 第二个参数 是否在for循环中， staticInFor 是在optimize过程添加的
  return `_m(${state.staticRenderFns.length - 1}${
    el.staticInFor ? ',true' : ''
  })`
}

// v-once
function genOnce(el: ASTElement, state: CodegenState): string {
  // 标记已被处理
  el.onceProcessed = true
  // 如果节点是if节点，则生成if渲染函数
  if (el.if && !el.ifProcessed) {
    return genIf(el, state)
  } else if (el.staticInFor) {
    // 如果节点是for节点
    let key = ''
    let parent = el.parent
    // 找到祖先节点中的for节点获取上面的key
    while (parent) {
      if (parent.for) {
        key = parent.key!
        break
      }
      parent = parent.parent
    }
    // 如果v-once 在循环中，但是不提供key，警告，因为这种情况下无法缓存
    // <ul>
    //   <li v-for="item in items" :key="item.id">
    //     <span v-once>{{ item.name }}</span>
    //     <!-- 这里需要获取 item.id 作为 key -->
    //   </li>
    // </ul>
    if (!key) {
      __DEV__ &&
        state.warn(
          `v-once can only be used inside v-for that is keyed. `,
          el.rawAttrsMap['v-once']
        )
      return genElement(el, state)
    }
    return `_o(${genElement(el, state)},${state.onceId++},${key})`
  } else {
    // 因为之渲染一次，放入静态缓存中
    return genStatic(el, state)
  }
}

export function genIf(
  el: any,
  state: CodegenState,
  // 替代生成函数
  altGen?: Function,
  // 替代空值字符串
  altEmpty?: string
): string {
  // 标记已被处理
  el.ifProcessed = true // avoid recursion
  return genIfConditions(el.ifConditions.slice(), state, altGen, altEmpty)
}

function genIfConditions(
  conditions: ASTIfConditions,
  state: CodegenState,
  altGen?: Function,
  altEmpty?: string
): string {
  // 条件数据结构：
  // el.ifConditions = [
  //   {
  //     exp: 'show',           // 条件表达式
  //     block: el              // 对应的节点
  //   },
  //   // 对于 v-else-if 和 v-else
  //   {
  //     exp: 'type === "B"',   // v-else-if 的条件
  //     block: elseIfBlock
  //   },
  //   {
  //     exp: undefined,        // v-else 没有条件表达式
  //     block: elseBlock
  //   }
  // ]
  // 如果if条件为空
  if (!conditions.length) {
    // 返回空字符串，否则返回默认空值
    return altEmpty || '_e()'
  }
// 获取第一个条件
  const condition = conditions.shift()!
  if (condition.exp) {
    // 如果有条件表达式 v-if='a > 1'
    // (a>1)?${当前element的渲染函数}：下一个条件的渲染函数
    return `(${condition.exp})?${genTernaryExp(
      condition.block
    )}:${genIfConditions(conditions, state, altGen, altEmpty)}`
  } else {
    // 没有条件表达式，直接生成渲染函数
    return `${genTernaryExp(condition.block)}`
  }

  // v-if with v-once should generate code like (a)?_m(0):_m(1)
  function genTernaryExp(el) {
    // 替代生成函数存在则使用替代生成函数
    // 如果这个if节点上还有v-once属性，需要使用v-once函数处理
    // 其他情况下使用genElement来生成渲染函数
    return altGen
      ? altGen(el, state)
      : el.once
      ? genOnce(el, state)
      : genElement(el, state)
  }
}

export function genFor(
  el: any,
  state: CodegenState,
  altGen?: Function,
  altHelper?: string
): string {
  // "(value, key, index) in object"
  // {
  //   for: "object",
  //   alias: "value",
  //   iterator1: "key",
  //   iterator2: "index"
  // }
  const exp = el.for
  const alias = el.alias
  const iterator1 = el.iterator1 ? `,${el.iterator1}` : ''
  const iterator2 = el.iterator2 ? `,${el.iterator2}` : ''

  if (
    __DEV__ &&
    state.maybeComponent(el) && // 是组件
    el.tag !== 'slot' && // 不是slot
    el.tag !== 'template' && // 不是template
    !el.key // 没有key
  ) {
    // 警告，v-for 需要key
    state.warn(
      `<${el.tag} v-for="${alias} in ${exp}">: component lists rendered with ` +
        `v-for should have explicit keys. ` +
        `See https://v2.vuejs.org/v2/guide/list.html#key for more info.`,
      el.rawAttrsMap['v-for'],
      true /* tip */
    )
  }

  // 标记节点被for处理过
  el.forProcessed = true // avoid recursion
  // 使用 _l 或者 辅助函数
  // __l(
  //   (object),
  //   function (value, key, index){
  //     return genElement 生成的渲染函数
  //   })
  return (
    `${altHelper || '_l'}((${exp}),` +
    `function(${alias}${iterator1}${iterator2}){` +
    `return ${(altGen || genElement)(el, state)}` +
    '})'
  )
}

export function genData(el: ASTElement, state: CodegenState): string {
  let data = '{'

  // directives first.
  // directives may mutate the el's other properties before they are generated.
  // 返回指令
  const dirs = genDirectives(el, state)
  // data = { directives: [{}],
  if (dirs) data += dirs + ','

  // key
  if (el.key) {
    // data = { directives: [{}], key: 'id'
    data += `key:${el.key},`
  }
  // ref
  if (el.ref) {
     // data = { directives: [{}], key: 'id', ref: 'foo'
    data += `ref:${el.ref},`
  }
  if (el.refInFor) {
     // data = { directives: [{}], key: 'id', ref: 'foo', refInFor:true
    data += `refInFor:true,`
  }
  // pre
  if (el.pre) {
     // data = { directives: [{}], key: 'id', ref: 'foo', refInFor:true, pre:true
    data += `pre:true,`
  }
  // record original tag name for components using "is" attribute
  if (el.component) {
     // data = { directives: [{}], key: 'id', ref: 'foo', refInFor:true, pre:true, tag:"component"
    data += `tag:"${el.tag}",`
  }
  // module data generation functions
  // 使用module中注册的genData函数处理el
  // 例如class 会把 类和静态类 返回 "staticClass:'static',class:{ active: isActive },"
  // style 会把 style和静态style 返回 "staticStyle:{'color': 'red'},style:({ fontSize: size + 'px' }),"
   // data = { directives: [{}], key: 'id', ref: 'foo', refInFor:true, pre:true, tag:"component",  "staticClass:'static',class:{ active: isActive },", "staticStyle:{'color': 'red'},style:({ fontSize: size + 'px' }),"
  for (let i = 0; i < state.dataGenFns.length; i++) {
    data += state.dataGenFns[i](el)
  }
  // attributes
  if (el.attrs) {
    // data = { directives: [{}], key: 'id', ref: 'foo', refInFor:true, pre:true, tag:"component",  "staticClass:'static',class:{ active: isActive },", "staticStyle:{'color': 'red'},style:({ fontSize: size + 'px' }), 
    // _d({"id":"app"}, ["class",dynamicClass])
    data += `attrs:${genProps(el.attrs)},`
  }
  // DOM props
  if (el.props) {
    data += `domProps:${genProps(el.props)},`
  }
  // event handlers
  // 添加事件函数
  // data = { directives: [{}], key: 'id', ref: 'foo', refInFor:true, pre:true, tag:"component",  "staticClass:'static',class:{ active: isActive },", "staticStyle:{'color': 'red'},style:({ fontSize: size + 'px' }), 
  // _d({"id":"app"}, ["class",dynamicClass]),on:{click:function($event){xxxxxx}},
  if (el.events) {
    data += `${genHandlers(el.events, false)},`
  }
  if (el.nativeEvents) {
    data += `${genHandlers(el.nativeEvents, true)},`
  }
  // slot target
  // only for non-scoped slots
  // 不处理作用域插槽
  if (el.slotTarget && !el.slotScope) {
    // data = { directives: [{}], key: 'id', ref: 'foo', refInFor:true, pre:true, tag:"component",  "staticClass:'static',class:{ active: isActive },", "staticStyle:{'color': 'red'},style:({ fontSize: size + 'px' }), 
    // _d({"id":"app"}, ["class",dynamicClass]),on:{click:function($event){xxxxxx}},slot:"slotName"
    data += `slot:${el.slotTarget},`
  }
  // scoped slots
  // 单独处理作用域插槽
  if (el.scopedSlots) {
    // data = { directives: [{}], key: 'id', ref: 'foo', refInFor:true, pre:true, tag:"component",  "staticClass:'static',class:{ active: isActive },", "staticStyle:{'color': 'red'},style:({ fontSize: size + 'px' }), 
    // _d({"id":"app"}, ["class",dynamicClass]),on:{click:function($event){xxxxxx}},slot:"slotName",scopedSlots: _u([
    //   {
    //     key: "default",
    //     fn: function(slotProps) {
    //       return _c('div', {}, [_v(_s(slotProps.text))])
    //     }
    //   }
    // ]),
    data += `${genScopedSlots(el, el.scopedSlots, state)},`
  }
  // component v-model
  if (el.model) {
    // data = { directives: [{}], key: 'id', ref: 'foo', refInFor:true, pre:true, tag:"component",  "staticClass:'static',class:{ active: isActive },", "staticStyle:{'color': 'red'},style:({ fontSize: size + 'px' }), 
    // _d({"id":"app"}, ["class",dynamicClass]),on:{click:function($event){xxxxxx}},slot:"slotName",scopedSlots: _u([
    //   {
    //     key: "default",
    //     fn: function(slotProps) {
    //       return _c('div', {}, [_v(_s(slotProps.text))])
    //     }
    //   }
    // ]),model:{value:value, callback:cb, expression:exp}
    data += `model:{value:${el.model.value},callback:${el.model.callback},expression:${el.model.expression}},`
  }
  // inline-template
  if (el.inlineTemplate) {
    const inlineTemplate = genInlineTemplate(el, state)
    if (inlineTemplate) {
      data += `${inlineTemplate},`
    }
  }
  // 移除最后一个逗号，给data添加右大括号，形成一个对象字符串
  data = data.replace(/,$/, '') + '}'
  // v-bind dynamic argument wrap
  // v-bind with dynamic arguments must be applied using the same v-bind object
  // merge helper so that class/style/mustUseProp attrs are handled correctly.
  if (el.dynamicAttrs) {
    // 如果有动态属性
    // _b({}, div, _d({"id":"app", "title":"Static Title"},["class",dynamicClass,"data-id",userId]))
    data = `_b(${data},"${el.tag}",${genProps(el.dynamicAttrs)})`
  }
  // v-bind data wrap
  // 处理v-bind和v-on， 使用他们的包裹函数处理
  if (el.wrapData) {
    // el.wrapData = (code: string) => {
    //   return `_b(${code},'${el.tag}',${dir.value},${
    //     dir.modifiers && dir.modifiers.prop ? 'true' : 'false'
    //   }${dir.modifiers && dir.modifiers.sync ? ',true' : ''})`
    // }
    // _b({key:value}, div, value, false, '')
    data = el.wrapData(data)
  }
  // v-on data wrap
  if (el.wrapListeners) {
    // el.wrapListeners = (code: string) => `_g(${code},${dir.value})`
    // _g({key:value...}, value)
    data = el.wrapListeners(data)
  }
  return data
}

// 处理指令
function genDirectives(el: ASTElement, state: CodegenState): string | void {
  const dirs = el.directives
  if (!dirs) return
  let res = 'directives:['
  let hasRuntime = false
  let i, l, dir, needRuntime
  for (i = 0, l = dirs.length; i < l; i++) {
    // 遍历指令
    dir = dirs[i]
    needRuntime = true
    // 获取指令处理函数
    const gen: DirectiveFunction = state.directives[dir.name]

    if (gen) {
      // compile-time directive that manipulates AST.
      // returns true if it also needs a runtime counterpart.
      // 如果指令处理函数返回了true，那么需要运行时支持
      needRuntime = !!gen(el, dir, state.warn)
    }
    // 如果需要运行时支持
    if (needRuntime) {
      hasRuntime = true
      // v-model='value'
      // res = directives:[ {name:"model", rawname: "v-model", value:"(value)", expression:("value")},
      res += `{name:"${dir.name}",rawName:"${dir.rawName}"${
        dir.value
          ? `,value:(${dir.value}),expression:${JSON.stringify(dir.value)}`
          : ''
      }${dir.arg ? `,arg:${dir.isDynamicArg ? dir.arg : `"${dir.arg}"`}` : ''}${
        dir.modifiers ? `,modifiers:${JSON.stringify(dir.modifiers)}` : ''
      }},`
    }
  }
  // 删除尾逗号添加右方括号
  if (hasRuntime) {
    return res.slice(0, -1) + ']'
  }
}

function genInlineTemplate(
  el: ASTElement,
  state: CodegenState
): string | undefined {
  const ast = el.children[0]
  if (__DEV__ && (el.children.length !== 1 || ast.type !== 1)) {
    // 使用内部元素作为模版，那么至少有一个子节点，且子节点类型必须是1元素节点
    state.warn(
      'Inline-template components must have exactly one child element.',
      { start: el.start }
    )
  }
  if (ast && ast.type === 1) {
    // {
    //   render: `with(this){return ${code}}`,
    //   staticRenderFns: state.staticRenderFns
    // }
    const inlineRenderFns = generate(ast, state.options)
    // inlineTemplate:{render:function(){
    // with(this){
    //     return xxxx
    //   }  
    // },staticRenderFns:[
    // function(){xxxx}  
    // ]}
    return `inlineTemplate:{render:function(){${
      inlineRenderFns.render
    }},staticRenderFns:[${inlineRenderFns.staticRenderFns
      .map(code => `function(){${code}}`)
      .join(',')}]}`
  }
}
// 处理作用域插槽
function genScopedSlots(
  el: ASTElement,
  slots: { [key: string]: ASTElement },
  state: CodegenState
): string {
  // by default scoped slots are considered "stable", this allows child
  // components with only scoped slots to skip forced updates from parent.
  // but in some cases we have to bail-out of this optimization
  // for example if the slot contains dynamic names, has v-if or v-for on them...
  // 如果在循环中，或者插槽是动态插槽名、有v-if或v-for，或者包含子插槽， 则说明需要强制更新
  let needsForceUpdate =
    el.for ||
    Object.keys(slots).some(key => {
      const slot = slots[key]
      return (
        slot.slotTargetDynamic || slot.if || slot.for || containsSlotChild(slot) // is passing down slot from parent which may be dynamic
      )
    })

  // #9534: if a component with scoped slots is inside a conditional branch,
  // it's possible for the same component to be reused but with different
  // compiled slot content. To avoid that, we generate a unique key based on
  // the generated code of all the slot contents.
  let needsKey = !!el.if

  // OR when it is inside another scoped slot or v-for (the reactivity may be
  // disconnected due to the intermediate scope variable)
  // #9438, #9506
  // TODO: this can be further optimized by properly analyzing in-scope bindings
  // and skip force updating ones that do not actually use scope variables.
  // 在父节点上查找作用域插槽，并且父节点作用域插槽不为空，或者父节点有v-for 说明需要强制更新
  if (!needsForceUpdate) {
    let parent = el.parent
    while (parent) {
      if (
        (parent.slotScope && parent.slotScope !== emptySlotScopeToken) ||
        parent.for
      ) {
        needsForceUpdate = true
        break
      }
      if (parent.if) {
        needsKey = true
      }
      parent = parent.parent
    }
  }
  // <!-- 1. 复杂嵌套结构 -->
  // <div v-for="group in groups">
  //   <!-- parent.for = true -->
  //   <div v-if="group.show">
  //     <!-- parent.if = true -->
  //     <template #content="{ item }">
  //       <!-- 当前节点 -->
  //       <div>
  //         Group: {{ group.name }}
  //         Item: {{ item.name }}
  //       </div>
  //     </template>
  //   </div>
  // </div>

  // <!-- 生成的代码 -->
  // {
  //   scopedSlots: _u([
  //     {
  //       key: "content",
  //       fn: function({ item }) {
  //         return _c('div', [
  //           _v("Group: " + _s(group.name) + "\n" +
  //             "Item: " + _s(item.name))
  //         ])
  //       }
  //     }
  //   ], null, true)  // 需要强制更新，因为父节点有 v-for
  // }
  const generatedSlots = Object.keys(slots)
    .map(key => genScopedSlot(slots[key], state))
    .join(',')
  // scopeSlots: _u([{
  //   key: "default",
  //   fn: function(slotProps) {
  //     return _c('div', {}, [_v(_s(slotProps.text))])
  //   }
  // }])
  return `scopedSlots:_u([${generatedSlots}]${
    needsForceUpdate ? `,null,true` : ``
  }${
    !needsForceUpdate && needsKey ? `,null,false,${hash(generatedSlots)}` : ``
  })`
}

function hash(str) {
  let hash = 5381
  let i = str.length
  while (i) {
    hash = (hash * 33) ^ str.charCodeAt(--i)
  }
  return hash >>> 0
}

function containsSlotChild(el: ASTNode): boolean {
  if (el.type === 1) {
    if (el.tag === 'slot') {
      return true
    }
    return el.children.some(containsSlotChild)
  }
  return false
}

function genScopedSlot(el: ASTElement, state: CodegenState): string {
  const isLegacySyntax = el.attrsMap['slot-scope']
  if (el.if && !el.ifProcessed && !isLegacySyntax) {
    return genIf(el, state, genScopedSlot, `null`)
  }
  if (el.for && !el.forProcessed) {
    return genFor(el, state, genScopedSlot)
  }
  const slotScope =
    el.slotScope === emptySlotScopeToken ? `` : String(el.slotScope)
  // <!-- 1. 复杂嵌套结构 -->
  // <div v-for="group in groups">
  //   <!-- parent.for = true -->
  //   <div v-if="group.show">
  //     <!-- parent.if = true -->
  //     <template #content="{ item }">
  //       <!-- 当前节点 -->
  //       <div>
  //         Group: {{ group.name }}
  //         Item: {{ item.name }}
  //       </div>
  //     </template>
  //   </div>
  // </div>
  // function({ item }) {
  //   return _c('div', [
  //     _v("Group: " + _s(group.name) + "\n" +
  //        "Item: " + _s(item.name))
  //   ])
  // }
  const fn =
    `function(${slotScope}){` +
    `return ${
      el.tag === 'template'
        ? el.if && isLegacySyntax
          ? `(${el.if})?${genChildren(el, state) || 'undefined'}:undefined`
          : genChildren(el, state) || 'undefined'
        : genElement(el, state)
    }}`
  // reverse proxy v-slot without scope on this.$slots
  // 如果没有作用域插槽，则说明要代理
  // 代理的意思是将其代理到this.$slots上
  const reverseProxy = slotScope ? `` : `,proxy:true`
  // {
  //   key: "content",
  //   fn: function({ item }) {
  //     return _c('div', [
  //       _v("Group: " + _s(group.name) + "\n" +
  //          "Item: " + _s(item.name))
  //     ])
  //   }
  // }
  return `{key:${el.slotTarget || `"default"`},fn:${fn}${reverseProxy}}`
}


// 关于规范化的解释
// vue中存在3中规范化级别 0 、1、2
// 0 表示不需要规范化 主要是简单节点
// 1 需要简单规范化 主要是组件
// 2 需要完全规范化 主要是 template 和 slot
// 规范化 的作用主要是 数组扁平化对template、slot、compoennt中的节点正确展开，返回的数组能正确处理， 所有子节点能最终形成一个扁平的、可渲染的数组
export function genChildren(
  el: ASTElement,
  state: CodegenState,
  checkSkip?: boolean,
  altGenElement?: Function,
  altGenNode?: Function
): string | void {
  // 获取子节点
  const children = el.children
  if (children.length) {
    // 第一个子节点
    const el: any = children[0]
    // optimize single v-for
    // 如果子节点长度为1， 并且子节点是v-for， 并且子节点的标签不是template， 并且子节点的标签不是slot
    if (
      children.length === 1 &&
      el.for &&
      el.tag !== 'template' &&
      el.tag !== 'slot'
    ) {
      const normalizationType = checkSkip
        ? state.maybeComponent(el)
          ? `,1` // 1 表示这个元素是一个组件
          : `,0` // 0 表示这个元素不是一个组件
        : `` // 如果不需要检查，不添加类型
        // 返回genElement生成的渲染函数
      return `${(altGenElement || genElement)(el, state)}${normalizationType}`
    }
    // 如果有多个子节点
    const normalizationType = checkSkip
      ? getNormalizationType(children, state.maybeComponent)
      : 0
    const gen = altGenNode || genNode
    // 遍历children，每个子节点调用gen 生成渲染函数
    // <div>
    //   <span>Static</span>
    //   <div v-for="item in items">{{ item }}</div>
    //   <p>{{ message }}</p>
    // </div>
    //
    // _c('div', [
    //   _c('span', [_v("Static")]),
    //   _l((items), function(item) {
    //     return _c('div', [_v(_s(item))])
    //   }),
    //   _c('p', [_v(_s(message))])
    // ], 1)  // 1 表示需要规范化
    return `[${children.map(c => gen(c, state)).join(',')}]${
      normalizationType ? `,${normalizationType}` : ''
    }`
  }
}

// determine the normalization needed for the children array.
// 0: no normalization needed
// 1: simple normalization needed (possible 1-level deep nested array)
// 2: full normalization needed
function getNormalizationType(
  children: Array<ASTNode>,
  maybeComponent: (el: ASTElement) => boolean
): number {
  let res = 0
  // 遍历子节点
  for (let i = 0; i < children.length; i++) {
    const el: ASTNode = children[i]
    // 子节点类型不是元素节点， 跳过
    if (el.type !== 1) {
      continue
    }
    if (
      // 需要规范化
      needsNormalization(el) ||
      // 或者有if条件时，某个分支需要规范化
      (el.ifConditions &&
        el.ifConditions.some(c => needsNormalization(c.block)))
    ) {
      res = 2
      break
    }
    if (
      // 如果是组件
      maybeComponent(el) ||
      // 或者 分支上有节点需要规范化
      (el.ifConditions && el.ifConditions.some(c => maybeComponent(c.block)))
    ) {
      res = 1
    }
  }
  return res
}

function needsNormalization(el: ASTElement): boolean {
  // 节点有for循环或者类型是template或者slot
  return el.for !== undefined || el.tag === 'template' || el.tag === 'slot'
}

function genNode(node: ASTNode, state: CodegenState): string {
  if (node.type === 1) {
    return genElement(node, state)
  } else if (node.type === 3 && node.isComment) {
    return genComment(node)
  } else {
    return genText(node)
  }
}

export function genText(text: ASTText | ASTExpression): string {
  return `_v(${
    text.type === 2
      ? text.expression // no need for () because already wrapped in _s()
      : transformSpecialNewlines(JSON.stringify(text.text))
  })`
}

export function genComment(comment: ASTText): string {
  return `_e(${JSON.stringify(comment.text)})`
}

function genSlot(el: ASTElement, state: CodegenState): string {
  // :slot='header'
  const slotName = el.slotName || '"default"'
  // slot节点处理其子节点
  const children = genChildren(el, state)
  // res = _t(header, function(){
  //   return [child1, child2]
  // }  注意这里没有右括号，需要根据属性给_t添加其他参数
  let res = `_t(${slotName}${children ? `,function(){return ${children}}` : ''}`
  // 如果el上存在属性或者动态属性
  const attrs =
    el.attrs || el.dynamicAttrs
      ? genProps(
          // 合并sttrs和动态属性，并将属性名转换为驼峰
          (el.attrs || []).concat(el.dynamicAttrs || []).map(attr => ({
            // slot props are camelized
            name: camelize(attr.name),
            value: attr.value,
            dynamic: attr.dynamic
          }))
        )
      : null
  const bind = el.attrsMap['v-bind']
  // 如果存在属性或者动态属性，且没有子节点
  if ((attrs || bind) && !children) {
    res += `,null`
  }
  // 如果存在属性，_t 添加属性参数
  if (attrs) {
    res += `,${attrs}`
  }
  // 如果存在绑定属性， _t 添加绑定参数
  if (bind) {
    res += `${attrs ? '' : ',null'},${bind}`
  }
  return res + ')'
}

// componentName is el.component, take it as argument to shun flow's pessimistic refinement
function genComponent(
  componentName: string,
  el: ASTElement,
  state: CodegenState
): string {
  // 如果有inlineTemplate 属性， 则不需要生成子节点
  const children = el.inlineTemplate ? null : genChildren(el, state, true)
  // genData(el, state) 将组件上的指令、属性、事件等信息生成render函数的额外数据
  // _c(Header ,_b({xxxx}), null)
  return `_c(${componentName},${genData(el, state)}${
    children ? `,${children}` : ''
  })`
}

function genProps(props: Array<ASTAttr>): string {
  let staticProps = ``
  let dynamicProps = ``
  // 循环属性
  for (let i = 0; i < props.length; i++) {
    const prop = props[i]
    const value = transformSpecialNewlines(prop.value)
    // 如果是动态属性
    if (prop.dynamic) {
      dynamicProps += `${prop.name},${value},`
    } else {
      // 如果是静态属性
      staticProps += `"${prop.name}":${value},`
    }
  }
  // 静态属性去掉最后的逗号
  staticProps = `{${staticProps.slice(0, -1)}}`
  if (dynamicProps) {
    // 动态属性需要使用_d 生成
    // <div
    //   id="app"
    //   :class="dynamicClass"
    //   title="Static Title"
    //   :data-id="userId">
    // </div>
    // _d({
    //   "id":"app",
    //   "title":"Static Title",
    // }, [
    //   "class",dynamicClass,
    //   "data-id",userId
    // ])
    return `_d(${staticProps},[${dynamicProps.slice(0, -1)}])`
  } else {
    return staticProps
  }
}

// #3895, #4268
// 属性上的行分隔符和段落分隔符 替换为 \\u2028 和 \\u2029 防止换行字符导致的错误
// 可能出问题的情况
// const str = "Hello\u2028World";  // 可能导致语法错误

// // 转换后的安全版本
// const str = "Hello\\u2028World";  // 安全，不会破坏代码
// 如果有 const str = "Hello\u2028World"; 其内部的\u2028 会导致换行， 因此将他转换成 \\u2028 保持字符串为原有字面量
function transformSpecialNewlines(text: string): string {
  return text.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}
