/**
 * Virtual DOM patching algorithm based on Snabbdom by
 * Simon Friis Vindum (@paldepind)
 * Licensed under the MIT License
 * https://github.com/paldepind/snabbdom/blob/master/LICENSE
 *
 * modified by Evan You (@yyx990803)
 *
 * Not type-checking this because this file is perf-critical and the cost
 * of making flow understand it is not worth it.
 */

import VNode, { cloneVNode } from './vnode'
import config from '../config'
import { SSR_ATTR } from 'shared/constants'
import { registerRef } from './modules/template-ref'
import { traverse } from '../observer/traverse'
import { activeInstance } from '../instance/lifecycle'
import { isTextInputType } from 'web/util/element'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  isArray,
  makeMap,
  isRegExp,
  isPrimitive
} from '../util/index'

export const emptyNode = new VNode('', {}, [])

const hooks = ['create', 'activate', 'update', 'remove', 'destroy']

// 判断虚拟节点是否是相同节点
function sameVnode(a, b) {
  return (
    a.key === b.key &&
    a.asyncFactory === b.asyncFactory &&
    ((a.tag === b.tag &&
      a.isComment === b.isComment &&
      isDef(a.data) === isDef(b.data) &&
      sameInputType(a, b)) ||
      (isTrue(a.isAsyncPlaceholder) && isUndef(b.asyncFactory.error)))
  )
}

