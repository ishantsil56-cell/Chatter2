/**
 * A small in-memory stand-in for @react-native-firebase/firestore, covering just
 * the calls the app's services make. It models the behaviours that matter for
 * correctness: nested `update()` paths, deep-merge `set()`, queries, live
 * snapshots, batches, and "pending writes" (to simulate offline).
 *
 * It is NOT a rules engine — security rules are reviewed separately.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Data = Record<string, any>;

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function deepMerge(target: Data, patch: Data): Data {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      deepMerge(target[k], v);
    } else {
      target[k] = clone(v);
    }
  }
  return target;
}

function setPath(obj: Data, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i] as string;
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1] as string] = clone(value);
}

function getPath(obj: Data, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export class FakeFirestoreError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export class FakeDb {
  docs = new Map<string, Data>();
  /** Paths whose latest write has not been "acknowledged by the server". */
  pending = new Set<string>();
  private listeners = new Set<() => void>();
  private counter = 0;
  /** Simulate being offline: writes are applied locally but their promises never settle until `goOnline()`. */
  offline = false;
  private parked: (() => void)[] = [];
  /** When set, the next write whose path matches rejects with this code. */
  failNext: { match: RegExp; code: string } | null = null;
  writeLog: { op: string; path: string; data?: Data }[] = [];

  notifyAll(): void {
    for (const l of [...this.listeners]) l();
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  nextId(): string {
    this.counter += 1;
    return `auto${String(this.counter).padStart(4, '0')}`;
  }

  goOffline(): void {
    this.offline = true;
  }

  goOnline(): void {
    this.offline = false;
    this.pending.clear();
    const parked = this.parked;
    this.parked = [];
    parked.forEach((f) => f());
    this.notifyAll();
  }

  /** Apply a write locally, then settle (or park / fail) its promise like the real SDK. */
  commit(path: string, op: string, apply: () => void, data?: Data): Promise<void> {
    if (this.failNext && this.failNext.match.test(path)) {
      const { code } = this.failNext;
      this.failNext = null;
      return Promise.reject(new FakeFirestoreError(code, `${code} on ${path}`));
    }
    apply();
    this.writeLog.push({ op, path, data: data ? clone(data) : undefined });
    if (this.offline) this.pending.add(path);
    this.notifyAll();
    if (this.offline) return new Promise<void>((resolve) => this.parked.push(resolve));
    return Promise.resolve();
  }

  collection(path: string): FakeCollection {
    return new FakeCollection(this, path);
  }

  batch() {
    const ops: (() => Promise<void>)[] = [];
    return {
      set: (ref: FakeDoc, data: Data, opts?: { merge?: boolean }) => void ops.push(() => ref.set(data, opts)),
      delete: (ref: FakeDoc) => void ops.push(() => ref.delete()),
      update: (ref: FakeDoc, data: Data) => void ops.push(() => ref.update(data)),
      commit: async () => {
        for (const op of ops) await op();
      },
    };
  }

  runTransaction(): never {
    throw new Error('runTransaction must never be used on this app (it hangs on React Native)');
  }
}

export class FakeDocSnap {
  constructor(public id: string, private raw: Data | undefined, public metadata: { hasPendingWrites: boolean }) {}
  get exists(): boolean {
    return this.raw !== undefined;
  }
  data(): Data | undefined {
    return this.raw === undefined ? undefined : clone(this.raw);
  }
}

export class FakeDoc {
  constructor(private db: FakeDb, public path: string) {}
  get id(): string {
    return this.path.split('/').pop() as string;
  }
  collection(name: string): FakeCollection {
    return new FakeCollection(this.db, `${this.path}/${name}`);
  }
  snap(): FakeDocSnap {
    return new FakeDocSnap(this.id, this.db.docs.get(this.path), { hasPendingWrites: this.db.pending.has(this.path) });
  }
  async get(): Promise<FakeDocSnap> {
    return this.snap();
  }
  set(data: Data, opts?: { merge?: boolean }): Promise<void> {
    return this.db.commit(
      this.path,
      'set',
      () => {
        if (opts?.merge) {
          const cur = this.db.docs.get(this.path) ?? {};
          this.db.docs.set(this.path, deepMerge(cur, data));
        } else {
          this.db.docs.set(this.path, clone(data));
        }
      },
      data,
    );
  }
  update(data: Data): Promise<void> {
    if (!this.db.docs.has(this.path)) {
      return Promise.reject(new FakeFirestoreError('not-found', `no document to update: ${this.path}`));
    }
    return this.db.commit(
      this.path,
      'update',
      () => {
        const cur = this.db.docs.get(this.path) as Data;
        for (const [k, v] of Object.entries(data)) setPath(cur, k, v); // dotted keys are PATHS here
      },
      data,
    );
  }
  delete(): Promise<void> {
    return this.db.commit(this.path, 'delete', () => void this.db.docs.delete(this.path));
  }
  onSnapshot(...args: any[]): () => void {
    const cb = args.find((a) => typeof a === 'function');
    const errCb = args.filter((a) => typeof a === 'function')[1];
    void errCb;
    let last = '';
    const fire = (): void => {
      const s = this.snap();
      const sig = JSON.stringify([s.data(), s.metadata.hasPendingWrites]);
      if (sig === last) return;
      last = sig;
      cb(s);
    };
    setTimeout(fire, 0);
    return this.db.onChange(fire);
  }
}

