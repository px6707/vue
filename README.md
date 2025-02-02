## Vue 2 源码解析
> vue2 源码解析，vue2源码流程图

## 目录
- [构建版本说明](#构建版本说明)
- [源码入口分析](#源码入口分析)
- [Vue 构造函数的扩展](#vue-构造函数的扩展)

## 构建版本说明

|-|UMD|CommonJS|ESModule|ESModule (Browser)|
|---|---|---|---|---|
|完整版|vue.js|vue.common.js|vue.esm.js|vue.esm.browser.js|
|只包含运行时版|vue.runtime.js|vue.runtime.common.js|vue.runtime.esm.js|-|
|完整版 (生产环境)|vue.min.js|-|-|vue.esm.browser.min.js|
|只包含运行时版 (生产环境)|	vue.runtime.min.js|	-|	-|	-|

### 版本特点
1. **完整版 (Full Build)**
    - 同时包含编译器和运行时
    - 可以直接在浏览器中编译模板
    - 体积较大
2. **运行时版本 (Runtime Only)**
    - 只包含运行时，不包含编译器
    - 体积小，比完整版轻约 30%
    - 不能在浏览器中编译模板
3. **ESM 构建版本**
    - 基于 ES modules
    - 支持现代打包工具
> **注意**：如果你需要在客户端编译模板 (比如传入一个字符串给 template 选项，或挂载到一个元素上并以其 DOM 内部的 HTML 作为模板)，就将需要加上编译器，即完整版。

---

## 源码入口分析
通过观察[package.json](./package.json)可以看到
```json
  "scripts": {
    "build": "node scripts/build.js",
  },
```
vue2使用 [scripts/build.js](./scripts/build.js) 脚本进行打包。构建过程通过build(builds)对builds数组进行打包，builds数组包含了所有的打包配置信息。在[scripts/config.js](./scripts/config.js)中可以查看详细的打包配置信息。我们源码分析主要关注带编译器的版本，入口文件是[entry-runtime-with-compiler.ts](./src/platforms/web/entry-runtime-with-compiler.ts)。
<br>在这个文件中
```javascript
import Vue from './runtime-with-compiler'
```
说明了vue引自[runtime-with-compiler.ts](./src/platforms/web/runtime-with-compiler.ts)
同样的，我们查看这个文件就能发现
```javascript
import Vue from './runtime/index'
```
其引入的路径在[instance/index.ts](./src/core/instance/index.ts)
```typescript
function Vue(options) {
  if (__DEV__ && !(this instanceof Vue)) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  this._init(options)
}
```
这样我们终于找到了vue2的本体，也就是这个构造函数。

### 入口文件加载流程

1. entry-runtime-with-compiler.ts
   - 入口文件，添加编译器
   
2. runtime-with-compiler.ts
   - 运行时编译器实现
   
3. runtime/index.ts
   - 运行时核心功能
   
4. instance/index.ts
   - Vue 构造函数定义

## vue-构造函数的扩展
### 1. 扩展挂载，添加编译能力
Vue的本体就是一个构造函数，而且极其简单，只有一行代码就是调用了_init方法，这个方法甚至在Vue构造函数中找不到。Vue为了跨平台的特性，通过不同的platform入口，给Vue扩展了不同的能力。
文件：[entry-runtime-with-compiler.ts](./src/platforms/web/entry-runtime-with-compiler.ts)。
```typescript
const mount = Vue.prototype.$mount
Vue.prototype.$mount= function (
  el?: string | Element,
  hydrating?: boolean
): Component {
  ...
  // 如果render函数不存在
  if (!options.render) {
    let template = options.template
    if (template) {
      // template是字符串
      if (typeof template === 'string') {
        // template开头是# 说明传入的是节点ID
        if (template.charAt(0) === '#') {
          // 通过idToTemplate函数将节点ID转换为模板
          template = idToTemplate(template)
        }
        // 如果传入的是dom节点，有nodeType说明是dom节点
      } else if (template.nodeType) {
        // 获取DOM节点上的模版
        template = template.innerHTML
      } else {
        return this
      }
      // 没有template的情况下如果有el参数则使用el getOuterHTML作为模板
    } else if (el) {
      // @ts-expect-error
      template = getOuterHTML(el)
    }
    // 如果template模版存在
    if (template) {
      // 模版编译为render函数
      const { render, staticRenderFns } = compileToFunctions(
        template,
        {
          outputSourceRange: __DEV__,
          shouldDecodeNewlines,
          shouldDecodeNewlinesForHref,
          delimiters: options.delimiters,
          comments: options.comments
        },
        this
      )
      // render函数挂载到options上
      options.render = render
      // 静态渲染函数
      // vue会在编译时把静态部分抽离出来生成一个静态渲染函数数组，并对执行后的渲染结果进行缓存
      options.staticRenderFns = staticRenderFns
    }
  }
  ...
}
```
在这个带编译器版本的vue中，它通过重写原型链上的$mount函数，给$mount添加了编译模版的能力。最后又调用了原始的$mout 让这个函数具有挂载的能力。
### 模板编译过程

1. 模板字符串
   - `<div>{{ message }}</div>`

2. 解析器（Parser）
   - 将模板解析为 AST
   - 标记静态节点

3. 优化器（Optimizer）
   - 对 AST 进行静态分析
   - 标记静态子树

4. 代码生成器（Code Generator）
   - 生成 render 函数
   - 生成 staticRenderFns

5. 虚拟 DOM
   - render 函数执行
   - 生成 VNode 树
### 2. 扩展全局API
文件：[core/index.ts](./src/core/index.ts)
  ```typescript
  import { initGlobalAPI } from './global-api/index'
  // 通过initGloablAPI函数扩展全局API
  initGlobalAPI(Vue)
  ```
在initGlobalAPI中添加了mergeOptions、defineReactive、use、mixin、extend、component、filter、directive等工具函数。

### 3. 扩展Vue原型能力
在Vue本体的文件中，通过6个函数对Vue本体进行了扩展，分别是
文件：[core/index.ts](./src/core/index.ts)
  ```typescript
  import { initMixin } from './init'
  import { stateMixin } from './state'
  import { renderMixin } from './render'
  import { eventsMixin } from './events'
  import { lifecycleMixin } from './lifecycle'
  // 给Vue类 添加能力
  //@ts-expect-error Vue has function type
  // 添加初始化函数_init
  initMixin(Vue)
  //@ts-expect-error Vue has function type
  // Vue类上添加$props $data 的代理添加$watch方法
  stateMixin(Vue)
  //@ts-expect-error Vue has function type
  // 给Vue类上添加$on $off $once $emit方法
  eventsMixin(Vue)
  //@ts-expect-error Vue has function type
  // Vue类上挂载_update、$forceUpdate、$destroy方法
  lifecycleMixin(Vue)
  //@ts-expect-error Vue has function type
  // 挂载生成虚拟节点的方法_render和$nextTick,以及执行render函数需要的各种工具函数
  renderMixin(Vue)  
  ```
他们分别为Vue添加了_init函数，添加了$props、$data代理，给Vue类添加$on、$off $once $emit方法，给Vue类添加_update、$forceUpdate、$destroy方法，给Vue类添加_render和$nextTick，以及执行render函数需要的各种工具函数。

## Vue实例化的过程
Vue 的实例化是从执行 `new Vue()` 开始的，这个过程主要通过 [_init](./src/core/instance/init.ts) 方法完成初始化。让我们详细了解这个过程。

### 1. 初始化前的准备工作
  ```typescript
  Vue.prototype._init = function (options?: Record<string, any>) {
    const vm: Component = this
    // 设置实例的唯一标识
    vm._uid = uid++
    
    // 标记为 Vue 实例
    vm._isVue = true
    // 避免被响应式系统观察
    vm.__v_skip = true
    // 创建效果作用域
    vm._scope = new EffectScope(true /* detached */)
  }
  ```
这个阶段主要完成：

* 设置实例唯一标识 _uid
* 标记 Vue 实例，防止被响应式系统观察
* 创建独立的效果作用域

### 2. 合并选项
  ```typescript
  // 合并选项
  vm.$options = mergeOptions(
    resolveConstructorOptions(vm.constructor as any),
    options || {},
    vm
  )
  ```
其中mergeOptions的实现包含了合并策略：
1. 生命周期钩子函数合并
    ```typescript
    export function mergeLifecycleHook(
      parentVal: Array<Function> | null,
      childVal: Function | Array<Function> | null
    ): Array<Function> | null {
      const res = childVal
        ? parentVal
          ? parentVal.concat(childVal)
          : isArray(childVal)
          ? childVal
          : [childVal]
        : parentVal
      return res ? dedupeHooks(res) : res
    }
    ```
    - 子组件和父组件的同名钩子函数将合并为一个数组
    - 父组件的钩子函数在子组件之前调用
    - 去重
2. data 选项
    ```typescript
    strats.data = function (
      parentVal: any, 
      childVal: any, 
      vm?: Component
    ): Function | null {
      if (!vm) {
        return mergeDataOrFn(parentVal, childVal)
      }

      return mergeDataOrFn(parentVal, childVal, vm)
    }


    function mergeDataOrFn(
      parentVal: any,
      childVal: any,
      vm?: Component
    ): Function | null {
      if (!vm) {
        if (!childVal) {
          return parentVal
        }
        // 复选项没有，直接返回子选项
        if (!parentVal) {
          return childVal
        }
        return function mergedDataFn() {
          // 如果选项是函数，则先执行这个函数，返回值作为需要merge的data
          return mergeData(
            isFunction(childVal) ? childVal.call(this, this) : childVal,
            isFunction(parentVal) ? parentVal.call(this, this) : parentVal
          )
        }
      } else {
        return function mergedInstanceDataFn() {
          // instance merge
          const instanceData = isFunction(childVal)
            ? childVal.call(vm, vm)
            : childVal
          const defaultData = isFunction(parentVal)
            ? parentVal.call(vm, vm)
            : parentVal
          if (instanceData) {
            return mergeData(instanceData, defaultData)
          } else {
            return defaultData
          }
        }
      }
    }
    ```
    - 组件定义时 data 必须是函数
    - 通过 mergeDataOrFn 递归合并对象的属性
3. 资源选项合并
  ```typescript
  function mergeAssets(
    parentVal: Object | null,
    childVal: Object | null,
    vm: Component | null,
    key: string
  ): Object {
    const res = Object.create(parentVal || null)
    if (childVal) {
      __DEV__ && assertObjectType(key, childVal, vm)
      return extend(res, childVal)
    } else {
      return res
    }
  }
  ```
  处理了 `components`  `directives`  `filters`
    - 创建一个原型指向父选项的空对象
    - 将子选项复制到这个对象上
    - 这样可以通过原型链访问父选项中的资源

4. watch 选项
  ```typescript
      strats.watch = function (
      parentVal: Record<string, any> | null,
      childVal: Record<string, any> | null,
      vm: Component | null,
      key: string
    ): Object | null {
      // work around Firefox's Object.prototype.watch...
      //@ts-expect-error work around
      if (parentVal === nativeWatch) parentVal = undefined
      //@ts-expect-error work around
      if (childVal === nativeWatch) childVal = undefined
      /* istanbul ignore if */
      if (!childVal) return Object.create(parentVal || null)
      if (__DEV__) {
        assertObjectType(key, childVal, vm)
      }
      if (!parentVal) return childVal
      const ret: Record<string, any> = {}
      extend(ret, parentVal)
      for (const key in childVal) {
        let parent = ret[key]
        const child = childVal[key]
        if (parent && !isArray(parent)) {
          parent = [parent]
        }
        ret[key] = parent ? parent.concat(child) : isArray(child) ? child : [child]
      }
      return ret
    }
  ```
  - watch 选项中的函数会被合并为数组
  - 支持多个监听器监听同一个属性
5. props、methods、inject、computed
    ```typescript
    strats.props =
      strats.methods =
      strats.inject =
      strats.computed =
        function (
          parentVal: Object | null,
          childVal: Object | null,
          vm: Component | null,
          key: string
        ): Object | null {
          if (childVal && __DEV__) {
            assertObjectType(key, childVal, vm)
          }
          if (!parentVal) return childVal
          const ret = Object.create(null)
          extend(ret, parentVal)
          if (childVal) extend(ret, childVal)
          return ret
        }
    ```
  - 子选项优先级高于父选项
  - 同名的子选项会覆盖父选项
6. provide 选项:
    ```typescript
      strats.provide = function (
        parentVal: Object | null, 
        childVal: Object | null) {
        if (!parentVal) return childVal
        return function () {
          const ret = Object.create(null)
          mergeData(ret, isFunction(parentVal) ? parentVal.call(this) : parentVal)
          if (childVal) {
            mergeData(
              ret,
              isFunction(childVal) ? childVal.call(this) : childVal,
              false // non-recursive
            )
          }
          return ret
        }
      }
    ```
    - 与 data 选项使用相同的合并策略
7. 默认策略
    ```typescript
    const defaultStrat = function (parentVal: any, childVal: any): any {
      return childVal === undefined ? parentVal : childVal
    }
    ```
    - 子选项存在则使用子选项
    - 子选项不存在则使用父选项
8. 对于mixin
    ```typescript
      if (child.mixins) {
      // 如果具有mixin，对每一个mixin进行合并选项
      for (let i = 0, l = child.mixins.length; i < l; i++) {
        parent = mergeOptions(parent, child.mixins[i], vm)
      }
    }
    ```
    - mixin 循环向父选项上合并
> **总结：**
>1. 生命周期都会执行，父组件（全局配置、mixin）的钩子函数在子组件（本组件）之前调用。多个mixin，后注册的声明周期后执行。
>2. 对于数据、方法、filter，本组件覆盖父组件（mixin），多个mixin，后注册的mixin覆盖先注册的mixin。


### 3. 核心初始化流程
在 `_init` 方法中，Vue 按照特定的顺序执行了一系列初始化方法：

```typescript 
// 初始化生命周期
initLifecycle(vm)
// 初始化事件
initEvents(vm)
// 初始化渲染
initRender(vm)
// 调用beforeCreate钩子
callHook(vm, 'beforeCreate', undefined, false /* setContext */)
// 初始化注入
initInjections(vm)
// 初始化状态
initState(vm)
// 初始化provide
initProvide(vm)
// 调用created钩子
callHook(vm, 'created')
```
这些初始化方法各自完成特定的任务：
1. initLifecycle: 建立父子组件关系，初始化生命周期相关属性
    ```typescript
    export function initLifecycle(vm: Component) {
      const options = vm.$options
      // 找到第一个非抽象的父组件
      let parent = options.parent
      if (parent && !options.abstract) {
        while (parent.$options.abstract && parent.$parent) {
          parent = parent.$parent
        }
        parent.$children.push(vm)
      }
      vm.$parent = parent
      vm.$root = parent ? parent.$root : vm
      vm.$children = []
      vm.$refs = {}
    }
    ```
2. initEvents: 初始化事件
    - 处理父组件传递的事件监听器
    - 将事件添加到实例的 _events 属性上
3. initRender: 初始化渲染相关功能
    - 处理插槽，将其放入 $slots
    - 处理作用域插槽，将其放入 $scopedSlots
    - 定义 $createElement 方法用于生成虚拟 DOM
    - 对 $attrs 和 $listeners 做响应式处理
4. initInjections: 初始化注入
    - 处理 inject 配置
    - 将注入的属性代理到实例上
5. initState: 按顺序初始化各种状态，并且会将props、data进行响应式处理
    ```typescript
    export function initState(vm: Component) {
      const opts = vm.$options
      // 初始化props
      if (opts.props) initProps(vm, opts.props)
      // Composition API
      initSetup(vm)
      // 初始化methods
      if (opts.methods) initMethods(vm, opts.methods)
      // 初始化data
      if (opts.data) {
        initData(vm)
      } else {
        const ob = observe((vm._data = {}))
        ob && ob.vmCount++
      }
      // 初始化computed
      if (opts.computed) initComputed(vm, opts.computed)
      // 初始化watch
      if (opts.watch && opts.watch !== nativeWatch) {
        initWatch(vm, opts.watch)
      }
    }
    function initProps(vm: Component, propsOptions: Object) {
      defineReactive(props, key, value, undefined, true /* shallow */)
    }
    function initMethods(vm: Component, methods: Object) {
      // 函数绑定到vue实例上，this指向当前实例
      vm[key] = typeof methods[key] !== 'function' ? noop : bind(methods[key], vm)
    }
    function initComputed(vm: Component, computed: Object) {
      ...
      const watchers = (vm._computedWatchers = Object.create(null))
      ...
       watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        computedWatcherOptions
      )
      ...
    }
    function initWatch(vm: Component, watch: Object) {
      ...
      createWatcher(vm, key, handler)
      ...
    }
    function initData(vm: Component) {
      ...
      const ob = observe(data)
      ...
    }
    ```
6. initProvide: 初始化 provide
    - 将 provide 选项挂载到实例的 _provided 属性上
### 4. 响应式处理
initState中对数据进行了响应式处理。Vue 的响应式系统主要由三个核心部分组成：Observer（数据劫持）、Dep（依赖收集）和 Watcher（订阅者）。
1. observe 函数
    ```typescript
    observe(data)export function observe(value: any): Observer | void {
      // 已经是响应式对象，直接返回
      if (value && hasOwn(value, '__ob__')) {
        return value.__ob__
      }
      // 满足以下条件才会创建 Observer：
      // 1. 是数组或普通对象
      // 2. 对象可扩展
      // 3. 不是被跳过的对象
      // 4. 不是 ref（因为已经是响应式）
      // 5. 不是 VNode
      if (shouldObserve && 
          (isArray(value) || isPlainObject(value)) && 
          Object.isExtensible(value) &&
          !value.__v_skip &&
          !isRef(value) &&
          !(value instanceof VNode)
      ) {
        return new Observer(value)
      }
    }
    ```
2. Observer 类：负责将对象转换为响应式
    ```typescript
    export class Observer {
      constructor(value: any) {
        this.dep = new Dep()
        // 在值上定义 __ob__ 属性，指向 Observer 实例
        def(value, '__ob__', this)
        
        if (isArray(value)) {
          // 数组的特殊处理
          if (hasProto) {
            value.__proto__ = arrayMethods  // 覆盖数组原型方法
          } else {
            // 降级处理：直接在对象上定义方法
            for (let i = 0; i < arrayKeys.length; i++) {
              def(value, arrayKeys[i], arrayMethods[arrayKeys[i]])
            }
          }
          this.observeArray(value)  // 递归处理数组元素
        } else {
          // 对象的处理：遍历属性转换为 getter/setter
          const keys = Object.keys(value)
          for (let i = 0; i < keys.length; i++) {
            defineReactive(value, keys[i])
          }
        }
      }
    }
    ```
3. defineReactive 函数：核心响应式处理
    ```typescript
      export function defineReactive(obj: object, key: string, val?: any) {
        // 每个属性都有自己的 dep 实例
        const dep = new Dep()
        
        // 获取属性描述符
        const property = Object.getOwnPropertyDescriptor(obj, key)
        const getter = property && property.get
        const setter = property && property.set
        
        // 递归子属性，对子属性进行响应式处理
        let childOb = observe(val)
        // 响应式处理的核心方法
        Object.defineProperty(obj, key, {
          enumerable: true,
          configurable: true,
          get: function reactiveGetter() {
            const value = getter ? getter.call(obj) : val
            // 依赖收集
            if (Dep.target) {
              dep.depend()
              // 子对象依赖收集
              if (childOb) {
                childOb.dep.depend()
              }
            }
            return value
          },
          set: function reactiveSetter(newVal) {
            const value = getter ? getter.call(obj) : val
            if (value === newVal) return
            
            val = newVal
            // 新值可能是对象，继续做响应式处理
            childOb = observe(newVal)
            // 通知更新
            dep.notify()
          }
        })
      }
    ```
    - 每一个key都会创建一个Dep实例
    - 当数据被读取时，也就是get操作时，会依次调用每个Dep实例的depend方法
    - 当数据被修改时，也就是set操作时，会依次调用每个Dep实例的notify方法
4. 数组的特殊处理
    ```typescript
    const methodsToPatch = [
      'push',
      'pop',
      'shift',
      'unshift',
      'splice',
      'sort',
      'reverse'
    ]

    methodsToPatch.forEach(function(method) {
      const original = arrayProto[method]
      def(arrayMethods, method, function mutator(...args) {
        const result = original.apply(this, args)
        const ob = this.__ob__
        // 对新增的元素进行响应式处理
        let inserted
        switch (method) {
          case 'push':
          case 'unshift':
            inserted = args
            break
          case 'splice':
            inserted = args.slice(2)
            break
        }
        if (inserted) ob.observeArray(inserted)
        // 通知更新
        ob.dep.notify()
        return result
      })
    })
    ```
    - 由于 Object.defineProperty 无法监听数组的变化，Vue 通过重写数组方法来实现响应式
5. Dep 类：用于收集依赖
    ```typescript
    export class Dep {
      constructor() {
        this.subs = []
      }
      depend() {
        if (Dep.target) {
          Dep.target.addDep(this)
        }
      }
      notify() {
        for (let i = 0, l = subs.length; i < l; i++) {
          const sub = subs[i]
          sub.update()
        }
      }
    }
    ```
> **注意**：现在只是进行了数据的响应式，但数据既没有被读取，也没有被修改，所以没有触发依赖更新，所以没有触发视图更新。在后面每一个vue实例都会new 一个渲染Watcher，它在第一个创建的时候会执行render函数，读取数据，触发响应式的依赖收集。

### 5. 挂载过程
如果在实例化时提供了 el 选项，Vue 会自动调用 $mount 方法进行挂载
1. 编译模版，如果不存在render函数则使用template生成render函数
   [runtime-with-compiler.ts](./src/platforms/web/runtime-with-compiler.ts)
    ```typescript
      if (!options.render) {
        ...
        if (template) {
          ...
          const { render, staticRenderFns } = compileToFunctions(
            template,
            {
              outputSourceRange: __DEV__,
              shouldDecodeNewlines,
              shouldDecodeNewlinesForHref,
              delimiters: options.delimiters,
              comments: options.comments
            },
            this
          )
          // render函数挂载到options上
          options.render = render
          ...
        }
        ...
      }
    ```
    - 获取模板：优先使用 template 选项，其次是 el 的 outerHTML
    - 将模板编译为 render 函数
    - 将编译后的 render 和 staticRenderFns 挂载到 options 上
2. 调用mountComponent进行挂载[runtime/idnex.ts](./src/platforms/web/runtime/index.ts)
    ```typescript
      Vue.prototype.$mount = function (
        el?: string | Element,
        hydrating?: boolean
      ): Component {
        // 查找到对应的挂载节点
        el = el && inBrowser ? query(el) : undefined
        return mountComponent(this, el, hydrating)
      }
    ```
    挂载的实现在[instance/lifecycle.ts](./src/core/instance/lifecycle.ts)
    ```typescript
    if (!vm.$options.render) {
      vm.$options.render = createEmptyVNode
    }
    callHook(vm, 'beforeMount')
    updateComponent = () => {
      vm._update(vm._render(), hydrating)
    }

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
    if (vm.$vnode == null) {
      vm._isMounted = true
      callHook(vm, 'mounted')
    }
    ```
    - 检查 render 函数，不存在则使用空的 VNode
    - 调用 beforeMount 钩子
    - 创建渲染 Watcher，负责组件的更新,使用 updateComponent作为更新函数，更新函数会通过执行render函数获取虚拟节点，然后传递给_update方法渲染成真是DOM节点 
    - Watcher 会立即执行一次更新函数，进行首次渲染
    - 设置 _isMounted 标志并调用 mounted 钩子
### 6.组件更新
在 Vue 中，组件的更新是由 Watcher 来控制的。每个组件实例都会创建一个渲染 Watcher，它负责在数据变化时重新渲染组件。
1. Watcher 的初始化过程
    ```typescript
    // 初始化watcher
    constructor(vm, expOrFn, cb, options, isRenderWatcher) {
      this.vm = vm
      if (isRenderWatcher) {
        vm._watcher = this    // 保存到组件实例上
      }
      this.deep = !!options.deep
      this.user = !!options.user
      this.lazy = !!options.lazy
      this.sync = !!options.sync
      this.before = options.before
      this.getter = expOrFn   // 更新函数
      // 首次执行 getter 进行依赖收集
      this.value = this.lazy ? undefined : this.get()
    }
    get() {
      // 将当前 Watcher 设置为全局的活动 Watcher
        pushTarget(this)
        let value
        const vm = this.vm
        try {
          value = this.getter.call(vm, vm)
        } catch (e: any) {
          if (this.user) {
            handleError(e, vm, `getter for watcher "${this.expression}"`)
          } else {
            throw e
          }
        } finally {
          // "touch" every property so they are all tracked as
          // dependencies for deep watching
          if (this.deep) {
            traverse(value)
          }
          popTarget()
          this.cleanupDeps()
        }
        return value
    }
    addDep(dep: Dep) {
      const id = dep.id
      if (!this.newDepIds.has(id)) {
        this.newDepIds.add(id)
        this.newDeps.push(dep)
        if (!this.depIds.has(id)) {
          dep.addSub(this)
        }
      }
    }
    update() {
      /* istanbul ignore else */
      if (this.lazy) {
        this.dirty = true
      } else if (this.sync) {
        this.run()
      } else {
        queueWatcher(this)
      }
    }
    run() {
      if (this.active) {
        const value = this.get()
        if (
          value !== this.value ||
          // Deep watchers and watchers on Object/Arrays should fire even
          // when the value is the same, because the value may
          // have mutated.
          isObject(value) ||
          this.deep
        ) {
          // set new value
          const oldValue = this.value
          this.value = value
        }
      }
    }
    ```
    - 创建 Watcher 时，会调用this.get()进行首次渲染，并触发依赖收集
    - 将当前 Watcher 设置为全局的活动 Watcher
    - 执行 getter 函数（即 updateComponent）
    
2. Watcher 的依赖收集
    ```typescript
    Object.defineProperty(obj, key, {
          enumerable: true,
          configurable: true,
          get: function reactiveGetter() {
            const value = getter ? getter.call(obj) : val
            // 依赖收集
            if (Dep.target) {
              dep.depend()
              // 子对象依赖收集
              if (childOb) {
                childOb.dep.depend()
              }
            }
            return value
          },
          set: function reactiveSetter(newVal) {
            const value = getter ? getter.call(obj) : val
            if (value === newVal) return
            
            val = newVal
            // 新值可能是对象，继续做响应式处理
            childOb = observe(newVal)
            // 通知更新
            dep.notify()
          }
    })
    class Dep {
      constructor() {
        this.subs = []
      }
      depend() {
        if (Dep.target) {
          Dep.target.addDep(this)
        }
      }
      notify() {
        for (let i = 0, l = subs.length; i < l; i++) {
          const sub = subs[i]
          sub.update()
        }
      }
    }
    ```
    我们再次将响应式核心代码和Dep的实现贴在这里，方便查看。
    - 当数据被读取，也就是get操作时，会依次调用每个Dep实例的depend方法
    - Dep.target就是当前正在进行依赖收集的watcher，他会执行addDep方法
    - 当Watcher执行addDep的时候，会使用`dep.addSub(this)`将当前的watcher添加到的的dep实例的subs数组中，完成依赖收集
3. Watcher 的更新
    - 当数据被修改，也就是set操作时，会依次调用每个Dep实例的notify方法，notify方法会通知当前 Dep 实例的所有sub，也就是所依赖的所有watcher进行更新，执行Watcher的update方法
    - update方法会直接使用`this.run()`或者使用queueWatcher队列来使用`this.run()`
    - `this.run()`会直接调用`this.get()`方法，也就是执行getter，这个getter就是updateComponent，会执行render函数生成虚拟节点，然后使用update方法生成真实DOM进行视图更新
    - 在队列执行run之前会执行watcher.before()，会触发beforeUpdate钩子
    - 在队列执行run之后会触发updated钩子

4. 批量更新
    - queueWatcher 函数中，会将更新函数放入到nextTick队列中，且添加waiting标志位，在flushSchedulerQueue执行更新函数的时候waiting为true，更新函数只会进入队列而不执行。当flushSchedulerQueue执行完成后，waiting标志位会变为false，队列中的更新函数会执行
    - vue组件中的nextTick回调会写在数据更新之后，这个回调也会放在nextTick的队列中，且顺序在更新函数之后
    - 等更新函数执行完成后，才会执行组件中的nextTick回调，保证了能够拿到最新的DOM