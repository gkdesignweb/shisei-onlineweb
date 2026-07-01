// Server-side block renderers. Each block type's `props` is a JSON object
// with the shape declared in /public/js/block-schemas.js (single source of truth
// for the admin editor + server renderer).
import { prisma } from '../db.js';

const BLOCK_TYPES = new Set([
  'HERO', 'TEXT', 'IMAGE', 'PRODUCT_GRID', 'BANNER', 'CALLOUT', 'FAQ', 'EMBED',
]);

export function isValidBlockType(type) {
  return BLOCK_TYPES.has(type);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Render one block to HTML. Returns a complete <section> string.
export async function renderBlock(block) {
  let props = {};
  try { props = JSON.parse(block.props || '{}'); } catch {}
  switch (block.type) {
    case 'HERO':         return renderHero(props);
    case 'TEXT':         return renderText(props);
    case 'IMAGE':        return renderImage(props);
    case 'PRODUCT_GRID': return await renderProductGrid(props);
    case 'BANNER':       return await renderBannerBlock(props);
    case 'CALLOUT':      return renderCallout(props);
    case 'FAQ':          return renderFaq(props);
    case 'EMBED':        return renderEmbed(props);
    default:             return '';
  }
}

export async function renderBlocks(blocks) {
  const parts = await Promise.all(blocks.map(renderBlock));
  return parts.join('\n');
}

function renderHero(p) {
  const bg = p.imageUrl
    ? `background-image: linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.35)), url('${escapeHtml(p.imageUrl)}'); background-size: cover; background-position: center;`
    : `background: ${escapeHtml(p.bgColor || '#0f172a')};`;
  const btn = p.btnLabel && p.btnHref
    ? `<a href="${escapeHtml(p.btnHref)}" class="inline-block mt-6 bg-teal-500 hover:bg-teal-600 text-white font-semibold px-6 py-3 rounded-full">${escapeHtml(p.btnLabel)}</a>`
    : '';
  return `<section class="mb-10">
    <div class="rounded-2xl overflow-hidden text-white text-center py-24 px-6" style="${bg}">
      <h2 class="text-4xl md:text-5xl font-black">${escapeHtml(p.title || '')}</h2>
      ${p.subtitle ? `<p class="mt-4 text-lg md:text-xl text-white/90 max-w-2xl mx-auto">${escapeHtml(p.subtitle)}</p>` : ''}
      ${btn}
    </div>
  </section>`;
}

function renderText(p) {
  return `<section class="prose max-w-3xl mx-auto mb-10">${p.html || ''}</section>`;
}

function renderImage(p) {
  if (!p.imageUrl) return '';
  const img = `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.alt || '')}" class="w-full rounded-2xl"/>`;
  const inner = p.linkUrl ? `<a href="${escapeHtml(p.linkUrl)}">${img}</a>` : img;
  return `<section class="mb-10 max-w-4xl mx-auto">
    ${inner}
    ${p.caption ? `<p class="text-center text-sm text-slate-500 mt-2">${escapeHtml(p.caption)}</p>` : ''}
  </section>`;
}

async function renderProductGrid(p) {
  const where = { isActive: true };
  if (p.categorySlug) where.category = { slug: p.categorySlug };
  if (p.brandSlug)    where.brand    = { slug: p.brandSlug };
  if (p.isFeatured)   where.isFeatured = true;
  const products = await prisma.product.findMany({
    where,
    take: Math.max(1, Math.min(24, parseInt(p.limit, 10) || 8)),
    orderBy: p.orderBy === 'newest' ? { createdAt: 'desc' } : { sortOrder: 'asc' },
    include: { brand: { select: { nameZh: true } } },
  });
  const cols = Math.max(1, Math.min(6, parseInt(p.columns, 10) || 4));
  const cards = products.map((pr) => {
    const img = (pr.images?.split(',')[0]?.trim()) || pr.imageUrl || '';
    return `<a href="/products/${escapeHtml(pr.sku)}" class="block bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition">
      <div class="aspect-square bg-slate-100">${img ? `<img src="${escapeHtml(img)}" alt="" class="w-full h-full object-cover"/>` : ''}</div>
      <div class="p-3">
        ${pr.brand?.nameZh ? `<p class="text-xs text-slate-400">${escapeHtml(pr.brand.nameZh)}</p>` : ''}
        <p class="font-semibold text-sm line-clamp-2">${escapeHtml(pr.nameZh)}</p>
      </div>
    </a>`;
  }).join('');
  return `<section class="mb-10 max-w-6xl mx-auto">
    ${p.title ? `<h2 class="text-2xl md:text-3xl font-black mb-6">${escapeHtml(p.title)}</h2>` : ''}
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-${cols} gap-4">${cards || '<p class="text-slate-400 col-span-full text-center py-8">沒有符合條件的商品</p>'}</div>
  </section>`;
}

async function renderBannerBlock(p) {
  if (!p.bannerId) return '';
  const b = await prisma.heroBanner.findUnique({ where: { id: p.bannerId } });
  if (!b || !b.isActive) return '';
  const inner = `<img src="${escapeHtml(b.imageUrl)}" alt="" class="w-full h-auto block"/>${
    b.captionHtml ? `<div class="absolute inset-0 grid place-items-center p-6 text-white text-center">${b.captionHtml}</div>` : ''
  }`;
  const wrap = `<div class="relative rounded-2xl overflow-hidden bg-slate-100">${inner}</div>`;
  const linked = b.linkUrl ? `<a href="${escapeHtml(b.linkUrl)}" class="block">${wrap}</a>` : wrap;
  return `<section class="max-w-6xl mx-auto mb-10">${linked}</section>`;
}

function renderCallout(p) {
  const bg = p.bgColor || '#ecfdf5';
  const accent = p.accentColor || '#0d9488';
  const btn = p.btnLabel && p.btnHref
    ? `<a href="${escapeHtml(p.btnHref)}" class="inline-block mt-4 font-semibold px-5 py-2 rounded-full text-white" style="background:${escapeHtml(accent)}">${escapeHtml(p.btnLabel)}</a>`
    : '';
  return `<section class="mb-10 max-w-4xl mx-auto">
    <div class="rounded-2xl p-6 md:p-10 text-center" style="background:${escapeHtml(bg)}">
      ${p.icon ? `<div class="text-4xl mb-3">${escapeHtml(p.icon)}</div>` : ''}
      ${p.title ? `<h3 class="text-2xl font-black" style="color:${escapeHtml(accent)}">${escapeHtml(p.title)}</h3>` : ''}
      ${p.body ? `<p class="mt-3 text-slate-700">${escapeHtml(p.body)}</p>` : ''}
      ${btn}
    </div>
  </section>`;
}

function renderFaq(p) {
  const items = Array.isArray(p.items) ? p.items : [];
  const rendered = items.map((it, i) => `
    <details class="group bg-white rounded-xl border border-slate-200 px-5 py-3" ${i === 0 ? 'open' : ''}>
      <summary class="font-semibold cursor-pointer list-none flex justify-between items-center">
        <span>${escapeHtml(it.question || '')}</span>
        <span class="text-slate-400 group-open:rotate-180 transition">▾</span>
      </summary>
      <div class="mt-3 text-slate-700 leading-relaxed">${it.answer || ''}</div>
    </details>`).join('');
  return `<section class="mb-10 max-w-3xl mx-auto">
    ${p.title ? `<h2 class="text-2xl md:text-3xl font-black mb-6 text-center">${escapeHtml(p.title)}</h2>` : ''}
    <div class="space-y-3">${rendered}</div>
  </section>`;
}

function renderEmbed(p) {
  // Trust admin to author safe HTML — this block is the explicit escape hatch.
  return `<section class="mb-10 max-w-5xl mx-auto">${p.html || ''}</section>`;
}
