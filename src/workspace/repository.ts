import {
  parseIndicatorTemplatePayload, parseIndicatorTemplate, parseWorkspaceDocument, parseWorkspacePayload,
  type IndicatorTemplateDocument, type IndicatorTemplateInput, type WorkspaceDocument, type WorkspaceKind, type WorkspacePayload,
} from './documents';
import { boolean, list, number, readJson, record, string, WorkspaceDocumentError } from './json';

export interface WorkspaceCatalog {
  version: 1; revision: number; workspaces: WorkspaceDocument[]; templates: IndicatorTemplateDocument[];
  recentWorkspaceIds: string[]; activeWorkspaceId: string | null; autosave: boolean;
}

/** Cancellation is effective until the storage transaction commits. */
export interface WorkspaceOperationOptions { signal?: AbortSignal }
export interface WorkspaceOpenOptions extends WorkspaceOperationOptions {
  /** Reject if a grid was prepared from a catalog that has since changed. */
  expectedRevision?: number;
}

/** The host must atomically reject writes whose expectedRevision is stale. */
export interface WorkspaceStorage {
  read(namespace: string): Promise<unknown | null>;
  write(namespace: string, catalog: WorkspaceCatalog, expectedRevision: number, options?: WorkspaceOperationOptions): Promise<void>;
}
export interface WorkspaceRepositoryOptions { now?: () => number; id?: () => string }
export class WorkspaceConflictError extends Error {
  constructor() { super('The saved workspace changed in another session. Reload and retry.'); this.name = 'WorkspaceConflictError'; }
}
type Document = WorkspaceDocument | IndicatorTemplateDocument;

/** Parse the complete catalog before any mutation; corrupt storage is never replaced. */
export function parseWorkspaceCatalog(input: unknown): WorkspaceCatalog {
  const source = record(readJson(input), 'workspace catalog');
  if (source.version !== 1) throw new WorkspaceDocumentError('Unsupported workspace catalog version');
  const workspaces = list(source.workspaces, 'workspaces', 100).map(parseWorkspaceDocument);
  const templates = list(source.templates, 'templates', 100).map(parseIndicatorTemplate);
  const ids = [...workspaces, ...templates].map(item => item.id);
  if (new Set(ids).size !== ids.length) throw new WorkspaceDocumentError('Duplicate document ID');
  const workspaceIds = new Set(workspaces.map(item => item.id));
  const recentWorkspaceIds = list(source.recentWorkspaceIds, 'recent workspaces', 10).map(id => string(id, 'recent workspace ID', 100));
  if (new Set(recentWorkspaceIds).size !== recentWorkspaceIds.length || recentWorkspaceIds.some(id => !workspaceIds.has(id))) {
    throw new WorkspaceDocumentError('Invalid recent workspace IDs');
  }
  const activeWorkspaceId = source.activeWorkspaceId === null ? null : string(source.activeWorkspaceId, 'active workspace ID', 100);
  if (activeWorkspaceId !== null && !workspaceIds.has(activeWorkspaceId)) throw new WorkspaceDocumentError('Active workspace is missing');
  return { version: 1, revision: number(source.revision, 'catalog revision', 0, Number.MAX_SAFE_INTEGER, true),
    workspaces, templates, recentWorkspaceIds, activeWorkspaceId, autosave: boolean(source.autosave, 'autosave') };
}

function emptyCatalog(): WorkspaceCatalog {
  return { version: 1, revision: 0, workspaces: [], templates: [], recentWorkspaceIds: [], activeWorkspaceId: null, autosave: false };
}

function documentOf(input: unknown): Document {
  const source = record(readJson(input), 'document');
  if (source.kind === 'workspace') return parseWorkspaceDocument(source);
  if (source.kind === 'indicator-template') return parseIndicatorTemplate(source);
  throw new WorkspaceDocumentError('Unsupported document kind');
}

/**
 * Named configuration with serialized, revision-checked writes. Create a new
 * repository when the account changes; an in-flight operation keeps its owner.
 */
