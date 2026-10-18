(() => {
  'use strict';
  const PAGE = 'design-studio';
  const s = { loaded: false, loading: false, busy: false, token: '', profile: {}, categories: [], stats: {}, topics: [], jobs: [], capabilities: {}, error: '', tab: 'topics', topicId: null, jobId: null, category: 'all', collection: 'all', priority: 'all', query: '', sort: 'priority', drafts: new Map(), timer: null, version: 0 };
  const copyIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></svg>';
  const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const active = job => job && ['queued', 'generating', 'validating'].includes(job.status);
  const labels = { prepared: '待创作', queued: '准备中', generating: '创作中', validating: '检查中', ready: '已完成', failed: '生成失败', interrupted: '已中断', cancelled: '已停止' };
  const categoryNames = { bag: '通勤包', phone: '手机壳', wear: '日常穿搭', home: '居家空间', daily: '幸福感小物' };
  const copyOf = value => JSON.parse(JSON.stringify(value));
  const topic = () => s.topics.find(item => item.id === s.topicId);
  const categoryName = id => s.categories.find(item => item.id === id)?.name || categoryNames[id] || id || '日常设计';
  const latestJob = id => s.jobs.filter(job => job.topicId === id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  function topicStatus(item) { const related = s.jobs.filter(job => job.topicId === item.id); if (related.some(active)) return 'generating'; const latest = latestJob(item.id); if (latest && ['failed', 'interrupted', 'cancelled'].includes(latest.status)) return latest.status; return related.some(job => job.status === 'ready') ? 'ready' : 'prepared'; }
  const edition = job => !!job && (job.schemaVersion === 2 || !!job.variantLabel || (job.pages?.length || 0) > 4);
  const selectedJob = () => s.jobs.find(job => job.id === s.jobId) || s.jobs.filter(job => job.topicId === s.topicId && !edition(job)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || latestJob(s.topicId);
  const comparisonJob = id => s.jobs.find(job => job.topicId === id && job.compareWithJobId);
  const count = value => Array.from(String(value || '')).length;
  const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); };
  const content = () => document.querySelector('#content');
  function asset(value) { if (typeof value !== 'string' || !value.trim()) return ''; try { const u = new URL(value, location.href); return u.origin === location.origin && ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
  function putJob(job) { if (!job?.id) return; const i = s.jobs.findIndex(item => item.id === job.id); if (i < 0) s.jobs.unshift(job); else s.jobs[i] = job; }
  function putTopic(item) { const i = s.topics.findIndex(t => t.id === item.id); if (i < 0) s.topics.push(item); else s.topics[i] = item; }
  function badge(status) { return `<span class="ds-badge ds-status-${html(status)}">${html(labels[status] || status || '待创作')}</span>`; }
  function empty(title, body) { return `<div class="ds-empty">${icon('layers')}<h3>${html(title)}</h3><p>${html(body)}</p></div>`; }
  function draftFor(item) {
    if (!s.drafts.has(item.id)) s.drafts.set(item.id, { revision: item.revision, title: item.caption?.title || item.title || '', caption: typeof item.caption === 'string' ? item.caption : item.caption?.body || '', tags: (item.tags || item.caption?.tags || []).slice(), pages: copyOf(item.pages || []), dirty: false });
    return s.drafts.get(item.id);
  }
  async function api(path, body) {
    const options = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Orbit-Token': s.token }, body: JSON.stringify(body) };
    const response = await fetch('/api/studio' + path, options);
    let result; try { result = await response.json(); } catch { throw new Error('服务没有返回有效数据，请刷新本机服务后重试。'); }
    if (!response.ok) throw new Error(result.error || `请求未完成（${response.status}）`);
    return result;
  }
  function route() {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    s.tab = ['works', 'compare'].includes(params.get('view')) ? params.get('view') : 'topics';
    s.topicId = params.get('topic'); s.jobId = params.get('job');
    s.collection = params.get('collection') === 'wardrobe-and-joy' ? 'wardrobe-and-joy' : 'all';
  }
  function go(tab, topicId = null, jobId = null) {
    s.tab = tab; s.topicId = topicId; s.jobId = jobId; s.error = '';
    const params = new URLSearchParams({ view: tab }); if (topicId) params.set('topic', topicId); if (jobId) params.set('job', jobId);
    if (s.collection !== 'all') params.set('collection', s.collection);
    history.pushState(null, '', '#' + PAGE + '?' + params); state.page = PAGE; render(); window.scrollTo(0, 0);
  }
  names[PAGE] = '偏爱日常设计所';
  const nav = document.createElement('button'); nav.className = 'nav-item ds-nav'; nav.dataset.nav = PAGE;
  nav.innerHTML = icon('image') + '<span>偏爱日常设计所</span>';
  const atlasNav = document.querySelector('.sidebar nav [data-nav="atlas"]');
  if (atlasNav) atlasNav.after(nav); else document.querySelector('.sidebar nav')?.append(nav);
  const baseRender = render, baseNavigate = navigate;
  navigate = function (page) {
    if (page === PAGE) { s.tab = 'topics'; s.topicId = null; s.jobId = null; s.collection = 'all'; history.replaceState(null, '', '#' + PAGE); }
    else if (location.hash.startsWith('#' + PAGE)) history.replaceState(null, '', location.pathname + location.search);
    baseNavigate(page);
  };
  render = function () {
    baseRender(); document.body.classList.toggle('ds-body', state.page === PAGE); content().classList.toggle('ds-workspace', state.page === PAGE); clearTimeout(s.timer);
    if (state.page === PAGE) { paint(); if (!s.loaded && !s.loading) load(); else poll(); }
  };
  async function load() {
    if (s.loading) return; s.loading = true; const version = s.version;
    try {
      const b = await api('/bootstrap'); if (version !== s.version) return;
      if (b.version !== 1) throw new Error('请重新启动本机工作台，以加载设计所。');
      s.token = b.token; s.profile = b.profile || {}; s.categories = b.categories || []; s.stats = b.stats || {};
      s.topics = b.topics || []; s.jobs = b.jobs || []; s.capabilities = b.capabilities || {}; s.loaded = true; s.error = '';
      if (state.page === PAGE) document.querySelector('.live').innerHTML = '<i></i>本机创作空间';
      for (const item of s.topics) if (!s.drafts.get(item.id)?.dirty) s.drafts.delete(item.id);
    } catch (error) { s.error = error.message; }
    finally { s.loading = false; if (state.page === PAGE) { paint(); poll(); } }
  }
  function heading() {
    return `<header class="ds-heading"><div class="ds-brand"><span class="ds-brand-mark" aria-hidden="true">偏</span><div><p class="ds-eyebrow">EVERYDAY, REIMAGINED</p><h1>${html(s.profile.name || '偏爱日常设计所')}</h1></div></div><div class="ds-heading-actions"><details class="ds-environment"><summary><i class="${s.capabilities.available ? 'is-ready' : ''}"></i>${s.loaded ? s.capabilities.available ? '创作环境就绪' : '环境待检查' : '连接本机工作台'}</summary><div><p>${html(s.capabilities.reason || '作品和设计稿保存在本机。')}</p><button class="btn" data-ds="refresh" ${s.busy ? 'disabled' : ''}>刷新状态</button></div></details><button class="ds-text-button" data-ds="export" ${!s.loaded ? 'disabled' : ''}>${icon('download')} 导出选题</button></div></header><div class="ds-navigation"><nav aria-label="设计所工作区"><button data-ds-tab="topics" ${s.tab === 'topics' ? 'aria-current="page"' : ''}>选题库 <span>${s.loaded ? s.topics.length : '—'}</span></button><button data-ds-tab="works" ${['works', 'compare'].includes(s.tab) ? 'aria-current="page"' : ''}>创作与作品 <span>${s.loaded ? s.jobs.length : '—'}</span></button></nav><span>给日常物品，多一点偏爱</span></div>`;
  }
  function sampleJob() { const sample = s.topics.find(t => t.sampleJobId); return s.jobs.find(j => j.id === sample?.sampleJobId && j.images?.length) || s.jobs.find(j => j.status === 'ready' && j.images?.length); }
  function showcase() {
    const job = sampleJob(), item = s.topics.find(t => t.id === job?.topicId), image = job?.images?.find(im => asset(im.url));
    return `<section class="ds-showcase"><div class="ds-showcase-copy"><p class="ds-eyebrow">THE EVERYDAY COLLECTION / 01</p><h2>把喜欢的日常，<br>设计成自己的样子。</h2><p class="ds-showcase-intro">${html(s.profile.description || '从通勤的一只包，到房间里的一束光。留住一个具体的灵感，再把它变成完整设计。')}</p><div class="ds-stat-strip"><span><b>${s.stats.total ?? s.topics.length}</b><small>个独立选题</small></span><span><b>${s.categories.length}</b><small>个日常方向</small></span><span><b>${s.jobs.filter(j => j.status === 'ready').length}</b><small>篇完成作品</small></span></div>${item ? `<button class="btn ds-primary" data-ds-topic="${html(item.id)}">打开这份设计 ${icon('arrow')}</button>` : '<span class="ds-subtle">从下方选题开始第一份设计</span>'}</div><div class="ds-showcase-visual">${image ? `<button class="ds-sample-image" data-ds-topic="${html(job.topicId)}" data-ds-job="${html(job.id)}" aria-label="查看${html(job.title)}"><img src="${html(asset(image.url))}" alt="${html(job.title)}的真实生成作品"><span class="ds-sample-label">已生成样稿 <i>↗</i></span></button><div class="ds-sample-caption"><span>${html(categoryName(item?.category))}</span><strong>${html(job.title)}</strong><small>${job.images.length} 张作品 · ${html(date(job.createdAt))}</small></div>` : `<div class="ds-showcase-empty"><span class="ds-paper-mark">偏爱日常</span><p>第一份设计<br>从一个具体的喜欢开始</p><small>完成生成后，在这里查看真实作品</small></div>`}</div></section>`;
  }
  function filters() {
    const scoped = s.topics.filter(t => s.collection === 'all' || t.collection === s.collection);
    const categories = (s.categories.length ? s.categories : Object.entries(categoryNames).map(([id, name]) => ({ id, name }))).filter(c => s.collection === 'all' || scoped.some(t => t.category === c.id));
    return `<div class="ds-library-heading"><div><p class="ds-eyebrow">IDEA ARCHIVE</p><h2>每个选题，都已准备好展开</h2><p>主题、发布文案与四张图的画面说明，按篇整理。</p></div><label class="ds-sort">排列<select id="ds-sort"><option value="priority" ${s.sort === 'priority' ? 'selected' : ''}>首批优先</option><option value="category" ${s.sort === 'category' ? 'selected' : ''}>按品类</option><option value="title" ${s.sort === 'title' ? 'selected' : ''}>按标题</option></select></label></div><div class="ds-filters"><div class="ds-category-filters" role="group" aria-label="按品类筛选"><button data-ds-category="all" aria-pressed="${s.category === 'all'}">全部 <span>${scoped.length}</span></button>${categories.map(c => `<button data-ds-category="${html(c.id)}" aria-pressed="${s.category === c.id}">${html(c.name)} <span>${scoped.filter(t => t.category === c.id).length}</span></button>`).join('')}</div><label class="ds-search">${icon('search')}<input id="ds-search" value="${html(s.query)}" placeholder="搜索编号、主题或生活场景" aria-label="搜索选题"></label></div>`;
  }
  function priorities() { return `<div class="ds-priorities" role="group" aria-label="选题优先级"><span>创作安排</span>${[['all', '全部选题'], ['首批', '首批试发'], ['常青', '常青储备'], ['探索', '后续探索']].map(([value, name]) => `<button data-ds-priority="${value}" aria-pressed="${s.priority === value}">${name}</button>`).join('')}</div>`; }
  function collections() { const added = s.topics.filter(t => t.collection === 'wardrobe-and-joy').length; return added ? `<div class="ds-priorities ds-collections" role="group" aria-label="选题批次"><span>选题范围</span><button data-ds-collection="all" aria-pressed="${s.collection === 'all'}">全部 ${s.topics.length} 题</button><button data-ds-collection="wardrobe-and-joy" aria-pressed="${s.collection === 'wardrobe-and-joy'}">本次新增 ${added} 题 · 衣物与幸福小物</button></div>` : ''; }
  function collectionIntro() { const items = s.topics.filter(t => t.collection === s.collection); return `<section class="ds-collection-intro"><p class="ds-eyebrow">THE EVERYDAY COLLECTION / 02</p><h2>衣橱里的新喜欢，<br>日常里的小幸福。</h2><p>${items.filter(t => t.category === 'wear').length} 个衣物设计，${items.filter(t => t.category === 'daily').length} 个幸福感小物。从周一出门，到周末慢慢喝一杯茶。</p><span>${items.length} 份完整文案 · ${items.reduce((n,t) => n + t.pages.length,0)} 条专属图片提示词</span></section>`; }
  function rank(item) { const known = { '首批': 0, '常青': 1, '探索': 2 }; if (Object.hasOwn(known, item.priority)) return known[item.priority]; if (Number.isFinite(Number(item.priority))) return Number(item.priority); return Number(String(item.priority || '').match(/\d+/)?.[0] || 999); }
  function topicResults() {
    let items = s.topics.filter(t => (s.collection === 'all' || t.collection === s.collection) && (s.category === 'all' || t.category === s.category) && (s.priority === 'all' || t.priority === s.priority) && [t.id, t.title, t.theme, t.scene, t.hook, categoryName(t.category)].join(' ').toLocaleLowerCase().includes(s.query.trim().toLocaleLowerCase()));
    items.sort((a, b) => s.sort === 'title' ? String(a.title).localeCompare(String(b.title), 'zh-CN') : s.sort === 'category' ? String(a.category).localeCompare(String(b.category)) || rank(a) - rank(b) : rank(a) - rank(b));
    return `<p class="ds-result-count">${items.length} 个选题${s.query ? ' · 与“' + html(s.query) + '”相关' : ''}</p><div class="ds-topic-grid">${items.map((item, index) => {
      const status = topicStatus(item);
      return `<button class="ds-topic-card ds-category-${html(item.category)}" data-ds-topic="${html(item.id)}"><div class="ds-topic-meta"><span>${html(categoryName(item.category))}</span><small>${html(item.priority || '储备')} · ${html(item.id || String(index + 1).padStart(2, '0'))}</small></div><h3>${html(item.title)}</h3><p>${html(item.scene || item.theme)}</p><div class="ds-topic-theme">${html(item.theme)}</div><div class="ds-topic-bottom">${badge(status)}<span>${item.pages?.length || 0} 张图${s.drafts.get(item.id)?.dirty ? ' · 有未保存修改' : ''} ${icon('arrow')}</span></div></button>`;
    }).join('')}</div>${items.length ? '' : empty('暂时没有匹配选题', '换一个关键词，或查看其他品类。')}`;
  }
  function jobCard(job) {
    const im = job.images?.find(item => asset(item.url)), item = s.topics.find(t => t.id === job.topicId);
    return `<article class="ds-work-card"><button class="ds-work-cover" data-ds-topic="${html(job.topicId)}" data-ds-job="${html(job.id)}" aria-label="查看${html(job.title)}">${im ? `<img src="${html(asset(im.url))}" alt="${html(job.title)}" loading="lazy">` : `<span>${icon('image')}<small>${html(labels[job.status] || '准备作品')}</small></span>`}</button><div class="ds-work-info"><div>${badge(job.status)}<small>${html(date(job.createdAt))}</small></div><h3><button data-ds-topic="${html(job.topicId)}" data-ds-job="${html(job.id)}">${html(job.title)}</button></h3><p>${html(categoryName(item?.category))} · ${job.images?.length || 0} 张图片${job.variantLabel ? ' · ' + html(job.variantLabel) : ''}</p><button class="ds-text-button" data-ds-topic="${html(job.topicId)}" data-ds-job="${html(job.id)}">${active(job) ? '查看进度' : ['failed', 'interrupted', 'cancelled'].includes(job.status) ? '查看并继续' : '查看完整作品'} ${icon('arrow')}</button>${comparisonEntry(job.topicId, 'card')}</div></article>`;
  }
  function works() { return `<section class="ds-works-heading"><p class="ds-eyebrow">DESIGN JOURNAL</p><h2>从一个念头，到一份作品</h2><p>每次创作都独立保存，可以查看原图、复制文案或继续未完成的设计。</p></section><div id="ds-work-list" class="ds-work-grid">${s.jobs.map(jobCard).join('') || empty('还没有生成作品', '在选题库打开一个设计，调整后即可开始生成。')}</div>`; }
  function comparisonEntry(topicId, placement = 'detail') {
    const job = comparisonJob(topicId); if (!job) return '';
    const label = placement === 'card' ? '原版 / 新版对比' : '查看这只通勤包的两版图文';
    return `<button class="${placement === 'card' ? 'ds-text-button ds-compare-link' : 'ds-compare-entry'}" data-ds-compare="${html(job.id)}"><span>${label}</span>${placement === 'card' ? '' : `<small>原版 ${s.jobs.find(j => j.id === job.compareWithJobId)?.pages?.length || 4} 图 · ${html(job.variantLabel || '新版')} ${job.pages?.length || job.pageCount || 6} 图</small>`}${icon('arrow')}</button>`;
  }
  function savedCaption(job) {
    const caption = job.caption || {};
    return `<section class="ds-saved-copy" aria-label="${html(job.variantLabel || '原版')}文案"><div class="ds-section-title"><div><h3>发布文案</h3><p>保留这次作品生成时的稿件。</p></div><button class="ds-text-button" data-ds="copy-job-caption" data-ds-job="${html(job.id)}">${copyIcon} 复制文案</button></div><h4>${html(caption.title || job.title)}</h4><p class="ds-caption-text">${html(caption.body || '')}</p><p class="ds-job-tags">${html((caption.tags || []).map(tag => String(tag).startsWith('#') ? tag : '#' + tag).join(' '))}</p></section>`;
  }
  function savedPrompt(page, index, job) {
    return `<details class="ds-saved-prompt"><summary>查看第 ${index + 1} 张提示词</summary><label class="ds-field">本次作品使用的完整提示词<textarea rows="8" readonly data-ds-snapshot-prompt="${index}" aria-label="${html(job.variantLabel || '原版')}第${index + 1}张图的提示词">${html(page.prompt || '')}</textarea></label><button class="ds-text-button" data-ds="copy-job-page" data-ds-index="${index}" data-ds-job="${html(job.id)}">${copyIcon} 复制本页提示词</button></details>`;
  }
  function comparisonGallery(job) {
    const pages = job.pages?.length ? job.pages : (job.images || []).map((im, index) => ({ title: im.title || im.name, filename: im.name, index: index + 1 }));
    return `<div class="ds-compare-gallery">${pages.map((page, index) => {
      const im = (job.images || []).find(image => image.name === page.filename) || (!page.filename ? job.images?.[index] : null), url = asset(im?.url);
      return `<figure class="ds-compare-image"><div class="ds-compare-image-number"><span>${String(index + 1).padStart(2, '0')}</span><strong>${html(page.title || im?.title || '设计图')}</strong></div><button class="ds-compare-preview" data-ds-preview="${html(url)}" data-ds-image-name="${html(im?.name || page.filename || page.title)}" ${url ? '' : 'disabled'} aria-label="预览${html(job.variantLabel || '原版')}第${index + 1}张图">${url ? `<img src="${html(url)}" alt="${html(job.variantLabel || '原版')} · ${html(page.title)}" loading="lazy">` : '<span>本页图片尚未就绪</span>'}</button><figcaption><span>${im ? `${Number(im.width) || '—'} × ${Number(im.height) || '—'}` : '等待图片'}</span>${url ? `<a href="${html(url)}" download="${html(im.name)}" aria-label="下载${html(job.variantLabel || '原版')}第${index + 1}张图">${icon('download')} 原图</a>` : ''}</figcaption>${page.focus ? `<p class="ds-image-focus">${html(page.focus)}</p>` : ''}${page.prompt ? savedPrompt(page, index, job) : ''}</figure>`;
    }).join('')}</div>`;
  }
  function comparisonVersion(job, newer) {
    if (!job) return `<section class="ds-comparison-version ds-panel">${empty('原版暂未载入', '已有新版仍可预览，刷新工作台后可重新读取原版。')}</section>`;
    const amount = job.pages?.length || job.pageCount || job.images?.length || 0;
    return `<section class="ds-comparison-version ${newer ? 'is-new' : ''}" data-ds-version="${newer ? 'new' : 'original'}"><header class="ds-version-heading"><div><p class="ds-eyebrow">${newer ? '02 / EDITORIAL EDITION' : '01 / ORIGINAL EDITION'}</p><h3>${newer ? html(job.variantLabel || '新版') : '原版'} <span>${amount} 张图</span></h3><p>${newer ? '人物代入、设计档案、细节与设计取舍' : '站台场景、通勤背法与产品展示'}</p></div>${badge(job.status)}</header><div class="ds-version-images-heading"><h4>逐图查看</h4>${job.pages?.length ? `<button class="ds-text-button" data-ds="copy-job-prompts" data-ds-job="${html(job.id)}">${copyIcon} 复制 ${amount} 条提示词</button>` : ''}</div>${comparisonGallery(job)}<div class="ds-version-footer"><button class="ds-text-button" data-ds-topic="${html(job.topicId)}" data-ds-job="${html(job.id)}">打开本版完整作品 ${icon('arrow')}</button><button class="ds-text-button" data-ds="export-job" data-ds-job="${html(job.id)}">${icon('download')} 导出本版记录</button></div></section>`;
  }
  function comparison() {
    const job = s.jobs.find(j => j.id === s.jobId && j.compareWithJobId) || comparisonJob(s.topicId);
    if (!job) return `<button class="ds-back" data-ds="back">← 返回创作与作品</button>${empty('暂时没有可对比的版本', '打开创作与作品，选择已有的原版 / 新版对比。')}`;
    const original = s.jobs.find(j => j.id === job.compareWithJobId);
    return `<button class="ds-back" data-ds="back">← 返回创作与作品</button><section class="ds-comparison-intro"><p class="ds-eyebrow">ONE IDEA, TWO EDITIONS</p><h2>同一只通勤包，<br>换一种讲述日常的方式。</h2><p>保留原版，也展开六图编辑版。对照画面、文案与每一页的信息，看看哪一种更值得停留。</p><div class="ds-comparison-key"><span>原版 ${original?.pages?.length || 4} 图</span><i>→</i><span>新版 ${job.pages?.length || job.pageCount || 6} 图</span><small>点图片可放大，逐页可下载</small></div></section><div class="ds-comparison-grid">${comparisonVersion(original, false)}${comparisonVersion(job, true)}</div><section class="ds-caption-comparison"><div class="ds-library-heading"><div><p class="ds-eyebrow">TWO WAYS TO TELL THE STORY</p><h2>文案也一起对照</h2></div></div><div class="ds-comparison-grid">${original ? `<div class="ds-panel"><p class="ds-eyebrow">原版 · ${original.pages?.length || 4} 图</p>${savedCaption(original)}</div>` : ''}<div class="ds-panel"><p class="ds-eyebrow">${html(job.variantLabel || '新版')} · ${job.pages?.length || 6} 图</p>${savedCaption(job)}</div></div></section>`;
  }
  function editionDetail(item, job) {
    const pages = job.pages || [];
    return `<button class="ds-back" data-ds="back">← 返回${s.tab === 'works' ? '创作与作品' : '选题库'}</button><div class="ds-detail-heading"><div><p class="ds-eyebrow">SAVED EDITION / ${html(job.variantLabel || '独立版本')}</p><h2>${html(job.title)}</h2><p>本次独立创作的图文与完整画面提示词。</p></div><span class="ds-page-count"><b>${pages.length}</b> 张图 · ${html(job.variantLabel || '保存稿')}</span></div>${comparisonEntry(item.id)}<div id="ds-job-panel">${jobPanel(job)}</div><div class="ds-editor-layout ds-snapshot-layout"><div class="ds-editor-main"><div class="ds-panel">${savedCaption(job)}</div>${job.design ? designArchive(job) : ''}</div><section class="ds-panel ds-page-plans"><div class="ds-section-title"><span>06</span><div><h3>${pages.length} 张图的完整提示词</h3><p>按这次作品的保存稿展示，可复制或导出。</p></div><button class="ds-text-button" data-ds="copy-job-prompts" data-ds-job="${html(job.id)}">${copyIcon} 全部复制</button></div>${pages.map((page, index) => `<div class="ds-snapshot-page"><h4><span>${String(index + 1).padStart(2, '0')}</span>${html(page.title)}</h4><p>${html(page.focus || page.role || '')}</p>${savedPrompt(page, index, job)}</div>`).join('')}</section></div><div id="ds-detail-history">${historyPanel(item)}</div>`;
  }
  const designLabels = { name: '设计名称', concept: '设计概念', silhouette: '轮廓', palette: '配色', colors: '颜色', material: '材质', materials: '材质', details: '细节', features: '设计重点', signature: '标志性细节', identity: '固定设计特征', constraints: '结构约束', dimensions: '尺寸', proportions: '比例', styling: '搭配', lighting: '光线', environment: '场景', mood: '氛围', avoid: '避开元素', mustKeep: '始终保留', camera: '镜头', consistency: '跨图一致性', product: '设计对象', keyDetails: '关键细节', paletteName: '色彩主题', inspiration: '灵感来源', structure: '结构', category: '品类', audience: '适用人群', specs: '设计拟定参数' };
  function valueText(value) { if (Array.isArray(value)) return value.map(valueText).join(' / '); if (value && typeof value === 'object') return Object.entries(value).map(([k, v]) => `${designLabels[k] || k}：${valueText(v)}`).join('；'); return String(value ?? ''); }
  function specificationText(specs) {
    if (!Array.isArray(specs)) return valueText(specs);
    return specs.map(spec => {
      if (!spec || typeof spec !== 'object') return valueText(spec);
      const status = spec.status === 'design-target' ? '设计拟定' : '待确认';
      return [`${spec.label || '参数'}：${valueText(spec.value)}${spec.unit ? ' ' + spec.unit : ''}`, `状态：${status}`, spec.sourceNote ? `来源说明：${spec.sourceNote}` : ''].filter(Boolean).join('\n');
    }).join('\n\n');
  }
  function designArchive(item) { return `<section class="ds-panel ds-design-archive"><div class="ds-section-title"><span>02</span><div><h3>设计档案</h3><p>让每张图片，都延续同一个设计。</p></div></div><dl>${Object.entries(item.design || {}).map(([key, value]) => `<div><dt>${html(designLabels[key] || key)}</dt><dd>${html(key === 'specs' ? specificationText(value) : valueText(value))}</dd></div>`).join('') || '<p class="ds-subtle">本选题暂未提供设计档案。</p>'}</dl></section>`; }
  function detail() {
    const item = topic(); if (!item) return empty('没有找到这个选题', '返回选题库，选择另一份设计。'); if (s.jobId && edition(selectedJob())) return editionDetail(item, selectedJob()); const d = draftFor(item);
    return `<button class="ds-back" data-ds="back">← 返回${s.tab === 'works' ? '创作与作品' : '选题库'}</button><div class="ds-detail-heading"><div><p class="ds-eyebrow">${html(categoryName(item.category))} / DESIGN BRIEF</p><h2>${html(item.title)}</h2><p>${html(item.theme)}</p></div><span class="ds-page-count"><b>${d.pages.length}</b> 张图 · 一份完整设计</span></div><div class="ds-brief"><div><small>使用场景</small><p>${html(item.scene)}</p></div><div><small>本篇看点</small><p>${html(item.hook)}</p></div>${item.audience ? `<div><small>给谁设计</small><p>${html(valueText(item.audience))}</p></div>` : ''}</div>${comparisonEntry(item.id)}<div id="ds-job-panel">${jobPanel()}</div><div class="ds-editor-layout"><div class="ds-editor-main"><section class="ds-panel"><div class="ds-section-title"><span>01</span><div><h3>发布文案</h3><p>写清设计里的心思，让喜欢它的人愿意停留。</p></div><button class="ds-text-button" data-ds="copy-caption">${copyIcon} 复制</button></div><label class="ds-field">标题 <span id="ds-title-count"></span><input data-ds-field="title" value="${html(d.title)}" aria-label="发布标题"></label><label class="ds-field">正文<textarea data-ds-field="caption" rows="9" aria-label="发布正文">${html(d.caption)}</textarea></label><label class="ds-field">话题标签<textarea data-ds-field="tags" rows="2" aria-label="话题标签">${html(d.tags.map(tag => String(tag).startsWith('#') ? tag : '#' + tag).join(' '))}</textarea></label><p id="ds-caption-count" class="ds-field-note"></p></section>${designArchive(item)}</div><section class="ds-panel ds-page-plans"><div class="ds-section-title"><span>03</span><div><h3>四张图，讲好一个设计</h3><p>展开查看或调整每张图的画面说明。</p></div><button class="ds-text-button" data-ds="copy-prompts">${copyIcon} 全部复制</button></div>${d.pages.map((page, index) => `<details class="ds-page-plan" ${index === 0 ? 'open' : ''}><summary><span>${String(index + 1).padStart(2, '0')}</span><div><strong>${html(page.title)}</strong><small>${html(page.focus || page.role)}</small></div><i>＋</i></summary><div class="ds-prompt-body"><label class="ds-field">完整画面提示词<textarea rows="12" data-ds-prompt="${index}" aria-label="第${index + 1}张图的完整提示词">${html(page.prompt)}</textarea></label><button class="ds-text-button" data-ds="copy-page" data-ds-index="${index}">${copyIcon} 复制本页提示词</button></div></details>`).join('')}</section></div><div class="ds-save-bar"><div><span id="ds-save-state"></span><small>保存后可随时继续，生成只针对当前这一篇。</small></div><div><button class="btn" data-ds="save">保存修改</button><button class="btn ds-primary" data-ds="generate">${icon('spark')} 生成本篇 ${d.pages.length} 张图</button></div></div><div id="ds-detail-history">${historyPanel(item)}</div>`;
  }
  function historyPanel(item) { const jobs = s.jobs.filter(j => j.topicId === item.id); return jobs.length > 1 ? `<section class="ds-history"><div class="ds-library-heading"><h3>这个设计的创作记录</h3><span>${jobs.length} 次独立创作</span></div>${jobs.map(j => `<button class="ds-history-row" data-ds-topic="${html(item.id)}" data-ds-job="${html(j.id)}"><span>${html(date(j.createdAt))}</span>${badge(j.status)}<span>${j.images?.length || 0} 张图${j.variantLabel ? ' · ' + html(j.variantLabel) : ''}</span>${icon('arrow')}</button>`).join('')}</section>` : ''; }
  function jobPanel(job = selectedJob()) {
    if (!job) return '';
    const images = job.images || [], running = active(job), recover = ['failed', 'interrupted', 'cancelled'].includes(job.status);
    return `<section class="ds-job-state ds-panel" aria-live="polite"><div class="ds-job-heading"><div><span class="ds-eyebrow">${running ? 'IN THE MAKING' : 'SAVED CREATION'}</span><h3>${running ? '正在完成这份设计' : job.status === 'ready' ? '这份设计已完成' : '已有内容已保留'}</h3></div><div class="ds-job-controls">${badge(job.status)}${running ? '<button class="btn" data-ds="cancel">停止本篇</button>' : recover ? '<button class="btn ds-primary" data-ds="retry">继续生成</button>' : ''}</div></div>${running ? '<div class="ds-progress-track"><i></i></div>' : ''}<p class="ds-job-message">${html(job.message || labels[job.status])}</p><p class="ds-subtle ds-snapshot-note">${edition(job) ? '本页展示这次创作保存的独立稿件、图片和提示词。' : '继续生成沿用这份作品的原稿。修改并保存下方选题后，可另开新作品；原稿与已有图片继续保留。'}</p>${job.review?.summary ? `<p class="ds-subtle">${html(job.review.summary)}</p>` : ''}${images.length ? `<div class="ds-generated-images">${images.map((im, i) => `<figure><button data-ds-preview="${html(asset(im.url))}" data-ds-image-name="${html(im.name || '设计图 ' + (i + 1))}" ${asset(im.url) ? '' : 'disabled'}>${asset(im.url) ? `<img src="${html(asset(im.url))}" alt="${html(im.name || '设计图 ' + (i + 1))}" loading="lazy">` : '<span>图片暂不可用</span>'}</button><figcaption><span>${String(i + 1).padStart(2, '0')} · ${html(im.name)}</span>${asset(im.url) ? `<a href="${html(asset(im.url))}" download="${html(im.name)}" aria-label="下载${html(im.name)}">${icon('download')}</a>` : ''}</figcaption><small>${Number(im.width) || '—'} × ${Number(im.height) || '—'}</small></figure>`).join('')}</div>` : ''}${job.caption ? `<details class="ds-job-caption"><summary>查看本次作品文案</summary><div><h4>${html(job.caption.title)}</h4><p>${html(job.caption.body)}</p><p class="ds-job-tags">${html((job.caption.tags || []).map(tag => String(tag).startsWith('#') ? tag : '#' + tag).join(' '))}</p></div></details><div class="ds-job-export"><button class="btn" data-ds="copy-job-caption">复制本次作品文案</button><button class="btn" data-ds="export-job">导出本次记录</button><button class="btn" data-ds="folder">打开素材目录</button></div>` : ''}<details class="ds-events"><summary>查看创作进度记录${job.events?.length ? ' · ' + job.events.length : ''}</summary><ol>${(job.events || []).slice(-30).map(event => `<li><time>${html(date(event.time))}</time><span>${html(event.message)}</span></li>`).join('') || '<li>暂时没有进度记录。</li>'}</ol></details></section>`;
  }
  function paint() {
    if (state.page !== PAGE) return;
    content().innerHTML = `<div class="ds-page">${heading()}<div id="ds-error" role="alert">${s.error ? `<p class="ds-error">${html(s.error)}</p>` : ''}</div>${!s.loaded ? empty(s.loading ? '正在读取设计档案' : '设计所暂时无法连接', s.error || '选题、文案和图片都将从本机工作台载入。') : s.tab === 'compare' ? comparison() : s.topicId ? detail() : s.tab === 'works' ? works() : (s.collection === 'all' ? showcase() : collectionIntro()) + collections() + filters() + priorities() + '<section id="ds-topic-results">' + topicResults() + '</section>'}<footer class="ds-footer"><span>偏爱日常设计所</span><span>DESIGNED FOR THE EVERYDAY</span></footer></div>`;
    updateControls();
  }
  function updateControls() {
    if (state.page !== PAGE) return; const item = topic(), d = item ? draftFor(item) : null;
    content().querySelectorAll('[data-ds="save"]').forEach(button => { button.disabled = s.busy || !d?.dirty; button.textContent = s.busy ? '处理中…' : '保存修改'; });
    const unfinished = item && !d?.dirty && s.jobs.some(j => j.topicId === item.id && j.revision === item.revision && ['failed', 'interrupted', 'cancelled'].includes(j.status));
    content().querySelectorAll('[data-ds="generate"]').forEach(button => { button.disabled = s.busy || !s.capabilities.available || s.jobs.some(active) || unfinished || !d?.pages.length; button.title = !s.capabilities.available ? s.capabilities.reason || '创作环境尚未就绪' : s.jobs.some(active) ? '设计所当前有一篇正在创作，请等待完成或停止后继续' : unfinished ? '当前版本已有未完成作品，可继续生成；修改稿件后可另开新作品' : ''; });
    content().querySelectorAll('[data-ds="retry"],[data-ds="cancel"],[data-ds="export"],[data-ds="folder"]').forEach(button => { button.disabled = s.busy || !s.loaded; });
    content().querySelectorAll('[data-ds="retry"]').forEach(button => { button.disabled = s.busy || !s.capabilities.available || s.jobs.some(active); });
    content().querySelectorAll('[data-ds="refresh"]').forEach(button => { button.disabled = s.busy || s.loading; });
    content().querySelectorAll('[data-ds-field],[data-ds-prompt]').forEach(field => { field.disabled = s.busy; });
    if (!d) return;
    const status = document.querySelector('#ds-save-state'); if (status) { status.textContent = d.dirty ? '有未保存的修改' : '设计稿已保存'; status.className = d.dirty ? 'is-dirty' : ''; }
    const titleCount = document.querySelector('#ds-title-count'); if (titleCount) { titleCount.textContent = `${count(d.title)} / 20`; titleCount.classList.toggle('ds-over-limit', count(d.title) > 20); }
    const bodyCount = document.querySelector('#ds-caption-count'), amount = count(d.caption + '\n\n' + d.tags.map(t => String(t).startsWith('#') ? t : '#' + t).join(' '));
    if (bodyCount) { bodyCount.textContent = `正文与标签 ${amount} / 1000 字`; bodyCount.classList.toggle('ds-over-limit', amount > 1000); }
  }
  function showError(message) { s.error = message; const holder = document.querySelector('#ds-error'); if (holder) { holder.innerHTML = message ? `<p class="ds-error">${html(message)}</p>` : ''; if (message) holder.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
  function refreshJobs() {
    if (state.page !== PAGE) return;
    if (s.topicId) { const panel = document.querySelector('#ds-job-panel'); if (panel) { const expanded = [...panel.querySelectorAll('details[open]')].map(el => el.className); panel.innerHTML = jobPanel(); panel.querySelectorAll('details').forEach(el => { el.open = expanded.includes(el.className); }); } const history = document.querySelector('#ds-detail-history'); if (history && topic()) history.innerHTML = historyPanel(topic()); }
    else if (s.tab === 'works') { const list = document.querySelector('#ds-work-list'); if (list) list.innerHTML = s.jobs.map(jobCard).join('') || empty('还没有生成作品', '从选题库开始第一份设计。'); }
    else { const list = document.querySelector('#ds-topic-results'); if (list) list.innerHTML = topicResults(); }
    updateControls();
  }
  function poll() {
    clearTimeout(s.timer); if (state.page !== PAGE || !s.loaded || !s.jobs.some(active)) return;
    s.timer = setTimeout(async () => {
      if (s.busy) { poll(); return; } const version = s.version;
      try {
        const results = await Promise.allSettled(s.jobs.filter(active).map(job => api('/jobs/' + encodeURIComponent(job.id))));
        if (version !== s.version) return;
        for (const result of results) if (result.status === 'fulfilled') { putJob(result.value); const item = s.topics.find(t => t.id === result.value.topicId); if (item && result.value.status === 'ready') item.status = 'ready'; }
        const failure = results.find(result => result.status === 'rejected'); if (failure) showError('进度连接暂时中断，已有内容仍保留。' + failure.reason.message); else if (s.error.startsWith('进度连接暂时中断')) showError('');
        refreshJobs();
      } catch (error) { showError(error.message); }
      finally { poll(); }
    }, 3000);
  }
  function captionText(d) { return [d.title, d.caption ?? d.body, (d.tags || []).map(t => String(t).startsWith('#') ? t : '#' + t).join(' ')].filter(Boolean).join('\n\n'); }
  async function clipboard(value) { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value); else { const area = document.createElement('textarea'); area.value = value; area.style.cssText = 'position:fixed;left:-9999px'; document.body.append(area); area.select(); const ok = document.execCommand('copy'); area.remove(); if (!ok) throw new Error('复制未完成，请手动选择文字复制。'); } toast('已复制'); }
  function downloadJSON(value, filename) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function saveCurrent() {
    const item = topic(); if (!item) throw new Error('请先选择一个选题。'); const d = draftFor(item); if (!d.dirty) return item;
    const updated = await api('/topics/' + encodeURIComponent(item.id), { revision: d.revision, title: d.title, caption: d.caption, tags: d.tags, pages: d.pages });
    putTopic(updated); d.revision = updated.revision; d.dirty = false;
    const heading = document.querySelector('.ds-detail-heading h2'); if (heading && s.topicId === updated.id) heading.textContent = updated.title;
    return updated;
  }
  async function action(name, button) {
    const item = topic(), d = item ? draftFor(item) : null, job = s.jobs.find(j => j.id === button.dataset.dsJob) || selectedJob();
    if (name === 'back') { go(s.tab === 'compare' ? 'works' : s.tab); return; }
    if (name === 'refresh') { if (!s.busy) await load(); return; }
    if (s.busy) return;
    try {
      if (name === 'copy-caption' && d) { await clipboard(captionText(d)); return; }
      if (name === 'copy-job-caption' && job) { await clipboard(captionText(job.caption)); return; }
      if (name === 'copy-job-prompts' && job) { await clipboard((job.pages || []).map((p, i) => `${i + 1}. ${p.title}\n\n${p.prompt}`).join('\n\n---\n\n')); return; }
      if (name === 'copy-job-page' && job) { await clipboard(job.pages?.[Number(button.dataset.dsIndex)]?.prompt || ''); return; }
      if (name === 'copy-prompts' && d) { await clipboard(d.pages.map((p, i) => `${i + 1}. ${p.title}\n\n${p.prompt}`).join('\n\n---\n\n')); return; }
      if (name === 'copy-page' && d) { await clipboard(d.pages[Number(button.dataset.dsIndex)]?.prompt || ''); return; }
      if (name === 'export-job' && job) { downloadJSON(job, '偏爱日常设计所-' + job.id + '.json'); return; }
      s.busy = true; s.version++; updateControls(); showError('');
      if (name === 'export') { const collection=s.collection, exported=await api('/export'); if(collection!=='all'){exported.topics=exported.topics.filter(t=>t.collection===collection);exported.collection=collection;} downloadJSON(exported,collection==='all'?'偏爱日常设计所-选题档案.json':'偏爱日常设计所-新增衣物与幸福小物.json');toast(collection==='all'?'完整选题档案已导出':'本次新增选题已导出'); }
      else if (name === 'folder' && job) { await api('/jobs/' + encodeURIComponent(job.id) + '/open-folder', {}); toast('已打开素材目录'); }
      else if (name === 'save') { const saved = await saveCurrent(); const title = document.querySelector('.ds-detail-heading h2'); if (state.page === PAGE && s.topicId === saved.id && title) title.textContent = saved.title; toast('修改已保存'); }
      else if (name === 'generate') { const saved = await saveCurrent(); const result = await api('/jobs', { topicId: saved.id, revision: saved.revision }); putJob(result); if (state.page === PAGE && s.topicId === saved.id) { s.jobId = result.id; const params = new URLSearchParams({ view: s.tab, topic: saved.id, job: result.id }); if (s.collection !== 'all') params.set('collection', s.collection); history.replaceState(null, '', '#' + PAGE + '?' + params); } refreshJobs(); toast('已开始创作当前设计'); }
      else if ((name === 'retry' || name === 'cancel') && job) { putJob(await api('/jobs/' + encodeURIComponent(job.id) + '/' + name, {})); refreshJobs(); toast(name === 'retry' ? '已继续本篇创作' : '已停止本篇，已有内容保留'); }
    } catch (error) { showError(error.message); }
    finally { s.busy = false; updateControls(); poll(); }
  }
  function preview(url, name) {
    if (!asset(url)) return; const dialog = document.createElement('dialog'); dialog.className = 'ds-preview';
    dialog.innerHTML = `<div class="ds-preview-heading"><strong>${html(name)}</strong><div><button class="btn" data-zoom>100% 原图</button><a class="btn" href="${html(asset(url))}" download="${html(name)}">保存原图</a><button class="ds-preview-close" aria-label="关闭预览">×</button></div></div><div class="ds-preview-scroll"><img src="${html(asset(url))}" alt="${html(name)}"></div><p class="ds-preview-size">正在读取原图…</p>`;
    document.body.append(dialog); dialog.showModal(); const img = dialog.querySelector('img');
    img.onload = () => { dialog.querySelector('.ds-preview-size').textContent = `${img.naturalWidth} × ${img.naturalHeight} · 原始图片`; }; img.onerror = () => { dialog.querySelector('.ds-preview-size').textContent = '图片暂时无法读取，请关闭后重试。'; };
    dialog.querySelector('.ds-preview-close').onclick = () => dialog.close(); dialog.querySelector('[data-zoom]').onclick = event => { event.target.textContent = dialog.classList.toggle('ds-native') ? '适应窗口' : '100% 原图'; };
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }); dialog.addEventListener('close', () => dialog.remove());
  }
  document.addEventListener('input', event => {
    if (state.page !== PAGE) return; const target = event.target;
    if (target.id === 'ds-search') { s.query = target.value; document.querySelector('#ds-topic-results').innerHTML = topicResults(); return; }
    if (!target.hasAttribute('data-ds-field') && !target.hasAttribute('data-ds-prompt')) return;
    const item = topic(); if (!item) return; const d = draftFor(item);
    if (target.hasAttribute('data-ds-prompt')) { const page = d.pages[Number(target.dataset.dsPrompt)]; if (page) page.prompt = target.value; }
    else if (target.dataset.dsField === 'tags') d.tags = target.value.split(/[\s,，]+/).map(tag => tag.replace(/^#+/, '')).filter(Boolean);
    else d[target.dataset.dsField] = target.value;
    d.dirty = true; updateControls();
  });
  document.addEventListener('change', event => { if (event.target.id === 'ds-sort') { s.sort = event.target.value; document.querySelector('#ds-topic-results').innerHTML = topicResults(); } });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-ds],[data-ds-tab],[data-ds-topic],[data-ds-category],[data-ds-priority],[data-ds-collection],[data-ds-preview],[data-ds-compare]'); if (!button || button.disabled || state.page !== PAGE) return; event.preventDefault();
    if (button.hasAttribute('data-ds-preview')) { preview(button.dataset.dsPreview, button.dataset.dsImageName); return; }
    if (button.hasAttribute('data-ds-category')) { s.category = button.dataset.dsCategory; paint(); return; }
    if (button.hasAttribute('data-ds-priority')) { s.priority = button.dataset.dsPriority; paint(); return; }
    if (button.hasAttribute('data-ds-collection')) { s.collection = button.dataset.dsCollection; s.category = 'all'; s.priority = 'all'; s.query = ''; const params = new URLSearchParams({view:s.tab}); if (s.collection !== 'all') params.set('collection',s.collection); history.replaceState(null,'','#'+PAGE+'?'+params); paint(); return; }
    if (s.busy) return;
    if (button.dataset.dsCompare) { const job = s.jobs.find(j => j.id === button.dataset.dsCompare); if (job) go('compare', job.topicId, job.id); return; }
    if (button.dataset.dsTab) { go(button.dataset.dsTab); return; }
    if (button.dataset.dsTopic) { go(s.tab === 'compare' ? 'works' : s.tab, button.dataset.dsTopic, button.dataset.dsJob || null); return; }
    if (button.dataset.ds) action(button.dataset.ds, button);
  });
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#' + PAGE)) { route(); state.page = PAGE; render(); } else if (!location.hash && state.page === PAGE) { state.page = 'dashboard'; render(); } });
  window.addEventListener('beforeunload', event => { if ([...s.drafts.values()].some(d => d.dirty)) { event.preventDefault(); event.returnValue = ''; } });
  route(); if (location.hash.startsWith('#' + PAGE)) state.page = PAGE; render();
})();
