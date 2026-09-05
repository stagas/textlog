import type { VNode } from 'preact'
import { renderToStaticMarkup as render } from 'preact-render-to-string'

// React's server renderer emitted class before the remaining attributes. Keep
// that stable HTML contract while the application moves to Preact rendering.
export function renderToStaticMarkup(vnode: VNode<any>) {
  return render(vnode)
    .replace(/<script([^>]*)\/>/gi, '<script$1></script>')
    .replace(/<([a-z][^<>]*?)>/gi, tag => {
    const classAttribute = tag.match(/\sclass="[^"]*"/)
    const classFirst = classAttribute
      ? tag.replace(classAttribute[0], '').replace(/^<([a-z][^\s/>]*)/i, `<$1${classAttribute[0]}`)
      : tag
    const reactBooleans = classFirst.replace(
      /\s(allowfullscreen|async|autofocus|autoplay|checked|controls|default|defer|disabled|formnovalidate|hidden|inert|loop|multiple|muted|nomodule|novalidate|open|playsinline|readonly|required|reversed|selected)(?=[\s/>])/gi,
      ' $1=""',
    )
    const explicitEmptyValues = reactBooleans.replace(/\svalue(?=[\s/>])/gi, ' value=""')
    return explicitEmptyValues.startsWith('<input')
      ? explicitEmptyValues.replace(/\svalue="([^"]*)"\schecked=""/, ' checked="" value="$1"')
      : explicitEmptyValues
    })
}
