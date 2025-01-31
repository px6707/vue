import { isIE, isIE9, isEdge } from 'core/util/env'

import { extend, isDef, isUndef, isTrue } from 'shared/util'
import type { VNodeWithData } from 'types/vnode'

import {
  isXlink,
  xlinkNS,
  getXlinkProp,
  isBooleanAttr,
  isEnumeratedAttr,
  isFalsyAttrValue,
  convertEnumeratedValue
} from 'web/util/index'

function updateAttrs(oldVnode: VNodeWithData, vnode: VNodeWithData) {
  const opts = vnode.componentOptions
  if (isDef(opts) && opts.Ctor.options.inheritAttrs === false) {
    return
    // 不继承则直接退出
  }
  if (isUndef(oldVnode.data.attrs) && isUndef(vnode.data.attrs)) {
    // 如果属性一直都是空的，直接退出
    return
  }
  let key, cur, old
  const elm = vnode.elm
  const oldAttrs = oldVnode.data.attrs || {}
  let attrs: any = vnode.data.attrs || {}
  // clone observed objects, as the user probably wants to mutate it
  if (isDef(attrs.__ob__) || isTrue(attrs._v_attr_proxy)) {
    // 如果attrs是响应式的，或者是被vue代理的，直接修改它会导致触发响应式系统，或者影响到其他地方，因此这里先clone
    attrs = vnode.data.attrs = extend({}, attrs)
  }

  for (key in attrs) {
    cur = attrs[key]
    old = oldAttrs[key]
    // 新旧属性不同，设置属性
    if (old !== cur) {
      setAttr(elm, key, cur, vnode.data.pre)
    }
  }
  // #4391: in IE9, setting type can reset value for input[type=radio]
  // #6666: IE/Edge forces progress value down to 1 before setting a max
  /* istanbul ignore if */
  if ((isIE || isEdge) && attrs.value !== oldAttrs.value) {
    setAttr(elm, 'value', attrs.value)
  }
  for (key in oldAttrs) {
    // 旧attrs中有的属性，在新的中没有，删除
    if (isUndef(attrs[key])) {
      if (isXlink(key)) {
        elm.removeAttributeNS(xlinkNS, getXlinkProp(key))
      } else if (!isEnumeratedAttr(key)) {
        elm.removeAttribute(key)
      }
    }
  }
}

function setAttr(el: Element, key: string, value: any, isInPre?: any) {
  if (isInPre || el.tagName.indexOf('-') > -1) {

    baseSetAttr(el, key, value)
  } else if (isBooleanAttr(key)) {
    // set attribute for blank value
    // e.g. <option disabled>Select one</option>
    // 设置boolean类型的属性
    if (isFalsyAttrValue(value)) {
      el.removeAttribute(key)
    } else {
      // technically allowfullscreen is a boolean attribute for <iframe>,
      // but Flash expects a value of "true" when used on <embed> tag
      value = key === 'allowfullscreen' && el.tagName === 'EMBED' ? 'true' : key
      el.setAttribute(key, value)
    }
  } else if (isEnumeratedAttr(key)) {
    // 1. 检查是否是枚举属性
    // 2. 转换值为标准格式
    // 3. 设置属性
    el.setAttribute(key, convertEnumeratedValue(key, value))
  } else if (isXlink(key)) {
    if (isFalsyAttrValue(value)) {
      el.removeAttributeNS(xlinkNS, getXlinkProp(key))
    } else {
      el.setAttributeNS(xlinkNS, key, value)
    }
  } else {
    baseSetAttr(el, key, value)
  }
}

function baseSetAttr(el, key, value) {
  if (isFalsyAttrValue(value)) {
    // value是空值，删除这个属性
    el.removeAttribute(key)
  } else {
    // #7138: IE10 & 11 fires input event when setting placeholder on
    // <textarea>... block the first input event and remove the blocker
    // immediately.
    /* istanbul ignore if */
    if (
      isIE &&
      !isIE9 &&
      el.tagName === 'TEXTAREA' &&
      key === 'placeholder' &&
      value !== '' &&
      !el.__ieph
    ) {
      // 如果是placeholder，在IE1011下会阻止input事件，因此需要添加阻止冒泡的代码
      const blocker = e => {
        e.stopImmediatePropagation()
        el.removeEventListener('input', blocker)
      }
      el.addEventListener('input', blocker)
      // $flow-disable-line
      el.__ieph = true /* IE placeholder patched */
    }
    el.setAttribute(key, value)
  }
}

export default {
  create: updateAttrs,
  update: updateAttrs
}
