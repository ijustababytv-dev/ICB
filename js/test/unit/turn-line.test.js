'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../../server/domain/turn-line');

const root = path.resolve(__dirname, '../../..');
const states = (s) => s.people.map((p) => p.name + ':' + p.state).join(' ');

/** A line with the given names already added. */
function lineOf(...names) {
    const s = rules.turnLineDefaults();
    for (const n of names) rules.addPerson(s, n);
    return s;
}

test('the first person added is green and later people wait', () => {
    const s = lineOf('Ann', 'Bo', 'Cy');
    assert.equal(states(s), 'Ann:go Bo:wait Cy:wait');
});

test('duplicates (any case), blanks and an at-sign are handled', () => {
    const s = lineOf('Ann');
    assert.equal(rules.addPerson(s, 'ANN'), false);
    assert.equal(rules.addPerson(s, '   '), false);
    assert.equal(rules.addPerson(s, '@Bo'), true);
    assert.deepEqual(
        s.people.map((p) => p.name),
        ['Ann', 'Bo']
    );
});

test('Done turns the current person red and the next green; the last Done leaves nobody green', () => {
    const s = lineOf('Ann', 'Bo');
    assert.equal(rules.finishCurrent(s), true);
    assert.equal(states(s), 'Ann:done Bo:go');
    assert.equal(rules.finishCurrent(s), true);
    assert.equal(states(s), 'Ann:done Bo:done');
    assert.equal(rules.finishCurrent(s), false);
    rules.addPerson(s, 'Cy'); // someone joining late is green straight away
    assert.equal(states(s), 'Ann:done Bo:done Cy:go');
});

test('Undo brings the last finished person back and sends the current one back to waiting', () => {
    const s = lineOf('Ann', 'Bo', 'Cy');
    rules.finishCurrent(s);
    rules.finishCurrent(s);
    assert.equal(states(s), 'Ann:done Bo:done Cy:go');
    assert.equal(rules.undoDone(s), true);
    assert.equal(states(s), 'Ann:done Bo:go Cy:wait');
    const empty = lineOf('Zed');
    assert.equal(rules.undoDone(empty), false);
});

test('removing the current person hands the turn to the next; removing others keeps green', () => {
    const s = lineOf('Ann', 'Bo', 'Cy');
    assert.equal(rules.removeByName(s, 'bo'), true);
    assert.equal(states(s), 'Ann:go Cy:wait');
    assert.equal(rules.removePerson(s, s.people[0].id), true);
    assert.equal(states(s), 'Cy:go');
    assert.equal(rules.removeByName(s, 'nobody'), false);
});

test('skip sends the current person to the back and needs someone waiting', () => {
    const s = lineOf('Ann', 'Bo', 'Cy');
    assert.equal(rules.skipCurrent(s), true);
    assert.equal(states(s), 'Bo:go Cy:wait Ann:wait');
    assert.equal(rules.skipCurrent(lineOf('Solo')), false);
});

test('new round makes everyone wait and turns the first green; clear empties via the API', () => {
    const s = lineOf('Ann', 'Bo');
    rules.finishCurrent(s);
    rules.finishCurrent(s);
    rules.newRound(s);
    assert.equal(states(s), 'Ann:go Bo:wait');
});

test('moving people swaps neighbours and stops at the ends', () => {
    const s = lineOf('Ann', 'Bo', 'Cy');
    assert.equal(rules.movePerson(s, s.people[2].id, -1), true);
    assert.deepEqual(
        s.people.map((p) => p.name),
        ['Ann', 'Cy', 'Bo']
    );
    assert.equal(rules.movePerson(s, s.people[0].id, -1), false);
    assert.equal(rules.movePerson(s, s.people[2].id, 1), false);
});

test('the line holds at most sixty people', () => {
    const s = rules.turnLineDefaults();
    for (let i = 0; i < 70; i++) rules.addPerson(s, 'Person' + i);
    assert.equal(s.people.length, rules.MAX_PEOPLE);
});

test('only the exact join word and !leave are chat commands', () => {
    const s = rules.turnLineDefaults();
    assert.equal(rules.chatCommand(s, '!turn'), 'join');
    assert.equal(rules.chatCommand(s, '  !TURN '), 'join');
    assert.equal(rules.chatCommand(s, '!turn please'), null);
    assert.equal(rules.chatCommand(s, 'turn'), null);
    assert.equal(rules.chatCommand(s, '!leave'), 'leave');
    rules.applySettings(s, { joinWord: '!Dish Turn' });
    assert.equal(s.joinWord, 'dishturn');
    assert.equal(rules.chatCommand(s, '!dishturn'), 'join');
    assert.equal(rules.chatCommand(s, '!turn'), null);
});

test('settings clamp numbers and only accept real colours and booleans', () => {
    const s = rules.turnLineDefaults();
    rules.applySettings(s, {
        turnsEach: 500,
        font: 3,
        goColor: 'green',
        doneColor: '#AA0000',
        open: 'no',
        visible: false,
        title: ' Dish Night '
    });
    assert.equal(s.turnsEach, 99);
    assert.equal(s.font, 14);
    assert.equal(s.goColor, '#3ddc84');
    assert.equal(s.doneColor, '#AA0000');
    assert.equal(s.open, true);
    assert.equal(s.visible, false);
    assert.equal(s.title, 'Dish Night');
});

test('background settings accept only listed modes, fits, colours and plain picture names', () => {
    const s = rules.turnLineDefaults();
    assert.equal(s.bgMode, 'none');
    rules.applySettings(s, {
        bgMode: 'image',
        bgFit: 'contain',
        bgColor: '#102030',
        bgOpacity: 400,
        bgRadius: -5,
        bgImage: 'Bubbles 2.png'
    });
    assert.deepEqual(
        [s.bgMode, s.bgFit, s.bgColor, s.bgOpacity, s.bgRadius, s.bgImage],
        ['image', 'contain', '#102030', 100, 0, 'Bubbles 2.png']
    );
    rules.applySettings(s, { bgMode: 'video', bgFit: 'tile', bgColor: 'red' });
    assert.deepEqual([s.bgMode, s.bgFit, s.bgColor], ['image', 'contain', '#102030']);
    for (const bad of ['../secret.png', 'a/b.png', 'notes.txt', '.png', 'x..png/y.png'])
        assert.equal(rules.isImageFile(bad), false, bad);
    rules.applySettings(s, { bgImage: '../secret.png' });
    assert.equal(s.bgImage, '');
});

test('the Meld overlay script stays plain ES5 and polls without EventSource', () => {
    const code = fs
        .readFileSync(path.join(root, 'js', 'client', 'turn-line.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /=>|\blet\b|\bconst\b|`|\bclass\s+[A-Z]/);
    assert.doesNotMatch(code, /EventSource/);
});
