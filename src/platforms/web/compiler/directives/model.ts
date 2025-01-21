import config from 'core/config'
import { addHandler, addProp, getBindingAttr } from 'compiler/helpers'
import { genComponentModel, genAssignmentCode } from 'compiler/directives/model'
import { ASTDirective, ASTElement, ASTModifiers } from 'types/compiler'

let warn

// in some cases, the event used has to be determined at runtime
// so we used some reserved tokens during compile.
export const RANGE_TOKEN = '__r'
export const CHECKBOX_RADIO_TOKEN = '__c'

export default function model(
  el: ASTElement,
  dir: ASTDirective,
  _warn: Function
): boolean | undefined {
  warn = _warn
  const value = dir.value
  const modifiers = dir.modifiers
  const tag = el.tag
  const type = el.attrsMap.type

  if (__DEV__) {
    // inputs with type="file" are read only and setting the input's
    // value will throw an error.
    // 如果是 文件上传的input 使用了 v-model 则显示警告
    if (tag === 'input' && type === 'file') {
      warn(
        `<${el.tag} v-model="${value}" type="file">:\n` +
          `File inputs are read only. Use a v-on:change listener instead.`,
        el.rawAttrsMap['v-model']
      )
    }
  }
  // 如果是组件
  if (el.component) {
    // 给el添加model属性
    // el.model = {
    //   value: `(${value})`,
    //   expression: JSON.stringify(value),
    //   // 示例
    //   // v-model.number: "name"
    //   // `function ($$v){
    //   //   name = _n($$v)
    //   // }`
    //   // v-model:"user[items[index]]",
    //   // `function ($$v){
    //   //   $set("users","'items[index]'" , $$v)
    //   // }`
    //   callback: `function (${baseValueExpression}) {${assignment}}`
    // }
    genComponentModel(el, value, modifiers)
    // component v-model doesn't need extra runtime
    return false
  } else if (tag === 'select') {
    // 创建对应的事件，并放入到el的事件中
    genSelect(el, value, modifiers)
  } else if (tag === 'input' && type === 'checkbox') {
    genCheckboxModel(el, value, modifiers)
  } else if (tag === 'input' && type === 'radio') {
    genRadioModel(el, value, modifiers)
  } else if (tag === 'input' || tag === 'textarea') {
    genDefaultModel(el, value, modifiers)
  } else if (!config.isReservedTag(tag)) {
    genComponentModel(el, value, modifiers)
    // component v-model doesn't need extra runtime
    return false
  } else if (__DEV__) {
    warn(
      `<${el.tag} v-model="${value}">: ` +
        `v-model is not supported on this element type. ` +
        "If you are working with contenteditable, it's recommended to " +
        'wrap a library dedicated for that purpose inside a custom component.',
      el.rawAttrsMap['v-model']
    )
  }

  // ensure runtime directive metadata
  return true
}

function genCheckboxModel(
  el: ASTElement,
  value: string,
  modifiers?: ASTModifiers | null
) {
  const number = modifiers && modifiers.number
  const valueBinding = getBindingAttr(el, 'value') || 'null'
  // 处理自定义的tue|false 的代替值
  const trueValueBinding = getBindingAttr(el, 'true-value') || 'true'
  const falseValueBinding = getBindingAttr(el, 'false-value') || 'false'
  // v-model="checked" :value='value'
  // Array.isArray(checked)?_i(checked, value)>-1: :(checked)
  // 对checked 进行判断，
  // v-model="checked" :value='value'
  // Array.isArray(checked)?_i(checked, value)>-1: :(checked) 
  // 即如果checked 是数组，_i(checked, value)>-1 判断 value是否在数组中 作为checked的值
  // 不是数组则直接返回 checked 
  // 如果自定义了true的代替值，则_q判断 替代值和选择值是否相等
  addProp(
    el,
    'checked',
    `Array.isArray(${value})` +
      `?_i(${value},${valueBinding})>-1` +
      (trueValueBinding === 'true'
        ? `:(${value})`
        : `:_q(${value},${trueValueBinding})`)
  )
  // 添加如下函数到change事件
  // var $$a = checked,
  //   $$el = $event.target,
  //   $$c = $$el.checked ? (true) : (false);
  //   if(Array.isArray($$a)){
  //     // 如果是数组
  //     var $$v=value,
  //     $$i=_i($$a,$$v);
  //     if($$el.checked){
  //       // 如果选中，并且选中值不在数组中，则添加值
  //       $$i<0&&(
  //         checked=$$a.concat([$$v])
  //       )}else{
  //         // 如果未选中，则删除该值
  //         $$i>-1&&(
  //           checked = $$a.slice(0,$$i).concat($$a.slice($$i+1))
  //           )
  //       }
  //   }else{
  //     // 如果不是数组
  //     checked = $$c
  //   }
  addHandler(
    el,
    'change',
    `var $$a=${value},` +
      '$$el=$event.target,' +
      `$$c=$$el.checked?(${trueValueBinding}):(${falseValueBinding});` +
      'if(Array.isArray($$a)){' +
      `var $$v=${number ? '_n(' + valueBinding + ')' : valueBinding},` +
      '$$i=_i($$a,$$v);' +
      `if($$el.checked){$$i<0&&(${genAssignmentCode(
        value,
        '$$a.concat([$$v])'
      )})}` +
      `else{$$i>-1&&(${genAssignmentCode(
        value,
        '$$a.slice(0,$$i).concat($$a.slice($$i+1))'
      )})}` +
      `}else{${genAssignmentCode(value, '$$c')}}`,
    null,
    true
  )
}

