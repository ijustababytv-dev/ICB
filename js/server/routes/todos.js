'use strict';

const mHttpResponse = require('../http/response');
const mStorage = require('../storage');
const mTodos = require('../todos');
const mHttpBody = require('../http/body');
const mDomainValidation = require('../domain/validation');
const crypto = require('node:crypto');

/** Handle todos requests; reject unmatched paths. */
async function handleTodosApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  // ---------------- Daily / Weekly to-do lists ----------------
  // Dashboard-only (control.html), confirmed with Baby 2026-08-25: no Palia log involvement, no
  // automatic reset of either list - she adds and deletes everything herself. Two kinds of item
  // share the same list: 'check' (a plain done/not-done line) and 'goal' (a running count toward
  // a target she sets, e.g. "1/100").
  if (pathname === '/api/todos' && method === 'GET') {
    return mHttpResponse.sendJson(res, 200, { ok: true, todos: mStorage.clone(mTodos.todos) });
  }

  const todoListMatch = pathname.match(/^\/api\/todos\/(daily|weekly)$/);
  if (todoListMatch && method === 'POST') {
    const list = todoListMatch[1];
    const body = await mHttpBody.readBody(req);
    const text = mDomainValidation.cleanString(body.text);
    if (!text) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'A to-do needs some text.' });
    const kind = body.kind === 'goal' ? 'goal' : 'check';
    const item = {
      id: `todo-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      text,
      kind,
      createdAt: new Date().toISOString(),
    };
    if (kind === 'goal') {
      const target = Math.trunc(Number(body.target));
      if (!Number.isFinite(target) || target <= 0) {
        return mHttpResponse.sendJson(res, 400, { ok: false, error: 'A goal needs a target greater than 0 (e.g. 100 for "1/100").' });
      }
      item.target = target;
      item.current = 0;
    } else {
      item.done = false;
    }
    mTodos.todos[list].push(item);
    mTodos.broadcastTodos();
    return mHttpResponse.sendJson(res, 200, { ok: true, todos: mStorage.clone(mTodos.todos) });
  }

  const todoItemMatch = pathname.match(/^\/api\/todos\/(daily|weekly)\/([a-z0-9-]+)$/i);
  if (todoItemMatch) {
    const list = todoItemMatch[1];
    const items = mTodos.todos[list];
    const index = items.findIndex(entry => entry.id === todoItemMatch[2]);
    if (index < 0) return mHttpResponse.sendJson(res, 404, { ok: false, error: 'No to-do with that id.' });

    if (method === 'DELETE') {
      items.splice(index, 1);
      mTodos.broadcastTodos();
      return mHttpResponse.sendJson(res, 200, { ok: true, todos: mStorage.clone(mTodos.todos) });
    }

    if (['PUT', 'POST', 'PATCH'].includes(method)) {
      const item = items[index];
      const body = await mHttpBody.readBody(req);
      if (body.text !== undefined) {
        const text = mDomainValidation.cleanString(body.text);
        if (!text) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'A to-do needs some text.' });
        item.text = text;
      }
      if (item.kind === 'check' && body.done !== undefined) {
        item.done = Boolean(body.done);
      }
      if (item.kind === 'goal') {
        if (body.delta !== undefined) {
          const delta = Math.trunc(Number(body.delta));
          if (!Number.isFinite(delta)) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'delta must be a whole number.' });
          item.current = Math.max(0, item.current + delta);
        }
        if (body.current !== undefined) {
          const current = Math.trunc(Number(body.current));
          if (!Number.isFinite(current) || current < 0) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Progress must be 0 or more.' });
          item.current = current;
        }
        if (body.target !== undefined) {
          const target = Math.trunc(Number(body.target));
          if (!Number.isFinite(target) || target <= 0) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Target must be greater than 0.' });
          item.target = target;
        }
      }
      mTodos.broadcastTodos();
      return mHttpResponse.sendJson(res, 200, { ok: true, todos: mStorage.clone(mTodos.todos) });
    }
  }
  return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}


Object.assign(exports, { handleTodosApi });
