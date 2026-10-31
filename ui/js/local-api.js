'use strict';
(function () {
    var token = '';
    var waiting = [];
    var loading = false;
    var nativeFetch = window.fetch;
    var nativeOpen = XMLHttpRequest.prototype.open;
    var nativeSend = XMLHttpRequest.prototype.send;
    var generation = null;
    var revisions = {};
    var draft = null;
    var offset = 0;
    window.ICBClock = {
        now: function () {
            return Date.now() + offset;
        }
    };

    /** Keep an unsaved form bound to the feature versions it originally displayed. */
    document.addEventListener(
        'input',
        function () {
            if (!draft) draft = JSON.parse(JSON.stringify(revisions));
        },
        true
    );
    document.addEventListener(
        'change',
        function () {
            if (!draft) draft = JSON.parse(JSON.stringify(revisions));
        },
        true
    );

    /** Response headers carry only revisions and a clock estimate. */
    function metadata(read) {
        observe(read('X-ICB-Session'));
        var sync = read('X-ICB-Sync-State');
        if (sync && sync !== 'ready')
            setTimeout(function () {
                var health = document.getElementById('health');
                if (health) {
                    health.textContent =
                        sync === 'login_required'
                            ? 'Sign in to Cloud account'
                            : 'Cloud reconnecting…';
                    health.className = 'health bad';
                }
            }, 0);
        try {
            var incoming = JSON.parse(read('X-ICB-Revisions') || '{}');
            for (var key in incoming) revisions[key] = incoming[key];
            var value = read('X-ICB-Clock-Offset');
            if (value !== null && isFinite(Number(value))) offset = Number(value);
        } catch (_error) {}
    }

    /** Account changes clear old page state without adding another polling loop. */
    function observe(value) {
        if (value === null) return;
        if (generation !== null && generation !== value) {
            location.reload();
            return;
        }
        generation = value;
    }

    /** Observe a non-secret local session generation, never a cloud token. */
    function observeFetch(response) {
        metadata(function (name) {
            return response.headers.get(name);
        });
        return response;
    }

    /** Preserve ES5/XHR overlays while securing the existing local operator and Meld mutations. */
    function mutation(method, url) {
        var link = document.createElement('a');
        link.href = String(url || '');
        return (
            !/^(GET|HEAD|OPTIONS)$/i.test(method || 'GET') &&
            link.host === location.host &&
            /^\/api\//.test(link.pathname)
        );
    }

    /** The local capability stays in page RAM; cloud bearer tokens never enter the browser. */
    function capability(callback) {
        if (token) return callback(null, token);
        waiting.push(callback);
        if (loading) return;
        loading = true;
        var request = new XMLHttpRequest();
        request.open('GET', '/api/cloud/csrf', true);
        request.onload = function () {
            var error = null;
            try {
                token = JSON.parse(request.responseText).csrf || '';
                if (!token) throw new Error();
            } catch (_error) {
                error = new Error('Local page authorization is unavailable.');
            }
            loading = false;
            var callbacks = waiting;
            waiting = [];
            for (var i = 0; i < callbacks.length; i++) callbacks[i](error, token);
        };

        request.onerror = function () {
            loading = false;
            var callbacks = waiting;
            waiting = [];
            for (var i = 0; i < callbacks.length; i++)
                callbacks[i](new Error('Local server is unavailable.'));
        };

        request.send();
    }

    if (nativeFetch)
        window.fetch = function (input, options) {
            var settings = options || {};
            var method = settings.method || (input && input.method) || 'GET';
            var url = typeof input === 'string' ? input : input.url;
            if (!mutation(method, url))
                return nativeFetch.apply(window, arguments).then(observeFetch);
            return new Promise(function (resolve, reject) {
                capability(function (error, value) {
                    if (error) return reject(error);
                    var next = {};
                    for (var key in settings)
                        if (Object.prototype.hasOwnProperty.call(settings, key))
                            next[key] = settings[key];
                    next.headers = new Headers(settings.headers || (input && input.headers) || {});
                    next.headers.set('X-ICB-CSRF', value);
                    next.headers.set('X-ICB-Revisions', JSON.stringify(draft || revisions));
                    nativeFetch
                        .call(window, input, next)
                        .then(function (response) {
                            if (response.ok) draft = null;
                            return observeFetch(response);
                        })
                        .then(resolve, reject);
                });
            });
        };

    if (window.EventSource) {
        var NativeEvents = window.EventSource;
        window.EventSource = function (url, options) {
            var source = new NativeEvents(url, options);
            source.addEventListener('icb-revisions', function (event) {
                try {
                    var data = JSON.parse(event.data);
                    for (var key in data.revisions) revisions[key] = data.revisions[key];
                    observe(String(data.session));
                } catch (_error) {}
            });
            return source;
        };

        window.EventSource.prototype = NativeEvents.prototype;
    }

    XMLHttpRequest.prototype.open = function (method, url, async) {
        if (!this.icbObserved) {
            this.icbObserved = true;
            var request = this;
            this.addEventListener('loadend', function () {
                metadata(function (name) {
                    return request.getResponseHeader(name);
                });
                if (request.icbMutation && request.status >= 200 && request.status < 300)
                    draft = null;
            });
        }
        this.icbMutation = mutation(method, url);
        this.icbAsync = async !== false;
        return nativeOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        if (!this.icbMutation) return nativeSend.apply(this, arguments);
        var request = this;
        if (!request.icbAsync && !token)
            throw new Error('Local authorization requires an asynchronous request.');
        capability(function (error, value) {
            if (error) {
                if (typeof request.onerror === 'function') request.onerror(error);
                return;
            }
            if (request.readyState !== 1) return;
            request.setRequestHeader('X-ICB-CSRF', value);
            request.setRequestHeader('X-ICB-Revisions', JSON.stringify(draft || revisions));
            nativeSend.call(request, body);
        });
    };
})();
