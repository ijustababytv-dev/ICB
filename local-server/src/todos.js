'use strict';

const mDomainTodos = require('./domain/todos');
const mStorage = require('./storage');
const mConfig = require('./config');
const mEvents = require('./events');

let todos = mDomainTodos.normalizeTodos(
    mStorage.readJson(mConfig.TODOS_FILE, mDomainTodos.DEFAULT_TODOS)
);

/** Persist both manual lists without any date-based reset. */
function saveTodos() {
    todos.updatedAt = new Date().toISOString();
    mStorage.writeJson(mConfig.TODOS_FILE, todos);
}

/** Save operator changes before notifying todo consumers. */
function broadcastTodos() {
    saveTodos();
    mEvents.broadcast('todos', mStorage.clone(todos));
}

Object.assign(exports, { broadcastTodos });

// Accessors keep replacement state visible to routes and collaborating features.
Object.defineProperties(exports, {
    todos: {
        enumerable: true,
        get: () => todos,

        set: (value) => {
            todos = value;
        }
    }
});
