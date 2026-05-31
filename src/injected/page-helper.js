(function wxChannelLocalHelperBootstrap() {
  if (window.__WX_CHANNEL_LOCAL_HELPER__) return;
  window.__WX_CHANNEL_LOCAL_HELPER__ = true;

  function ready(callback) {
    if (document.body) {
      callback();
      return;
    }
    const waitForBody = () => {
      if (document.body) callback();
      else setTimeout(waitForBody, 50);
    };
    document.addEventListener('DOMContentLoaded', waitForBody, { once: true });
    setTimeout(waitForBody, 50);
  }

  ready(function wxChannelLocalHelper() {
    const state = {
      selected: new Map(),
      candidates: new Map(),
      mediaEntries: [],
      observer: null,
      captureTimer: null,
      dragState: null,
      collapsed: window.localStorage?.getItem('wxh-toolbar-collapsed') === '1',
      appBase: window.__WX_HELPER_APP_BASE__ || 'http://127.0.0.1:20250'
    };

    const style = document.createElement('style');
    style.textContent = `
      .wxh-card-mark { position: absolute; top: 8px; right: 8px; z-index: 2147483646; width: 30px; height: 30px; border-radius: 50%; border: 1px solid rgba(255,255,255,.72); background: rgba(20,20,20,.82); display: grid; place-items: center; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.3); }
      .wxh-card-mark input { width: 18px; height: 18px; accent-color: #07c160; cursor: pointer; }
      .wxh-card-selected { outline: 2px solid #07c160 !important; outline-offset: 2px; }
      .wxh-toolbar { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483647; width: min(760px, calc(100vw - 32px)); box-sizing: border-box; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; color: #f2f2f2; background: rgba(24,24,24,.96); box-shadow: 0 12px 32px rgba(0,0,0,.4); font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .wxh-toolbar.wxh-collapsed { width: auto; min-width: 150px; grid-template-columns: auto auto; cursor: grab; }
      .wxh-toolbar.wxh-collapsed .wxh-controls, .wxh-toolbar.wxh-collapsed .wxh-message { display: none; }
      .wxh-toolbar:not(.wxh-collapsed) .wxh-expand { display: none; }
      .wxh-toolbar button, .wxh-toolbar input { height: 34px; border-radius: 6px; border: 1px solid rgba(255,255,255,.18); background: #303030; color: #f2f2f2; padding: 0 10px; font: inherit; white-space: nowrap; }
      .wxh-toolbar button { cursor: pointer; }
      .wxh-toolbar button.primary { background: #07c160; color: #07170f; border-color: #07c160; font-weight: 700; }
      .wxh-toolbar input { width: 76px; }
      .wxh-toolbar-drag { cursor: grab; user-select: none; color: #9f9f9f; padding: 0 2px; }
      .wxh-toolbar-drag:active { cursor: grabbing; }
      .wxh-status { min-width: 58px; font-weight: 700; white-space: nowrap; }
      .wxh-message { min-width: 180px; max-width: 440px; color: #bff4d5; overflow: visible; text-overflow: clip; white-space: normal; overflow-wrap: anywhere; line-height: 1.45; }
      .wxh-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
      .wxh-toggle { min-width: 52px; padding: 0 8px !important; }
    `;
    document.documentElement.appendChild(style);

    function hashText(text) {
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return `wxh-${(hash >>> 0).toString(36)}`;
    }

    function isAllowedMediaUrl(value) {
      try {
        const parsed = new URL(value);
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname.toLowerCase();
        return (
          (host === 'finder.video.qq.com' ||
            host === 'finder.video.weixin.qq.com' ||
            host.endsWith('.video.qq.com') ||
            host.endsWith('.weixin.qq.com') ||
            host.endsWith('.wx.qq.com')) &&
          (path.includes('.mp4') || path.includes('/video/') || path.includes('videoplayback') || parsed.search)
        );
      } catch {
        return false;
      }
    }

    function normalizeUrlKey(value) {
      try {
        const parsed = new URL(value);
        return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
      } catch {
        return String(value || '').split('?')[0].toLowerCase();
      }
    }

    function rememberMediaEntry(entry) {
      if (!entry?.url || !isAllowedMediaUrl(entry.url)) return;
      const key = normalizeUrlKey(entry.url);
      if (state.mediaEntries.some((item) => normalizeUrlKey(item.url) === key)) return;
      const mediaEntry = {
        url: entry.url,
        coverUrl: entry.coverUrl || '',
        title: entry.title || '',
        objectId: entry.objectId || '',
        videoId: entry.videoId || '',
        capturedAt: Date.now()
      };
      state.mediaEntries.unshift(mediaEntry);
      state.mediaEntries = state.mediaEntries.slice(0, 300);
      void postMediaEntries([mediaEntry]);
    }

    function scanTextForMedia(text) {
      const matches = String(text || '').match(/https?:\\?\/\\?\/[^"'\\\s<>]+/g) || [];
      for (const raw of matches) {
        const url = raw.replaceAll('\\/', '/').replace(/[),.;\]]+$/, '');
        if (isAllowedMediaUrl(url)) rememberMediaEntry({ url });
      }
    }

    function scanObjectForMedia(value, depth = 0, context = {}) {
      if (!value || depth > 5) return;
      if (typeof value === 'string') {
        scanTextForMedia(value);
        return;
      }
      if (Array.isArray(value)) {
        value.slice(0, 160).forEach((item) => scanObjectForMedia(item, depth + 1, context));
        return;
      }
      if (typeof value !== 'object') return;

      const nextContext = { ...context };
      for (const [key, item] of Object.entries(value)) {
        const lowerKey = key.toLowerCase();
        if (typeof item !== 'string') continue;
        if (lowerKey.includes('cover') || lowerKey.includes('thumb')) nextContext.coverUrl = item;
        if (lowerKey.includes('title') || lowerKey.includes('desc')) nextContext.title = item;
        if (lowerKey.includes('objectid') || lowerKey === 'id' || lowerKey.includes('feedid')) nextContext.objectId = item;
        if (isAllowedMediaUrl(item)) rememberMediaEntry({ ...nextContext, url: item });
      }

      for (const item of Object.values(value)) {
        scanObjectForMedia(item, depth + 1, nextContext);
      }
    }

    function scanRuntimeForMedia() {
      for (const video of document.querySelectorAll('video')) {
        rememberMediaEntry({ ...currentPendingCandidate(), url: video.currentSrc || video.src || '' });
      }
      try {
        const pending = currentPendingCandidate();
        for (const entry of window.performance.getEntriesByType('resource').slice(-300)) {
          rememberMediaEntry({ ...pending, url: entry.name || '' });
        }
      } catch {
        // Some embedded browsers may restrict performance entries.
      }
      for (const key of ['__INITIAL_STATE__', '__NEXT_DATA__', '__NUXT__']) {
        try {
          scanObjectForMedia(window[key]);
        } catch {
          // Ignore inaccessible runtime stores.
        }
      }
      try {
        for (const storage of [window.localStorage, window.sessionStorage]) {
          for (let index = 0; index < Math.min(storage.length, 200); index += 1) {
            const key = storage.key(index);
            scanTextForMedia(storage.getItem(key));
          }
        }
      } catch {
        // Some embedded browsers restrict storage access.
      }
    }

    function installNetworkCollectors() {
      if (window.__WX_HELPER_NETWORK_COLLECTORS__) return;
      window.__WX_HELPER_NETWORK_COLLECTORS__ = true;

      const originalFetch = window.fetch;
      if (typeof originalFetch === 'function') {
        window.fetch = async function wxhFetch(...args) {
          const response = await originalFetch.apply(this, args);
          try {
            const clone = response.clone();
            const type = clone.headers.get('content-type') || '';
            if (type.includes('json')) scanObjectForMedia(await clone.json());
            else if (type.includes('text') || type.includes('javascript')) scanTextForMedia(await clone.text());
            rememberMediaEntry({ ...currentPendingCandidate(), url: response.url });
          } catch {
            // Network collection is opportunistic only.
          }
          return response;
        };
      }

      if (!window.XMLHttpRequest) return;
      const originalOpen = window.XMLHttpRequest.prototype.open;
      const originalSend = window.XMLHttpRequest.prototype.send;
      window.XMLHttpRequest.prototype.open = function wxhOpen(method, url, ...rest) {
        this.__wxhUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };
      window.XMLHttpRequest.prototype.send = function wxhSend(...args) {
        this.addEventListener('load', () => {
          try {
            const type = this.getResponseHeader('content-type') || '';
            if (type.includes('json')) scanObjectForMedia(JSON.parse(this.responseText));
            else scanTextForMedia(this.responseText || this.responseURL || this.__wxhUrl);
            rememberMediaEntry({ ...currentPendingCandidate(), url: this.responseURL || this.__wxhUrl });
          } catch {
            scanTextForMedia(this.responseText || this.responseURL || this.__wxhUrl);
          }
        });
        return originalSend.apply(this, args);
      };
    }

    function currentSourceTab() {
      const active = Array.from(document.querySelectorAll('[class*="active"], [aria-selected="true"]'))
        .map((node) => node.textContent.trim())
        .find((text) => ['全部', '收藏', '点赞', '转发'].some((name) => text.includes(name)));
      if (active) return active;
      return location.pathname.includes('/account/like') ? '赞和收藏' : '未知';
    }

    function visible(node) {
      const rect = node.getBoundingClientRect();
      return rect.width > 120 && rect.height > 120 && rect.bottom > 0 && rect.right > 0;
    }

    function findCards() {
      const nodes = Array.from(document.querySelectorAll('a, div'));
      return nodes.filter((node) => {
        if (node.dataset.wxhCard === '1') return true;
        if (!visible(node)) return false;
        const rect = node.getBoundingClientRect();
        if (rect.width < 150 || rect.width > 560 || rect.height < 170 || rect.height > 820) return false;
        const hasMedia = node.querySelector('img, video, canvas');
        const text = node.textContent.trim();
        return Boolean(hasMedia && text.length >= 2 && text.length < 320);
      });
    }

    function guessAuthor(card) {
      const textLines = card.textContent.split(/\n|\r/).map((line) => line.trim()).filter(Boolean);
      return textLines.length > 1 ? textLines[textLines.length - 1].slice(0, 60) : 'unknown-author';
    }

    function extractCandidate(card) {
      const text = card.textContent.trim().replace(/\s+/g, ' ');
      const img = card.querySelector('img');
      const video = card.querySelector('video');
      const link = card.closest('a') || card.querySelector('a');
      const title = card.getAttribute('title') || text.split(/\d{1,2}:\d{2}/)[0].slice(0, 80) || 'video';
      const coverUrl = img?.currentSrc || img?.src || '';
      const mediaUrl = video?.currentSrc || video?.src || card.dataset.url || '';
      const idSeed = link?.href || coverUrl || `${title}:${text}`;
      const videoId = card.dataset.wxhId || hashText(idSeed);
      card.dataset.wxhCard = '1';
      card.dataset.wxhId = videoId;
      return {
        videoId,
        title,
        author: guessAuthor(card),
        sourceTab: currentSourceTab(),
        coverUrl,
        url: mediaUrl,
        pageUrl: link?.href || location.href,
        durationText: (text.match(/\b\d{1,2}:\d{2}\b/) || [''])[0],
        capturedAt: new Date().toISOString()
      };
    }

    function setPendingCandidate(candidate) {
      const pending = {
        videoId: candidate.videoId,
        title: candidate.title,
        coverUrl: candidate.coverUrl,
        objectId: candidate.videoId,
        time: Date.now()
      };
      try {
        window.sessionStorage.setItem('wxh-pending-candidate', JSON.stringify(pending));
      } catch {
        // Ignore storage failures in embedded browsers.
      }
      state.pendingCandidate = pending;
    }

    function currentPendingCandidate() {
      let pending = state.pendingCandidate;
      try {
        pending = pending || JSON.parse(window.sessionStorage.getItem('wxh-pending-candidate') || 'null');
      } catch {
        pending = null;
      }
      if (!pending || Date.now() - Number(pending.time || 0) > 5 * 60 * 1000) return {};
      return pending;
    }

    function ensureToolbar() {
      let toolbar = document.querySelector('.wxh-toolbar');
      if (toolbar) return toolbar;
      toolbar = document.createElement('div');
      toolbar.className = 'wxh-toolbar';
      toolbar.innerHTML = `
        <span class="wxh-toolbar-drag" data-role="drag" title="拖动">⋮⋮</span>
        <strong class="wxh-status" data-role="count">已选 0</strong>
        <span class="wxh-message" data-role="message"></span>
        <div class="wxh-controls">
          <button type="button" data-action="scan">扫描</button>
          <button type="button" data-action="select-all">全选本页</button>
          <button type="button" data-action="invert">反选</button>
          <button type="button" data-action="clear">清空</button>
          <input data-role="limit" inputmode="numeric" value="200" title="采集上限" />
          <button type="button" data-action="capture">自动采集</button>
          <button type="button" class="primary" data-action="enqueue">加入下载</button>
          <button type="button" class="wxh-toggle" data-action="toggle">收起</button>
        </div>
        <button type="button" class="wxh-toggle wxh-expand" data-action="toggle">展开</button>
      `;
      toolbar.addEventListener('click', onToolbarClick);
      toolbar.addEventListener('pointerdown', onToolbarPointerDown);
      document.body.appendChild(toolbar);
      restoreToolbarPosition(toolbar);
      applyToolbarMode(toolbar);
      return toolbar;
    }

    function setMessage(message) {
      ensureToolbar().querySelector('[data-role="message"]').textContent = message;
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function restoreToolbarPosition(toolbar) {
      try {
        const saved = JSON.parse(window.localStorage.getItem('wxh-toolbar-position') || 'null');
        if (!saved) return;
        toolbar.style.left = `${clamp(Number(saved.left) || 16, 8, window.innerWidth - 80)}px`;
        toolbar.style.top = `${clamp(Number(saved.top) || 16, 8, window.innerHeight - 48)}px`;
        toolbar.style.bottom = 'auto';
        toolbar.style.transform = 'none';
      } catch {
        // Ignore invalid persisted position.
      }
    }

    function saveToolbarPosition(toolbar) {
      const rect = toolbar.getBoundingClientRect();
      try {
        window.localStorage.setItem('wxh-toolbar-position', JSON.stringify({ left: rect.left, top: rect.top }));
      } catch {
        // Ignore storage failures.
      }
    }

    function applyToolbarMode(toolbar = ensureToolbar()) {
      toolbar.classList.toggle('wxh-collapsed', state.collapsed);
      const toggle = toolbar.querySelector('.wxh-controls [data-action="toggle"]');
      if (toggle) toggle.textContent = state.collapsed ? '展开' : '收起';
      const expand = toolbar.querySelector('.wxh-expand');
      if (expand) expand.style.display = state.collapsed ? '' : 'none';
      try {
        window.localStorage.setItem('wxh-toolbar-collapsed', state.collapsed ? '1' : '0');
      } catch {
        // Ignore storage failures.
      }
    }

    function isInteractiveToolbarTarget(target) {
      return Boolean(target?.closest?.('button,input,select,textarea,a,label'));
    }

    function onToolbarPointerDown(event) {
      const toolbar = ensureToolbar();
      if (isInteractiveToolbarTarget(event.target)) return;
      if (!state.collapsed && event.target?.dataset?.role !== 'drag') return;
      const rect = toolbar.getBoundingClientRect();
      state.dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      toolbar.setPointerCapture?.(event.pointerId);
      toolbar.addEventListener('pointermove', onToolbarPointerMove);
      toolbar.addEventListener('pointerup', onToolbarPointerUp, { once: true });
      event.preventDefault();
    }

    function onToolbarPointerMove(event) {
      if (!state.dragState || event.pointerId !== state.dragState.pointerId) return;
      const toolbar = ensureToolbar();
      const nextLeft = clamp(event.clientX - state.dragState.offsetX, 8, window.innerWidth - toolbar.offsetWidth - 8);
      const nextTop = clamp(event.clientY - state.dragState.offsetY, 8, window.innerHeight - toolbar.offsetHeight - 8);
      toolbar.style.left = `${nextLeft}px`;
      toolbar.style.top = `${nextTop}px`;
      toolbar.style.bottom = 'auto';
      toolbar.style.transform = 'none';
    }

    function onToolbarPointerUp(event) {
      const toolbar = ensureToolbar();
      toolbar.releasePointerCapture?.(event.pointerId);
      toolbar.removeEventListener('pointermove', onToolbarPointerMove);
      state.dragState = null;
      saveToolbarPosition(toolbar);
    }

    function syncSelectionUi() {
      const selectedIds = new Set(state.selected.keys());
      for (const card of document.querySelectorAll('[data-wxh-card="1"]')) {
        const checked = selectedIds.has(card.dataset.wxhId);
        card.classList.toggle('wxh-card-selected', checked);
        const input = card.querySelector('.wxh-card-mark input');
        if (input) input.checked = checked;
      }
      updateCount();
    }

    function updateCount() {
      const count = state.selected.size;
      ensureToolbar().querySelector('[data-role="count"]').textContent = `已选 ${count}`;
    }

    function setSelected(card, candidate, checked) {
      const input = card.querySelector('.wxh-card-mark input');
      const latestCandidate = extractCandidate(card);
      if (checked) {
        state.selected.set(latestCandidate.videoId, latestCandidate);
        card.classList.add('wxh-card-selected');
      } else {
        state.selected.delete(latestCandidate.videoId);
        state.selected.delete(candidate.videoId);
        card.classList.remove('wxh-card-selected');
      }
      if (input) input.checked = checked;
      updateCount();
    }

    function decorateCards() {
      const cards = findCards();
      const candidates = [];
      for (const card of cards) {
        const candidate = extractCandidate(card);
        state.candidates.set(candidate.videoId, candidate);
        candidates.push(candidate);
        if (card.querySelector('.wxh-card-mark')) continue;
        if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
        const mark = document.createElement('label');
        mark.className = 'wxh-card-mark';
        mark.title = '选择下载';
        mark.innerHTML = '<input type="checkbox" />';
        mark.addEventListener('click', (event) => event.stopPropagation());
        mark.querySelector('input').addEventListener('change', (event) => {
          setSelected(card, candidate, event.target.checked);
        });
        card.addEventListener('click', () => {
          setPendingCandidate(extractCandidate(card));
        }, true);
        card.appendChild(mark);
      }
      void postCandidates(candidates);
      updateCount();
    }

    async function postCandidates(candidates) {
      try {
        await fetch(`${state.appBase}/__wx_helper/candidates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceTab: currentSourceTab(), candidates })
        });
      } catch {
        // Keep the WeChat page usable if the local console is not reachable.
      }
    }

    async function postMediaEntries(entries) {
      try {
        await fetch(`${state.appBase}/__wx_helper/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceTab: currentSourceTab(), entries })
        });
      } catch {
        // Media sharing is best-effort; local selection should still work.
      }
    }

    function visibleCandidates() {
      decorateCards();
      return Array.from(document.querySelectorAll('[data-wxh-card="1"]')).map((card) => ({
        card,
        candidate: state.candidates.get(card.dataset.wxhId) || extractCandidate(card)
      }));
    }

    async function onToolbarClick(event) {
      const action = event.target?.dataset?.action;
      if (!action) return;
      if (action === 'toggle') {
        state.collapsed = !state.collapsed;
        applyToolbarMode();
        return;
      }
      const visibleItems = visibleCandidates();
      if (action === 'scan') {
        scanRuntimeForMedia();
        setMessage(`已扫描 ${state.mediaEntries.length} 个视频地址`);
        decorateCards();
      } else if (action === 'select-all') {
        visibleItems.forEach(({ card, candidate }) => setSelected(card, candidate, true));
      } else if (action === 'invert') {
        visibleItems.forEach(({ card, candidate }) => setSelected(card, candidate, !state.selected.has(candidate.videoId)));
      } else if (action === 'clear') {
        state.selected.clear();
        syncSelectionUi();
        setMessage('');
      } else if (action === 'capture') {
        const limit = Number(ensureToolbar().querySelector('[data-role="limit"]').value) || 200;
        await captureByScrolling(limit);
      } else if (action === 'enqueue') {
        await enqueueSelected();
      }
    }

    async function captureByScrolling(limit) {
      let stableRounds = 0;
      let lastCount = state.candidates.size;
      setMessage('正在采集...');
      while (state.candidates.size < limit && stableRounds < 6) {
        window.scrollBy({ top: Math.floor(window.innerHeight * 0.82), behavior: 'smooth' });
        await new Promise((resolve) => setTimeout(resolve, 900));
        scanRuntimeForMedia();
        decorateCards();
        if (state.candidates.size === lastCount) stableRounds += 1;
        else stableRounds = 0;
        lastCount = state.candidates.size;
      }
      setMessage(`已采集 ${state.candidates.size} 个卡片`);
    }

    function enrichCandidate(candidate) {
      if (candidate.url && isAllowedMediaUrl(candidate.url)) return candidate;
      const coverKey = normalizeUrlKey(candidate.coverUrl);
      const title = String(candidate.title || '').trim();
      const matched = state.mediaEntries.find((entry) => {
        if (candidate.videoId && entry.videoId === candidate.videoId) return true;
        if (coverKey && normalizeUrlKey(entry.coverUrl) === coverKey) return true;
        if (title && entry.title && (entry.title.includes(title) || title.includes(entry.title))) return true;
        return false;
      });
      const media = matched;
      return media?.url ? { ...candidate, url: media.url } : candidate;
    }

    async function enqueueSelected() {
      scanRuntimeForMedia();
      const videos = Array.from(state.selected.values()).map((candidate) => enrichCandidate(candidate));
      if (!videos.length) {
        setMessage('请先选择视频');
        return;
      }
      const downloadable = videos.filter((video) => video.url && isAllowedMediaUrl(video.url));
      if (!downloadable.length) {
        setMessage(`没匹配到这个卡片的视频地址。已扫描 ${state.mediaEntries.length} 个地址。请点开这张卡片播放几秒，等画面开始播放后再回列表点击“加入下载”；如果左右两个页面都开着，可以在播放页也点一次“扫描”。`);
        return;
      }
      setMessage('正在加入...');
      try {
        const response = await fetch(`${state.appBase}/__wx_helper/downloads/enqueue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceTab: currentSourceTab(), videos: downloadable })
        });
        if (response.ok) {
          setMessage(`已加入 ${downloadable.length} 个`);
        } else {
          setMessage(`加入失败 ${response.status}`);
        }
      } catch (error) {
        setMessage(`加入失败：${error.message || '网络错误'}`);
      }
    }

    installNetworkCollectors();
    ensureToolbar();
    scanRuntimeForMedia();
    decorateCards();
    state.observer = new MutationObserver(() => {
      clearTimeout(state.captureTimer);
      state.captureTimer = setTimeout(() => {
        scanRuntimeForMedia();
        decorateCards();
      }, 250);
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  });
})();
