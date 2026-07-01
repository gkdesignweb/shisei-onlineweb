// Reusable media picker. Other admin pages call:
//   const url = await window.openMediaPicker();
// Resolves to a public URL string, or null if cancelled.
window.openMediaPicker = function () {
  return new Promise((resolve) => {
    let modal = document.getElementById('__mediaPicker');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = '__mediaPicker';
      modal.className = 'fixed inset-0 bg-black/60 z-[10000] hidden grid place-items-center p-4';
      modal.innerHTML = `
        <div class="bg-white rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
          <div class="p-5 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold">選擇媒體（圖片 / 影片）</h3>
            <div class="flex items-center gap-2">
              <label class="text-xs bg-teal-600 text-white px-3 py-1.5 rounded cursor-pointer">
                ⤴ 上傳新媒體
                <input id="__mpUpload" type="file" accept="image/*,video/*" multiple class="hidden"/>
              </label>
              <button id="__mpClose" class="text-sm text-slate-500 hover:text-slate-900">✕</button>
            </div>
          </div>
          <div id="__mpGrid" class="p-5 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 overflow-y-auto flex-1"></div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('#__mpClose').addEventListener('click', () => closePicker(null));
      modal.addEventListener('click', (e) => { if (e.target === modal) closePicker(null); });
      modal.querySelector('#__mpUpload').addEventListener('change', uploadFiles);
    }

    async function loadGrid() {
      const { items } = await fetch('/api/admin/media').then(r=>r.json());
      const grid = modal.querySelector('#__mpGrid');
      if (items.length === 0) {
        grid.innerHTML = '<p class="col-span-full text-sm text-slate-500 text-center py-8">尚無圖片，請先上傳。</p>';
        return;
      }
      grid.innerHTML = items.map(m => {
        const isVid = (m.mimeType || '').startsWith('video/');
        const thumb = isVid
          ? `<video src="${m.url}" muted playsinline preload="metadata" class="w-full h-full object-cover"></video>
             <span class="absolute top-1 left-1 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded">▶</span>`
          : `<img src="${m.url}" alt="" class="w-full h-full object-cover"/>`;
        return `
        <button data-url="${m.url}" class="group aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-teal-500 bg-slate-100 relative">
          ${thumb}
          <span class="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] py-0.5 px-1 truncate opacity-0 group-hover:opacity-100">${m.originalName}</span>
        </button>`;
      }).join('');
      grid.querySelectorAll('button[data-url]').forEach(b => {
        b.addEventListener('click', () => closePicker(b.dataset.url));
      });
    }

    async function uploadFiles(e) {
      const fd = new FormData();
      [...e.target.files].forEach(f => fd.append('files', f));
      const r = await fetch('/api/admin/media', { method:'POST', body: fd });
      if (!r.ok) { alert('上傳失敗'); return; }
      e.target.value = '';
      loadGrid();
    }

    function closePicker(url) {
      modal.classList.add('hidden');
      const cur = window.__mpResolve;
      window.__mpResolve = null;
      if (cur) cur(url);
    }

    window.__mpResolve = resolve;
    modal.classList.remove('hidden');
    loadGrid();
  });
};
