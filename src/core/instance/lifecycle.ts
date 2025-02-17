import config from '../config'
import Watcher, { WatcherOptions } from '../observer/watcher'
import { mark, measure } from '../util/perf'
import VNode, { createEmptyVNode } from '../vdom/vnode'
import { updateComponentListeners } from './events'
import { resolveSlots } from './render-helpers/resolve-slots'
import { toggleObserving } from '../observer/index'
import { pushTarget, popTarget } from '../observer/dep'
import type { Component } from 'types/component'
import type { MountedComponentVNode } from 'types/vnode'

import {
  warn,
  noop,
  remove,
  emptyObject,
  validateProp,
  invokeWithErrorHandling
} from '../util/index'
import { currentInstance, setCurrentInstance } from 'v3/currentInstance'
import { getCurrentScope } from 'v3/reactivity/effectScope'
import { syncSetupProxy } from 'v3/apiSetup'

export let activeInstance: any = null
export let isUpdatingChildComponent: boolean = false

export function setActiveInstance(vm: Component) {
  const prevActiveInstance = activeInstance
  activeInstance = vm
  return () => {
    activeInstance = prevActiveInstance
  }
}

export function initLifecycle(vm: Component) {
  // 获取vue实例上的选项
  const options = vm.$options

  // locate first non-abstract parent
  let parent = options.parent
  // 如果有父节点并且不是抽象节点
  if (parent && !options.abstract) {
    while (parent.$options.abstract && parent.$parent) {
      // 向上寻找第一个非抽象节点
      parent = parent.$parent
    }
    // 父节点建立和子节点的关系
    parent.$children.push(vm)
  }
  // 当前节点添加父节点\根节点关系
  vm.$parent = parent
  vm.$root = parent ? parent.$root : vm
  // 初始化当前vm的子节点为空
  vm.$children = []
  vm.$refs = {}
  // 继承父组件的 provide 数据，如果没有父组件则创建空对象，
  // 注意这个点，后面在初始化provide的时候，判断子组件的provide和父组件的provide是否相同，如果相同说明没有处理过
  vm._provided = parent ? parent._provided : Object.create(null)
  // 组件的主 watcher，用于响应式更新
  vm._watcher = null
  // keep-alive 相关的状态标志
   // 组件是否被缓存
  vm._inactive = null
  // 直接的不活跃状态
  vm._directInactive = false
  // 组件是否已经挂载
  vm._isMounted = false
  // 组件是否已经销毁
  vm._isDestroyed = false
  // 组件是否正在被销毁
  vm._isBeingDestroyed = false
}
// Vue类上挂载_update、$forceUpdate、$destroy方法
export function lifecycleMixin(Vue: typeof Component) {
  Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    const vm: Component = this
    const prevEl = vm.$el
    const prevVnode = vm._vnode
  // 标识当前正在更新的组件实例，在patch、create-compoonent时使用
    const restoreActiveInstance = setActiveInstance(vm)
    vm._vnode = vnode
    // Vue.prototype.__patch__ is injected in entry points
    // based on the rendering backend used.
    // 之前没有虚拟节点，说明是第一次渲染
    if (!prevVnode) {
      // initial render
      // 生成真实DOM节点,将当前组件的挂载节点赋值给$el
      vm.$el = vm.__patch__(vm.$el, vnode, hydrating, false /* removeOnly */)
    } else {
      // updates
      vm.$el = vm.__patch__(prevVnode, vnode)
    }
    restoreActiveInstance()
    // update __vue__ reference
    // 更新DOM元素和Vue实例之间的引用
    if (prevEl) {
      prevEl.__vue__ = null
    }
    if (vm.$el) {
      vm.$el.__vue__ = vm
    }
    // if parent is an HOC, update its $el as well
    // 在透明的高阶组件（高阶组件不渲染额外节点）的情况下，HOC没有额外的渲染内容，只是一个过渡的包装，为了保证HOC组件能够正确的访问实际DOM
    let wrapper: Component | undefined = vm
    while (
      wrapper &&
      wrapper.$vnode &&
      wrapper.$parent &&
      // _vnode 是当前组件的虚拟节点 $vnode 是当前组件在父组件中的虚拟节点
      //  通俗的说，_vode就是子组件的模版内容编译出的虚拟节点， $vode是父组件编译时的，子组件节点
      wrapper.$vnode === wrapper.$parent._vnode
    ) {
      wrapper.$parent.$el = wrapper.$el
      wrapper = wrapper.$parent
    }
    // updated hook is called by the scheduler to ensure that children are
    // updated in a parent's updated hook.
  }

  Vue.prototype.$forceUpdate = function () {
    const vm: Component = this
    if (vm._watcher) {
      vm._watcher.update()
    }
  }

  Vue.prototype.$destroy = function () {
    const vm: Component = this
    // 已经开始销毁
    if (vm._isBeingDestroyed) {
      return
    }
    // 调用beforeDestroy钩子
    callHook(vm, 'beforeDestroy')
    vm._isBeingDestroyed = true
    // remove self from parent
    const parent = vm.$parent
    if (parent && !parent._isBeingDestroyed && !vm.$options.abstract) {
      // 从父组件中移除
      remove(parent.$children, vm)
    }
    // teardown scope. this includes both the render watcher and other
    // watchers created
    vm._scope.stop()
    // remove reference from data ob
    // frozen object may not have observer.
//     vmCount 记录了有多少个组件实例在使用这个响应式数据
// 当组件销毁时，需要减少计数，表示少了一个使用者
// 这是为了内存管理，当 vmCount 为 0 时，表示没有组件在使用这个响应式数据了
    if (vm._data.__ob__) {
      vm._data.__ob__.vmCount--
    }
    // call the last hook...
    vm._isDestroyed = true
    // invoke destroy hooks on current rendered tree
    // 新的vnode为null， 用来更新销毁后的视图
    vm.__patch__(vm._vnode, null)
    // 调用destroyed钩子
    // fire destroyed hook
    callHook(vm, 'destroyed')
    // turn off all instance listeners.
    vm.$off()
    // remove __vue__ reference
    // 当前节点和DOM、父节点的关系断开
    if (vm.$el) {
      vm.$el.__vue__ = null
    }
    // release circular reference (#6759)
    if (vm.$vnode) {
      vm.$vnode.parent = null
    }
  }
}

