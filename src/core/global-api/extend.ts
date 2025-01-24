import { ASSET_TYPES } from 'shared/constants'
import type { Component } from 'types/component'
import type { GlobalAPI } from 'types/global-api'
import { defineComputed, proxy } from '../instance/state'
import { extend, mergeOptions, validateComponentName } from '../util/index'
import { getComponentName } from '../vdom/create-component'

export function initExtend(Vue: GlobalAPI) {
  /**
   * Each instance constructor, including Vue, has a unique
   * cid. This enables us to create wrapped "child
   * constructors" for prototypal inheritance and cache them.
   */
  Vue.cid = 0
  let cid = 1

  /**
   * Class inheritance
   */
  Vue.extend = function (extendOptions: any): typeof Component {
    extendOptions = extendOptions || {}
    const Super = this
    const SuperId = Super.cid
    const cachedCtors = extendOptions._Ctor || (extendOptions._Ctor = {})
    // 如果已经缓存过这个构造函数，则返回它
    if (cachedCtors[SuperId]) {
      return cachedCtors[SuperId]
    }
    // 获取组件名称
    const name =
      getComponentName(extendOptions) || getComponentName(Super.options)
    if (__DEV__ && name) {
      // 开发模式下校验组件名
      validateComponentName(name)
    }

    const Sub = function VueComponent(this: any, options: any) {
      // 使用vue的_init方法初始化
      this._init(options)
    } as unknown as typeof Component
    // 子组件原型链挂载上 Vue
    Sub.prototype = Object.create(Super.prototype)
    // 修正子组件的constructor
    Sub.prototype.constructor = Sub
    // 为子组件增加cid
    Sub.cid = cid++
    // 为子组件增加options
    Sub.options = mergeOptions(Super.options, extendOptions)
     // 保存对父类的引用
    Sub['super'] = Super

    // For props and computed properties, we define the proxy getters on
    // the Vue instances at extension time, on the extended prototype. This
    // avoids Object.defineProperty calls for each instance created.
    // Sub原型上定义_props和计算属性的代理访问
    if (Sub.options.props) {
      initProps(Sub)
    }
    if (Sub.options.computed) {
      initComputed(Sub)
    }

    // allow further extension/mixin/plugin usage
    // 添加vueAPI， 集成父类的方法
    Sub.extend = Super.extend
    Sub.mixin = Super.mixin
    Sub.use = Super.use

    // create asset registers, so extended classes
    // can have their private assets too.
    // ['component', 'directive', 'filter'] 对应函数添加
    ASSET_TYPES.forEach(function (type) {
      Sub[type] = Super[type]
    })
    // enable recursive self-lookup
    // 如果组件有名字，将自身添加到自己的 components 选项中，可以在自己的组件中使用自己
    if (name) {
      Sub.options.components[name] = Sub
    }

    // keep a reference to the super options at extension time.
    // later at instantiation we can check if Super's options have
    // been updated.
    // 存储父类选项
    Sub.superOptions = Super.options
    Sub.extendOptions = extendOptions
    Sub.sealedOptions = extend({}, Sub.options)

    // cache constructor
    cachedCtors[SuperId] = Sub
    return Sub
  }
}
// 在原型谁给你添加_props的代理访问，之后在子类上访问props中的属性就可以直接this.name 而不需要this._props.name了
// 注意这是在原型上扩展的，这样的话每个子类的实例都可以这样访问props的属性，而不需要每个实例都去代理了
function initProps(Comp: typeof Component) {
  const props = Comp.options.props
  for (const key in props) {
    proxy(Comp.prototype, `_props`, key)
  }
}
//  在原型上定义 computed 属性
function initComputed(Comp: typeof Component) {
  const computed = Comp.options.computed
  for (const key in computed) {
    defineComputed(Comp.prototype, key, computed[key])
  }
}
