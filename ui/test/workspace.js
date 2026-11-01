'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Poll navigation-safe browser conditions while only the isolated test target changes documents. */
async function wait(page, expression) {
    const until = Date.now() + 15000;
    while (Date.now() < until) {
        try {
            if (await page.evaluate('Boolean(' + expression + ')')) return;
        } catch (error) {
            if (!/context|navigat/i.test(error.message)) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Workspace browser condition timed out: ' + expression);
}

/** Exercise navigation, close-match search, responsive panels and persisted history using test-owned state. */
async function verifyWorkspace(browser, port, json) {
    const base = 'http://127.0.0.1:' + port;
    const page = await browser.newPage();
    try {
        await page.navigate(base + '/');
        await wait(
            page,
            'window.ICBVisits && window.ICBLocalAccount && window.ICBWorkspace && window.ICBRecentPages'
        );
        await wait(page, "document.getElementById('rzGames').children.length>0");
        await page.evaluate('rzRoll()');
        assert.ok(
            await page.evaluate("document.getElementById('rzTitle').textContent.length>0"),
            'Randomizer still generates a title'
        );
        const structure = await page.evaluate(`({
            heading:document.querySelector('.ws-page-heading h1').textContent,
            oldButtons:!!document.querySelector('.page-directory'),
            sidebarHome:document.querySelector('.ws-home').getAttribute('href'),
            sidebarLast:document.querySelector('#workspace-sidebar').lastElementChild.getAttribute('href'),
            recentAboveRandomizer:!!(document.getElementById('ws-recent-panels').compareDocumentPosition(document.getElementById('rz'))&Node.DOCUMENT_POSITION_FOLLOWING),
            settingsClosed:!document.querySelector('.ws-settings').open
        })`);
        assert.equal(structure.heading, 'Home');
        assert.equal(structure.oldButtons, false);
        assert.equal(structure.sidebarHome, '/');
        assert.equal(structure.sidebarLast, '/all-pages.html');
        assert.equal(structure.recentAboveRandomizer, true);
        assert.equal(structure.settingsClosed, true);
        await page.evaluate(`(function(){
            localStorage.removeItem(ICBVisits.key(ICBLocalAccount.id));dispatchEvent(new Event('icb-recent'));
        })()`);
        assert.ok(await page.evaluate("!!document.querySelector('#ws-recent-panels .ws-empty')"));
        await page.evaluate(`(function(){
            ICBWorkspace.pages().filter(function(p){return p.url.endsWith('-control.html');}).slice(0,24).forEach(function(p,i){
                ICBVisits.open(ICBLocalAccount.id,p.url,Date.now()-(i+1)*60000);
            });
        })()`);
        for (const width of [1600, 1100, 390]) {
            await page.setViewport(width, 1000);
            await page.evaluate(
                'new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);});})'
            );
            const panels = await page.evaluate(`({
                counts:Array.from(document.querySelectorAll('.ws-recent-panel')).map(function(p){return p.querySelectorAll('a').length;}),
                width:document.getElementById('ws-recent-panels').getBoundingClientRect().width,
                overflow:document.documentElement.scrollWidth>innerWidth
            })`);
            assert.equal(panels.counts.length, Math.max(1, Math.floor((panels.width + 16) / 336)));
            assert.ok(panels.counts.every((count) => count === 4));
            assert.equal(panels.overflow, false);
            if (width === 390) {
                assert.equal(panels.counts.length, 1);
                await page.evaluate("document.querySelector('.ws-menu-toggle').click()");
                assert.equal(
                    await page.evaluate(
                        "document.querySelector('.ws-menu-toggle').getAttribute('aria-expanded')"
                    ),
                    'true'
                );
                await page.evaluate(
                    "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"
                );
                assert.equal(
                    await page.evaluate("document.querySelector('#workspace-sidebar').inert"),
                    true
                );
            }
            await page.evaluate('new Promise(function(resolve){setTimeout(resolve,250);})');
            if (process.env.ICB_TEST_SCREENSHOTS && [390, 1600].includes(width)) {
                fs.mkdirSync(process.env.ICB_TEST_SCREENSHOTS, { recursive: true });
                await page.screenshot(
                    path.join(process.env.ICB_TEST_SCREENSHOTS, 'workspace-' + width + '.png')
                );
            }
        }
        await page.setViewport(1280, 900);
        await page.evaluate(
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))"
        );
        assert.equal(await page.evaluate('document.activeElement.id'), 'ws-page-search');
        await page.evaluate(
            `(function(){var input=document.getElementById('ws-page-search');input.value='pkoe bowl';input.dispatchEvent(new Event('input',{bubbles:true}));})()`
        );
        const results = await page.evaluate(
            "Array.from(document.querySelectorAll('#ws-search-results a')).map(function(a){return a.getAttribute('href');})"
        );
        assert.deepEqual(
            [...results].sort(),
            ['/poke-bowl.html', '/sashimi-signin-control.html', '/sashimi-signin.html'].sort()
        );
        await page.evaluate(
            `(function(){var input=document.getElementById('ws-page-search');input.value='zzqx spaceship';input.dispatchEvent(new Event('input',{bubbles:true}));})()`
        );
        assert.equal(
            await page.evaluate(
                "document.querySelectorAll('#ws-search-results [role=option]').length"
            ),
            0
        );
        await json('/api/todos');
        await json('/api/todos/daily', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Workspace search revision fixture', kind: 'check' })
        });
        const searchDidNotFreeze = await page.evaluate(`(async function(){
            await fetch('/api/todos');
            var response=await fetch('/api/todos/daily',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Search is not a feature form edit',kind:'check'})});
            return response.status;
        })()`);
        assert.equal(
            searchDidNotFreeze,
            200,
            'Typing in search does not freeze unrelated feature revisions'
        );
        await page.evaluate(
            `(function(){var input=document.getElementById('ws-page-search');input.value='poke cooking';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`
        );
        await wait(
            page,
            "location.pathname==='/poke-bowl.html' && !!document.getElementById('wrap')"
        );
        await wait(page, 'window.ICBVisits && window.ICBLocalAccount');
        assert.equal(
            await page.evaluate('ICBVisits.read(ICBLocalAccount.id)[0].url'),
            '/poke-bowl.html'
        );
        await page.navigate(base + '/recent-pages.html');
        await wait(page, "document.querySelectorAll('#ws-recent-body tr').length>0");
        const history = await page.evaluate(
            "Array.from(document.querySelectorAll('#ws-recent-body tr')).map(function(row){return {url:row.querySelector('a').getAttribute('href'),stamp:Number(row.dataset.openedAt),time:row.querySelector('time').dateTime};})"
        );
        assert.equal(history[0].url, '/poke-bowl.html');
        assert.equal(history.filter((row) => row.url === '/poke-bowl.html').length, 1);
        for (let i = 1; i < history.length; i++)
            assert.ok(history[i - 1].stamp >= history[i].stamp);
        assert.ok(history.every((row) => Date.parse(row.time) === row.stamp));
        await json('/api/decor/state');
        const effect = await json('/api/decor/effects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Browser Ghosts <img src=x>', type: 'float' })
        });
        assert.equal(effect.response.status, 200);
        await page.navigate(base + '/all-pages.html');
        await wait(
            page,
            "document.querySelector('#ws-directory-body')?.textContent.includes('Browser Ghosts')"
        );
        const directory = await page.evaluate(`(function(){
            var links=Array.from(document.querySelectorAll('#ws-directory-body a'));
            return {names:links.map(function(a){return ICBNavModel.normalize(a.textContent);}),urls:links.map(function(a){return a.getAttribute('href');})};
        })()`);
        assert.equal(new Set(directory.urls).size, directory.urls.length);
        for (let i = 1; i < directory.names.length; i++)
            assert.ok(directory.names[i - 1].localeCompare(directory.names[i]) <= 0);
        assert.ok(
            directory.urls.includes('/all-pages.html') &&
                directory.urls.includes('/recent-pages.html')
        );
        const failed = await page.evaluate(`(async function(){
            var pages=ICBWorkspace.pages(), failures=[];
            for(var i=0;i<pages.length;i+=8) await Promise.all(pages.slice(i,i+8).map(async function(p){
                if(!p.url.startsWith('/')) return;
                var response=await fetch(p.url);if(!response.ok)failures.push(p.url+': '+response.status);
            }));return failures;
        })()`);
        assert.deepEqual(failed, [], 'All directory destinations return successfully');
        assert.equal(
            await page.evaluate(
                "document.querySelectorAll('#workspace-sidebar a img,#ws-directory-body a img').length"
            ),
            0
        );
        assert.deepEqual(page.errors, []);
        console.log(
            'Workspace browser checks passed: sidebar/search, tight typo matches, responsive four-item panels, visit history, dynamic decor and A–Z directory.'
        );
    } finally {
        await page.close();
    }
}

module.exports = { verifyWorkspace };
