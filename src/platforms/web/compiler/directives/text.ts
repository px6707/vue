import { addProp } from 'compiler/helpers'
import { ASTDirective, ASTElement } from 'types/compiler'

export default function text(el: ASTElement, dir: ASTDirective) {
  if (dir.value) {
    // 给节点添加props，值为
    // {
    //   name: 'textContent',
    //   value: `_s(${dir.value})`,
    //   start: dir.start,
    //   end: dir.end
    // }
    addProp(el, 'textContent', `_s(${dir.value})`, dir)
  }
}
