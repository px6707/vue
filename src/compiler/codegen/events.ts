import { ASTElementHandler, ASTElementHandlers } from 'types/compiler'

const fnExpRE = /^([\w$_]+|\([^)]*?\))\s*=>|^function(?:\s+[\w$]+)?\s*\(/
const fnInvokeRE = /\([^)]*?\);*$/
const simplePathRE =
  /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\['[^']*?']|\["[^"]*?"]|\[\d+]|\[[A-Za-z_$][\w$]*])*$/

// KeyboardEvent.keyCode aliases
const keyCodes: { [key: string]: number | Array<number> } = {
  esc: 27,
  tab: 9,
  enter: 13,
  space: 32,
  up: 38,
  left: 37,
  right: 39,
  down: 40,
  delete: [8, 46]
}

// KeyboardEvent.key aliases
const keyNames: { [key: string]: string | Array<string> } = {
  // #7880: IE11 and Edge use `Esc` for Escape key name.
  esc: ['Esc', 'Escape'],
  tab: 'Tab',
  enter: 'Enter',
  // #9112: IE11 uses `Spacebar` for Space key name.
  space: [' ', 'Spacebar'],
  // #7806: IE11 uses key names without `Arrow` prefix for arrow keys.
  up: ['Up', 'ArrowUp'],
  left: ['Left', 'ArrowLeft'],
  right: ['Right', 'ArrowRight'],
  down: ['Down', 'ArrowDown'],
  // #9112: IE11 uses `Del` for Delete key name.
  delete: ['Backspace', 'Delete', 'Del']
}

// #4868: modifiers that prevent the execution of the listener
// need to explicitly return null so that we can determine whether to remove
// the listener for .once
const genGuard = condition => `if(${condition})return null;`

const modifierCode: { [key: string]: string } = {
  stop: '$event.stopPropagation();',
  prevent: '$event.preventDefault();',
  self: genGuard(`$event.target !== $event.currentTarget`),
  ctrl: genGuard(`!$event.ctrlKey`),
  shift: genGuard(`!$event.shiftKey`),
  alt: genGuard(`!$event.altKey`),
  meta: genGuard(`!$event.metaKey`),
  left: genGuard(`'button' in $event && $event.button !== 0`),
  middle: genGuard(`'button' in $event && $event.button !== 1`),
  right: genGuard(`'button' in $event && $event.button !== 2`)
}

export function genHandlers(
  events: ASTElementHandlers,
  isNative: boolean
): string {
  const prefix = isNative ? 'nativeOn:' : 'on:'
  let staticHandlers = ``
  let dynamicHandlers = ``
  for (const name in events) {
    // 生成事件调用函数
    const handlerCode = genHandler(events[name])
    //@ts-expect-error
    // 动态事件添加到动态事件字符串上，静态事件添加到静态事件字符串上
    if (events[name] && events[name].dynamic) {
      dynamicHandlers += `${name},${handlerCode},`
    } else {
      staticHandlers += `"${name}":${handlerCode},`
    }
  }
  // 静态事件变成对象
  staticHandlers = `{${staticHandlers.slice(0, -1)}}`
  if (dynamicHandlers) {
    // 动态事件
    // on:__d({}, ['function($event){xxxxxx}'])
    return prefix + `_d(${staticHandlers},[${dynamicHandlers.slice(0, -1)}])`
  } else {
    // on:{click:function($event){xxxxxx}}
    return prefix + staticHandlers
  }
}

