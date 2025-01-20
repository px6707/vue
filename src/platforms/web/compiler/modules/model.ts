/**
 * Expand input[v-model] with dynamic type bindings into v-if-else chains
 * Turn this:
 *   <input v-model="data[type]" :type="type">
 * into this:
 *   <input v-if="type === 'checkbox'" type="checkbox" v-model="data[type]">
 *   <input v-else-if="type === 'radio'" type="radio" v-model="data[type]">
 *   <input v-else :type="type" v-model="data[type]">
 */

import { addRawAttr, getBindingAttr, getAndRemoveAttr } from 'compiler/helpers'

import {
  processFor,
  processElement,
  addIfCondition,
  createASTElement
} from 'compiler/parser/index'
import { ASTElement, CompilerOptions, ModuleOptions } from 'types/compiler'

function preTransformNode(el: ASTElement, options: CompilerOptions) {
  // 如果是input元素
  if (el.tag === 'input') {
    const map = el.attrsMap
    // 没有v-model则不处理
    if (!map['v-model']) {
      return
    }

    let typeBinding
    // 如果input具有动态绑定的type，则获取这个绑定内容
    if (map[':type'] || map['v-bind:type']) {
      typeBinding = getBindingAttr(el, 'type')
    }
    // 如果input没有type属性，且没有动态绑定的type，则获取v-bind中的type
    // <input v-bind="{ type: inputType }"> 匹配这种写法
    if (!map.type && !typeBinding && map['v-bind']) {
      typeBinding = `(${map['v-bind']}).type`
    }
    // 如果具有动态绑定的type
    if (typeBinding) {
      // 找到节点上的if条件
      const ifCondition = getAndRemoveAttr(el, 'v-if', true)
      const ifConditionExtra = ifCondition ? `&&(${ifCondition})` : ``
      // 找到节点上的v-else
      const hasElse = getAndRemoveAttr(el, 'v-else', true) != null
      // 找到节点上的v-else-if条件
      const elseIfCondition = getAndRemoveAttr(el, 'v-else-if', true)
      // 1. checkbox
      const branch0 = cloneASTElement(el)
      // 在el上添加for相关的属性
      // process for on the main node
      processFor(branch0)
      // 给el添加类型为checkbox
      addRawAttr(branch0, 'type', 'checkbox')
      // 处理节点，包括了处ref、处理插槽、处理本身是插槽、组件等
      processElement(branch0, options)
      // 表示当前节点已经处理
      branch0.processed = true // prevent it from double-processed
      // 添加if条件，如果type为checkbox，再加上本来就具有的if条件
      branch0.if = `(${typeBinding})==='checkbox'` + ifConditionExtra
      // 添加ifCondition 结合后面的addIfCondition，相当于给branch0节点添加不同的if条件（exp），走不同的分支（block）
      addIfCondition(branch0, {
        exp: branch0.if,
        block: branch0
      })
      // 再创建一个AST节点，类型是radio
      // 2. add radio else-if condition
      const branch1 = cloneASTElement(el)
      getAndRemoveAttr(branch1, 'v-for', true)
      addRawAttr(branch1, 'type', 'radio')
      processElement(branch1, options)
      addIfCondition(branch0, {
        exp: `(${typeBinding})==='radio'` + ifConditionExtra,
        block: branch1
      })
      // 创建一个类型为其他的AST节点
      // 3. other
      const branch2 = cloneASTElement(el)
      getAndRemoveAttr(branch2, 'v-for', true)
      addRawAttr(branch2, ':type', typeBinding)
      processElement(branch2, options)
      addIfCondition(branch0, {
        exp: ifCondition!,
        block: branch2
      })
      // 如果节点上有v-else
      if (hasElse) {
        branch0.else = true
      } else if (elseIfCondition) {
        // 如果节点上有v-else-if条件
        branch0.elseif = elseIfCondition
      }

      return branch0
    }
  }
}
// 克隆一个新的AST节点
function cloneASTElement(el) {
  return createASTElement(el.tag, el.attrsList.slice(), el.parent)
}

export default {
  preTransformNode
} as ModuleOptions
