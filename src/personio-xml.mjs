function decode(value) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(value)) {
    throw new TypeError('personio: invalid XML entity');
  }
  return value.replace(/&([^;]+);/g, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) return named[entity];
    const code = entity.startsWith('#x')
      ? Number.parseInt(entity.slice(2), 16)
      : Number(entity.slice(1));
    if (!(code === 9 || code === 10 || code === 13 ||
        (code >= 0x20 && code <= 0xD7FF) ||
        (code >= 0xE000 && code <= 0xFFFD) ||
        (code >= 0x10000 && code <= 0x10FFFF))) {
      throw new TypeError('personio: invalid XML character reference');
    }
    return String.fromCodePoint(code);
  });
}

/** Read only the public Personio feed format; never resolve external entities. */
export function parsePersonioXml(xml) {
  if (typeof xml !== 'string') throw new TypeError('personio: expected XML text');
  const document = { name: '#document', children: [], text: '' };
  const stack = [document];
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?xml\s[\s\S]*?\?>|<(?:[^"'<>]|"[^"]*"|'[^']*')*>|[^<]+/gy;
  let offset = 0;
  while (offset < xml.length) {
    tokens.lastIndex = offset;
    const match = tokens.exec(xml);
    if (!match) throw new TypeError('personio: malformed XML');
    const token = match[0];
    offset = tokens.lastIndex;
    const parent = stack.at(-1);
    if (token.startsWith('<!--')) {
      if (token.slice(4, -3).includes('--')) throw new TypeError('personio: malformed XML comment');
      continue;
    }
    if (token.startsWith('<?xml')) {
      if (stack.length !== 1 || document.children.length || document.text.trim()) {
        throw new TypeError('personio: misplaced XML declaration');
      }
      continue;
    }
    if (token.startsWith('<![CDATA[')) {
      if (stack.length === 1) throw new TypeError('personio: CDATA outside root');
      parent.text += token.slice(9, -3);
      continue;
    }
    if (!token.startsWith('<')) {
      if (token.includes(']]>')) throw new TypeError('personio: malformed XML text');
      parent.text += decode(token);
      continue;
    }
    const closing = /^<\/([A-Za-z_][\w.-]*)\s*>$/.exec(token);
    if (closing) {
      if (stack.length === 1 || parent.name !== closing[1]) {
        throw new TypeError('personio: mismatched XML closing tag');
      }
      stack.pop();
      continue;
    }
    const opening = /^<([A-Za-z_][\w.-]*)(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*(\/?)>$/.exec(token);
    if (!opening) throw new TypeError('personio: unsupported or malformed XML declaration/tag');
    const node = { name: opening[1], children: [], text: '' };
    parent.children.push(node);
    if (!opening[2]) stack.push(node);
  }
  if (stack.length !== 1 || document.text.trim() || document.children.length !== 1 ||
      document.children[0].name !== 'workzag-jobs') {
    throw new TypeError('personio: unexpected or incomplete XML document');
  }
  const root = document.children[0];
  if (root.text.trim() || root.children.some(node => node.name !== 'position')) {
    throw new TypeError('personio: unexpected feed contents');
  }
  return root.children.map(position => {
    if (position.text.trim()) throw new TypeError('personio: unexpected position text');
    const result = {};
    for (const name of ['id', 'name', 'office', 'department', 'createdAt']) {
      const nodes = position.children.filter(node => node.name === name);
      if (nodes.length > 1 || nodes[0]?.children.length) {
        throw new TypeError(`personio: invalid ${name} field`);
      }
      result[name] = nodes[0]?.text.trim() || null;
    }
    if (!result.id) throw new TypeError('personio: position has no valid ID');
    return result;
  });
}
