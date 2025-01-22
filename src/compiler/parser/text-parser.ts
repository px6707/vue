import { cached } from 'shared/util'
import { parseFilters } from './filter-parser'
// 匹配双大括号表达式
const defaultTagRE = /\{\{((?:.|\r?\n)+?)\}\}/g
const regexEscapeRE = /[-.*+?^${}()|[\]\/\\]/g

const buildRegex = cached(delimiters => {
  const open = delimiters[0].replace(regexEscapeRE, '\\$&')
  const close = delimiters[1].replace(regexEscapeRE, '\\$&')
  return new RegExp(open + '((?:.|\\n)+?)' + close, 'g')
})

type TextParseResult = {
  expression: string
  tokens: Array<string | { '@binding': string }>
}

export function parseText(
  text: string,
  delimiters?: [string, string]
): TextParseResult | void {
  // 如果传入的分隔符，则使用分隔符创建插值表达式的正则
  // vue中支持自定义插值表达式的分隔符，例如：
  // new Vue({
  //   delimiters: ['${', '}']  // 使用 ${expression} 替代 {{expression}}
  // })
  //@ts-expect-error
  const tagRE = delimiters ? buildRegex(delimiters) : defaultTagRE
  // 没有插值直接返回
  if (!tagRE.test(text)) {
    return
  }
  const tokens: string[] = []
  const rawTokens: any[] = []
  // 在/g的全局正则下，重置开始匹配的位置为开头
  let lastIndex = (tagRE.lastIndex = 0)
  let match, index, tokenValue
  // 每次匹配到插值表达式
  // match.index 为匹配到的开始位置, match[0] 为匹配到的字符串 例如{{expression}};match[1] 为匹配到的表达式例如expression
  while ((match = tagRE.exec(text))) {
    // index是匹配的开始位置
    index = match.index
    // 匹配到的位置 大于 开始匹配位置， 说明前面这一段是纯文本
    // push text token
    if (index > lastIndex) {
      // 纯文本保存起来
      rawTokens.push((tokenValue = text.slice(lastIndex, index)))
      tokens.push(JSON.stringify(tokenValue))
    }
    // 获取管道过滤器 _f("uppercase")(message) 如果没有管道则直接是 message
    // tag token
    const exp = parseFilters(match[1].trim())
    tokens.push(`_s(${exp})`)
    rawTokens.push({ '@binding': exp })
    // 下一次从这次匹配的结束位置开始
    lastIndex = index + match[0].length
  }
  // 剩余字符串保存
  if (lastIndex < text.length) {
    rawTokens.push((tokenValue = text.slice(lastIndex)))
    tokens.push(JSON.stringify(tokenValue))
  }
  return {
    expression: tokens.join('+'),
    tokens: rawTokens
  }
}
