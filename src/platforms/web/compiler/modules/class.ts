import { parseText } from 'compiler/parser/text-parser'
import { getAndRemoveAttr, getBindingAttr, baseWarn } from 'compiler/helpers'
import { ASTElement, CompilerOptions, ModuleOptions } from 'types/compiler'
// 转换中的函数
function transformNode(el: ASTElement, options: CompilerOptions) {
  const warn = options.warn || baseWarn
  const staticClass = getAndRemoveAttr(el, 'class')
  // 开发模式下，如果有class
  if (__DEV__ && staticClass) {
    const res = parseText(staticClass, options.delimiters)
    // 如果解析成功，警告 class={{ expression }} 的形式不再支持
    if (res) {
      warn(
        `class="${staticClass}": ` +
          'Interpolation inside attributes has been removed. ' +
          'Use v-bind or the colon shorthand instead. For example, ' +
          'instead of <div class="{{ val }}">, use <div :class="val">.',
        el.rawAttrsMap['class']
      )
    }
  }
  // 处理静态class
  if (staticClass) {
    // 将多个空格合并成一个，规范class的格式
    el.staticClass = JSON.stringify(staticClass.replace(/\s+/g, ' ').trim())
  }
  // 获取动态绑定的class，放入el.classBinding中
  const classBinding = getBindingAttr(el, 'class', false /* getStatic */)
  if (classBinding) {
    el.classBinding = classBinding
  }

  // <div class="static" :class="{ active: isActive, 'text-danger': hasError }">
  // 转换后的结果
  // el.staticClass = "static"
  // el.classBinding = "{ active: isActive, 'text-danger': hasError }"
}

// 输入HTML:
// <div class="static" :class="{ active: isActive }">
// 生成的数据字符串:
// "staticClass:'static',class:{ active: isActive },"
function genData(el: ASTElement): string {
  let data = ''
  if (el.staticClass) {
    data += `staticClass:${el.staticClass},`
  }
  if (el.classBinding) {
    data += `class:${el.classBinding},`
  }
  return data
}

export default {
  staticKeys: ['staticClass'],
  transformNode,
  genData
} as ModuleOptions
