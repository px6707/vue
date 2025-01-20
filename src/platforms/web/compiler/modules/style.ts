import { parseText } from 'compiler/parser/text-parser'
import { parseStyleText } from 'web/util/style'
import { getAndRemoveAttr, getBindingAttr, baseWarn } from 'compiler/helpers'
import { ASTElement, CompilerOptions, ModuleOptions } from 'types/compiler'

function transformNode(el: ASTElement, options: CompilerOptions) {
  const warn = options.warn || baseWarn
  // 获取静态style style="color: red"
  const staticStyle = getAndRemoveAttr(el, 'style')
  if (staticStyle) {
    /* istanbul ignore if */
    if (__DEV__) {
      const res = parseText(staticStyle, options.delimiters)
      // 今天style上存在插值表达式，需要警告， style="color: {{ color }}" 不再支持
      if (res) {
        warn(
          `style="${staticStyle}": ` +
            'Interpolation inside attributes has been removed. ' +
            'Use v-bind or the colon shorthand instead. For example, ' +
            'instead of <div style="{{ val }}">, use <div :style="val">.',
          el.rawAttrsMap['style']
        )
      }
    }
    el.staticStyle = JSON.stringify(parseStyleText(staticStyle))
  }

  // 获取动态绑定的style
  const styleBinding = getBindingAttr(el, 'style', false /* getStatic */)
  if (styleBinding) {
    el.styleBinding = styleBinding
  }
}


// 输入HTML:
// <div style="color: red" :style="{ fontSize: size + 'px' }">
// 生成的数据字符串:
// "staticStyle:{'color': 'red'},style:({ fontSize: size + 'px' }),"
function genData(el: ASTElement): string {
  let data = ''
  if (el.staticStyle) {
    data += `staticStyle:${el.staticStyle},`
  }
  if (el.styleBinding) {
    data += `style:(${el.styleBinding}),`
  }
  return data
}

export default {
  staticKeys: ['staticStyle'],
  transformNode,
  genData
} as ModuleOptions
