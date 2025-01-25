import config from '../config'
import { initProxy } from './proxy'
import { initState } from './state'
import { initRender } from './render'
import { initEvents } from './events'
import { mark, measure } from '../util/perf'
import { initLifecycle, callHook } from './lifecycle'
import { initProvide, initInjections } from './inject'
import { extend, mergeOptions, formatComponentName } from '../util/index'
import type { Component } from 'types/component'
import type { InternalComponentOptions } from 'types/options'
import { EffectScope } from 'v3/reactivity/effectScope'

let uid = 0

export function initMixin(Vue: typeof Component) {
  // 添加初始化函数
  Vue.prototype._init = function (options?: Record<string, any>) {
    const vm: Component = this
    // a uid
    vm._uid = uid++

    let startTag, endTag
    /* istanbul ignore if */
    // 如果有性能监控则记录开始标签，记录监控信息
    if (__DEV__ && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`
      endTag = `vue-perf-end:${vm._uid}`
      mark(startTag)
    }

    // a flag to mark this as a Vue instance without having to do instanceof
    // check
    // vue实例本身不需要响应式，以及标记自己是vue实例
    vm._isVue = true
    // avoid instances from being observed
    vm.__v_skip = true
    // effect scope
    vm._scope = new EffectScope(true /* detached */)
    // #13134 edge case where a child component is manually created during the
    // render of a parent component
    vm._scope.parent = undefined
    vm._scope._vm = true
    // merge options
    // 如果是组件
    if (options && options._isComponent) {
      // optimize internal component instantiation
      // since dynamic options merging is pretty slow, and none of the
      // internal component options needs special treatment.
      initInternalComponent(vm, options as any)
    } else {
      vm.$options = mergeOptions(
        resolveConstructorOptions(vm.constructor as any),
        options || {},
        vm
      )
    }
    /* istanbul ignore else */
    if (__DEV__) {
      // 开发环境下代理,作用是添加警告:属性未定义或者使用了保留前缀
      initProxy(vm)
    } else {
      vm._renderProxy = vm
    }
    // expose real self
    vm._self = vm
    // 初始化生命周期
    // 建立父子节点之间的关系，初始化生命周期相关属性    
    initLifecycle(vm)
    // 初始化事件，统一事件错误处理，事件添加到实例的_events属性上
    initEvents(vm)
    // 把插槽放到$slots上，作用域插槽放到$scopedSlots上，挂在生成虚拟dom的方法，对vm的$attrs和$listeners添加响应式
    initRender(vm)
    // 调用beforeCreate生命周期，设置上下文
    callHook(vm, 'beforeCreate', undefined, false /* setContext */)
    // 计算注入的值，通过代理能够直接从实例上取到注入值
    initInjections(vm)
    // 依次初始化props、methods、data、computed、watch，将他们挂载到vm上， 属性重名判断也是按照这个顺序判断，props中的key最优先
    initState(vm)
    // 给当前实例添加_provide属性，并且当前实例的_provide属性指向父组件的_provide，使得后续组件都能使用祖先provide的值
    initProvide(vm)
    // 调用created生命周期
    callHook(vm, 'created')

    /* istanbul ignore if */
    // 如果有性能监控则记录开始标签，打印监控信息
    if (__DEV__ && config.performance && mark) {
      vm._name = formatComponentName(vm, false)
      mark(endTag)
      measure(`vue ${vm._name} init`, startTag, endTag)
    }
    // 如果存在el,执行挂载
    if (vm.$options.el) {
      vm.$mount(vm.$options.el)
    }
  }
}

// 初始化内部组件
export function initInternalComponent(
  vm: Component,
  options: InternalComponentOptions
) {
  // 根据Vue的构造函数作为原型创建对象
  // 在vue的iniGlobal过程中，Vue.options = Object.create(null)，因此Vue上具有Options
  // 在子组件中，extend过程中，穿件的Sub也有Sub.options = mergeOptions(Super.options, extendOptions)，因此子组件也能取到options
  const opts = (vm.$options = Object.create((vm.constructor as any).options))
  // doing this because it's faster than dynamic enumeration.
  const parentVnode = options._parentVnode
  // 当前节点建立和父节点的关系
  opts.parent = options.parent
  opts._parentVnode = parentVnode

  const vnodeComponentOptions = parentVnode.componentOptions!
  opts.propsData = vnodeComponentOptions.propsData
  // 父节点的listener是在createComponent的时候初始化的，取的是虚拟节点上的on，也就是父节点上绑定的函数，这个绑定的函数就是子节点需要触发的函数
  opts._parentListeners = vnodeComponentOptions.listeners
  opts._renderChildren = vnodeComponentOptions.children
  opts._componentTag = vnodeComponentOptions.tag

  if (options.render) {
    opts.render = options.render
    opts.staticRenderFns = options.staticRenderFns
  }
}

export function resolveConstructorOptions(Ctor: typeof Component) {
  let options = Ctor.options
  // 如果有父类
  if (Ctor.super) {
    // 递归父类的选项
    const superOptions = resolveConstructorOptions(Ctor.super)
    // 找到当前直接父类的选项
    const cachedSuperOptions = Ctor.superOptions
    if (superOptions !== cachedSuperOptions) {
      // 父类选项发生变化，更新缓存的父类选项,后面也要更新当前选项的options,因为子组件是使用父组件extend来的
      // super option changed,
      // need to resolve new options.
      Ctor.superOptions = superOptions
      // check if there are any late-modified/attached options (#4976)
      // 获取被修改的属性集合
      const modifiedOptions = resolveModifiedOptions(Ctor)
      // update base extend options
      if (modifiedOptions) {
        // 将修改的选项合并到 extendOptions
        extend(Ctor.extendOptions, modifiedOptions)
      }
      // 合并父类选项和扩展选项
      options = Ctor.options = mergeOptions(superOptions, Ctor.extendOptions)
      if (options.name) {
        // 如果有名字，将构造函数注册到组件集合中
        options.components[options.name] = Ctor
      }
    }
  }
  return options
}

function resolveModifiedOptions(
  Ctor: typeof Component
): Record<string, any> | null {
  let modified
  // 获取当前选项和密封起来的选项
  const latest = Ctor.options
  const sealed = Ctor.sealedOptions
  for (const key in latest) {
    // 遍历最新的选项,如果属性被修改过
    if (latest[key] !== sealed[key]) {
      if (!modified) modified = {}
      // 将修改过的属性存储到modified中
      modified[key] = latest[key]
    }
  }
  return modified
}
