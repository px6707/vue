import config from '../config'
import Watcher from '../observer/watcher'
import Dep, { pushTarget, popTarget } from '../observer/dep'
import { isUpdatingChildComponent } from './lifecycle'
import { initSetup } from 'v3/apiSetup'

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving
} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  isArray,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute,
  invokeWithErrorHandling,
  isFunction
} from '../util/index'
import type { Component } from 'types/component'
import { shallowReactive, TrackOpTypes } from 'v3'

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}

export function proxy(target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter() {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter(val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

export function initState(vm: Component) {
  const opts = vm.$options
  // 初始化props
  if (opts.props) initProps(vm, opts.props)

  // Composition API
  // 兼容v3 的setup
  initSetup(vm)
  // 初始化methods
  if (opts.methods) initMethods(vm, opts.methods)
  if (opts.data) {
    // 初始化数据
    initData(vm)
  } else {
    // 没有数据添加默认的响应式空对象作为data
    const ob = observe((vm._data = {}))
    ob && ob.vmCount++
  }
  // 初始化computed计算属性
  if (opts.computed) initComputed(vm, opts.computed)
    // 初始化watch
  if (opts.watch && opts.watch !== nativeWatch) {
    // options 上有watch没并且watch不是原型链上的watch
    initWatch(vm, opts.watch)
  }
}

function initProps(vm: Component, propsOptions: Object) {
   // 获取传入的props数据
  const propsData = vm.$options.propsData || {}
  // 创建浅响应式对象存储props
  const props = (vm._props = shallowReactive({}))
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
   // 缓存prop的键名
  const keys: string[] = (vm.$options._propKeys = [])
  const isRoot = !vm.$parent
  // root instance props should be converted
  if (!isRoot) {
    // 非根实例时暂时关闭观察者
    toggleObserving(false)
  }
  for (const key in propsOptions) {
    // 收集prop键名
    keys.push(key)
    // 验证并获取prop值
    const value = validateProp(key, propsOptions, propsData, vm)
    /* istanbul ignore else */
    if (__DEV__) {
      const hyphenatedKey = hyphenate(key)
      // 检查是否是保留属性
      if (
        isReservedAttribute(hyphenatedKey) ||
        config.isReservedAttr(hyphenatedKey)
      ) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      // 设置响应式：// 开发环境下，直接修改prop时发出警告
      defineReactive(
        props,
        key,
        value,
        () => {
          if (!isRoot && !isUpdatingChildComponent) {
            warn(
              `Avoid mutating a prop directly since the value will be ` +
                `overwritten whenever the parent component re-renders. ` +
                `Instead, use a data or computed property based on the prop's ` +
                `value. Prop being mutated: "${key}"`,
              vm
            )
          }
        },
        true /* shallow */
      )
    } else {
      defineReactive(props, key, value, undefined, true /* shallow */)
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      // 代理到vm实例上，可以直接通过vm.propName访问
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}

function initData(vm: Component) {
  // 获取数据
  let data: any = vm.$options.data
  // data是函数就获取data,否则直接使用data
  data = vm._data = isFunction(data) ? getData(data, vm) : data || {}
  // data不是对象,报错
  if (!isPlainObject(data)) {
    data = {}
    __DEV__ &&
      warn(
        'data functions should return an object:\n' +
          'https://v2.vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
        vm
      )
  }
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    // data遍历
    const key = keys[i]
    if (__DEV__) {
      // 同名函数,报错
      if (methods && hasOwn(methods, key)) {
        warn(`Method "${key}" has already been defined as a data property.`, vm)
      }
    }
    // 同名props,警告
    if (props && hasOwn(props, key)) {
      __DEV__ &&
        warn(
          `The data property "${key}" is already declared as a prop. ` +
            `Use prop default value instead.`,
          vm
        )
    } else if (!isReserved(key)) {
      // 不是vue内部保留字,代理到vm实例上
      proxy(vm, `_data`, key)
    }
  }
  // observe data
  const ob = observe(data)
  ob && ob.vmCount++
}

export function getData(data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  // 初始化获取数据的时候不要触发视图更新
  pushTarget()
  try {
    return data.call(vm, vm)
  } catch (e: any) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}

const computedWatcherOptions = { lazy: true }

function initComputed(vm: Component, computed: Object) {
  // $flow-disable-line
  const watchers = (vm._computedWatchers = Object.create(null))
  // computed properties are just getters during SSR
  const isSSR = isServerRendering()
  // 遍历computed
  for (const key in computed) {
    const userDef = computed[key]
    // 计算属性是函数,get就是他自己,否则使用对象上的get属性
    const getter = isFunction(userDef) ? userDef : userDef.get
    if (__DEV__ && getter == null) {
      // 找不到get报错
      warn(`Getter is missing for computed property "${key}".`, vm)
    }

    if (!isSSR) {
      // create internal watcher for the computed property.
      // 计算属性是使用watcher来创建的,计算属性挂载到实例上的_computedWatchers属性上
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        computedWatcherOptions
      )
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.
    if (!(key in vm)) {
      defineComputed(vm, key, userDef)
    } else if (__DEV__) {
      // 如果计算属性在vm实例上,判断多种冲突情况
      // 与data重名
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        // 与props重名
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      } else if (vm.$options.methods && key in vm.$options.methods) {
        // 与methods重名
        warn(
          `The computed property "${key}" is already defined as a method.`,
          vm
        )
      }
    }
  }
}

export function defineComputed(
  target: any,
  key: string,
  userDef: Record<string, any> | (() => any)
) {
  const shouldCache = !isServerRendering()
  if (isFunction(userDef)) {
    // 计算属性是函数
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)

      // 服务端渲染，直接执行这个函数
      : createGetterInvoker(userDef)
    sharedPropertyDefinition.set = noop
  } else {
    // 如果计算属性是对象，则使用对象的get作为计算函数
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : createGetterInvoker(userDef.get)
      : noop
    sharedPropertyDefinition.set = userDef.set || noop
  }
  if (__DEV__ && sharedPropertyDefinition.set === noop) {
    // 计算属性赋值，会报错
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
  // 使用defineProperty定义计算属性的get/set，监听他们
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

function createComputedGetter(key) {
  return function computedGetter() {
    const watcher = this._computedWatchers && this._computedWatchers[key]
    // 获取计算属性的watcher
    if (watcher) {
      // 如果是脏的（dirty），需要重新计算
      if (watcher.dirty) {
        // 属性计算，在计算的时候会访问数据，从而导致访问的响应式对象的get被执行，get被执行的之后，就会为dep添加当前计算属性watcher的依赖
        watcher.evaluate()
      }
      if (Dep.target) {
        // 开发模式下,watcher的debug函数依赖追踪
        if (__DEV__ && Dep.target.onTrack) {
          Dep.target.onTrack({
            effect: Dep.target,
            target: this,
            type: TrackOpTypes.GET,
            key
          })
        }
        // 依赖收集
        watcher.depend()
      }
      // 返回计算的结果
      return watcher.value
    }
  }
}

function createGetterInvoker(fn) {
  return function computedGetter() {
    return fn.call(this, this)
  }
}

function initMethods(vm: Component, methods: Object) {
  // 获取props
  const props = vm.$options.props
  for (const key in methods) {
    // 遍历函数
    if (__DEV__) {
      if (typeof methods[key] !== 'function') {
        // 如果部署函数，警告
        warn(
          `Method "${key}" has type "${typeof methods[
            key
          ]}" in the component definition. ` +
            `Did you reference the function correctly?`,
          vm
        )
      }
      // 如果props 和methond名字相同，警告
      if (props && hasOwn(props, key)) {
        warn(`Method "${key}" has already been defined as a prop.`, vm)
      }
      // 函数名字不能和Vue内置方法、组件的方法名相同
      if (key in vm && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
            `Avoid defining component methods that start with _ or $.`
        )
      }
    }
    // 函数绑定到vue实例上，this指向当前实例
    vm[key] = typeof methods[key] !== 'function' ? noop : bind(methods[key], vm)
  }
}

function initWatch(vm: Component, watch: Object) {
  // 遍历watch
  for (const key in watch) {
    // 获取watch选项
    const handler = watch[key]
    // 如果回调选项是数组，每个选项都创建一个watcher
    if (isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
      createWatcher(vm, key, handler)
    }
  }
}

function createWatcher(
  vm: Component,
  expOrFn: string | (() => any),
  handler: any,
  options?: Object
) {
  // 如果watch是对象写法
  // watch:{
  //   age: {
  //     handler(newVal, oldVal) { /* ... */ },
  //     deep: true,
  //     immediate: true
  //   },
  // }
  if (isPlainObject(handler)) {
    // 获取对象上的函数和其他选项
    options = handler
    handler = handler.handler
  }
  if (typeof handler === 'string') {
    // 如果watch是字符串写法，从实例上获取绑定的函数
    // nickname: 'handleNicknameChange',
    handler = vm[handler]
  }
  // 使用$watch 函数创建watcher
  return vm.$watch(expOrFn, handler, options)
}

export function stateMixin(Vue: typeof Component) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef: any = {}
  dataDef.get = function () {
    return this._data
  }
  const propsDef: any = {}
  propsDef.get = function () {
    return this._props
  }
  if (__DEV__) {
    dataDef.set = function () {
      warn(
        'Avoid replacing instance root $data. ' +
          'Use nested data properties instead.',
        this
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  Object.defineProperty(Vue.prototype, '$data', dataDef)
  Object.defineProperty(Vue.prototype, '$props', propsDef)

  Vue.prototype.$set = set
  Vue.prototype.$delete = del

  // Vue原型上添加$watch函数
  Vue.prototype.$watch = function (
    expOrFn: string | (() => any),
    cb: any,
    options?: Record<string, any>
  ): Function {
    const vm: Component = this
    // 如果回调是对象
    if (isPlainObject(cb)) {
      return createWatcher(vm, expOrFn, cb, options)
    }
    options = options || {}
    // 标记是用户创建的Watcher
    options.user = true
    // 创建Watcher
    const watcher = new Watcher(vm, expOrFn, cb, options)
    if (options.immediate) {
      // 如果设置了immediate，需要立即执行一次， 执行的时候不需要收集依赖，只需要执行
      const info = `callback for immediate watcher "${watcher.expression}"`
      pushTarget()
      invokeWithErrorHandling(cb, vm, [watcher.value], vm, info)
      popTarget()
    }
    // 返回一个解除监听的函数
    return function unwatchFn() {
      watcher.teardown()
    }
  }
}
