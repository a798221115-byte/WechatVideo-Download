const tasksNode = document.querySelector('#tasks');
const refreshButton = document.querySelector('#refresh');
const proxyButton = document.querySelector('#proxy');
const proxyNotice = document.querySelector('#proxyNotice');

function statusText(status) {
  return {
    queued: '等待',
    running: '下载中',
    done: '完成',
    failed: '失败',
    cancelled: '已取消'
  }[status] || status;
}

function count(tasks, status) {
  return tasks.filter((task) => task.status === status).length;
}

async function post(url) {
  await fetch(url, { method: 'POST' });
  await load();
}

async function loadProxyStatus() {
  const response = await fetch('/api/proxy');
  const status = await response.json();
  proxyButton.textContent = status.running ? '停止代理' : '启动代理';
  proxyNotice.classList.toggle('ok', status.running);
  proxyNotice.textContent = status.running
    ? `代理已启动：127.0.0.1:${status.port}。请重新打开或刷新微信视频号页面。`
    : '代理未启动。点击“启动代理”后，再重新打开微信视频号“赞和收藏”页面。';
  return status;
}

function render(tasks) {
  document.querySelector('#queued').textContent = count(tasks, 'queued');
  document.querySelector('#running').textContent = count(tasks, 'running');
  document.querySelector('#done').textContent = count(tasks, 'done');
  document.querySelector('#failed').textContent = count(tasks, 'failed');

  if (!tasks.length) {
    tasksNode.innerHTML = '<div class="empty">还没有任务。请在视频号页面多选视频后加入下载。</div>';
    return;
  }

  tasksNode.innerHTML = tasks.map((task) => `
    <article class="task">
      <div>
        <h3>${escapeHtml(task.title || task.videoId)}</h3>
        <small>${escapeHtml(task.author || '未知作者')} · ${escapeHtml(task.sourceTab || '未知来源')} · ${escapeHtml(task.error || task.localPath || '')}</small>
      </div>
      <div class="task-actions">
        <span class="status">${statusText(task.status)}</span>
        ${task.status === 'done' && task.localPath ? `<button data-open-folder="${task.id}">打开文件夹</button>` : ''}
        ${task.status === 'failed' ? `<button data-retry="${task.id}">重试</button>` : ''}
        ${task.status === 'queued' || task.status === 'running' ? `<button data-cancel="${task.id}">取消</button>` : ''}
      </div>
    </article>
  `).join('');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

async function load() {
  const response = await fetch('/api/downloads');
  const data = await response.json();
  render(data.tasks || []);
  await loadProxyStatus();
}

tasksNode.addEventListener('click', async (event) => {
  const retry = event.target?.dataset?.retry;
  const cancel = event.target?.dataset?.cancel;
  const openFolder = event.target?.dataset?.openFolder;
  if (retry) await post(`/api/downloads/${retry}/retry`);
  if (cancel) await post(`/api/downloads/${cancel}/cancel`);
  if (openFolder) await post(`/api/downloads/${openFolder}/open-folder`);
});

refreshButton.addEventListener('click', load);
proxyButton.addEventListener('click', async () => {
  const status = await loadProxyStatus();
  proxyButton.disabled = true;
  try {
    await fetch(status.running ? '/api/proxy/stop' : '/api/proxy/start', { method: 'POST' });
  } finally {
    proxyButton.disabled = false;
    await load();
  }
});
setInterval(load, 1500);
await load();
