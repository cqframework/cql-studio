// Author: Preston Lee

/** Pretty-print ELM XML for display in the pipeline view. */

export function formatElmXml(xmlString: string): string {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      return xmlString;
    }
    return formatXmlNode(xmlDoc.documentElement, 0);
  } catch {
    return xmlString;
  }
}

function formatXmlNode(node: Node, indent: number): string {
  const indentStr = '  '.repeat(indent);
  let result = '';

  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const tagName = element.tagName;
    let attrs = '';
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      attrs += ` ${attr.name}="${escapeXml(attr.value)}"`;
    }
    const hasChildren =
      element.childNodes.length > 0 &&
      Array.from(element.childNodes).some(
        n =>
          n.nodeType === Node.ELEMENT_NODE ||
          (n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0)
      );

    if (!hasChildren) {
      result += `${indentStr}<${tagName}${attrs} />\n`;
    } else {
      result += `${indentStr}<${tagName}${attrs}>\n`;
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          result += formatXmlNode(child, indent + 1);
        } else if (child.nodeType === Node.TEXT_NODE && child.textContent) {
          const text = child.textContent.trim();
          if (text.length > 0) {
            result += `${'  '.repeat(indent + 1)}${escapeXml(text)}\n`;
          }
        }
      }
      result += `${indentStr}</${tagName}>\n`;
    }
  }

  return result;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
