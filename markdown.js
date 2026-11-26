// Small, safe Markdown renderer for EduCator answers.
// All text is HTML-escaped before any markup is added, so model output can never inject HTML.
// Supports headings, bold/italic/strikethrough, inline + fenced code, lists (nested), blockquotes,
// tables, horizontal rules, links, and LaTeX math ($...$, $$...$$, \(...\), \[...\]) via KaTeX when loaded.
(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Models often put plain words inside math ("$Density = \\frac{mass}{volume}$"). KaTeX would set
  // every letter as a separate italic variable, so runs of real words are wrapped in \\text{} first.
  function tidyTex(tex) {
    const keep = [];
    const held = tex.replace(/\\(?:text|textbf|textit|mathrm|mathbf|mathit|operatorname|mbox|begin|end)\s*\{[^{}]*\}/g, (m) => `\u0001${keep.push(m) - 1}\u0001`);
    const wrapped = held.replace(/(^|[^\\A-Za-z])([A-Za-z]{3,}(?:[ \t]+[A-Za-z]{2,})*)/g, (m, pre, words) => `${pre}\\text{${words}}`);
    return wrapped.replace(/\u0001(\d+)\u0001/g, (m, n) => keep[+n]);
  }

  function renderMath(tex, display) {
    if (window.katex) {
      try { return window.katex.renderToString(tidyTex(tex), { displayMode: display, throwOnError: false, output: 'html' }); } catch {}
    }
    return display ? `<div class="math-fallback">${esc(tex)}</div>` : `<code>${esc(tex)}</code>`;
  }

  function renderMarkdown(source) {
    const slots = [];
    const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;
    let text = String(source || '').replace(/\r\n?/g, '\n');

    // 1. Pull out code and math first so their contents are never treated as Markdown.
    text = text.replace(/^```[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)(?:^```[ \t]*$|(?![\s\S]))/gm, (_, lang, code) =>
      '\n' + hold(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(code.replace(/\n$/, ''))}</code></pre>`) + '\n');
    text = text.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));
    text = text.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_, a, b) => '\n' + hold(`<div class="math-display">${renderMath((a || b).trim(), true)}</div>`) + '\n');
    text = text.replace(/\\\((.+?)\\\)|(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, (m, a, pre, b) =>
      a !== undefined ? hold(renderMath(a, false)) : pre + hold(renderMath(b, false)));

    // 2. A backslash-escaped dollar sign is just a dollar sign. Then escape everything else.
    text = esc(text.replace(/\\\$/g, '$'));

    const inline = (s) => s
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`))
      .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');

    // 3. Block structure.
    const lines = text.split('\n');
    const out = [];
    let i = 0;
    const isListItem = (l) => /^(\s*)([-*+]|\d+[.)])\s+/.test(l);
    const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
    const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    const isBlockStart = (l) => /^\s*$/.test(l) || /^#{1,6}\s/.test(l) || /^\s*&gt;/.test(l) || isListItem(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) || /^\u0000\d+\u0000$/.test(l.trim());
    const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));

    function parseList(start) {
      const baseIndent = lines[start].match(/^\s*/)[0].length;
      const ordered = /^\s*\d/.test(lines[start]);
      const items = [];
      let j = start;
      while (j < lines.length) {
        const line = lines[j];
        if (/^\s*$/.test(line)) { // blank line: continue list only if the next line is a list item at this level or deeper
          if (j + 1 < lines.length && isListItem(lines[j + 1]) && lines[j + 1].match(/^\s*/)[0].length >= baseIndent) { j++; continue; }
          break;
        }
        const indent = line.match(/^\s*/)[0].length;
        if (isListItem(line) && indent === baseIndent) {
          items.push({ text: line.replace(/^\s*([-*+]|\d+[.)])\s+/, ''), children: '' });
          j++;
        } else if (isListItem(line) && indent > baseIndent && items.length) {
          const nested = parseList(j);
          items[items.length - 1].children += nested.html;
          j = nested.end;
        } else if (indent > baseIndent && items.length && !isBlockStart(line)) {
          items[items.length - 1].text += ' ' + line.trim();
          j++;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const startNum = ordered ? parseInt(lines[start].trim(), 10) : 1;
      return { html: `<${tag}${ordered && startNum !== 1 ? ` start="${startNum}"` : ''}>${items.map((it) => `<li>${inline(it.text)}${it.children}</li>`).join('')}</${tag}>`, end: j };
    }

    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      if (/^\u0000\d+\u0000$/.test(line.trim())) { out.push(line.trim()); i++; continue; }
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) { const level = Math.min(m[1].length + 1, 6); out.push(`<h${level}>${inline(m[2])}</h${level}>`); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s*&gt;/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*&gt;/.test(lines[i])) quote.push(lines[i++].replace(/^\s*&gt;\s?/, ''));
        out.push(`<blockquote>${inline(quote.join('<br>'))}</blockquote>`);
        continue;
      }
      if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const body = [];
        while (i < lines.length && isTableRow(lines[i])) body.push(cells(lines[i++]));
        out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (isListItem(line)) { const list = parseList(i); out.push(list.html); i = list.end; continue; }
      const para = [line.trim()];
      i++;
      while (i < lines.length && !isBlockStart(lines[i]) && !(isTableRow(lines[i]) && isTableSep(lines[i + 1] || ''))) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join('<br>'))}</p>`);
    }

    // 4. Restore held code/math/links (twice, since links can wrap held inline code).
    let html = out.join('');
    for (let pass = 0; pass < 2; pass++) html = html.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[+n]);
    return html;
  }

  window.renderMarkdown = renderMarkdown;
})();
