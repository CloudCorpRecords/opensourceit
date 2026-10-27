// Opensourceit — git-backed durable store.
//
// On serverless hosts the filesystem is read-only and memory is per-instance,
// so community data kept vanishing between cold starts. When OSIT_DB_MODE=github
// is set (with GITHUB_TOKEN, OSIT_DB_REPO, OSIT_DB_BRANCH), the whole db.json
// lives as a file on a dedicated branch of a GitHub repo: every write is a
// commit (which is also a free, auditable backup history), reads come from an
// in-memory cache loaded once per instance.
//
// Anywhere else, load()/save() fall back to the local file exactly as before.

const API = 'https://api.github.com';

export function remoteConfig(env = process.env) {
  if ((env.OSIT_DB_MODE || '').toLowerCase() !== 'github') return null;
  if (!env.GITHUB_TOKEN || !env.OSIT_DB_REPO) return null;
  return {
    token: env.GITHUB_TOKEN,
    repo: env.OSIT_DB_REPO,                                 // owner/name
    branch: env.OSIT_DB_BRANCH || 'data-live',
    path: env.OSIT_DB_PATH || 'data/db.json',
  };
}

export class GitStore {
  constructor(cfg, seed, fetchImpl = fetch) {
    this.cfg = cfg; this.seed = seed; this.fetch = fetchImpl;
    this.cache = null; this.sha = null;
    this.queue = Promise.resolve(); this.dirty = false; this.lastError = null;
  }
  headers() { return { 'Authorization': 'Bearer ' + this.cfg.token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'opensourceit', 'Content-Type': 'application/json' }; }
  url() { return `${API}/repos/${this.cfg.repo}/contents/${this.cfg.path}`; }

  async load() {
    if (this.cache) return this.cache;
    try {
      const r = await this.fetch(`${this.url()}?ref=${encodeURIComponent(this.cfg.branch)}`, { headers: this.headers(), signal: AbortSignal.timeout(10000) });
      if (r.status === 200) {
        const j = await r.json();
        this.sha = j.sha;
        this.cache = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
        return this.cache;
      }
      if (r.status === 404) { // first boot: seed the branch file from the bundled db
        this.cache = structuredClone(this.seed);
        await this.persist('chore: initialize live data store');
        return this.cache;
      }
      throw new Error('github load ' + r.status);
    } catch (e) {
      this.lastError = String(e.message || e);
      // Degraded, never down: serve the seed rather than 500 the community.
      this.cache = structuredClone(this.seed);
      return this.cache;
    }
  }

  /** Replace the in-memory db and schedule a durable write (debounced, serialized). */
  save(db) {
    this.cache = db; this.dirty = true;
    this.queue = this.queue.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      try { await this.persist('data: community update'); }
      catch (e) { this.lastError = String(e.message || e); this.dirty = true; }
    });
    return this.queue;
  }

  async persist(message) {
    const content = Buffer.from(JSON.stringify(this.cache, null, 2)).toString('base64');
    for (let attempt = 0; attempt < 2; attempt++) {
      const payload = { message, content, branch: this.cfg.branch, ...(this.sha ? { sha: this.sha } : {}) };
      const r = await this.fetch(this.url(), { method: 'PUT', headers: this.headers(), body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
      if (r.status === 200 || r.status === 201) { const j = await r.json(); this.sha = j.content?.sha || this.sha; return; }
      if ((r.status === 409 || r.status === 422) && attempt === 0) {
        // Someone else wrote first (another instance) — take their sha and retry once,
        // keeping OUR in-memory state (last-writer-wins per instance is acceptable at
        // community scale; the commit history keeps every version recoverable).
        const g = await this.fetch(`${this.url()}?ref=${encodeURIComponent(this.cfg.branch)}`, { headers: this.headers(), signal: AbortSignal.timeout(10000) });
        if (g.ok) { const j = await g.json(); this.sha = j.sha; continue; }
      }
      throw new Error('github persist ' + r.status);
    }
  }

  status() { return { mode: 'github', repo: this.cfg.repo, branch: this.cfg.branch, loaded: !!this.cache, lastError: this.lastError }; }
}
