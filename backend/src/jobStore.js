// In-memory job store for scrapes. For a single-process dev server this is
// enough; swap for a DB (mongo/redis) if you need persistence across restarts.

const { randomUUID } = require('crypto');

const jobs = new Map();

function createJob(params) {
  const id = randomUUID();
  const job = {
    id,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    params,
    progress: { stage: 'queued', total: 0, found: 0 },
    result: null,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function listJobs() {
  return [...jobs.values()].sort((a, b) => (b.createdAt < a.createdAt ? 1 : -1));
}

module.exports = { createJob, updateJob, getJob, listJobs };
