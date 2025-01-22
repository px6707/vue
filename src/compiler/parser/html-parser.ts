/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson (MPL-1.1 OR Apache-2.0 OR GPL-2.0-or-later)
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

import { makeMap, no } from 'shared/util'
import { isNonPhrasingTag } from 'web/compiler/util'
import { unicodeRegExp } from 'core/util/lang'
import { ASTAttr, CompilerOptions } from 'types/compiler'

// Regular Expressions for parsing tags and attributes
const attribute =
  /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
const dynamicArgAttribute =
  /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+?\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`
const qnameCapture = `((?:${ncname}\\:)?${ncname})`
// 开始标签的正则
const startTagOpen = new RegExp(`^<${qnameCapture}`)
// 匹配标签的结束 >， 并且是以结束符开始
const startTagClose = /^\s*(\/?)>/
// 结束标签的正则
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`)
// 如果是<!DOCTYPE
const doctype = /^<!DOCTYPE [^>]+>/i
// #7298: escape - to avoid being passed as HTML comment when inlined in page
// 匹配<!-- 说明是注释
const comment = /^<!\--/
// 如果<![开头的条件注释 
const conditionalComment = /^<!\[/

// Special Elements (can contain anything)
// 是否是纯文本元素 内部包含任何内容，不会解析为html元素
export const isPlainTextElement = makeMap('script,style,textarea', true)
const reCache = {}

const decodingMap = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&#10;': '\n',
  '&#9;': '\t',
  '&#39;': "'"
}
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g
// 多匹配了换行和制表符
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g

// #5992
const isIgnoreNewlineTag = makeMap('pre,textarea', true)
const shouldIgnoreFirstNewline = (tag, html) =>
  tag && isIgnoreNewlineTag(tag) && html[0] === '\n'

function decodeAttr(value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr
  // 对属性中的特殊符号进行解码 把 '&lt;'替换成 '<' 等待
  return value.replace(re, match => decodingMap[match])
}

export interface HTMLParserOptions extends CompilerOptions {
  start?: (
    tag: string,
    attrs: ASTAttr[],
    unary: boolean,
    start: number,
    end: number
  ) => void
  end?: (tag: string, start: number, end: number) => void
  chars?: (text: string, start?: number, end?: number) => void
  comment?: (content: string, start: number, end: number) => void
}

