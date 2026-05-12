(function () {
  'use strict';

  const ROW_CLASS = {
    added: 'argocm-row-added',
    removed: 'argocm-row-removed',
    changed: 'argocm-row-changed',
  };

  // ===== DATA EXTRACTION =====

  function extractDataSection(lines) {
    let inDataSection = false;
    const pairs = {};
    let i = 0;

    while (i < lines.length) {
      const trimmed = lines[i].trimEnd();

      if (trimmed === 'data:') {
        inDataSection = true;
        i++;
        continue;
      }

      if (!inDataSection) { i++; continue; }

      const match = trimmed.match(/^(\s*)(\S.*)/);
      if (!match) { i++; continue; }

      const indent = match[1].length;
      const content = match[2];

      if (indent === 0) {
        inDataSection = false;
        i++;
        continue;
      }

      const kvMatch = content.match(/^([^:]+):\s*(.*)/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        let value = kvMatch[2].trim();

        // Multi-line scalar. Strip the block's common leading indentation
        // (per YAML spec) so relative indentation inside the block is preserved.
        if (value === '>' || value === '|') {
          const blockLines = [];
          let blockIndent = null;
          i++;
          while (i < lines.length) {
            const nextLine = lines[i];
            const nextMatch = nextLine.match(/^(\s+)(.*)$/);
            if (nextMatch && nextMatch[1].length > indent) {
              if (blockIndent === null) blockIndent = nextMatch[1].length;
              blockLines.push(nextLine.slice(blockIndent).trimEnd());
              i++;
            } else {
              break;
            }
          }
          value = blockLines.join('\n');
        }

        pairs[key] = value;
      }

      i++;
    }

    return pairs;
  }

  function extractConfigMapDiffs() {
    const diffContainers = document.querySelectorAll(
      '.white-box.application-component-diff__diff'
    );
    const deletedConfigMaps = [];
    const insertedConfigMaps = [];

    diffContainers.forEach((container) => {
      const titleEl = container.querySelector(
        '.application-resources-diff__diff__title'
      );
      const title = titleEl ? titleEl.textContent.trim() : '';
      if (!title.toLowerCase().includes('configmap')) return;

      const deleteLines = [];
      const insertLines = [];
      container.querySelectorAll('.diff-code-delete').forEach(cell => {
        deleteLines.push(cell.textContent);
      });
      container.querySelectorAll('.diff-code-insert').forEach(cell => {
        insertLines.push(cell.textContent);
      });

      const titleMatch = title.match(/\/ConfigMap\/[^\/]+\/(.+)/);
      const name = titleMatch ? titleMatch[1] : title;

      if (deleteLines.length > 0 && insertLines.length === 0) {
        deletedConfigMaps.push({ name, title, data: extractDataSection(deleteLines) });
      } else if (insertLines.length > 0 && deleteLines.length === 0) {
        insertedConfigMaps.push({ name, title, data: extractDataSection(insertLines) });
      }
    });

    return { deletedConfigMaps, insertedConfigMaps };
  }

  function getBaseName(name) {
    return name.replace(/-[a-z0-9]{8,12}$/, '');
  }

  function pairConfigMaps(deleted, inserted) {
    const byBase = new Map();
    inserted.forEach((cm, idx) => {
      const base = getBaseName(cm.name);
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push({ cm, idx });
    });

    const pairs = [];
    const usedInserted = new Set();

    deleted.forEach(oldCm => {
      const candidates = byBase.get(getBaseName(oldCm.name)) || [];
      const match = candidates.find(c => !usedInserted.has(c.idx));
      if (match) {
        usedInserted.add(match.idx);
        pairs.push({ old: oldCm, new: match.cm });
      } else {
        pairs.push({ old: oldCm, new: null });
      }
    });

    inserted.forEach((newCm, idx) => {
      if (!usedInserted.has(idx)) {
        pairs.push({ old: null, new: newCm });
      }
    });

    return pairs;
  }

  // ===== UI RENDERING =====

  function h(tag, opts = {}) {
    const node = document.createElement(tag);
    if (opts.className) node.className = opts.className;
    if (opts.id) node.id = opts.id;
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.title) node.title = opts.title;
    if (opts.children) opts.children.forEach(c => c && node.appendChild(c));
    return node;
  }

  function buildValueCell(className, value, isNa) {
    const td = h('td', { className });
    if (isNa) {
      td.classList.add('argocm-na');
      td.textContent = '—';
    } else {
      td.textContent = value;
    }
    return td;
  }

  function buildPairElement(pair) {
    const oldCm = pair.old;
    const newCm = pair.new;

    const allKeys = new Set([
      ...(oldCm ? Object.keys(oldCm.data) : []),
      ...(newCm ? Object.keys(newCm.data) : []),
    ]);
    const sortedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b));

    const tbody = h('tbody');
    let hasRow = false;

    for (const key of sortedKeys) {
      const oldVal = oldCm?.data[key] ?? null;
      const newVal = newCm?.data[key] ?? null;

      let rowClass;
      if (oldVal === null && newVal !== null) rowClass = ROW_CLASS.added;
      else if (oldVal !== null && newVal === null) rowClass = ROW_CLASS.removed;
      else if (oldVal !== newVal) rowClass = ROW_CLASS.changed;
      else continue;

      hasRow = true;
      tbody.appendChild(h('tr', {
        className: rowClass,
        children: [
          h('td', { className: 'argocm-key', text: key }),
          buildValueCell('argocm-val-old', oldVal, oldVal === null),
          buildValueCell('argocm-val-new', newVal, newVal === null),
        ],
      }));
    }

    if (!hasRow) return null;

    return h('div', {
      className: 'argocm-pair',
      children: [
        h('div', {
          className: 'argocm-pair-names',
          children: [
            h('span', { className: 'argocm-cm-name argocm-old-name', text: oldCm ? oldCm.name : '(none)' }),
            h('span', { className: 'argocm-arrow', text: '→' }),
            h('span', { className: 'argocm-cm-name argocm-new-name', text: newCm ? newCm.name : '(none)' }),
          ],
        }),
        h('table', {
          className: 'argocm-table',
          children: [
            h('thead', { children: [
              h('tr', { children: [
                h('th', { text: 'Key' }),
                h('th', { className: 'argocm-th-old', text: 'Old Value' }),
                h('th', { className: 'argocm-th-new', text: 'New Value' }),
              ]}),
            ]}),
            tbody,
          ],
        }),
        h('div', {
          className: 'argocm-legend',
          children: [
            h('span', { className: 'argocm-badge argocm-badge-added', text: '● Added' }),
            h('span', { className: 'argocm-badge argocm-badge-removed', text: '● Removed' }),
            h('span', { className: 'argocm-badge argocm-badge-changed', text: '● Changed' }),
          ],
        }),
      ],
    });
  }

  function buildEmptyMessage(lines) {
    const div = h('div', { className: 'argocm-empty' });
    lines.forEach((line, idx) => {
      if (idx > 0) div.appendChild(h('br'));
      div.appendChild(document.createTextNode(line));
    });
    return div;
  }

  function buildBodyChildren(pairs) {
    if (pairs.length === 0) {
      return [buildEmptyMessage([
        'No ConfigMap pairs found.',
        'Make sure you are on the Argo CD DIFF tab with ConfigMapGenerator-managed ConfigMaps.',
      ])];
    }

    const pairEls = pairs.map(buildPairElement).filter(Boolean);
    if (pairEls.length === 0) {
      return [buildEmptyMessage([
        'No ConfigMap data changes found.',
        'Only added, removed, and changed keys are shown.',
      ])];
    }

    const children = [];
    pairEls.forEach((p, idx) => {
      if (idx > 0) children.push(h('hr', { className: 'argocm-separator' }));
      children.push(p);
    });
    return children;
  }

  function makeDraggable(target, handle) {
    let startX, startY, origLeft, origTop, activePointer = null;

    handle.addEventListener('pointerdown', (e) => {
      activePointer = e.pointerId;
      handle.setPointerCapture(activePointer);
      startX = e.clientX;
      startY = e.clientY;
      const rect = target.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointer) return;
      target.style.left = (origLeft + e.clientX - startX) + 'px';
      target.style.top = (origTop + e.clientY - startY) + 'px';
      target.style.right = 'auto';
      target.style.bottom = 'auto';
    });

    const endDrag = (e) => {
      if (e.pointerId !== activePointer) return;
      handle.releasePointerCapture(activePointer);
      activePointer = null;
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  function showDiffOverlay() {
    const existing = document.getElementById('argocm-diff-overlay');
    if (existing) { existing.remove(); return; }

    const { deletedConfigMaps, insertedConfigMaps } = extractConfigMapDiffs();
    const pairs = pairConfigMaps(deletedConfigMaps, insertedConfigMaps);

    const overlay = h('div', { id: 'argocm-diff-overlay' });

    const closeBtn = h('button', { id: 'argocm-close', text: '✕', title: 'Close' });
    closeBtn.addEventListener('click', () => overlay.remove());

    const header = h('div', {
      id: 'argocm-header',
      children: [
        h('span', { id: 'argocm-title', text: '⚙️ ConfigMap Data Diff' }),
        closeBtn,
      ],
    });

    const body = h('div', {
      id: 'argocm-body',
      children: buildBodyChildren(pairs),
    });

    overlay.appendChild(header);
    overlay.appendChild(body);

    makeDraggable(overlay, header);
    document.body.appendChild(overlay);
  }

  showDiffOverlay();
})();
