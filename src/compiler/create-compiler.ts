import { extend } from 'shared/util'
import { CompilerOptions, CompiledResult, WarningMessage } from 'types/compiler'
import { detectErrors } from './error-detector'
import { createCompileToFunctionFn } from './to-function'

// 创建编译器
export function createCompilerCreator(baseCompile: Function): Function {
  // 创建一个基础的编译器
  return function createCompiler(baseOptions: CompilerOptions) {
    function compile(
      template: string,
      options?: CompilerOptions
    ): CompiledResult {
      const finalOptions = Object.create(baseOptions)
      const errors: WarningMessage[] = []
      const tips: WarningMessage[] = []

      let warn = (
        msg: WarningMessage,
        range: { start: number; end: number },
        tip: string
      ) => {
        ;(tip ? tips : errors).push(msg)
      }

      if (options) {
        // 是否在开发环境下开启编译调试
        if (__DEV__ && options.outputSourceRange) {
          // 计算模版开头的空格，用来精确计算错误位置
          // $flow-disable-line
          const leadingSpaceLength = template.match(/^\s*/)![0].length

          warn = (
            msg: WarningMessage | string,
            range: { start: number; end: number },
            tip: string
          ) => {
            // 错误信息统一成对象
            const data: WarningMessage = typeof msg === 'string' ? { msg } : msg
            if (range) {
              // 错误信息的开始结束位置都要加上开头空格，用来精确计算
              if (range.start != null) {
                data.start = range.start + leadingSpaceLength
              }
              if (range.end != null) {
                data.end = range.end + leadingSpaceLength
              }
            }
            ;(tip ? tips : errors).push(data)
          }
        }
        // 模块机制，处理标签上的不同module，例如class、style、model，这里合并自定义module，latforms/web/compiler/modules 中定义了 web 平台的默认模块
        // merge custom modules
        if (options.modules) {
          finalOptions.modules = (baseOptions.modules || []).concat(
            options.modules
          )
        }
        // 合并自定义指令处理
        // merge custom directives
        if (options.directives) {
          finalOptions.directives = extend(
            Object.create(baseOptions.directives || null),
            options.directives
          )
        }
        // copy other options
        for (const key in options) {
          if (key !== 'modules' && key !== 'directives') {
            finalOptions[key] = options[key as keyof CompilerOptions]
          }
        }
      }

      finalOptions.warn = warn

      const compiled = baseCompile(template.trim(), finalOptions)
      if (__DEV__) {
        detectErrors(compiled.ast, warn)
      }
      compiled.errors = errors
      compiled.tips = tips
      // 返回编译结果
      return compiled
    }

    return {
      compile,
      compileToFunctions: createCompileToFunctionFn(compile)
    }
  }
}
