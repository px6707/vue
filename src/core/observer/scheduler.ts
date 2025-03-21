import type Watcher from './watcher'
import config from '../config'
import Dep, { cleanupDeps } from './dep'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import { warn, nextTick, devtools, inBrowser, isIE } from '../util/index'
import type { Component } from 'types/component'

export const MAX_UPDATE_COUNT = 100

const queue: Array<Watcher> = []
const activatedChildren: Array<Component> = []
let has: { [key: number]: true | undefined | null } = {}
let circular: { [key: number]: number } = {}
let waiting = false
let flushing = false
let index = 0

/**
 * Reset the scheduler's state.
 */
function resetSchedulerState() {
  index = queue.length = activatedChildren.length = 0
  has = {}
  if (__DEV__) {
    circular = {}
  }
  waiting = flushing = false
}

// Async edge case #6566 requires saving the timestamp when event listeners are
// attached. However, calling performance.now() has a perf overhead especially
// if the page has thousands of event listeners. Instead, we take a timestamp
// every time the scheduler flushes and use that for all event listeners
// attached during that flush.
export let currentFlushTimestamp = 0

// Async edge case fix requires storing an event listener's attach timestamp.
let getNow: () => number = Date.now

// Determine what event timestamp the browser is using. Annoyingly, the
// timestamp can either be hi-res (relative to page load) or low-res
// (relative to UNIX epoch), so in order to compare time we have to use the
// same timestamp type when saving the flush timestamp.
// All IE versions use low-res event timestamps, and have problematic clock
// implementations (#9632)
if (inBrowser && !isIE) {
  const performance = window.performance
  if (
    performance &&
    typeof performance.now === 'function' &&
    getNow() > document.createEvent('Event').timeStamp
  ) {
    // if the event timestamp, although evaluated AFTER the Date.now(), is
    // smaller than it, it means the event is using a hi-res timestamp,
    // and we need to use the hi-res version for event listener timestamps as
    // well.
    getNow = () => performance.now()
  }
}

const sortCompareFn = (a: Watcher, b: Watcher): number => {
  if (a.post) {
    if (!b.post) return 1
  } else if (b.post) {
    return -1
  }
  return a.id - b.id
}

/**
 * Flush both queues and run the watchers.
 */
function flushSchedulerQueue() {
  currentFlushTimestamp = getNow()
  flushing = true
  let watcher, id

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child)
  // 2. A component's user watchers are run before its render watcher (because
  //    user watchers are created before the render watcher)
  // 3. If a component is destroyed during a parent component's watcher run,
  //    its watchers can be skipped.
  // 排序队列
  // 1. 组件更新顺序：父组件先于子组件
  // 2. 用户 watcher 先于渲染 watcher
  // 3. 如果父组件在更新时销毁子组件，子组件的 watcher 可以被跳过
  queue.sort(sortCompareFn)

  // do not cache length because more watchers might be pushed
  // as we run existing watchers
  // 遍历队列，执行 watcher.run()
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index]
    if (watcher.before) {
      watcher.before()
    }
    id = watcher.id
    has[id] = null
    watcher.run()
    // in dev build, check and stop circular updates.
    if (__DEV__ && has[id] != null) {
      circular[id] = (circular[id] || 0) + 1
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' +
            (watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`),
          watcher.vm
        )
        break
      }
    }
  }

  // keep copies of post queues before resetting state
  const activatedQueue = activatedChildren.slice()
  const updatedQueue = queue.slice()
  // watcher全部执行完成后，重置状态
  resetSchedulerState()

  // call component updated and activated hooks
  // 处理 keep-alive 组件。当一个被 keep-alive 的组件在 patch 过程中被激活时，会调用其 activated 钩子函数。
  callActivatedHooks(activatedQueue)
  // 在组件更新完成后调用 updated 生命周期钩子
  callUpdatedHooks(updatedQueue)
  // 清理依赖收集。在一轮更新完成后，会清理掉不再需要的依赖关系，防止内存泄漏。
  cleanupDeps()

  // devtool hook
  /* istanbul ignore if */
  // 给 Vue DevTools 使用的钩子。当更新队列刷新完成时，会通知 DevTools，这样 DevTools 就能够追踪到组件的更新情况。
  if (devtools && config.devtools) {
    devtools.emit('flush')
  }
}

function callUpdatedHooks(queue: Watcher[]) {
  let i = queue.length
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    if (vm && vm._watcher === watcher && vm._isMounted && !vm._isDestroyed) {
      callHook(vm, 'updated')
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent(vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false
  activatedChildren.push(vm)
}

function callActivatedHooks(queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 */
export function queueWatcher(watcher: Watcher) {
  const id = watcher.id
  // 已经存在的 watcher 会被跳过
  if (has[id] != null) {
    return
  }

  if (watcher === Dep.target && watcher.noRecurse) {
    return
  }

  has[id] = true
  if (!flushing) {
    // 如果没有在刷新，直接入队
    queue.push(watcher)
  } else {
    // 如果正在刷新，需要按照 id 顺序插入到合适的位置
    // if already flushing, splice the watcher based on its id
    // if already past its id, it will be run next immediately.
    let i = queue.length - 1
    while (i > index && queue[i].id > watcher.id) {
      i--
    }
    queue.splice(i + 1, 0, watcher)
  }
  // queue the flush
  // 在waiting为true的情况下，只会把新加的 watcher 加入queue队列
  // 直到queue中的watcher执行完成后，waiting变成fasle
  // 才会在执行下一次flushSchedulerQueue来执行watcher的run
  if (!waiting) {
    waiting = true

    if (__DEV__ && !config.async) {
      flushSchedulerQueue()
      return
    }
    // 在下一个 tick 刷新队列
    // 将watcher.run() 也就是更新视图方法 放入微任务队列
    // 如果在代码中
    // this.message = 'hello'
    // this.$nextTick(() => {
    //   dom已经更新
    // })
    // 修改message的值，会让渲染watcher的更新放入队列
    // this.$nextTick 会把回调放在flushSchedulerQueue的后面
    // 保证了，先更新视图，再触发组件中的nextTick的回调
    nextTick(flushSchedulerQueue)
  }
}