export function parseHTML(html, options: HTMLParserOptions) {
  const stack: any[] = []
  const expectHTML = options.expectHTML
  // 是否是自闭合标签
  const isUnaryTag = options.isUnaryTag || no
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no
  let index = 0
  let last, lastTag
  while (html) {
    last = html
    // Make sure we're not in a plaintext content element like script/style
    // 如果没有上一个标签，或者不是script、textarea、style之一
    if (!lastTag || !isPlainTextElement(lastTag)) {
      // 查找左尖括号
      let textEnd = html.indexOf('<')
      // 如果当前第一个字符是左尖括号
      if (textEnd === 0) {
        // Comment:
        // 如果是注释
        if (comment.test(html)) {
          // 找到注释结束标签
          const commentEnd = html.indexOf('-->')
          // 如果有结束标签
          if (commentEnd >= 0) {
            // 如果要求保留注释，调用注释回调
            if (options.shouldKeepComment && options.comment) {
              options.comment(
                // 去除 <!-- 占据的前4个字符，从第5个字符截取到注释
                html.substring(4, commentEnd),
                // 注释开始位置
                index,
                // 注释结束位置
                index + commentEnd + 3
              )
            }
            // index移动到评论结束位置，template从评论结束位置开始
            advance(commentEnd + 3)
            continue
          }
        }

        // https://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        // 如果是条件注释
        if (conditionalComment.test(html)) {
          const conditionalEnd = html.indexOf(']>')
          // 能够查到条件注释的结尾
          if (conditionalEnd >= 0) {
            // 直接跳过
            advance(conditionalEnd + 2)
            continue
          }
        }

        // Doctype:
        // 如果是文档类型
        const doctypeMatch = html.match(doctype)
        if (doctypeMatch) {
          // 直接跳过
          advance(doctypeMatch[0].length)
          continue
        }

        // End tag:
        const endTagMatch = html.match(endTag)
        // 如果当前以<开头的template匹配到了结束标签 说明是以结束标签开头 </div>
        if (endTagMatch) {
          const curIndex = index
          // 移动到结束标签结束位置
          advance(endTagMatch[0].length)
          // 处理结束标签
          parseEndTag(endTagMatch[1], curIndex, index)
          continue
        }

        // Start tag:
        // 解析开始标签
        const startTagMatch = parseStartTag()
        if (startTagMatch) {
          // 处理开始标签
          handleStartTag(startTagMatch)
          // 如果是pre、textarea，并行第一个字符是换行，直接略过
          if (shouldIgnoreFirstNewline(startTagMatch.tagName, html)) {
            advance(1)
          }
          continue
        }
      }

      let text, rest, next
      // 之后的模版中还存在左尖括号
      if (textEnd >= 0) {
        // 截取< 后面的内容
        rest = html.slice(textEnd)
        // 如果之后的内容 找不到 结束标签、开始标签、注释、条件注释
        // 那么就是纯文本
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          next = rest.indexOf('<', 1)
          if (next < 0) break
          // 更新文本结束位置
          textEnd += next
          // 更新剩余内容
          rest = html.slice(textEnd)
        }
        // 获取这段文本
        text = html.substring(0, textEnd)
      }
      // 找不到左尖括号了，说明剩余都是纯文本
      if (textEnd < 0) {
        text = html
      }

      if (text) {
        // 跳到纯文本后面
        advance(text.length)
      }
      // 处理文本节点
      if (options.chars && text) {
        options.chars(text, index - text.length, index)
      }
    } else {
      // 如果上一个标签是script、textarea、style之一
      let endTagLength = 0
      const stackedTag = lastTag.toLowerCase()
      // 匹配标签内容和结束标签 
      const reStackedTag =
        reCache[stackedTag] ||
        (reCache[stackedTag] = new RegExp(
          '([\\s\\S]*?)(</' + stackedTag + '[^>]*>)',
          'i'
        ))
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length
        // 如果不是 script/style/textarea noscript
        if (!isPlainTextElement(stackedTag) && stackedTag !== 'noscript') {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, '$1') // #7298 去掉注释标记，只保留注释内容
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1') // 去掉 <![CDATA[ ]]> 只保留内容
        }
        // 如果需要忽略第一个换行
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1)
        }
        if (options.chars) {
          // 处理文本节点
          options.chars(text)
        }
        return ''
      })
      index += html.length - rest.length
      html = rest
      parseEndTag(stackedTag, index - endTagLength, index)
    }
    // 如果 html 和 last 一样， 说明它没有经过上面的一系列处理 那么尝试使用纯文本处理
    if (html === last) {
      options.chars && options.chars(html)
      if (__DEV__ && !stack.length && options.warn) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`, {
          start: index + html.length
        })
      }
      break
    }
  }

  // Clean up any remaining tags
  // 如果栈里有留存的未闭合标签，尝试关闭
  parseEndTag()

  function advance(n) {
    // 当前索引+n，截取后面的字符串
    index += n
    html = html.substring(n)
  }

  function parseStartTag() {
    const start = html.match(startTagOpen)
    // 如果是开始标签
    if (start) {
      const match: any = {
        tagName: start[1],
        attrs: [],
        start: index
      }
      // 跳到开始标签的后面
      advance(start[0].length)
      let end, attr
      // 如果不是以结束符开始，即未到达开始标签的结束 并且 存在属性， 则把属性添加到match，并移动index
      while (
        !(end = html.match(startTagClose)) &&
        (attr = html.match(dynamicArgAttribute) || html.match(attribute))
      ) {
        // 把属性放到attr中，并且移动到属性的结束位置
        attr.start = index
        advance(attr[0].length)
        attr.end = index
        match.attrs.push(attr)
      }
      // 如果已经到了开始标签的结束符，移动到结束符的位置， 并返回
      if (end) {
        // 自闭合标记 / 或 空字符串
        match.unarySlash = end[1]
        advance(end[0].length)
        match.end = index
        return match
      }
    }
  }

  function handleStartTag(match) {
    const tagName = match.tagName
    const unarySlash = match.unarySlash

    if (expectHTML) {
      // 如果上一个标签是 p，且当前标签不能放在 p 标签内
      if (lastTag === 'p' && isNonPhrasingTag(tagName)) {
        // 自动关闭 p 标签
        parseEndTag(lastTag)
      }
      // 如果当前标签可以自动关闭，且与上一个标签相同
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        // 关闭上一个相同标签
        parseEndTag(tagName)
      }
    }
    // 判断是否是自闭合标签
    const unary = isUnaryTag(tagName) || !!unarySlash

    const l = match.attrs.length
    const attrs: ASTAttr[] = new Array(l)
    for (let i = 0; i < l; i++) {
      // 注意这里的args是match的结果
      const args = match.attrs[i]
      const value = args[3] || args[4] || args[5] || ''
      // 特殊处理 a 标签的 href 属性
      const shouldDecodeNewlines =
        tagName === 'a' && args[1] === 'href'
          ? options.shouldDecodeNewlinesForHref
          : options.shouldDecodeNewlines
      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines)
      }
      if (__DEV__ && options.outputSourceRange) {
        attrs[i].start = args.start + args[0].match(/^\s*/).length
        attrs[i].end = args.end
      }
    }

    if (!unary) {
      // 不是自闭合标签
      // 把当前标签添加到标签栈，作为父节点
      stack.push({
        tag: tagName,
        lowerCasedTag: tagName.toLowerCase(),
        attrs: attrs,
        start: match.start,
        end: match.end
      })
      lastTag = tagName
    }

    if (options.start) {
      // 处理开始标签
      options.start(tagName, attrs, unary, match.start, match.end)
    }
  }
  // 处理结束标签
  function parseEndTag(tagName?: any, start?: any, end?: any) {
    let pos, lowerCasedTagName
    if (start == null) start = index
    if (end == null) end = index

    // Find the closest opened tag of the same type
    // 如果有标签名
    if (tagName) {
      lowerCasedTagName = tagName.toLowerCase()
      // 从stack中向前找， 一直找到tagName一样的标签
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break
        }
      }
    } else {
      // If no tag name is provided, clean shop
      pos = 0
    }
    // 如果找到了
    if (pos >= 0) {
      // Close all the open elements, up the stack
      for (let i = stack.length - 1; i >= pos; i--) {
        // 如果找到的开始标签不是最后一个，说明有未闭合的标签，警告
        if (__DEV__ && (i > pos || !tagName) && options.warn) {
          options.warn(`tag <${stack[i].tag}> has no matching end tag.`, {
            start: stack[i].start,
            end: stack[i].end
          })
        }
        if (options.end) {
          options.end(stack[i].tag, start, end)
        }
      }

      // Remove the open elements from the stack
      // 更新标签栈，获取最新的上一个标签
      stack.length = pos
      lastTag = pos && stack[pos - 1].tag
    } else if (lowerCasedTagName === 'br') {
      // 如果标签名是br， 则它是自闭合标签，按照开始标签处理
      if (options.start) {
        options.start(tagName, [], true, start, end)
      }
    } else if (lowerCasedTagName === 'p') {
      // 遇到p标签的结束符</p> 且没有开始的p标签，则保持和浏览器相同的行为，自动给它加上开始标签，保持内容为空
      // 如果标签是p，且没有开始标签，则创建一个开始标签
      if (options.start) {
        options.start(tagName, [], false, start, end)
      }
      // 然后立即闭合这个p标签
      if (options.end) {
        options.end(tagName, start, end)
      }
    }
  }
}