/**
 * 
 * @param vm vue实例
 * @param el 挂载节点
 * @param hydrating 是否开启水合
 * @returns 返回挂载后的实例
 */
export function mountComponent(
  vm: Component,
  el: Element | null | undefined,
  hydrating?: boolean
): Component {
  vm.$el = el
  // 如果不存在render函数
  if (!vm.$options.render) {
    // 给一个创建空VNode的函数作为render函数
    // @ts-expect-error invalid type
    vm.$options.render = createEmptyVNode
    // 如果是开发模式则报错
    if (__DEV__) {
      // 检查如果
      // 1. 有模版且模版不是传入的选择器，类似#app， 而是template: '<div>hello</div>' 
      // 2. 或者options上有el属性
      // 3. 或者mount(el) el有值
      // 则说明template需要编译，而没有render函数的话需要报错
      /* istanbul ignore if */
      if (
        (vm.$options.template && vm.$options.template.charAt(0) !== '#') ||
        vm.$options.el ||
        el
      ) {
        warn(
          'You are using the runtime-only build of Vue where the template ' +
            'compiler is not available. Either pre-compile the templates into ' +
            'render functions, or use the compiler-included build.',
          vm
        )
      } else {
        warn(
          'Failed to mount component: template or render function not defined.',
          vm
        )
      }
    }
  }
  // 调用beforeMount Hook
  callHook(vm, 'beforeMount')

  let updateComponent
  // 如果在开发模式下开启了性能检测
  /* istanbul ignore if */
  if (__DEV__ && config.performance && mark) {
    updateComponent = () => {
      const name = vm._name
      const id = vm._uid
      const startTag = `vue-perf-start:${id}`
      const endTag = `vue-perf-end:${id}`
      // 添加一个开始标记
      mark(startTag)
      // 执行render函数，生成虚拟dom
      const vnode = vm._render()
      //  添加一个结束标记
      mark(endTag)
      // 记录渲染时间
      measure(`vue ${name} render`, startTag, endTag)
      
      // 添加一个开始标记
      mark(startTag)
      // 虚拟dom转为真实dom
      vm._update(vnode, hydrating)
      //  添加一个结束标记
      mark(endTag)
      // 记录渲染时间
      measure(`vue ${name} patch`, startTag, endTag)
    }
  } else {
    // 不开启性能检测时先执行render函数，生成虚拟dom，然后执行update生成真实dom就可以了
    updateComponent = () => {
      vm._update(vm._render(), hydrating)
    }
  }
  // 添加before函数，执行时，如果已经挂载并且未销毁则调用beforeUpdate函数
  const watcherOptions: WatcherOptions = {
    before() {
      if (vm._isMounted && !vm._isDestroyed) {
        callHook(vm, 'beforeUpdate')
      }
    }
  }
  // 开发模式下添加2个调试函数
  if (__DEV__) {
    watcherOptions.onTrack = e => callHook(vm, 'renderTracked', [e])
    watcherOptions.onTrigger = e => callHook(vm, 'renderTriggered', [e])
  }

  // 创建一个Watcher，用来渲染调用mount的vue
  // 一般这个vue实例是new Vue 出来的最外层的vue实例
  // new Watcher会触发一次updateComponent，来更新视图
  // we set this to vm._watcher inside the watcher's constructor
  // since the watcher's initial patch may call $forceUpdate (e.g. inside child
  // component's mounted hook), which relies on vm._watcher being already defined
  new Watcher(
    // 当前vue实例
    vm,
    // 更新函数
    updateComponent,
    // 空函数作为回调函数
    noop,
    // watcher选项
    watcherOptions,
    true /* isRenderWatcher */
  )
  // 执行更新函数后水合关闭
  hydrating = false
  // 兼容vue3 中setup中的watcher 
  // 在 src\v3\apiWatch.ts
  // 中如果 watch的options中flush为pre则保证该watcher在挂载前执行
  // flush buffer for flush: "pre" watchers queued in setup()
  const preWatchers = vm._preWatchers
  if (preWatchers) {
    for (let i = 0; i < preWatchers.length; i++) {
      preWatchers[i].run()
    }
  }
  // 判断$vnode是否为空，如果为空，则说明是根组件，它的mounted钩子直接触发
  // 如果不为空，说明是子组件，它的mounted钩子需要等待父组件的render函数触发子组件的创建，子组件创建过程中会调用自己的挂载逻辑触发mounted钩子
  // manually mounted instance, call mounted on self
  // mounted is called for render-created child components in its inserted hook
  if (vm.$vnode == null) {
    vm._isMounted = true
    callHook(vm, 'mounted')
  }
  return vm
}

