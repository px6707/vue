const validDivisionCharRE = /[\w).+\-_$\]]/

export function parseFilters(exp: string): string {

  // 记录 单引号、双引号、模板字符串、正则表达式的状态以及各种括号的深度，是为了防止匹配到 引号和括号内的 管道符 ，导致分割出错
  // 单引号状态， 处理'foo' 中的内容
  let inSingle = false
  // 双引号状态， 处理"foo" 中的内容
  let inDouble = false
  // 模板字符串状态， 处理`foo` 中的内容
  let inTemplateString = false
  // 正则表达式状态 `baz` 中的内容
  let inRegex = false
  // 跟踪花括号深度，{}的嵌套深度
  let curly = 0
  // 跟踪方括号深度，[]的嵌套深度
  let square = 0
  // 跟踪括号深度，()的嵌套深度
  let paren = 0
  let lastFilterIndex = 0
  let c, prev, i, expression, filters

  for (i = 0; i < exp.length; i++) {
    prev = c
    c = exp.charCodeAt(i)
    // 如果是单引号
    if (inSingle) {
      // 如果当前字符是单引号，且上一个字符不是反斜杠，说明单引号结束
      // 反之，在开启了单引号状态的情况下，如果当前字符是单引号，且上一个字符是反斜杠，说明单引号尚未结束，无需改变状态
      // 到正则的处理都是类似的，只是字符不同
      if (c === 0x27 && prev !== 0x5c) inSingle = false
    } else if (inDouble) {
      if (c === 0x22 && prev !== 0x5c) inDouble = false
    } else if (inTemplateString) {
      if (c === 0x60 && prev !== 0x5c) inTemplateString = false
    } else if (inRegex) {
      if (c === 0x2f && prev !== 0x5c) inRegex = false
    } else if (
      // 如果c是管道字符 | ，则判断前一个字符是不是管道字符 | 和后一个字符是不是管道字符 |， 在前一个字符和后一个字符是|的情况下，不是过滤而是 或||
      // 判断不再花括号内，不再方括号内，不再圆括号内，反之匹配到对象或者函数中的管道运算
      // 防止匹配  a || b    method({ a | b })   [a | b]   fn(a | b)
      c === 0x7c && // pipe
      exp.charCodeAt(i + 1) !== 0x7c &&
      exp.charCodeAt(i - 1) !== 0x7c &&
      !curly &&
      !square &&
      !paren
    ) {
      // 没有表达式时,说明是第一个过滤器
      if (expression === undefined) {
        // 当前开始索引+1
        // 获取从0到当前开始索引的字符串, 例如 exp = "message | uppercase"， 获取了lastFilterIndex = 8， expression = "message "
        // first filter, end of expression
        lastFilterIndex = i + 1
        expression = exp.slice(0, i).trim()
      } else {
        // 如果之前已有表达式，说明后面跟着多个过滤器
        pushFilter()
      }
    } else {
      switch (c) {
        // 如果匹配到了双引号，进入双引号状态
        case 0x22:
          inDouble = true
          break // "
        // 如果匹配到了单引号，进入单引号状态
        case 0x27:
          inSingle = true
          break // '
        // 如果匹配到了反引号，进入模板字符串状态
        case 0x60:
          inTemplateString = true
          break // `
          // 匹配到圆括号，圆括号深度+1
        case 0x28:
          paren++
          break // (
          // 匹配到右侧圆括号，括号深度-1
        case 0x29:
          paren--
          break // )
        case 0x5b:
          square++
          break // [
        case 0x5d:
          square--
          break // ]
        case 0x7b:
          curly++
          break // {
        case 0x7d:
          curly--
          break // }
      }
      // 遇到了/
      if (c === 0x2f) {
        // /
        let j = i - 1
        let p
        // 向前查找第一个不是空的字符
        // find first non-whitespace prev char
        for (; j >= 0; j--) {
          p = exp.charAt(j)
          if (p !== ' ') break
        }
        // 如果前面没有字符，或者前面的祖父不是有效的除法运算字符
        // 则认为这是一个正则的开始
        if (!p || !validDivisionCharRE.test(p)) {
          inRegex = true
        }
      }
    }
  }
  // 如果没有匹配到表达式， 则说明没有过滤器，传入的是表达式本身
  if (expression === undefined) {
    expression = exp.slice(0, i).trim()
  } else if (lastFilterIndex !== 0) {
    // 如果匹配到过表达式，且当前索引不为0，则说明后面还有个过滤器
    pushFilter()
  }
  // 将过滤器添加到filters数组中，并对当前索引进行递增
  function pushFilter() {
    ;(filters || (filters = [])).push(exp.slice(lastFilterIndex, i).trim())
    lastFilterIndex = i + 1
  }

  // 所有过滤器进行包裹
  if (filters) {
    for (i = 0; i < filters.length; i++) {
      expression = wrapFilter(expression, filters[i])
    }
  }
  // 返回的表达式形如 _f("uppercase")(message)    _f("currency")(price,'$',2)
  return expression
}

function wrapFilter(exp: string, filter: string): string {
  // 如果过滤器中有括号， 说明可能有参数
  const i = filter.indexOf('(')
  // 没有括号，则没有参数
  if (i < 0) {
    // 包裹为:_f("${filter}")(${exp}) wrapFilter("message", "uppercase") ===》  _f("uppercase")(message)
    // _f: resolveFilter
    return `_f("${filter}")(${exp})`
  } else {
    // 有参数的情况下
    // 左小括号前是过滤器名称
    const name = filter.slice(0, i)
    // 左小括号后面是参数+右小括号  例如  "currency('$', 2)" ===》 name = curency  args = " '$', 2, ) "
    const args = filter.slice(i + 1)
    // args !== ')' ? ',' + args : 这个三元表达式，如果args不是右括号,则前面加上逗号，args本身是有右括号的，所有就直接组成了函数
    // wrapFilter("price", "currency('$', 2)") ===> 输出: _f("currency")(price,'$',2)
    return `_f("${name}")(${exp}${args !== ')' ? ',' + args : args}`
  }
}