function genRadioModel(
  el: ASTElement,
  value: string,
  modifiers?: ASTModifiers | null
) {
  // v-model="checked" :value='value'
  const number = modifiers && modifiers.number
  let valueBinding = getBindingAttr(el, 'value') || 'null'
  valueBinding = number ? `_n(${valueBinding})` : valueBinding
  // checked _q(checked, value)
  addProp(el, 'checked', `_q(${value},${valueBinding})`)
  // 添加change事件
  // checked = value
  addHandler(el, 'change', genAssignmentCode(value, valueBinding), null, true)
}

function genSelect(
  el: ASTElement,
  value: string,
  modifiers?: ASTModifiers | null
) {
  const number = modifiers && modifiers.number
  const selectedVal =
    `Array.prototype.filter` +
    `.call($event.target.options,function(o){return o.selected})` +
    `.map(function(o){var val = "_value" in o ? o._value : o.value;` +
    `return ${number ? '_n(val)' : 'val'}})`

  // $event.target.options.filter(function (o) {
  //   return o.selected
  // }).map(function(o){
  //   var val = "_value" in o ? o._value : o.value;
  //   return number ? _n(val) : val
  // })
  const assignment = '$event.target.multiple ? $$selectedVal : $$selectedVal[0]'
  let code = `var $$selectedVal = ${selectedVal};`
  code = `${code} ${genAssignmentCode(value, assignment)}`
  // 例子
  // v-model="selected" 单选
  // var $$selectedVal = $event.target.options.filter(function (o) {
  //   return o.selected
  // }).map(function(o){
  //   var val = "_value" in o ? o._value : o.value;
  //   return number ? _n(val) : val
  // })
  //  selected = $$selectedVal 
  // 事件放在el对应的自定义事件、或原生事件数组中
  addHandler(el, 'change', code, null, true)
}

function genDefaultModel(
  el: ASTElement,
  value: string,
  modifiers?: ASTModifiers | null
): boolean | void {
  const type = el.attrsMap.type

  // warn if v-bind:value conflicts with v-model
  // except for inputs with v-bind:type
  if (__DEV__) {
    const value = el.attrsMap['v-bind:value'] || el.attrsMap[':value']
    const typeBinding = el.attrsMap['v-bind:type'] || el.attrsMap[':type']
    if (value && !typeBinding) {
      // 如果有绑定值，但没有绑定input的类型
      const binding = el.attrsMap['v-bind:value'] ? 'v-bind:value' : ':value'
      // 提示v-model 和 ：value/v-bind:value 同时存在，冲突
      warn(
        `${binding}="${value}" conflicts with v-model on the same element ` +
          'because the latter already expands to a value binding internally',
        el.rawAttrsMap[binding]
      )
    }
  }

  const { lazy, number, trim } = modifiers || {}
  const needCompositionGuard = !lazy && type !== 'range'
  // lazy事件需要再change时触发，而不是在input时触发
  const event = lazy ? 'change' : type === 'range' ? RANGE_TOKEN : 'input'

  let valueExpression = '$event.target.value'
  if (trim) {
    valueExpression = `$event.target.value.trim()`
  }
  if (number) {
    valueExpression = `_n(${valueExpression})`
  }
  // v-model="text_area" 转换为
  // text_area = $event.target.value
  let code = genAssignmentCode(value, valueExpression)
  if (needCompositionGuard) {
    // $event.target.composing 输入法输入过程的标记
    // 1. compositionstart  // 开始输入法编辑
    // 2. compositionupdate // 输入法编辑中
    // 3. compositionend    // 输入法编辑结束
    // 在汉语输入过程中不应该触发v-model
    code = `if($event.target.composing)return;${code}`
  }
  // 添加属性
  addProp(el, 'value', `(${value})`)
  // 添加事件
  addHandler(el, event, code, null, true)
  if (trim || number) {
    // trim 和number 修饰符可能会修改值
    // 执行$forceUpdate()更新视图，保证显示正确
    addHandler(el, 'blur', '$forceUpdate()')
  }
}
