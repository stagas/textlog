import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { SerializedMmlVisitor } from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { HTMLMathItem } from 'mathjax-full/js/handlers/html/HTMLMathItem.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import TexError from 'mathjax-full/js/input/tex/TexError.js'
import { mathjax } from 'mathjax-full/js/mathjax.js'

// mathjax-full 3 exposes its native MathML serializer as a visitor rather than
// a browser-oriented output bundle. Keep the whole TeX -> MathML pipeline here
// so this dependency can never enter a client bundle.
class MathMLOutputJax {
  private readonly visitor = new SerializedMmlVisitor()

  render(root: Parameters<SerializedMmlVisitor['visitTree']>[0]) {
    return this.visitor.visitTree(root)
  }
}

class StrictTeX extends TeX<unknown, unknown, unknown> {
  override formatError(error: TexError): never {
    throw error
  }
}

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

// Only the base TeX package is enabled. In particular, the MathJax HTML
// extension is not available to user input.
const tex = new StrictTeX({ packages: ['base'] })
const document = mathjax.document('', { InputJax: tex })
const mathml = new MathMLOutputJax()

export function texToMathML(source: string, display: boolean) {
  try {
    tex.reset()
    const item = new HTMLMathItem(source, tex, display)
    item.compile(document)
    return mathml.render(item.root)
  }
  catch {
    return null
  }
}
