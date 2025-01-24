/* globals MutationObserver */

import { noop } from 'shared/util'
import { handleError } from './error'
import { isIE, isIOS, isNative } from './env'

export let isUsingMicroTask = false

const callbacks: Array<Function> = []
let pending = false

function flushCallbacks() {
  pending = false
  // 复制所有的callback
  const copies = callbacks.slice(0)
  // 清空callbacks
  callbacks.length = 0
  // 执行所有的callback
  for (let i = 0; i < copies.length; i++) {
    copies[i]()
  }
}

// Here we have async deferring wrappers using microtasks.
// In 2.5 we used (macro) tasks (in combination with microtasks).
// However, it has subtle problems when state is changed right before repaint
// (e.g. #6813, out-in transitions).
// Also, using (macro) tasks in event handler would cause some weird behaviors
// that cannot be circumvented (e.g. #7109, #7153, #7546, #7834, #8109).
// So we now use microtasks everywhere, again.
// A major drawback of this tradeoff is that there are some scenarios
// where microtasks have too high a priority and fire in between supposedly
// sequential events (e.g. #4521, #6690, which have workarounds)
// or even between bubbling of the same event (#6566).
let timerFunc

// The nextTick behavior leverages the microtask queue, which can be accessed
// via either native Promise.then or MutationObserver.
// MutationObserver has wider support, however it is seriously bugged in
// UIWebView in iOS >= 9.3.3 when triggered in touch event handlers. It
// completely stops working after triggering a few times... so, if native
// Promise is available, we will use it:
/* istanbul ignore next, $flow-disable-line */
// 优先使用微任务，保证尽快执行
// 没有微任务则降级处理 依次为Promise，MutationObserver，setImmediate，setTimeout

// setImmediate，setTimeout 的区别
// setTimeout 可能不准确
// setTimeout(() => console.log('delayed'), 0)  // 实际延迟可能 > 0ms
// setImmediate 不关心时间
// setImmediate(() => console.log('immediate'))  // 下一个迭代立即执行
// setImmediate 大多数浏览器都不支持


// 如果当前环境下存在Promise，并且是环境自带的
if (typeof Promise !== 'undefined' && isNative(Promise)) {
  // 使用微任务执行callback
  const p = Promise.resolve()
  timerFunc = () => {
    p.then(flushCallbacks)
    // In problematic UIWebViews, Promise.then doesn't completely break, but
    // it can get stuck in a weird state where callbacks are pushed into the
    // microtask queue but the queue isn't being flushed, until the browser
    // needs to do some other work, e.g. handle a timer. Therefore we can
    // "force" the microtask queue to be flushed by adding an empty timer.
    // IOS的特殊处理， 强制微任务队列执行
    if (isIOS) setTimeout(noop)
  }
  isUsingMicroTask = true
} else if (
  // 如果不是IE并且存在MutationObserver，并且是环境自带的
  !isIE &&
  typeof MutationObserver !== 'undefined' &&
  (isNative(MutationObserver) ||
    // PhantomJS and iOS 7.x
    MutationObserver.toString() === '[object MutationObserverConstructor]')
) {
  // Use MutationObserver where native Promise is not available,
  // e.g. PhantomJS, iOS7, Android 4.4
  // (#6466 MutationObserver is unreliable in IE11)
  let counter = 1
  const observer = new MutationObserver(flushCallbacks)
  const textNode = document.createTextNode(String(counter))
  // 监听textNode数据变化，数据有变化则执行flushCallbacks
  observer.observe(textNode, {
    characterData: true // 当为 true 时，监听声明的 target 节点上所有字符的变化。默认值为 true，如果声明了 characterDataOldValue，默认值则为 false
  })
  timerFunc = () => {
    // 为conter更新，触发MutationObserver 的监听，执行flushCallbacks
    counter = (counter + 1) % 2 // counter 0和1切换
    textNode.data = String(counter) // 更新textNode的数据
  }
  isUsingMicroTask = true
} else if (typeof setImmediate !== 'undefined' && isNative(setImmediate)) {
  // setImmediate 函数存在且是环境自带的，使用它。
  // Fallback to setImmediate.
  // Technically it leverages the (macro) task queue,
  // but it is still a better choice than setTimeout.
  timerFunc = () => {
    setImmediate(flushCallbacks)
  }
} else {
  // 最后使用setTimeout。
  // Fallback to setTimeout.
  timerFunc = () => {
    setTimeout(flushCallbacks, 0)
  }
}

export function nextTick(): Promise<void>
export function nextTick<T>(this: T, cb: (this: T, ...args: any[]) => any): void
export function nextTick<T>(cb: (this: T, ...args: any[]) => any, ctx: T): void
/**
 * @internal
 */
export function nextTick(cb?: (...args: any[]) => any, ctx?: object) {
  let _resolve
  // 下一帧需要执行的函数回调数组中添加新函数
  callbacks.push(() => {
    if (cb) {
      try {
        cb.call(ctx)
      } catch (e: any) {
        handleError(e, ctx, 'nextTick')
      }
    } else if (_resolve) {
      _resolve(ctx)
    }
  })
  // 如果任务队列没有被安排执行，安排一个微任务执行，设置有微任务执行的标记pending为true
  if (!pending) {
    pending = true
    // 在微任务队列还没有开始执行的时候，只需要把所有的回调放入callbacks中，等待微任务挨个执行他们
    // 如果现在没有微任务，那么就安排微任务在同步代码执行完毕后执行，这样在同步代码中，所有nextTick添加的回调都会在微任务执行之前被放入callbacks中，然后一起执行
    timerFunc()
  }
  // $flow-disable-line
  // 如果没有传入回调函数且Promise存在，返回一个Promise，并存储一个这个promise的resolve
  // 这样 在外面可以 const promise = nextTick() ,当下一帧执行完毕后，可以 promise.then(() => {})
  if (!cb && typeof Promise !== 'undefined') {
    return new Promise(resolve => {
      _resolve = resolve
    })
  }
}
