import { makeMap, isBuiltInTag, cached, no } from 'shared/util'
import { ASTElement, CompilerOptions, ASTNode } from 'types/compiler'

let isStaticKey
let isPlatformReservedTag

const genStaticKeysCached = cached(genStaticKeys)

/**
 * Goal of the optimizer: walk the generated template AST tree
 * and detect sub-trees that are purely static, i.e. parts of
 * the DOM that never needs to change.
 *
 * Once we detect these sub-trees, we can:
 *
 * 1. Hoist them into constants, so that we no longer need to
 *    create fresh nodes for them on each re-render;
 * 2. Completely skip them in the patching process.
 */
export function optimize(
  root: ASTElement | null | undefined,
  options: CompilerOptions
) {
  if (!root) return
  isStaticKey = genStaticKeysCached(options.staticKeys || '')
  // 是否是html 原生标签和svg
  isPlatformReservedTag = options.isReservedTag || no
  // first pass: mark all non-static nodes.
  markStatic(root)
  // second pass: mark static roots.
  markStaticRoots(root, false)
}

function genStaticKeys(keys: string): Function {
  return makeMap(
    'type,tag,attrsList,attrsMap,plain,parent,children,attrs,start,end,rawAttrsMap' +
      (keys ? ',' + keys : '')
  )
}

function markStatic(node: ASTNode) {
  // 是否是静态节点
  node.static = isStatic(node)
  // 如果是元素节点 div p 等
  if (node.type === 1) {
    // do not make component slot content static. this avoids
    // 1. components not able to mutate slot nodes
    // 2. static slot content fails for hot-reloading
    // 如果不是平台保留标签 并且 不是slot 并且没有 inline-template 标记
    // inline-template 标记是 表示子节点当成模版
    if (
      !isPlatformReservedTag(node.tag) &&
      node.tag !== 'slot' &&
      node.attrsMap['inline-template'] == null
    ) {
      return
    }
    // 遍历子节点
    for (let i = 0, l = node.children.length; i < l; i++) {
      const child = node.children[i]
      // 递归处理子节点
      // 子节点不是静态节点则父节点也不是静态节点
      markStatic(child)
      if (!child.static) {
        node.static = false
      }
    }
    // 如果节点有if条件
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        // 遍历所有if分支
        const block = node.ifConditions[i].block
        markStatic(block)
        // 如果任意一个分支不是静态节点 则整个节点不是静态节点
        if (!block.static) {
          node.static = false
        }
      }
    }
  }
}

function markStaticRoots(node: ASTNode, isInFor: boolean) {
  // 如果节点是元素节点
  if (node.type === 1) {
    // 如果节点是静态的或者使用了v-once
    if (node.static || node.once) {
      // 该节点记录在静态for中
      node.staticInFor = isInFor
    }
    // For a node to qualify as a static root, it should have children that
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.
    
    if (
      // 如果节点是静态的
      node.static &&
      // 有子节点
      node.children.length &&
      // // 子节点不能只有一个纯文本节点
      !(node.children.length === 1 && node.children[0].type === 3)
    ) {
      // 节点是一个静态根节点
      node.staticRoot = true
      return
    } else {
      node.staticRoot = false
    }
    // 遍历子节点， 每个子节点和条件分支 都判断是不是一个静态根节点
    if (node.children) {
      for (let i = 0, l = node.children.length; i < l; i++) {
        markStaticRoots(node.children[i], isInFor || !!node.for)
      }
    }
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        markStaticRoots(node.ifConditions[i].block, isInFor)
      }
    }
  }
}

function isStatic(node: ASTNode): boolean {
  // 如果是表达式节点
  if (node.type === 2) {
    // expression
    return false
  }
  // 如果是文本节点
  if (node.type === 3) {
    // text
    return true
  }
  
  return !!(
    // 如果是pre标签 或者
    node.pre ||
    // 如果节点没有绑定属性
    (!node.hasBindings && // no dynamic bindings
      // 没有if条件
      !node.if &&
      // 没有循环
      !node.for && // not v-if or v-for or v-else
      // 不是slot和component标签
      !isBuiltInTag(node.tag) && // not a built-in
      // 是平台保留标签
      isPlatformReservedTag(node.tag) && // not a component
      // 不是for模版的子节点
      !isDirectChildOfTemplateFor(node) &&
      // 所有属性都没有动态绑定
      Object.keys(node).every(isStaticKey))
  )
}

function isDirectChildOfTemplateFor(node: ASTElement): boolean {
  while (node.parent) {
    node = node.parent
    // 如果节点不是template
    if (node.tag !== 'template') {
      return false
    }
  // 如果节点有for
    if (node.for) {
      return true
    }
  }
  return false
}