function sameInputType(a, b) {
  if (a.tag !== 'input') return true
  let i
  const typeA = isDef((i = a.data)) && isDef((i = i.attrs)) && i.type
  const typeB = isDef((i = b.data)) && isDef((i = i.attrs)) && i.type
  return typeA === typeB || (isTextInputType(typeA) && isTextInputType(typeB))
}
// 创建key和index的映射
function createKeyToOldIdx(children, beginIdx, endIdx) {
  let i, key
  const map = {}
  for (i = beginIdx; i <= endIdx; ++i) {
    key = children[i].key
    if (isDef(key)) map[key] = i
  }
  return map
}
// 工厂函数，用于创建patch函数
export function createPatchFunction(backend) {
  let i, j
  const cbs: any = {}

  const { modules, nodeOps } = backend
  // 初始化钩子函数  ['create', 'activate', 'update', 'remove', 'destroy']
  // 将module中的钩子函数收集到cbs对象中
  for (i = 0; i < hooks.length; ++i) {
    cbs[hooks[i]] = []
    for (j = 0; j < modules.length; ++j) {
      if (isDef(modules[j][hooks[i]])) {
        cbs[hooks[i]].push(modules[j][hooks[i]])
      }
    }
  }

  function emptyNodeAt(elm) {
    return new VNode(nodeOps.tagName(elm).toLowerCase(), {}, [], undefined, elm)
  }

  function createRmCb(childElm, listeners) {
    function remove() {
      if (--remove.listeners === 0) {
        // 当删除节点的监听都没有时，删除节点
        removeNode(childElm)
      }
    }
    remove.listeners = listeners
    // 创建一个回调函数，用于删除节点
    return remove
  }

  function removeNode(el) {
    const parent = nodeOps.parentNode(el)
    // element may have already been removed due to v-html / v-text
    // 使用平台方法，删除子节点
    if (isDef(parent)) {
      nodeOps.removeChild(parent, el)
    }
  }

  function isUnknownElement(vnode, inVPre) {
    return (
      !inVPre &&
      !vnode.ns &&
      !(
        config.ignoredElements.length &&
        config.ignoredElements.some(ignore => {
          return isRegExp(ignore)
            ? ignore.test(vnode.tag)
            : ignore === vnode.tag
        })
      ) &&
      config.isUnknownElement(vnode.tag)
    )
  }

  let creatingElmInVPre = 0

  function createElm(
    // 虚拟节点
    vnode,
    // 插入节点队列
    insertedVnodeQueue,
    parentElm?: any,
    // 父DOM
    refElm?: any,
    // 参考DOM， 用于插入位置
    nested?: any,
    // vnode所属数组
    ownerArray?: any,
    // vnode在数组中的索引
    index?: any
  ) {
    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // This vnode was used in a previous render!
      // now it's used as a new node, overwriting its elm would cause
      // potential patch errors down the road when it's used as an insertion
      // reference node. Instead, we clone the node on-demand before creating
      // associated DOM element for it.
      // 如果 vnode 之前被渲染过，需要克隆一个新的
      vnode = ownerArray[index] = cloneVNode(vnode)
    }

    vnode.isRootInsert = !nested // for transition enter check
    if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
       // 如果是组件，createComponent 会处理组件的创建和挂载
      return
    }

    const data = vnode.data
    const children = vnode.children
    const tag = vnode.tag
    if (isDef(tag)) {
      if (__DEV__) {
        if (data && data.pre) {
          // pre元素深度+1
          creatingElmInVPre++
        }
        if (isUnknownElement(vnode, creatingElmInVPre)) {
          // 检查未知元素
          warn(
            'Unknown custom element: <' +
              tag +
              '> - did you ' +
              'register the component correctly? For recursive components, ' +
              'make sure to provide the "name" option.',
            vnode.context
          )
        }
      }
      // 创建 DOM 元素
      vnode.elm = vnode.ns
      // SVG 等命名空间元素
        ? nodeOps.createElementNS(vnode.ns, tag)
      // 普通 HTML 元素
        : nodeOps.createElement(tag, vnode)
      // 设置作用域（用于 scoped CSS）
      setScope(vnode)
      // 创建子节点
      createChildren(vnode, children, insertedVnodeQueue)
      if (isDef(data)) {
        // 调用创建钩子
        invokeCreateHooks(vnode, insertedVnodeQueue)
      }
      insert(parentElm, vnode.elm, refElm)

      if (__DEV__ && data && data.pre) {
        creatingElmInVPre--
      }
    } else if (isTrue(vnode.isComment)) {
      // 如果是注释节点，直接创建
      vnode.elm = nodeOps.createComment(vnode.text)
      insert(parentElm, vnode.elm, refElm)
    } else {
      // 文本节点
      vnode.elm = nodeOps.createTextNode(vnode.text)
      insert(parentElm, vnode.elm, refElm)
    }
  }

  function createComponent(vnode, insertedVnodeQueue, parentElm, refElm) {
    let i = vnode.data
    if (isDef(i)) {
      // 检查是否是被 keep-alive 的组件重新激活
      const isReactivated = isDef(vnode.componentInstance) && i.keepAlive
      if (isDef((i = i.hook)) && isDef((i = i.init))) {
        // 调用初始化钩子，在src\core\vdom\create-component.ts文件中
        i(vnode, false /* hydrating */)
      }
      // after calling the init hook, if the vnode is a child component
      // it should've created a child instance and mounted it. the child
      // component also has set the placeholder vnode's elm.
      // in that case we can just return the element and be done.
      // 如果组件实例存在
      if (isDef(vnode.componentInstance)) {
        // 初始化组件
        initComponent(vnode, insertedVnodeQueue)
        // 将组件插入到DOM树中
        insert(parentElm, vnode.elm, refElm)
        // 如果是被重新激活的组件
        if (isTrue(isReactivated)) {
          reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm)
        }
        return true
      }
    }
  }

  function initComponent(vnode, insertedVnodeQueue) {
    if (isDef(vnode.data.pendingInsert)) {
      insertedVnodeQueue.push.apply(
        insertedVnodeQueue,
        vnode.data.pendingInsert
      )
      vnode.data.pendingInsert = null
    }
    vnode.elm = vnode.componentInstance.$el
    if (isPatchable(vnode)) {
      // 调用创建钩子
      invokeCreateHooks(vnode, insertedVnodeQueue)
      // 设置作用域（用于 scoped CSS）
      setScope(vnode)
    } else {
      // empty component root.
      // skip all element-related modules except for ref (#3455)
      registerRef(vnode)
      // make sure to invoke the insert hook
      insertedVnodeQueue.push(vnode)
    }
  }

  function reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm) {
    let i
    // hack for #4339: a reactivated component with inner transition
    // does not trigger because the inner node's created hooks are not called
    // again. It's not ideal to involve module-specific logic in here but
    // there doesn't seem to be a better way to do it.
    let innerNode = vnode
    while (innerNode.componentInstance) {
      innerNode = innerNode.componentInstance._vnode
      if (isDef((i = innerNode.data)) && isDef((i = i.transition))) {
        for (i = 0; i < cbs.activate.length; ++i) {
          // 调用激活钩子 使组件激活
          cbs.activate[i](emptyNode, innerNode)
        }
        insertedVnodeQueue.push(innerNode)
        break
      }
    }
    // unlike a newly created component,
    // a reactivated keep-alive component doesn't insert itself
    insert(parentElm, vnode.elm, refElm)
  }

  function insert(parent, elm, ref) {
    if (isDef(parent)) {
      if (isDef(ref)) {
        // 如果参考节点的父节点和插入点的父节点相同，那么可以直接插入
        if (nodeOps.parentNode(ref) === parent) {
          nodeOps.insertBefore(parent, elm, ref)
        }
      } else {
        // 没有参考节点，直接插入
        nodeOps.appendChild(parent, elm)
      }
    }
  }

  function createChildren(vnode, children, insertedVnodeQueue) {
    if (isArray(children)) {
      if (__DEV__) {
        // 检查子节点中的key是否重复
        checkDuplicateKeys(children)
      }
      for (let i = 0; i < children.length; ++i) {
        // 每个子节点使用createElm创建
        createElm(
          children[i],
          insertedVnodeQueue,
          vnode.elm,
          null,
          true,
          children,
          i
        )
      }
    } else if (isPrimitive(vnode.text)) {
      // 子节点不是数组，且是简单文本，调用平台方法创建文本节点
      nodeOps.appendChild(vnode.elm, nodeOps.createTextNode(String(vnode.text)))
    }
  }

  function isPatchable(vnode) {
    // <template>
    //   <my-component>
    //     <div>Content</div>
    //   </my-component>
    // </template>
    // isPatchable 会一直找到最内层的 div 节点
    // 对于组件，需要找到其最底层的实际 DOM 节点
    while (vnode.componentInstance) {
      vnode = vnode.componentInstance._vnode
    }
    // 检查最终节点是否有 tag
    return isDef(vnode.tag)
  }

  function invokeCreateHooks(vnode, insertedVnodeQueue) {
    // 调用创建钩子
    for (let i = 0; i < cbs.create.length; ++i) {
      cbs.create[i](emptyNode, vnode)
    }
    i = vnode.data.hook // Reuse variable
    if (isDef(i)) {
      if (isDef(i.create)) i.create(emptyNode, vnode)
      if (isDef(i.insert)) insertedVnodeQueue.push(vnode)
    }
  }

  // set scope id attribute for scoped CSS.
  // this is implemented as a special case to avoid the overhead
  // of going through the normal attribute patching process.
  // 设置css的作用域，用于 scoped CSS，这时候会在节点上添加data-v-xxx的属性，帮助css只在对应scope下生效
  function setScope(vnode) {
    let i
    if (isDef((i = vnode.fnScopeId))) {
      nodeOps.setStyleScope(vnode.elm, i)
    } else {
      let ancestor = vnode
      while (ancestor) {
        if (isDef((i = ancestor.context)) && isDef((i = i.$options._scopeId))) {
          nodeOps.setStyleScope(vnode.elm, i)
        }
        ancestor = ancestor.parent
      }
    }
    // for slot content they should also get the scopeId from the host instance.
    if (
      isDef((i = activeInstance)) &&
      i !== vnode.context &&
      i !== vnode.fnContext &&
      isDef((i = i.$options._scopeId))
    ) {
      nodeOps.setStyleScope(vnode.elm, i)
    }
  }

  function addVnodes(
    parentElm,
    refElm,
    vnodes,
    startIdx,
    endIdx,
    insertedVnodeQueue
  ) {
    for (; startIdx <= endIdx; ++startIdx) {
      createElm(
        vnodes[startIdx],
        insertedVnodeQueue,
        parentElm,
        refElm,
        false,
        vnodes,
        startIdx
      )
    }
  }

  function invokeDestroyHook(vnode) {
    let i, j
    // 调用销毁钩子
    const data = vnode.data
    if (isDef(data)) {
      if (isDef((i = data.hook)) && isDef((i = i.destroy))) i(vnode)
      for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode)
    }
    if (isDef((i = vnode.children))) {
      for (j = 0; j < vnode.children.length; ++j) {
        invokeDestroyHook(vnode.children[j])
      }
    }
  }

  function removeVnodes(vnodes, startIdx, endIdx) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx]
      if (isDef(ch)) {
        if (isDef(ch.tag)) {
          // 调用移除钩子
          removeAndInvokeRemoveHook(ch)
          // 调用销毁钩子
          invokeDestroyHook(ch)
        } else {
          // Text node
          // 文本节点直接移除
          removeNode(ch.elm)
        }
      }
    }
  }

  function removeAndInvokeRemoveHook(vnode, rm?: any) {
    if (isDef(rm) || isDef(vnode.data)) {
      let i
      const listeners = cbs.remove.length + 1
      if (isDef(rm)) {
        // we have a recursively passed down rm callback
        // increase the listeners count
        rm.listeners += listeners
      } else {
        // directly removing
        rm = createRmCb(vnode.elm, listeners)
      }
      // recursively invoke hooks on child component root node
      if (
        isDef((i = vnode.componentInstance)) &&
        isDef((i = i._vnode)) &&
        isDef(i.data)
      ) {
        // 递归调用子组件的移除钩子
        removeAndInvokeRemoveHook(i, rm)
      }
      for (i = 0; i < cbs.remove.length; ++i) {
        // 调用删除钩子
        cbs.remove[i](vnode, rm)
      }
      if (isDef((i = vnode.data.hook)) && isDef((i = i.remove))) {
        // 如果存在自定义的 remove 钩子，调用它
        i(vnode, rm)
      } else {
        // 否则直接执行移除回调
        rm()
      }
    } else {
      // 删除节点
      removeNode(vnode.elm)
    }
  }

  function updateChildren(
    parentElm,
    oldCh,
    newCh,
    insertedVnodeQueue,
    removeOnly
  ) {
    // 老节点开头指针
    let oldStartIdx = 0
    // 新节点开头指针
    let newStartIdx = 0
    // 老节点结尾指针
    let oldEndIdx = oldCh.length - 1
    // 老节点的开头节点
    let oldStartVnode = oldCh[0]
    // 老节点的结尾节点
    let oldEndVnode = oldCh[oldEndIdx]
    // 新节点的结尾指针
    let newEndIdx = newCh.length - 1
    // 新节点开头元素
    let newStartVnode = newCh[0]
    // 新节点结尾元素
    let newEndVnode = newCh[newEndIdx]
    let oldKeyToIdx, idxInOld, vnodeToMove, refElm

    // removeOnly is a special flag used only by <transition-group>
    // to ensure removed elements stay in correct relative positions
    // during leaving transitions
    const canMove = !removeOnly

    if (__DEV__) {
      checkDuplicateKeys(newCh)
    }

    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      // 开头节点不存在
      if (isUndef(oldStartVnode)) {
        // 移动到下一个
        oldStartVnode = oldCh[++oldStartIdx] // Vnode has been moved left
      } else if (isUndef(oldEndVnode)) {
        // 结尾节点不存在，移动到上一个
        oldEndVnode = oldCh[--oldEndIdx]
      } else if (sameVnode(oldStartVnode, newStartVnode)) {
        // 开始节点可复用
        patchVnode(
          oldStartVnode,
          newStartVnode,
          insertedVnodeQueue,
          newCh,
          newStartIdx
        )
        // 开始指针后移
        oldStartVnode = oldCh[++oldStartIdx]
        newStartVnode = newCh[++newStartIdx]
      } else if (sameVnode(oldEndVnode, newEndVnode)) {
        // 结尾节点可复用
        patchVnode(
          oldEndVnode,
          newEndVnode,
          insertedVnodeQueue,
          newCh,
          newEndIdx
        )
        // 结尾指针前移
        oldEndVnode = oldCh[--oldEndIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldStartVnode, newEndVnode)) {
        // 老节点的开头节点和新节点的结尾节点可复用
        // Vnode moved right
        patchVnode(
          oldStartVnode,
          newEndVnode,
          insertedVnodeQueue,
          newCh,
          newEndIdx
        )
        // 将老节点移动到尾部
        canMove &&
          nodeOps.insertBefore(
            parentElm,
            oldStartVnode.elm,
            nodeOps.nextSibling(oldEndVnode.elm)
          )
        // 老节点开始指针后移，新节点结束指针前移，获取当前指针的vnode
        oldStartVnode = oldCh[++oldStartIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldEndVnode, newStartVnode)) {
        // 如果老节点的结束节点和新节点的开头节点可复用
        // Vnode moved left
        patchVnode(
          oldEndVnode,
          newStartVnode,
          insertedVnodeQueue,
          newCh,
          newStartIdx
        )
        // 将老节点移动到头部
        canMove &&
          nodeOps.insertBefore(parentElm, oldEndVnode.elm, oldStartVnode.elm)
        // 老节点结束指针前移，新节点开始指针后移，获取当前指针的vnode
        oldEndVnode = oldCh[--oldEndIdx]
        newStartVnode = newCh[++newStartIdx]
      } else {
        // 老节点中查找新节点的开头节点
        if (isUndef(oldKeyToIdx))
          // 创建key和index的映射
          oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx)
        idxInOld = isDef(newStartVnode.key)
        // 新节点有key，在老节点中获取该key对应的index
          ? oldKeyToIdx[newStartVnode.key]
          // 新节点没有key，在老节点中找sameVnode的节点的index
          : findIdxInOld(newStartVnode, oldCh, oldStartIdx, oldEndIdx)
        if (isUndef(idxInOld)) {
          // 老节点中没有找到相同的节点，创建新节点
          // New element
          createElm(
            newStartVnode,
            insertedVnodeQueue,
            parentElm,
            // 放在这个参考节点前面
            oldStartVnode.elm,
            false,
            newCh,
            newStartIdx
          )
        } else {
          // 老节点中找到相同的节点
          vnodeToMove = oldCh[idxInOld]
          // 且新节点和老节点可复用
          if (sameVnode(vnodeToMove, newStartVnode)) {
            patchVnode(
              vnodeToMove,
              newStartVnode,
              insertedVnodeQueue,
              newCh,
              newStartIdx
            )
            oldCh[idxInOld] = undefined
            // 复用的新节点插入到老节点的头部
            canMove &&
              nodeOps.insertBefore(
                parentElm,
                vnodeToMove.elm,
                oldStartVnode.elm
              )
          } else {
            // same key but different element. treat as new element
            // key相同，但节点不sameVnode,直接创建新节点
            createElm(
              newStartVnode,
              insertedVnodeQueue,
              parentElm,
              oldStartVnode.elm,
              false,
              newCh,
              newStartIdx
            )
          }
        }
        newStartVnode = newCh[++newStartIdx]
      }
    }
    // 老节点遍历完，新节点还没遍历完，需要添加
    if (oldStartIdx > oldEndIdx) {
      refElm = isUndef(newCh[newEndIdx + 1]) ? null : newCh[newEndIdx + 1].elm
      addVnodes(
        parentElm,
        refElm,
        newCh,
        newStartIdx,
        newEndIdx,
        insertedVnodeQueue
      )
    } else if (newStartIdx > newEndIdx) {
      // 新节点遍历完，老节点还没遍历完，需要删除
      removeVnodes(oldCh, oldStartIdx, oldEndIdx)
    }
  }
  // 检查子节点中的key是否重复
  function checkDuplicateKeys(children) {
    const seenKeys = {}
    for (let i = 0; i < children.length; i++) {
      const vnode = children[i]
      const key = vnode.key
      if (isDef(key)) {
        if (seenKeys[key]) {
          warn(
            `Duplicate keys detected: '${key}'. This may cause an update error.`,
            vnode.context
          )
        } else {
          seenKeys[key] = true
        }
      }
    }
  }

  function findIdxInOld(node, oldCh, start, end) {
    for (let i = start; i < end; i++) {
      const c = oldCh[i]
      if (isDef(c) && sameVnode(node, c)) return i
    }
  }

  function patchVnode(
    oldVnode,
    vnode,
    insertedVnodeQueue,
    ownerArray,
    index,
    removeOnly?: any
  ) {
    if (oldVnode === vnode) {
      // 如果是同一个节点引用，无需更新
      return
    }

    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // clone reused vnode
      // 克隆可重用的 vnode
      vnode = ownerArray[index] = cloneVNode(vnode)
    }
    // 保存真实 DOM 引用
    const elm = (vnode.elm = oldVnode.elm)
    // 如果是异步组件，需要进行 hydrate
    if (isTrue(oldVnode.isAsyncPlaceholder)) {
      if (isDef(vnode.asyncFactory.resolved)) {
        hydrate(oldVnode.elm, vnode, insertedVnodeQueue)
      } else {
        vnode.isAsyncPlaceholder = true
      }
      return
    }

    // reuse element for static trees.
    // note we only do this if the vnode is cloned -
    // if the new node is not cloned it means the render functions have been
    // reset by the hot-reload-api and we need to do a proper re-render.
    // 静态元素
    if (
      isTrue(vnode.isStatic) &&
      isTrue(oldVnode.isStatic) &&
      vnode.key === oldVnode.key &&
      (isTrue(vnode.isCloned) || isTrue(vnode.isOnce))
    ) {
      // 静态元素不会变化，直接复用
      vnode.componentInstance = oldVnode.componentInstance
      return
    }

    let i
    const data = vnode.data
    if (isDef(data) && isDef((i = data.hook)) && isDef((i = i.prepatch))) {
      // 调用组件的 prepatch 钩子
      i(oldVnode, vnode)
    }

    const oldCh = oldVnode.children
    const ch = vnode.children
    if (isDef(data) && isPatchable(vnode)) {
      // 调用模块的 update 钩子
      for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode)
        // 调用组件的 update 钩子
      if (isDef((i = data.hook)) && isDef((i = i.update))) i(oldVnode, vnode)
    }
  // 非文本节点
    if (isUndef(vnode.text)) {
      // 都有子节点
      if (isDef(oldCh) && isDef(ch)) {
        if (oldCh !== ch)
          // 更新子节点
          updateChildren(elm, oldCh, ch, insertedVnodeQueue, removeOnly)
      } else if (isDef(ch)) {
        // 只有新子节点， 插入子节点
        if (__DEV__) {
          checkDuplicateKeys(ch)
        }
        // 清空之前的文本
        if (isDef(oldVnode.text)) nodeOps.setTextContent(elm, '')
          // 插入新子节点
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue)
      } else if (isDef(oldCh)) {
        // 只有旧子节点，移除所有旧子节点
        removeVnodes(oldCh, 0, oldCh.length - 1)
      } else if (isDef(oldVnode.text)) {
        // 旧节点是文本  清空文本
        nodeOps.setTextContent(elm, '')
      }
    } else if (oldVnode.text !== vnode.text) {
      // 更新文本内容
      nodeOps.setTextContent(elm, vnode.text)
    }
    if (isDef(data)) {
      // 调用 postpatch 钩子
      if (isDef((i = data.hook)) && isDef((i = i.postpatch))) i(oldVnode, vnode)
    }
  }

  function invokeInsertHook(vnode, queue, initial) {
    // delay insert hooks for component root nodes, invoke them after the
    // element is really inserted
    // 调用insert钩子
    if (isTrue(initial) && isDef(vnode.parent)) {
      vnode.parent.data.pendingInsert = queue
    } else {
      for (let i = 0; i < queue.length; ++i) {
        queue[i].data.hook.insert(queue[i])
      }
    }
  }

  let hydrationBailed = false
  // list of modules that can skip create hook during hydration because they
  // are already rendered on the client or has no need for initialization
  // Note: style is excluded because it relies on initial clone for future
  // deep updates (#7063).
  const isRenderedModule = makeMap('attrs,class,staticClass,staticStyle,key')

  // Note: this is a browser-only function so we can assume elms are DOM nodes.
  function hydrate(elm, vnode, insertedVnodeQueue, inVPre?: boolean) {
    let i
    const { tag, data, children } = vnode
    inVPre = inVPre || (data && data.pre)
    vnode.elm = elm

    if (isTrue(vnode.isComment) && isDef(vnode.asyncFactory)) {
      vnode.isAsyncPlaceholder = true
      return true
    }
    // assert node match
    if (__DEV__) {
      if (!assertNodeMatch(elm, vnode, inVPre)) {
        return false
      }
    }
    if (isDef(data)) {
      if (isDef((i = data.hook)) && isDef((i = i.init)))
        i(vnode, true /* hydrating */)
      if (isDef((i = vnode.componentInstance))) {
        // child component. it should have hydrated its own tree.
        initComponent(vnode, insertedVnodeQueue)
        return true
      }
    }
    if (isDef(tag)) {
      if (isDef(children)) {
        // empty element, allow client to pick up and populate children
        if (!elm.hasChildNodes()) {
          createChildren(vnode, children, insertedVnodeQueue)
        } else {
          // v-html and domProps: innerHTML
          if (
            isDef((i = data)) &&
            isDef((i = i.domProps)) &&
            isDef((i = i.innerHTML))
          ) {
            if (i !== elm.innerHTML) {
              /* istanbul ignore if */
              if (
                __DEV__ &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn('server innerHTML: ', i)
                console.warn('client innerHTML: ', elm.innerHTML)
              }
              return false
            }
          } else {
            // iterate and compare children lists
            let childrenMatch = true
            let childNode = elm.firstChild
            for (let i = 0; i < children.length; i++) {
              if (
                !childNode ||
                !hydrate(childNode, children[i], insertedVnodeQueue, inVPre)
              ) {
                childrenMatch = false
                break
              }
              childNode = childNode.nextSibling
            }
            // if childNode is not null, it means the actual childNodes list is
            // longer than the virtual children list.
            if (!childrenMatch || childNode) {
              /* istanbul ignore if */
              if (
                __DEV__ &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn(
                  'Mismatching childNodes vs. VNodes: ',
                  elm.childNodes,
                  children
                )
              }
              return false
            }
          }
        }
      }
      if (isDef(data)) {
        let fullInvoke = false
        for (const key in data) {
          if (!isRenderedModule(key)) {
            fullInvoke = true
            invokeCreateHooks(vnode, insertedVnodeQueue)
            break
          }
        }
        if (!fullInvoke && data['class']) {
          // ensure collecting deps for deep class bindings for future updates
          traverse(data['class'])
        }
      }
    } else if (elm.data !== vnode.text) {
      elm.data = vnode.text
    }
    return true
  }

  function assertNodeMatch(node, vnode, inVPre) {
    if (isDef(vnode.tag)) {
      return (
        vnode.tag.indexOf('vue-component') === 0 ||
        (!isUnknownElement(vnode, inVPre) &&
          vnode.tag.toLowerCase() ===
            (node.tagName && node.tagName.toLowerCase()))
      )
    } else {
      return node.nodeType === (vnode.isComment ? 8 : 3)
    }
  }

  return function patch(oldVnode, vnode, hydrating, removeOnly) {
    // 新的vnode不存在
    if (isUndef(vnode)) {
      // 有旧的vnode，说明要销毁
      if (isDef(oldVnode)) invokeDestroyHook(oldVnode)
      return
    }

    let isInitialPatch = false
    const insertedVnodeQueue: any[] = []
    // 旧虚拟节点不存在
    if (isUndef(oldVnode)) {
      // empty mount (likely as component), create new root element
      // 第一次生成节点，首次渲染
      isInitialPatch = true
      createElm(vnode, insertedVnodeQueue)
    } else {
      const isRealElement = isDef(oldVnode.nodeType)
      if (!isRealElement && sameVnode(oldVnode, vnode)) {
        // 如果新旧节点相同，执行 patchVnode
        // patch existing root node
        patchVnode(oldVnode, vnode, insertedVnodeQueue, null, null, removeOnly)
      } else {
        if (isRealElement) {
          // mounting to a real element
          // check if this is server-rendered content and if we can perform
          // a successful hydration.
          if (oldVnode.nodeType === 1 && oldVnode.hasAttribute(SSR_ATTR)) {
            oldVnode.removeAttribute(SSR_ATTR)
            hydrating = true
          }
          if (isTrue(hydrating)) {
            if (hydrate(oldVnode, vnode, insertedVnodeQueue)) {
              invokeInsertHook(vnode, insertedVnodeQueue, true)
              return oldVnode
            } else if (__DEV__) {
              warn(
                'The client-side rendered virtual DOM tree is not matching ' +
                  'server-rendered content. This is likely caused by incorrect ' +
                  'HTML markup, for example nesting block-level elements inside ' +
                  '<p>, or missing <tbody>. Bailing hydration and performing ' +
                  'full client-side render.'
              )
            }
          }
          // either not server-rendered, or hydration failed.
          // create an empty node and replace it
          oldVnode = emptyNodeAt(oldVnode)
        }
        // 父子节点不想听，需要替换节点
        // replacing existing element
        const oldElm = oldVnode.elm
        const parentElm = nodeOps.parentNode(oldElm)
        // 创建新节点
        // create new node
        createElm(
          vnode,
          insertedVnodeQueue,
          // extremely rare edge case: do not insert if old element is in a
          // leaving transition. Only happens when combining transition +
          // keep-alive + HOCs. (#4590)
          oldElm._leaveCb ? null : parentElm,
          nodeOps.nextSibling(oldElm)
        )

        // update parent placeholder node element, recursively
        if (isDef(vnode.parent)) {
          let ancestor = vnode.parent
          // 逐层遍历，直到找到最内层的 DOM 节点，判断它是否有 tag，能否被patch
          const patchable = isPatchable(vnode)
          while (ancestor) {
            // 调用DOM属性的销毁钩子，注意是DOM属性的而不是vue生命周期的
            for (let i = 0; i < cbs.destroy.length; ++i) {
              cbs.destroy[i](ancestor)
            }
            ancestor.elm = vnode.elm
            if (patchable) {
              // 调用DOM属性的创建钩子，注意是DOM属性的而不是vue生命周期的
              for (let i = 0; i < cbs.create.length; ++i) {
                cbs.create[i](emptyNode, ancestor)
              }
              // #6513
              // invoke insert hooks that may have been merged by create hooks.
              // e.g. for directives that uses the "inserted" hook.
              const insert = ancestor.data.hook.insert
              if (insert.merged) {
                // start at index 1 to avoid re-invoking component mounted hook
                // clone insert hooks to avoid being mutated during iteration.
                // e.g. for customed directives under transition group.
                const cloned = insert.fns.slice(1)
                for (let i = 0; i < cloned.length; i++) {
                  cloned[i]()
                }
              }
            } else {
              registerRef(ancestor)
            }
            ancestor = ancestor.parent
          }
        }

        // destroy old node
        if (isDef(parentElm)) {
          removeVnodes([oldVnode], 0, 0)
        } else if (isDef(oldVnode.tag)) {
          invokeDestroyHook(oldVnode)
        }
      }
    }

    invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch)
    return vnode.elm
  }
}