export function updateChildComponent(
  vm: Component,
  propsData: Record<string, any> | null | undefined,
  listeners: Record<string, Function | Array<Function>> | undefined,
  parentVnode: MountedComponentVNode,
  renderChildren?: Array<VNode> | null
) {
  if (__DEV__) {
    isUpdatingChildComponent = true
  }

  // determine whether component has slot children
  // we need to do this before overwriting $options._renderChildren.

  // check if there are dynamic scopedSlots (hand-written or compiled but with
  // dynamic slot names). Static scoped slots compiled from template has the
  // "$stable" marker.
  const newScopedSlots = parentVnode.data.scopedSlots
  const oldScopedSlots = vm.$scopedSlots
  const hasDynamicScopedSlot = !!(
    (newScopedSlots && !newScopedSlots.$stable) ||
    (oldScopedSlots !== emptyObject && !oldScopedSlots.$stable) ||
    (newScopedSlots && vm.$scopedSlots.$key !== newScopedSlots.$key) ||
    (!newScopedSlots && vm.$scopedSlots.$key)
  )

  // Any static slot children from the parent may have changed during parent's
  // update. Dynamic scoped slots may also have changed. In such cases, a forced
  // update is necessary to ensure correctness.
  let needsForceUpdate = !!(
    renderChildren || // has new static slots
    vm.$options._renderChildren || // has old static slots
    hasDynamicScopedSlot
  )

  const prevVNode = vm.$vnode
  vm.$options._parentVnode = parentVnode
  vm.$vnode = parentVnode // update vm's placeholder node without re-render

  if (vm._vnode) {
    // update child tree's parent
    vm._vnode.parent = parentVnode
  }
  vm.$options._renderChildren = renderChildren

  // update $attrs and $listeners hash
  // these are also reactive so they may trigger child update if the child
  // used them during render
  const attrs = parentVnode.data.attrs || emptyObject
  if (vm._attrsProxy) {
    // force update if attrs are accessed and has changed since it may be
    // passed to a child component.
    if (
      syncSetupProxy(
        vm._attrsProxy,
        attrs,
        (prevVNode.data && prevVNode.data.attrs) || emptyObject,
        vm,
        '$attrs'
      )
    ) {
      needsForceUpdate = true
    }
  }
  vm.$attrs = attrs

  // update listeners
  listeners = listeners || emptyObject
  const prevListeners = vm.$options._parentListeners
  if (vm._listenersProxy) {
    syncSetupProxy(
      vm._listenersProxy,
      listeners,
      prevListeners || emptyObject,
      vm,
      '$listeners'
    )
  }
  vm.$listeners = vm.$options._parentListeners = listeners
  updateComponentListeners(vm, listeners, prevListeners)

  // update props
  if (propsData && vm.$options.props) {
    toggleObserving(false)
    const props = vm._props
    const propKeys = vm.$options._propKeys || []
    for (let i = 0; i < propKeys.length; i++) {
      const key = propKeys[i]
      const propOptions: any = vm.$options.props // wtf flow?
      props[key] = validateProp(key, propOptions, propsData, vm)
    }
    toggleObserving(true)
    // keep a copy of raw propsData
    vm.$options.propsData = propsData
  }

  // resolve slots + force update if has children
  if (needsForceUpdate) {
    vm.$slots = resolveSlots(renderChildren, parentVnode.context)
    vm.$forceUpdate()
  }

  if (__DEV__) {
    isUpdatingChildComponent = false
  }
}

