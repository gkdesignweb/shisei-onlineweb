// Block editor schema — single source of truth for the page block editor.
// The server-side renderer (src/lib/blocks.js) reads the same `props` shape.
// Field types: text | textarea | richtext | url | image | color | number | select | repeater
//
// Each block has:
//   type:          internal id (matches PageBlock.type column + server renderer)
//   icon, label:   admin UI affordances
//   defaultProps:  initial values when block is added
//   fields:        ordered list of input fields

window.BLOCK_SCHEMAS = [
  {
    type: 'HERO',
    icon: '🦸',
    label: '主視覺 Hero',
    defaultProps: { title: '歡迎', subtitle: '', imageUrl: '', bgColor: '#0f172a', btnLabel: '', btnHref: '' },
    fields: [
      { key: 'title',    label: '主標題',       type: 'text',  placeholder: '例：專業醫療採購' },
      { key: 'subtitle', label: '副標題',       type: 'text' },
      { key: 'imageUrl', label: '背景圖片',     type: 'image' },
      { key: 'bgColor',  label: '背景顏色 (無圖時)', type: 'color' },
      { key: 'btnLabel', label: '按鈕文字',     type: 'text', placeholder: '例：立即購買' },
      { key: 'btnHref',  label: '按鈕連結',     type: 'url',  placeholder: '/shop.html' },
    ],
  },
  {
    type: 'TEXT',
    icon: '📝',
    label: '文字段落',
    defaultProps: { html: '<p>在這裡輸入內容…</p>' },
    fields: [
      { key: 'html', label: '內容 (HTML)', type: 'richtext' },
    ],
  },
  {
    type: 'IMAGE',
    icon: '🖼️',
    label: '單張圖片',
    defaultProps: { imageUrl: '', alt: '', caption: '', linkUrl: '' },
    fields: [
      { key: 'imageUrl', label: '圖片',         type: 'image' },
      { key: 'alt',      label: '替代文字 (SEO)', type: 'text' },
      { key: 'caption',  label: '圖說',          type: 'text' },
      { key: 'linkUrl',  label: '點擊跳轉',      type: 'url', placeholder: '可留空' },
    ],
  },
  {
    type: 'PRODUCT_GRID',
    icon: '🛒',
    label: '商品列表',
    defaultProps: { title: '推薦商品', categorySlug: '', brandSlug: '', isFeatured: false, limit: 8, columns: 4, orderBy: 'manual' },
    fields: [
      { key: 'title',        label: '區塊標題',   type: 'text' },
      { key: 'categorySlug', label: '分類 slug',  type: 'text', placeholder: '可留空' },
      { key: 'brandSlug',    label: '品牌 slug',  type: 'text', placeholder: '可留空' },
      { key: 'isFeatured',   label: '只顯示精選', type: 'select',
        options: [{ value: '', label: '不限' }, { value: '1', label: '是' }] },
      { key: 'limit',        label: '顯示筆數',   type: 'number' },
      { key: 'columns',      label: '欄數 (1-6)', type: 'number' },
      { key: 'orderBy',      label: '排序',       type: 'select',
        options: [{ value: 'manual', label: '依管理員排序' }, { value: 'newest', label: '最新上架' }] },
    ],
  },
  {
    type: 'BANNER',
    icon: '🎯',
    label: '頁面橫幅 (引用)',
    defaultProps: { bannerId: '' },
    fields: [
      { key: 'bannerId', label: '選擇橫幅', type: 'select', source: 'pageBanners' },
    ],
  },
  {
    type: 'CALLOUT',
    icon: '📣',
    label: '行動呼籲',
    defaultProps: { icon: '🩺', title: '加入會員', body: '通過資格審核享有專屬報價', btnLabel: '立即註冊', btnHref: '/register.html', bgColor: '#ecfdf5', accentColor: '#0d9488' },
    fields: [
      { key: 'icon',        label: '圖示 (Emoji)', type: 'text' },
      { key: 'title',       label: '標題',         type: 'text' },
      { key: 'body',        label: '說明',         type: 'textarea' },
      { key: 'btnLabel',    label: '按鈕文字',     type: 'text' },
      { key: 'btnHref',     label: '按鈕連結',     type: 'url' },
      { key: 'bgColor',     label: '背景色',       type: 'color' },
      { key: 'accentColor', label: '主色',         type: 'color' },
    ],
  },
  {
    type: 'FAQ',
    icon: '❓',
    label: '常見問題',
    defaultProps: { title: '常見問題', items: [{ question: '如何申請會員？', answer: '上傳醫療執照後 1-2 工作天內審核。' }] },
    fields: [
      { key: 'title', label: '區塊標題', type: 'text' },
      { key: 'items', label: '問題列表', type: 'repeater',
        itemFields: [
          { key: 'question', label: '問題', type: 'text' },
          { key: 'answer',   label: '回答 (HTML)', type: 'textarea' },
        ] },
    ],
  },
  {
    type: 'EMBED',
    icon: '🔧',
    label: '自訂 HTML',
    defaultProps: { html: '<!-- 自訂內容（影片嵌入 / 自訂表格…） -->' },
    fields: [
      { key: 'html', label: 'HTML 原始碼', type: 'richtext' },
    ],
  },
];
