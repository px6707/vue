import { emptyNode } from 'core/vdom/patch'
import { resolveAsset, handleError } from 'core/util/index'
import { mergeVNodeHook } from 'core/vdom/helpers/index'
import type { VNodeDirective, VNodeWithData } from 'types/vnode'
import type { Component } from 'types/component'

export default {
  create: updateDirectives,
  update: updateDirectives,
  destroy: function unbindDirectives(vnode: VNodeWithData) {
    // @ts-expect-error emptyNode is not VNodeWithData
    updateDirectives(vnode, emptyNode)
  }
}

function updateDirectives(oldVnode: VNodeWithData, vnode: VNodeWithData) {
  if (oldVnode.data.directives || vnode.data.directives) {
    _update(oldVnode, vnode)
  }
}

function _update(oldVnode, vnode) {
  // 没有oldVnode时,就是创建
  const isCreate = oldVnode === emptyNode
  // 当前新vnode时，就是销毁
  const isDestroy = vnode === emptyNode
  // 格式化指令
  const oldDirs = normalizeDirectives(
    oldVnode.data.directives,
    oldVnode.context
  )
  const newDirs = normalizeDirectives(vnode.data.directives, vnode.context)

  const dirsWithInsert: any[] = []
  const dirsWithPostpatch: any[] = []

  let key, oldDir, dir
  for (key in newDirs) {
    oldDir = oldDirs[key]
    dir = newDirs[key]
    if (!oldDir) {
      // new directive, bind
      // 如果没有旧指令，说明当前是新指令，调用 bind钩子，在insert数组中添加
      callHook(dir, 'bind', vnode, oldVnode)
      if (dir.def && dir.def.inserted) {
        dirsWithInsert.push(dir)
      }
    } else {
      // existing directive, update
      dir.oldValue = oldDir.value
      dir.oldArg = oldDir.arg
      // 旧指令存在，调用 update钩子，在需要更新的数组中添加
      callHook(dir, 'update', vnode, oldVnode)
      if (dir.def && dir.def.componentUpdated) {
        dirsWithPostpatch.push(dir)
      }
    }
  }

  if (dirsWithInsert.length) {
    // 对需要创建的指令，创建对应的调用inserted钩子的函数
    const callInsert = () => {
      for (let i = 0; i < dirsWithInsert.length; i++) {
        callHook(dirsWithInsert[i], 'inserted', vnode, oldVnode)
      }
    }
    if (isCreate) {
      // 如果是创建阶段，把当前需要执行的函数合并到insert钩子中
      mergeVNodeHook(vnode, 'insert', callInsert)
    } else {
      callInsert()
    }
  }

  if (dirsWithPostpatch.length) {
    // 对需要更新的指令，创建对应的调用componentUpdated钩子的函数，并把函数合并到postpatch钩子中
    mergeVNodeHook(vnode, 'postpatch', () => {
      for (let i = 0; i < dirsWithPostpatch.length; i++) {
        callHook(dirsWithPostpatch[i], 'componentUpdated', vnode, oldVnode)
      }
    })
  }

  if (!isCreate) {
    for (key in oldDirs) {
      // 如果新指令不存在，调用 unbind 钩子
      if (!newDirs[key]) {
        // no longer present, unbind
        callHook(oldDirs[key], 'unbind', oldVnode, oldVnode, isDestroy)
      }
    }
  }
}

const emptyModifiers = Object.create(null)

function normalizeDirectives(
  dirs: Array<VNodeDirective> | undefined,
  vm: Component
): { [key: string]: VNodeDirective } {
  const res = Object.create(null)
  // 不存在指令，返回空对象
  if (!dirs) {
    // $flow-disable-line
    return res
  }
  let i: number, dir: VNodeDirective
  for (i = 0; i < dirs.length; i++) {
    dir = dirs[i]
    if (!dir.modifiers) {
      // $flow-disable-line
      dir.modifiers = emptyModifiers
    }
    res[getRawDirName(dir)] = dir
    if (vm._setupState && vm._setupState.__sfc) {
      const setupDef = dir.def || resolveAsset(vm, '_setupState', 'v-' + dir.name)
      if (typeof setupDef === 'function') {
        dir.def = {
          bind: setupDef,
          update: setupDef,
        }
      } else {
        dir.def = setupDef
      }
    }
    // 如果 dir.def 已存在，直接使用；如果没有缓存，使用 resolveAsset 支持不同的命名方式（原始/驼峰/首字母大写）
    dir.def = dir.def || resolveAsset(vm.$options, 'directives', dir.name, true)
  }
  // $flow-disable-line
  return res
}

function getRawDirName(dir: VNodeDirective): string {
  return (
    dir.rawName || `${dir.name}.${Object.keys(dir.modifiers || {}).join('.')}`
  )
}

function callHook(dir, hook, vnode, oldVnode, isDestroy?: any) {
  const fn = dir.def && dir.def[hook]
  if (fn) {
    try {
      fn(vnode.elm, dir, vnode, oldVnode, isDestroy)
    } catch (e: any) {
      handleError(e, vnode.context, `directive ${dir.name} ${hook} hook`)
    }
  }
}