function genHandler(
  handler: ASTElementHandler | Array<ASTElementHandler>
): string {
  if (!handler) {
    return 'function(){}'
  }

  if (Array.isArray(handler)) {
    return `[${handler.map(handler => genHandler(handler)).join(',')}]`
  }
  // 匹配方法路径 @click="handleClick"
  const isMethodPath = simplePathRE.test(handler.value)
  // 匹配函数表达式 <button @click="($event) => console.log($event)"
  const isFunctionExpression = fnExpRE.test(handler.value)
  // 匹配函数调用 <button @click="doSomething(arg1, arg2)">  <button @click="handleClick($event)">
  const isFunctionInvocation = simplePathRE.test(
    handler.value.replace(fnInvokeRE, '')
  )
  // 如果没有修饰符
  if (!handler.modifiers) {
    // 是方法路径或者函数表达式
    if (isMethodPath || isFunctionExpression) {
      // 返回函数体
      return handler.value
    }
    // 如果是函数调用，在外部封装一层函数，并将$event 作为参数， 这就是为什么@click="handleClick($event)" 可以使用$event
    return `function($event){${
      isFunctionInvocation ? `return ${handler.value}` : handler.value
    }}` // inline statement
  } else {
    // 如果有修饰符
    let code = ''
    let genModifierCode = ''
    const keys: string[] = []
    for (const key in handler.modifiers) {
      // 遍历修饰符
      // 如果是内置修饰符
      if (modifierCode[key]) {
        // stop: '$event.stopPropagation();'
        // genModifierCode = $event.stopPropagation();
        genModifierCode += modifierCode[key]
        // 如果是按键修饰符，加入到keys中
        // left/right
        if (keyCodes[key]) {
          keys.push(key)
        }
      } else if (key === 'exact') {
        // 如果可以是exact
        const modifiers = handler.modifiers
        // if($event.ctrlKey)return null;
        genModifierCode += genGuard(
          ['ctrl', 'shift', 'alt', 'meta']
            // 不在修饰符中
            .filter(keyModifier => !modifiers[keyModifier])
            // $event.ctrlKey
            .map(keyModifier => `$event.${keyModifier}Key`)
            .join('||')
        )
      } else {
        keys.push(key)
      }
    }
    if (keys.length) {
    //    code= if(!$event.type.indexOf('key')&&$event.keyCode!==13)return null;
      code += genKeyFilter(keys)
    }
    // Make sure modifiers like prevent and stop get executed after key filtering
    if (genModifierCode) {
      code += genModifierCode
    }
    const handlerCode = isMethodPath
      // return clickHandler.apply(null, arguments)
      ? `return ${handler.value}.apply(null, arguments)`
      : isFunctionExpression
      // return (($event) => console.log($event)).apply(null, arguments)
      ? `return (${handler.value}).apply(null, arguments)`
      : isFunctionInvocation
      // return handleClick($event)
      ? `return ${handler.value}`
      : handler.value
      // function ($event) {
      //   if (!$event.type.indexOf('key')&&$event.keyCode!==13)return null;
      //   return clickHandler.apply(null, arguments)
      // }
    return `function($event){${code}${handlerCode}}`
  }
}

function genKeyFilter(keys: Array<string>): string {
  return (
    // make sure the key filters only apply to KeyboardEvents
    // #9441: can't use 'keyCode' in $event because Chrome autofill fires fake
    // key events that do not have keyCode property...
    `if(!$event.type.indexOf('key')&&` +
    `${keys.map(genFilterCode).join('&&')})return null;`
  )
}

function genFilterCode(key: string): string {
  const keyVal = parseInt(key, 10)
  // 如果是数字键码
  if (keyVal) {
    return `$event.keyCode!==${keyVal}`
  }
  const keyCode = keyCodes[key]
  const keyName = keyNames[key]
  // <!-- 生成的过滤代码 -->
  // _k($event.keyCode, 
  //   "enter",           // 按键名
  //   13,                // enter 的键码
  //   $event.key,        // 实际按键的 key
  //   "Enter"            // enter 的标准键名
  // )
  return (
    `_k($event.keyCode,` +
    `${JSON.stringify(key)},` +
    `${JSON.stringify(keyCode)},` +
    `$event.key,` +
    `${JSON.stringify(keyName)}` +
    `)`
  )
}
