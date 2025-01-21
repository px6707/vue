import { ASTElement, ASTModifiers } from 'types/compiler'

/**
 * Cross-platform code generation for component v-model
 */
export function genComponentModel(
  el: ASTElement,
  value: string,
  modifiers: ASTModifiers | null
): void {
  const { number, trim } = modifiers || {}

  const baseValueExpression = '$$v'
  let valueExpression = baseValueExpression
  if (trim) {
    // 如果使用了 trim 修饰符则对生成的表达式进行去空格处理
    valueExpression =
      `(typeof ${baseValueExpression} === 'string'` +
      `? ${baseValueExpression}.trim()` +
      `: ${baseValueExpression})`
  }
  if (number) {
    valueExpression = `_n(${valueExpression})`
  }
  // valueExpression 
  // `_n((typeof ${baseValueExpression} === 'string'?  ${baseValueExpression}.trim(): ${baseValueExpression}))`
  const assignment = genAssignmentCode(value, valueExpression)

  el.model = {
    value: `(${value})`,
    expression: JSON.stringify(value),
    // 示例
    // v-model.number: "name"
    // `function ($$v){
    //   name = _n($$v)
    // }`
    // v-model:"user[items[index]]",
    // `function ($$v){
    //   $set("users","'items[index]'" , $$v)
    // }`
    callback: `function (${baseValueExpression}) {${assignment}}`
  }
}

/**
 * Cross-platform codegen helper for generating v-model value assignment code.
 */
// 生成赋值表达式
export function genAssignmentCode(value: string, assignment: string): string {
  // 返回表达式的解析结果
  // val = "users[items[index]]"===>
  // {
  //     exp: "users",         // val.slice(0, 5)
  //     key: "'items[index]'"             // val.slice(6, 7)
  // }
  const res = parseModel(value)
  // key===null 说明当前不是对象的属性 即 value只是简单的字符串
  if (res.key === null) {
    return `${value}=${assignment}`
  } else {
    // 如果是对象的属性
    return `$set(${res.exp}, ${res.key}, ${assignment})`
  }
}

/**
 * Parse a v-model expression into a base path and a final key segment.
 * Handles both dot-path and possible square brackets.
 *
 * Possible cases:
 *
 * - test
 * - test[key]
 * - test[test1[key]]
 * - test["a"][key]
 * - xxx.test[a[a].test1[key]]
 * - test.xxx.a["asa"][test1[key]]
 *
 */

let len, str, chr, index, expressionPos, expressionEndPos

type ModelParseResult = {
  exp: string
  key: string | null
}

export function parseModel(val: string): ModelParseResult {
  // Fix https://github.com/vuejs/vue/pull/7730
  // allow v-model="obj.val " (trailing whitespace)
  val = val.trim()
  len = val.length
  // 如果不存在左方括号，或者右方括号的位置不是最后一个字符
  if (val.indexOf('[') < 0 || val.lastIndexOf(']') < len - 1) {
    index = val.lastIndexOf('.')
    // 如果存在 . 号
    if (index > -1) {
      // exp是0位到index的字符串
      // key是index+1位到最后的字符串
      // 例如 val = 'a.b.c'
      // exp = 'a.b'
      // key = 'c'
      return {
        exp: val.slice(0, index),
        key: '"' + val.slice(index + 1) + '"'
      }
    } else {
      return {
        exp: val,
        key: null
      }
    }
  }
  // 存在方括号，即 v-model="users[0].name" 或者 v-model="user['first-name']"
  str = val
  index = expressionPos = expressionEndPos = 0
  // 如果index小于len
  while (!eof()) {
    // 对每个字符遍历
    chr = next()
    /* istanbul ignore if */
    // 如果字符串是 单引号或双引号
    if (isStringStart(chr)) {
      // 跳跃到下一个引号位置
      parseString(chr)
    } else if (chr === 0x5b) {
      // 如果是左方括号，记录最后一个右方括号的位置 给expressionEndPos，
      // 记录左方括号的位置给expressionPos
      parseBracket(chr)
    }
  }
//    "users[0]" ===》 {
//     exp: "users",         // val.slice(0, 5)
//     key: "0"             // val.slice(6, 7)
// }
// val = "users['name']"===>
// {
//     exp: "users",         // val.slice(0, 5)
//     key: "'name'"             // val.slice(6, 7)
// }
// val = "users[items[index]]"===>
// {
//     exp: "users",         // val.slice(0, 5)
//     key: "'items[index]'"             // val.slice(6, 7)
// }
  return {
    exp: val.slice(0, expressionPos),
    key: val.slice(expressionPos + 1, expressionEndPos)
  }
}

function next(): number {
  return str.charCodeAt(++index)
}

function eof(): boolean {
  return index >= len
}

function isStringStart(chr: number): boolean {
  return chr === 0x22 || chr === 0x27
}

function parseBracket(chr: number): void {
  let inBracket = 1
  expressionPos = index
  while (!eof()) {
    chr = next()
    // 中括号内有引号
    if (isStringStart(chr)) {
      // 跳跃到下一个引号位置
      parseString(chr)
      continue
    }
    // 如果是左方括号
    if (chr === 0x5b) inBracket++
    // 如果是右方括号，这里是处理 方括号中还有方括号的情况，只记录最外层的方括号位置
    if (chr === 0x5d) inBracket--
    // 所有方括号都匹配完成
    if (inBracket === 0) {
      // 记录当前最外层方括号的位置
      expressionEndPos = index
      break
    }
  }
}

function parseString(chr: number): void {
  const stringQuote = chr
  // 遍历字符串
  while (!eof()) {
    chr = next()
    if (chr === stringQuote) {
      break
    }
  }
}