export class WorkspaceRepository {
  private readonly _storage: WorkspaceStorage;
  private readonly _namespace: string;
  private readonly _now: () => number;
  private readonly _id: () => string;
  private _queue: Promise<void> = Promise.resolve();

  constructor(storage: WorkspaceStorage, namespace: string, options: WorkspaceRepositoryOptions = {}) {
    this._storage = storage;
    this._namespace = string(namespace, 'storage namespace');
    this._now = options.now ?? Date.now;
    this._id = options.id ?? (() => {
      if (!globalThis.crypto?.randomUUID) throw new WorkspaceDocumentError('Supply an ID factory when crypto.randomUUID is unavailable');
      return globalThis.crypto.randomUUID();
    });
  }

  get namespace(): string { return this._namespace; }

  async load(): Promise<WorkspaceCatalog> {
    await this._queue;
    return this._read();
  }

  async createWorkspace(name: string, input: WorkspacePayload): Promise<WorkspaceDocument> {
    const payload = parseWorkspacePayload(input);
    const title = string(name, 'name', 120);
    return this._transact(catalog => {
      const now = this._now();
      const doc = parseWorkspaceDocument({ ...payload, kind: 'workspace', version: 1, id: this._newId(catalog), name: title, createdAt: now, updatedAt: now });
      catalog.workspaces.push(doc);
      return doc;
    });
  }

  async saveWorkspace(id: string, input: WorkspacePayload): Promise<WorkspaceDocument> {
    const payload = parseWorkspacePayload(input);
    return this._transact(catalog => {
      const existing = this._find(catalog, 'workspace', id) as WorkspaceDocument;
      const doc = parseWorkspaceDocument({ ...existing, ...payload, updatedAt: this._updatedAt(existing) });
      catalog.workspaces[catalog.workspaces.indexOf(existing)] = doc;
      return doc;
    });
  }

  async createTemplate(name: string, input: IndicatorTemplateInput): Promise<IndicatorTemplateDocument> {
    const payload = parseIndicatorTemplatePayload(input);
    const title = string(name, 'name', 120);
    return this._transact(catalog => {
      const now = this._now();
      const doc = parseIndicatorTemplate({ kind: 'indicator-template', version: 1, id: this._newId(catalog), name: title,
        createdAt: now, updatedAt: now, ...payload });
      catalog.templates.push(doc);
      return doc;
    });
  }

  /** Update reusable study settings without changing the saved template identity. */
  async saveTemplate(id: string, input: IndicatorTemplateInput): Promise<IndicatorTemplateDocument> {
    const payload = parseIndicatorTemplatePayload(input);
    return this._transact(catalog => {
      const existing = this._find(catalog, 'indicator-template', id) as IndicatorTemplateDocument;
      const doc = parseIndicatorTemplate({ kind: 'indicator-template', version: existing.version,
        id: existing.id, name: existing.name, createdAt: existing.createdAt, updatedAt: this._updatedAt(existing), ...payload });
      catalog.templates[catalog.templates.indexOf(existing)] = doc;
      return doc;
    });
  }

  async rename(kind: WorkspaceKind, id: string, name: string): Promise<void> {
    const title = string(name, 'name', 120);
    return this._transact(catalog => {
      const doc = this._find(catalog, kind, id);
      doc.name = title;
      doc.updatedAt = this._updatedAt(doc);
    });
  }

  async duplicate(kind: WorkspaceKind, id: string, name: string): Promise<WorkspaceDocument | IndicatorTemplateDocument> {
    const title = string(name, 'name', 120);
    return this._transact(catalog => this._insert(catalog, this._find(catalog, kind, id), title));
  }

