'use strict';
const assert = require('node:assert/strict');

/** Two real pages retain their read revisions even when SSE updates the newer shared Node cache. */
async function verifyConcurrentForms(browser, port) {
    const first = await browser.newPage();
    const second = await browser.newPage();
    try {
        for (const page of [first, second]) {
            await page.navigate('http://127.0.0.1:' + port + '/control.html');
            await page.evaluate('new Promise(function(resolve) {setTimeout(resolve,1800);})');
            await page.evaluate(`fetch('/api/todos').then(function(response){return response.json();}).then(function() {
                var field=document.createElement('input');document.body.appendChild(field);
                field.value='Unsaved draft';field.dispatchEvent(new Event('input',{bubbles:true}));
            })`);
        }
        const body = JSON.stringify({ text: 'Concurrent form fixture', kind: 'check' });
        const post = `fetch('/api/todos/daily',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(
            body
        )}}).then(function(response){return response.status;})`;
        assert.equal(await first.evaluate(post), 200);
        assert.equal(
            await second.evaluate(post),
            409,
            'An unseen edit must not overwrite or append through a newer Node cache revision.'
        );
        const count =
            await second.evaluate(`fetch('/api/todos').then(function(response){return response.json();}).then(function(value){
            return value.todos.daily.filter(function(item){return item.text==='Concurrent form fixture';}).length;
        })`);
        assert.equal(count, 1);
        assert.deepEqual(first.errors, []);
        assert.deepEqual(second.errors, []);
    } finally {
        await first.close();
        await second.close();
    }
}

module.exports = { verifyConcurrentForms };
