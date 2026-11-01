'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Include every operator page rather than relying on the existing feature smoke-test subset. */
function operatorPages() {
    return fs
        .readdirSync(path.resolve(__dirname, '../html'))
        .filter(
            (name) =>
                name.endsWith('-control.html') ||
                [
                    'hub.html',
                    'cloud.html',
                    'control.html',
                    'giveaway-report.html',
                    'Aniimo Tracker.html',
                    'aniimo-quick.html'
                ].includes(name)
        )
        .map((name) => name.slice(0, -5));
}

/** Verify actual layout, destinations and keyboard reachability in a disposable browser target. */
async function verifyNavigation(page, name) {
    const operator = name !== 'cloud' && operatorPages().includes(name);
    const navigation =
        await page.evaluate(`Array.from(document.querySelectorAll('.icb-page-nav')).map(function(nav) {
        var link=nav.querySelector('.icb-home-link');
        var box=nav.getBoundingClientRect();
        return { href:link.getAttribute('href'), text:link.textContent, height:box.height,
            display:getComputedStyle(nav).display, links:nav.querySelectorAll('a').length,
            account:!!nav.querySelector('a[href="/cloud.html"]') };
    })`);
    assert.equal(navigation.length, operator ? 2 : 0, name + ': navigation scope');
    for (const nav of navigation) {
        assert.equal(nav.href, '/');
        assert.match(nav.text, /\u2190.*ICB Home/);
        assert.equal(nav.account, false);
        assert.equal(nav.links, 1);
        assert.ok(nav.height >= 32 && nav.display !== 'none', name + ': visible navigation');
    }
    if (name === 'hub') {
        const failed = await page.evaluate(`(async function() {
            var links=Array.from(document.querySelectorAll('.page-directory a'));
            var failures=[];
            for(var i=0;i<links.length;i+=8) {
                await Promise.all(links.slice(i,i+8).map(async function(link) {
                    var response=await fetch(link.href);
                    if(!response.ok) failures.push(link.getAttribute('href')+': '+response.status);
                }));
            }
            return failures;
        })()`);
        assert.deepEqual(failed, [], 'All Home directory destinations return successfully');
    }
    if (['hub', 'cloud', 'aniimo-quick'].includes(name)) {
        for (const width of [390, 1280]) {
            await page.setViewport(width, 900);
            if (name === 'cloud') {
                const fits = await page.evaluate(
                    'document.documentElement.scrollWidth <= innerWidth'
                );
                assert.equal(fits, true, 'Standalone login: horizontal overflow at ' + width);
                continue;
            }
            const layout = await page.evaluate(`(function() {
                var footer=document.querySelectorAll('.icb-page-nav')[1];
                footer.scrollIntoView();
                var link=footer.querySelector('.icb-home-link');link.focus();
                var rect=link.getBoundingClientRect();
                return { overflow:document.documentElement.scrollWidth>innerWidth,
                    focused:document.activeElement===link, visible:rect.top>=0&&rect.bottom<=innerHeight };
            })()`);
            assert.equal(layout.overflow, false, name + ': horizontal overflow at ' + width);
            assert.equal(layout.focused, true, name + ': keyboard-accessible footer');
            assert.equal(layout.visible, true, name + ': reachable footer at ' + width);
        }
        await page.evaluate('window.scrollTo(0,0)');
    }
    if (name === 'cloud') {
        const form = await page.evaluate(`({
            password:document.getElementById('password').type,
            autocomplete:document.getElementById('password').autocomplete,
            label:document.querySelector('label[for="password"]').textContent,
            result:document.getElementById('result').getAttribute('role'),
            panel:getComputedStyle(document.querySelector('.account-page .card')).backgroundColor
        })`);
        assert.equal(form.password, 'password');
        assert.equal(form.autocomplete, 'current-password');
        assert.equal(form.label, 'Password');
        assert.equal(form.result, 'status');
        assert.equal(form.panel, 'rgb(29, 22, 40)');
    }
}

module.exports = { operatorPages, verifyNavigation };
