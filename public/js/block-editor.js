// Block editor — renders an ordered list of typed blocks for a Page.
//
// Usage:
//   const editor = window.createBlockEditor(containerEl, { onChange });
//   editor.setBlocks([{ type: 'HERO', props: {...} }, ...]);
//   editor.getBlocks();
//
// Each block becomes a collapsible card with type-specific fields, up/down
// arrows, and a delete button. The "Add block" dropdown appends new blocks.
// Source data is mutated in place; callers read it back with getBlocks().

(function () {
  const SCHEMAS = () => window.BLOCK_SCHEMAS || [];
  const schemaFor = (type) => SCHEMAS().find((s) => s.type === type);

  // Sources for dynamic <select> options (loaded once per editor instance).
  async function loadSources() {
    const sources = { pageBanners: [] };
    try {
      const r = await fetch('/api/banners/admin?placement=PAGE');
      if (r.ok) {
        const d = await r.json();
        sources.pageBanners = (d.banners ?? []).map((b) => ({
          value: b.id,
          label: (b.name?.trim() || b.imageUrl.split('/').pop() || b.id) + (b.isActive ? '' : ' (停用)'),
        }));
      }
    } catch {}
    return sources;
  }

  window.createBlockEditor = function (root, { onChange } = {}) {
    let blocks = [];
    let sources = { pageBanners: [] };
    let sourcesReady = loadSources().then((s) => { sources = s; render(); });

    function fireChange() { if (onChange) onChange(blocks); }

    function addBlock(type) {
      const schema = schemaFor(type);
      if (!schema) return;
      blocks.push({ type, props: JSON.parse(JSON.stringify(schema.defaultProps || {})) });
      render(); fireChange();
    }
    function removeBlock(i) {
      blocks.splice(i, 1);
      render(); fireChange();
    }
    function moveBlock(i, delta) {
      const j = i + delta;
      if (j < 0 || j >= blocks.length) return;
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      render(); fireChange();
    }

    function fieldHtml(field, value, path) {
      const id = 'be-' + Math.random().toString(36).slice(2, 8);
      switch (field.type) {
        case 'text':
        case 'url':
          return `<input id="${id}" data-path="${path}" type="${field.type === 'url' ? 'text' : 'text'}"
                  value="${escapeAttr(value ?? '')}" placeholder="${escapeAttr(field.placeholder ?? '')}"
                  class="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"/>`;
        case 'textarea':
          return `<textarea id="${id}" data-path="${path}" rows="3"
                  placeholder="${escapeAttr(field.placeholder ?? '')}"
                  class="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono">${escapeHtml(value ?? '')}</textarea>`;
        case 'richtext':
          return `<div class="flex gap-2 items-center mt-1 mb-1 text-xs">
                    <button type="button" data-action="insert-image" data-path="${path}" class="px-2 py-1 bg-slate-900 text-white rounded">📷 插入圖片</button>
                    <span class="text-slate-400">支援 HTML</span>
                  </div>
                  <textarea id="${id}" data-path="${path}" rows="6"
                  class="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono">${escapeHtml(value ?? '')}</textarea>`;
        case 'image':
          return `<div class="flex gap-2 mt-1">
                    <input id="${id}" data-path="${path}" type="text" value="${escapeAttr(value ?? '')}"
                      class="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono"/>
                    <button type="button" data-action="pick-image" data-path="${path}" class="px-3 py-2 bg-slate-900 text-white text-xs rounded">媒體庫</button>
                  </div>
                  ${value ? `<img src="${escapeAttr(value)}" class="mt-2 max-h-32 rounded border border-slate-200"/>` : ''}`;
        case 'color':
          return `<input id="${id}" data-path="${path}" type="color" value="${escapeAttr(value || '#ffffff')}"
                  class="mt-1 h-10 w-20 border border-slate-200 rounded"/>`;
        case 'number':
          return `<input id="${id}" data-path="${path}" type="number" value="${escapeAttr(value ?? '')}"
                  class="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"/>`;
        case 'select': {
          const opts = field.source ? (sources[field.source] || []) : (field.options || []);
          const optHtml = [{ value: '', label: '— 請選擇 —' }, ...opts]
            .map((o) => `<option value="${escapeAttr(o.value)}" ${String(value ?? '') === String(o.value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
          return `<select id="${id}" data-path="${path}"
                  class="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">${optHtml}</select>`;
        }
        case 'repeater': {
          const items = Array.isArray(value) ? value : [];
          const itemsHtml = items.map((it, i) => `
            <div class="border border-slate-200 rounded-lg p-3 mb-2 bg-slate-50">
              <div class="flex justify-between items-center mb-2">
                <span class="text-xs text-slate-500 font-semibold">#${i + 1}</span>
                <div class="flex gap-1">
                  <button type="button" data-action="rep-up" data-path="${path}" data-idx="${i}" class="text-xs text-slate-500">▲</button>
                  <button type="button" data-action="rep-down" data-path="${path}" data-idx="${i}" class="text-xs text-slate-500">▼</button>
                  <button type="button" data-action="rep-del" data-path="${path}" data-idx="${i}" class="text-xs text-red-600">×</button>
                </div>
              </div>
              ${field.itemFields.map((sub) => `
                <label class="block mb-2">
                  <span class="text-xs text-slate-500">${escapeHtml(sub.label)}</span>
                  ${fieldHtml(sub, it[sub.key], `${path}[${i}].${sub.key}`)}
                </label>`).join('')}
            </div>`).join('');
          return `<div class="mt-1">${itemsHtml}
                  <button type="button" data-action="rep-add" data-path="${path}" class="text-xs text-teal-600 font-semibold">+ 新增項目</button>
                  </div>`;
        }
      }
      return '';
    }

    function render() {
      const addOptions = SCHEMAS().map((s) =>
        `<button type="button" data-add="${s.type}" class="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-slate-50">
          <span>${s.icon}</span><span class="text-sm">${escapeHtml(s.label)}</span>
        </button>`).join('');

      const cards = blocks.map((b, i) => {
        const schema = schemaFor(b.type);
        if (!schema) return `<div class="bg-red-50 border border-red-200 text-red-700 p-3 rounded">未知區塊類型: ${escapeHtml(b.type)}</div>`;
        const fieldsHtml = schema.fields.map((f) => `
          <label class="block mb-3">
            <span class="text-xs text-slate-500">${escapeHtml(f.label)}</span>
            ${fieldHtml(f, b.props[f.key], `${i}.${f.key}`)}
          </label>`).join('');
        return `
          <details class="bg-white border border-slate-200 rounded-xl mb-3" open>
            <summary class="cursor-pointer px-4 py-3 flex items-center justify-between">
              <span class="font-semibold text-sm flex items-center gap-2">
                <span>${schema.icon}</span><span>${escapeHtml(schema.label)}</span>
                <span class="text-xs text-slate-400">#${i + 1}</span>
              </span>
              <span class="flex items-center gap-1">
                <button type="button" data-action="up" data-idx="${i}" class="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded text-xs">▲</button>
                <button type="button" data-action="down" data-idx="${i}" class="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded text-xs">▼</button>
                <button type="button" data-action="del" data-idx="${i}" class="px-2 py-1 text-red-600 hover:bg-red-50 rounded text-xs">🗑️</button>
              </span>
            </summary>
            <div class="px-4 pb-4 border-t border-slate-100 pt-3">${fieldsHtml}</div>
          </details>`;
      }).join('') || `<p class="text-slate-400 text-center py-8 text-sm">尚未加入任何區塊。點擊下方「+ 加入區塊」開始設計頁面。</p>`;

      root.innerHTML = `
        <div id="beList">${cards}</div>
        <div class="relative inline-block mt-3">
          <button type="button" id="beAddBtn" class="bg-teal-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-teal-700">+ 加入區塊</button>
          <div id="beAddMenu" class="hidden absolute z-10 left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg w-64">${addOptions}</div>
        </div>`;
      attach();
    }

    function setByPath(path, value) {
      // path like "2.title" or "1.items[0].question"
      const tokens = path.split('.');
      const idx = parseInt(tokens.shift(), 10);
      let cur = blocks[idx].props;
      while (tokens.length > 1) {
        const t = tokens.shift();
        const m = t.match(/^(\w+)(?:\[(\d+)\])?$/);
        cur = cur[m[1]];
        if (m[2] !== undefined) cur = cur[parseInt(m[2], 10)];
      }
      const last = tokens[0];
      const m = last.match(/^(\w+)(?:\[(\d+)\])?$/);
      if (m[2] !== undefined) cur[m[1]][parseInt(m[2], 10)] = value;
      else cur[m[1]] = value;
      fireChange();
    }

    function getRepeaterRef(path) {
      const tokens = path.split('.');
      const idx = parseInt(tokens.shift(), 10);
      let cur = blocks[idx].props;
      for (const t of tokens) cur = cur[t];
      return cur;
    }

    function attach() {
      const list = root.querySelector('#beList');
      const addBtn = root.querySelector('#beAddBtn');
      const addMenu = root.querySelector('#beAddMenu');

      addBtn.addEventListener('click', () => addMenu.classList.toggle('hidden'));
      addMenu.querySelectorAll('[data-add]').forEach((b) =>
        b.addEventListener('click', () => { addMenu.classList.add('hidden'); addBlock(b.dataset.add); }));

      list.querySelectorAll('[data-action="up"]').forEach((b) =>
        b.addEventListener('click', () => moveBlock(+b.dataset.idx, -1)));
      list.querySelectorAll('[data-action="down"]').forEach((b) =>
        b.addEventListener('click', () => moveBlock(+b.dataset.idx, +1)));
      list.querySelectorAll('[data-action="del"]').forEach((b) =>
        b.addEventListener('click', () => { if (confirm('刪除此區塊？')) removeBlock(+b.dataset.idx); }));

      // Field inputs
      list.querySelectorAll('[data-path]').forEach((el) => {
        el.addEventListener('input', () => {
          const v = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
          setByPath(el.dataset.path, v);
          if (el.type === 'color' || el.tagName === 'SELECT') render();
        });
      });

      // Image picker buttons
      list.querySelectorAll('[data-action="pick-image"]').forEach((b) =>
        b.addEventListener('click', async () => {
          const url = await window.openMediaPicker();
          if (url) { setByPath(b.dataset.path, url); render(); }
        }));
      // RichText: insert image into textarea
      list.querySelectorAll('[data-action="insert-image"]').forEach((b) =>
        b.addEventListener('click', async () => {
          const url = await window.openMediaPicker();
          if (!url) return;
          const ta = root.querySelector(`textarea[data-path="${b.dataset.path}"]`);
          const tag = `<img src="${url}" alt=""/>`;
          const s = ta.selectionStart, e = ta.selectionEnd;
          ta.value = ta.value.slice(0, s) + tag + ta.value.slice(e);
          setByPath(b.dataset.path, ta.value);
        }));

      // Repeater actions
      list.querySelectorAll('[data-action="rep-add"]').forEach((b) =>
        b.addEventListener('click', () => {
          const arr = getRepeaterRef(b.dataset.path);
          arr.push({}); render(); fireChange();
        }));
      list.querySelectorAll('[data-action="rep-del"]').forEach((b) =>
        b.addEventListener('click', () => {
          const arr = getRepeaterRef(b.dataset.path);
          arr.splice(+b.dataset.idx, 1); render(); fireChange();
        }));
      list.querySelectorAll('[data-action="rep-up"]').forEach((b) =>
        b.addEventListener('click', () => {
          const arr = getRepeaterRef(b.dataset.path);
          const i = +b.dataset.idx; if (i <= 0) return;
          [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]; render(); fireChange();
        }));
      list.querySelectorAll('[data-action="rep-down"]').forEach((b) =>
        b.addEventListener('click', () => {
          const arr = getRepeaterRef(b.dataset.path);
          const i = +b.dataset.idx; if (i >= arr.length - 1) return;
          [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]; render(); fireChange();
        }));
    }

    return {
      setBlocks(arr) {
        blocks = (arr || []).map((b) => ({
          type: b.type,
          props: typeof b.props === 'string' ? safeParse(b.props) : (b.props || {}),
        }));
        render();
      },
      getBlocks() {
        return blocks.map((b) => ({ type: b.type, props: b.props }));
      },
      reload: () => sourcesReady = loadSources().then((s) => { sources = s; render(); }),
    };
  };

  function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