function isInInactiveTree(vm) {
  while (vm && (vm = vm.$parent)) {
    if (vm._inactive) return true
  }
  return false
}

export function activateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = false
    if (isInInactiveTree(vm)) {
      return
    }
  } else if (vm._directInactive) {
    return
  }
  if (vm._inactive || vm._inactive === null) {
    vm._inactive = false
    for (let i = 0; i < vm.$children.length; i++) {
      activateChildComponent(vm.$children[i])
    }
    callHook(vm, 'activated')
  }
}

export function deactivateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = true
    if (isInInactiveTree(vm)) {
      return
    }
  }
  if (!vm._inactive) {
    vm._inactive = true
    for (let i = 0; i < vm.$children.length; i++) {
      deactivateChildComponent(vm.$children[i])
    }
    callHook(vm, 'deactivated')
  }
}

export function callHook(
  vm: Component,
  hook: string,
  args?: any[],
  setContext = true
) {
  // #7573 disable dep collection when invoking lifecycle hooks
  pushTarget()
  const prevInst = currentInstance
  const prevScope = getCurrentScope()
  setContext && setCurrentInstance(vm)
  const handlers = vm.$options[hook]
  const info = `${hook} hook`
  if (handlers) {
    for (let i = 0, j = handlers.length; i < j; i++) {
      invokeWithErrorHandling(handlers[i], vm, args || null, vm, info)
    }
  }
  if (vm._hasHookEvent) {
    vm.$emit('hook:' + hook)
  }
  if (setContext) {
    setCurrentInstance(prevInst)
    prevScope && prevScope.on()
  }

  popTarget()
}
