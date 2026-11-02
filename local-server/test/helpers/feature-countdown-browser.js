'use strict';
const assert = require('node:assert/strict');

const READ_MAIN = `fetch('/api/countdowns?id=main').then(function(response){return response.json();})
    .then(function(value){return value.countdown;})`;

/** Poll the real view because the dashboard's Start buttons do not return their request. */
async function waitForRunning(page) {
    let countdown;
    for (let attempt = 0; attempt < 20; attempt++) {
        await page.evaluate('new Promise(function(resolve){setTimeout(resolve,150);})');
        countdown = await page.evaluate(READ_MAIN);
        if (countdown.status === 'running') return countdown;
    }
    return countdown;
}

/** Edits made in the same moment must all save, whichever control or debounce sent them. */
async function verifySimultaneousEdits(page) {
    await page.evaluate(`(function(){
        window.alerts=[];window.alert=function(text){window.alerts.push(text);};
        [['scale','135'],['plateAlpha','41'],['x','22']].forEach(function(item){
            var field=document.querySelector('[data-k="'+item[0]+'"]');
            field.value=item[1];field.dispatchEvent(new Event('input',{bubbles:true}));
        });
        save({heading:'SAME MOMENT'});save({subheading:'ALL SAVED'});
    })()`);
    let countdown;
    for (let attempt = 0; attempt < 40; attempt++) {
        await page.evaluate('new Promise(function(resolve){setTimeout(resolve,150);})');
        countdown = await page.evaluate(READ_MAIN);
        if (countdown.scale === 135 && countdown.plateAlpha === 41 && countdown.x === 22) break;
    }
    assert.deepEqual(
        [
            countdown.scale,
            countdown.plateAlpha,
            countdown.x,
            countdown.heading,
            countdown.subheading
        ],
        [135, 41, 22, 'SAME MOMENT', 'ALL SAVED'],
        'No simultaneous edit may be dropped.'
    );
    assert.deepEqual(await page.evaluate('window.alerts'), []);
}

/** Both Start buttons must begin the timer and remember their inputs in one revisioned command. */
async function verifyCountdownStart(browser, port) {
    const page = await browser.newPage();
    const other = await browser.newPage();
    try {
        await page.navigate('http://127.0.0.1:' + port + '/countdown-control.html');
        await page.evaluate('new Promise(function(resolve){setTimeout(resolve,1800);})');

        await page.evaluate(`(function(){
            var field=document.getElementById('mins');field.value='7';
            field.dispatchEvent(new Event('input',{bubbles:true}));startMins();
        })()`);
        let countdown = await waitForRunning(page);
        assert.equal(countdown.status, 'running', 'Minutes Start must begin the countdown.');
        assert.equal(countdown.lastMinutes, 7, 'Minutes Start must remember its input.');

        await page.evaluate(`fetch('/api/countdowns',{method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({id:'main',action:'reset'})}).then(load)`);
        await page.evaluate(`(function(){
            document.getElementById('clock').value='06:30';startClock();
        })()`);
        countdown = await waitForRunning(page);
        assert.equal(countdown.status, 'running', 'Clock Start must begin the countdown.');
        assert.equal(countdown.lastTime, '06:30', 'Clock Start must remember its input.');
        assert.deepEqual(page.errors, []);
        await verifySimultaneousEdits(page);

        // A stale page must tell the operator instead of silently leaving the timer unchanged.
        await page.evaluate(`(function(){
            window.alerts=[];window.alert=function(text){window.alerts.push(text);};
            document.getElementById('mins').dispatchEvent(new Event('input',{bubbles:true}));
        })()`);
        await other.navigate('http://127.0.0.1:' + port + '/countdown-control.html');
        await other.evaluate('new Promise(function(resolve){setTimeout(resolve,1800);})');
        await other.evaluate(`fetch('/api/countdowns',{method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({id:'main',action:'reset'})}).then(function(response){return response.status;})`);
        await page.evaluate('startMins()');
        let alerts = [];
        for (let attempt = 0; attempt < 20 && !alerts.length; attempt++) {
            await page.evaluate('new Promise(function(resolve){setTimeout(resolve,150);})');
            alerts = await page.evaluate('window.alerts');
        }
        assert.equal(alerts.length, 1, 'A rejected start must be shown to the operator.');
        assert.match(alerts[0], /did not save/);
        assert.equal((await page.evaluate(READ_MAIN)).status, 'idle');
    } finally {
        await page.close();
        await other.close();
    }
}

module.exports = { verifyCountdownStart };