type Filter = { field: string; op: string; value: any };

export class FakeCollection {
  private filters: Filter[] = [];
  private order: { field: string; dir: 'asc' | 'desc' } | null = null;
  private max: number | null = null;
  private fromEnd = false;
  private start: any = undefined;
  private end: any = undefined;

  constructor(private db: FakeDb, public path: string) {}

  doc(id?: string): FakeDoc {
    return new FakeDoc(this.db, `${this.path}/${id ?? this.db.nextId()}`);
  }
  async add(data: Data): Promise<FakeDoc> {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
  private derive(patch: (c: FakeCollection) => void): FakeCollection {
    const c = new FakeCollection(this.db, this.path);
    c.filters = [...this.filters];
    c.order = this.order;
    c.max = this.max;
    c.fromEnd = this.fromEnd;
    c.start = this.start;
    c.end = this.end;
    patch(c);
    return c;
  }
  where(field: string, op: string, value: any): FakeCollection {
    return this.derive((c) => c.filters.push({ field, op, value }));
  }
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): FakeCollection {
    return this.derive((c) => (c.order = { field, dir }));
  }
  limit(n: number): FakeCollection {
    return this.derive((c) => {
      c.max = n;
      c.fromEnd = false;
    });
  }
  limitToLast(n: number): FakeCollection {
    return this.derive((c) => {
      c.max = n;
      c.fromEnd = true;
    });
  }
  startAt(v: any): FakeCollection {
    return this.derive((c) => (c.start = v));
  }
  endAt(v: any): FakeCollection {
    return this.derive((c) => (c.end = v));
  }

  private run(): FakeDocSnap[] {
    const depth = this.path.split('/').length + 1;
    let rows = [...this.db.docs.entries()]
      .filter(([p]) => p.startsWith(`${this.path}/`) && p.split('/').length === depth)
      .map(([p, d]) => ({ p, d }));
    for (const f of this.filters) {
      rows = rows.filter(({ d }) => {
        const v = getPath(d, f.field);
        if (f.op === 'array-contains') return Array.isArray(v) && v.includes(f.value);
        if (f.op === '==') return v === f.value;
        throw new Error(`fake firestore: unsupported operator ${f.op}`);
      });
    }
    if (this.order) {
      const { field, dir } = this.order;
      rows.sort((a, b) => {
        const x = getPath(a.d, field);
        const y = getPath(b.d, field);
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1);
      });
      if (this.start !== undefined) rows = rows.filter(({ d }) => getPath(d, field) >= this.start);
      if (this.end !== undefined) rows = rows.filter(({ d }) => getPath(d, field) <= this.end);
    }
    if (this.max !== null) rows = this.fromEnd ? rows.slice(-this.max) : rows.slice(0, this.max);
    return rows.map(({ p, d }) => new FakeDocSnap(p.split('/').pop() as string, d, { hasPendingWrites: this.db.pending.has(p) }));
  }

  async get(): Promise<{ docs: FakeDocSnap[]; empty: boolean; size: number }> {
    const docs = this.run();
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  onSnapshot(...args: any[]): () => void {
    const fns = args.filter((a) => typeof a === 'function');
    const cb = fns[0];
    let last = '';
    const fire = (): void => {
      const docs = this.run();
      const sig = JSON.stringify(docs.map((d) => [d.id, d.data(), d.metadata.hasPendingWrites]));
      if (sig === last) return;
      last = sig;
      cb({ docs, empty: docs.length === 0, size: docs.length });
    };
    setTimeout(fire, 0);
    return this.db.onChange(fire);
  }
}