  async remove(kind: WorkspaceKind, id: string): Promise<void> {
    return this._transact(catalog => {
      this._find(catalog, kind, id);
      if (kind === 'indicator-template') catalog.templates = catalog.templates.filter(item => item.id !== id);
      else {
        catalog.workspaces = catalog.workspaces.filter(item => item.id !== id);
        catalog.recentWorkspaceIds = catalog.recentWorkspaceIds.filter(item => item !== id);
        if (catalog.activeWorkspaceId === id) catalog.activeWorkspaceId = catalog.recentWorkspaceIds[0] ?? null;
      }
    });
  }

  async openWorkspace(id: string, options: WorkspaceOpenOptions = {}): Promise<WorkspaceDocument> {
    const expected = options.expectedRevision === undefined ? undefined
      : number(options.expectedRevision, 'expected revision', 0, Number.MAX_SAFE_INTEGER, true);
    return this._transact(catalog => {
      if (expected !== undefined && catalog.revision !== expected) throw new WorkspaceConflictError();
      const doc = this._find(catalog, 'workspace', id) as WorkspaceDocument;
      catalog.activeWorkspaceId = doc.id;
      catalog.recentWorkspaceIds = [doc.id, ...catalog.recentWorkspaceIds.filter(item => item !== doc.id)].slice(0, 10);
      return doc;
    }, options.signal);
  }

  async setAutosave(enabled: boolean): Promise<void> {
    const value = boolean(enabled, 'autosave');
    return this._transact(catalog => { catalog.autosave = value; });
  }

  async importDocument(input: unknown): Promise<WorkspaceDocument | IndicatorTemplateDocument> {
    const doc = documentOf(input);
    return this._transact(catalog => this._insert(catalog, doc, doc.name));
  }

  async exportDocument(kind: WorkspaceKind, id: string): Promise<string> {
    const catalog = await this.load();
    return JSON.stringify(this._find(catalog, kind, id), null, 2);
  }

  private async _read(): Promise<WorkspaceCatalog> {
    const input = await this._storage.read(this._namespace);
    return input === null ? emptyCatalog() : parseWorkspaceCatalog(input);
  }

  private _transact<T>(mutate: (catalog: WorkspaceCatalog) => T, signal?: AbortSignal): Promise<T> {
    const operation = this._queue.then(async () => {
      signal?.throwIfAborted();
      const catalog = await this._read();
      signal?.throwIfAborted();
      const expectedRevision = catalog.revision;
      const result = mutate(catalog);
      catalog.revision++;
      // Validate the entire candidate, including limits, before touching storage.
      const next = parseWorkspaceCatalog(catalog);
      signal?.throwIfAborted();
      await this._storage.write(this._namespace, next, expectedRevision, { signal });
      return result === undefined ? result : readJson(result) as T;
    });
    this._queue = operation.then(() => {}, () => {});
    return operation;
  }

  private _find(catalog: WorkspaceCatalog, kind: WorkspaceKind, id: string): Document {
    if (kind !== 'workspace' && kind !== 'indicator-template') throw new WorkspaceDocumentError('Unsupported document kind');
    const key = string(id, 'document ID', 100);
    const doc = (kind === 'workspace' ? catalog.workspaces : catalog.templates).find(item => item.id === key);
    if (!doc) throw new WorkspaceDocumentError(`Saved ${kind} does not exist`);
    return doc;
  }

  private _updatedAt(doc: Document): number {
    return Math.max(doc.updatedAt, number(this._now(), 'current time', 0));
  }

  private _newId(catalog: WorkspaceCatalog): string {
    const id = string(this._id(), 'generated document ID', 100);
    if ([...catalog.workspaces, ...catalog.templates].some(item => item.id === id)) throw new WorkspaceDocumentError('Generated document ID collision');
    return id;
  }

  private _insert(catalog: WorkspaceCatalog, source: Document, name: string): Document {
    const now = this._now();
    const doc = documentOf({ ...source, name, id: this._newId(catalog), createdAt: now, updatedAt: now });
    if (doc.kind === 'workspace') catalog.workspaces.push(doc);
    else catalog.templates.push(doc);
    return doc;
  }
}
