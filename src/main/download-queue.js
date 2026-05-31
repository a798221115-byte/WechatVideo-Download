import crypto from 'node:crypto';

const FINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

function nowIso() {
  return new Date().toISOString();
}

function createTask(candidate) {
  const id = crypto.randomUUID();
  return {
    id,
    videoId: String(candidate.videoId || candidate.id || id),
    title: candidate.title || '',
    author: candidate.author || candidate.nickname || '',
    sourceTab: candidate.sourceTab || '',
    url: candidate.url || '',
    coverUrl: candidate.coverUrl || '',
    durationText: candidate.durationText || '',
    decryptKey: candidate.decryptKey || '',
    decryptorArray: candidate.decryptorArray || null,
    localPath: '',
    status: 'queued',
    progress: 0,
    attempts: 0,
    error: '',
    capturedAt: candidate.capturedAt || nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

export function createDownloadQueue(initialTasks = []) {
  const tasks = [];
  const byVideoId = new Map();

  function index(task) {
    tasks.push(task);
    byVideoId.set(task.videoId, task);
  }

  for (const task of initialTasks) {
    index({ ...task });
  }

  function get(id) {
    const task = tasks.find((item) => item.id === id);
    if (!task) throw new Error(`download task not found: ${id}`);
    return task;
  }

  return {
    enqueue(candidate) {
      const videoId = String(candidate.videoId || candidate.id || '');
      if (videoId && byVideoId.has(videoId)) {
        return byVideoId.get(videoId);
      }
      const task = createTask(candidate);
      index(task);
      return task;
    },
    enqueueMany(candidates) {
      return candidates.map((candidate) => this.enqueue(candidate));
    },
    list() {
      return tasks.map((task) => ({ ...task, decryptorArray: undefined }));
    },
    get,
    markRunning(id) {
      const task = get(id);
      task.status = 'running';
      task.attempts += 1;
      task.error = '';
      task.updatedAt = nowIso();
      return task;
    },
    markProgress(id, progress) {
      const task = get(id);
      task.progress = Math.max(0, Math.min(100, Number(progress) || 0));
      task.updatedAt = nowIso();
      return task;
    },
    markDone(id, localPath) {
      const task = get(id);
      task.status = 'done';
      task.progress = 100;
      task.localPath = localPath || task.localPath;
      task.error = '';
      task.updatedAt = nowIso();
      return task;
    },
    markFailed(id, error) {
      const task = get(id);
      if (task.attempts === 0) task.attempts = 1;
      task.status = 'failed';
      task.error = String(error || 'download failed');
      task.updatedAt = nowIso();
      return task;
    },
    cancel(id) {
      const task = get(id);
      if (!FINAL_STATUSES.has(task.status)) {
        task.status = 'cancelled';
        task.updatedAt = nowIso();
      }
      return task;
    },
    retry(id) {
      const task = get(id);
      task.status = 'queued';
      task.error = '';
      task.progress = 0;
      task.updatedAt = nowIso();
      return task;
    },
    nextQueued() {
      return tasks.find((task) => task.status === 'queued') || null;
    }
  };
}
