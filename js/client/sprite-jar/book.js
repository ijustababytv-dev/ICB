/** ICBSpriteJarBook keeps related operations together and reads shared state at call time. */
window.ICBSpriteJarBook = function ICBSpriteJarBook(context) {
    function spriteOf(id) {
        for (var i = 0; i < context.roster.length; i++)
            if (context.roster[i].id === id) return context.roster[i];
        return null;
    }

    function drawLeft(s, ev, hideVariant) {
        function slotHtml(v, size, extra) {
            var vi = context.vinfo(v),
                has = s.caught.indexOf(v) >= 0 && v !== hideVariant,
                art = context.artOf(s, v);
            return (
                '<div class="slot' +
                (has ? ' has' : '') +
                (v === 'Gold' && !art ? ' gold' : '') +
                (extra || '') +
                '" data-v="' +
                context.esc(v) +
                '" style="width:' +
                size +
                'em;margin:.3em .25em">' +
                '<div class="spot" style="width:' +
                size +
                'em;height:' +
                size +
                'em"><img src="' +
                context.esc(art || s.img || '') +
                '" alt=""></div>' +
                '<span class="lb" style="background:' +
                vi[1] +
                '">' +
                context.esc(vi[0]) +
                '</span></div>'
            );
        }

        var bs = Math.max(
            7.6,
            Math.min(15, (7.6 * ((context.S && context.S.baseBook) || 100)) / 100)
        );
        context.$('pl').innerHTML =
            '<div class="pname">' +
            context.esc(s.name) +
            '</div><span class="rar" style="background:' +
            (context.RAR[s.rarity] || '#b77cff') +
            '">' +
            context.esc(s.rarity) +
            '</span>' +
            '<div class="slots" style="margin-top:' +
            Math.max(0, (19 - bs) / 2) +
            'em">' +
            slotHtml(s.variants[0], bs, ' baseSlot') +
            '</div>';
        var nv = s.variants.length - 1,
            vs = nv > 6 ? 5.2 : nv > 3 ? 6.6 : 7.4,
            h = '';
        for (var i = 1; i < s.variants.length; i++) h += slotHtml(s.variants[i], vs);
        context.$('prVars').innerHTML = nv
            ? h
            : '<div class="onlyBase">This sprite only has a Base sticker.</div>';
        if (context.curId) pageNo();
    }

    function slotEl(v) {
        var a = context.book.querySelectorAll('.slot');
        for (var i = 0; i < a.length; i++) if (a[i].getAttribute('data-v') === v) return a[i];
        return null;
    }

    function drawRight(st, curId, minus) {
        var done = st.done - (minus || 0),
            pct = st.total ? (done / st.total) * 100 : 0;
        context.$('prHead').innerHTML =
            '<div class="ctitle">My collection</div><div class="bigNum" id="bn">' +
            done +
            ' <span>/ ' +
            st.total +
            ' stickers</span></div>' +
            '<div class="bar"><span id="barFill" style="width:' +
            pct.toFixed(1) +
            '%"></span></div>';
    }

    function caption(h) {
        var c = context.$('cap');
        c.className = 'caption';
        c.innerHTML = h;
        if (h)
            setTimeout(function () {
                c.className = 'caption on';
            }, 30);
    }

    function propped() {
        return context.S && context.S.bookStyle === 'propped';
    }

    function shownOpen() {
        return !propped() || context.S.bookOpen || context.tempOpen;
    }

    function bookClass() {
        context.book.className =
            (context.S && context.S.bookTheme === 'spooky' ? 'spooky ' : '') +
            (propped()
                ? 'propped' + (context.alive ? ' alive' : '') + (shownOpen() ? '' : ' shut')
                : context.isOpen
                ? 'open'
                : '');
    }

    function placeShut(W, H, bw, bh) {
        var el = context.$('shut');
        if (!propped()) {
            el.style.display = 'none';
            return;
        }
        el.style.display = 'block';
        el.className =
            (context.S.bookTheme === 'spooky' ? '' : 'cute') + (context.alive ? ' glow' : '');
        var w = bw * 0.5;
        el.style.fontSize = bw / 60 + 'px';
        el.style.width = w + 'px';
        el.style.height = bh + 'px';
        el.style.left = (W * context.S.pbX) / 100 + bw * 0.12 + 'px';
        el.style.top = H - (H * context.S.pbB) / 100 - bh + 'px';
        var open = shownOpen();
        el.style.opacity = open ? '0' : '1';
        el.style.transform = el.style.webkitTransform =
            'perspective(90em) rotateX(' +
            context.S.pbLean +
            'deg) rotate(' +
            context.S.pbTilt +
            'deg)' +
            (open ? ' rotateY(-100deg)' : '');
        context.$('shutTtl').textContent = context.S.title || 'Sprite Sticker Book';
        context.$('shutSea').textContent = context.season;
        context.$('shutCnt').textContent = context.stats
            ? context.stats.done + ' / ' + context.stats.total + ' stickers'
            : '';
        var r = spriteOf(context.recentId) || context.roster[0],
            im = r ? context.artOf(r, r.variants[0]) || r.img : '';
        if (im && context.$('shutImg').getAttribute('src') !== im) context.$('shutImg').src = im;
    }

    function openBook() {
        clearTimeout(context.closeT);
        context.isOpen = true;
        context.alive = true;
        context.fit();
    }

    function closeLater(ms) {
        clearTimeout(context.closeT);
        context.closeT = setTimeout(
            function () {
                context.isOpen = false;
                context.alive = false;
                caption('');
                if (propped()) {
                    var wasTemp = context.tempOpen;
                    context.tempOpen = false;
                    context.fit();
                    context.pageKey = '';
                    if (wasTemp && !context.S.bookOpen) setTimeout(context.next, 600);
                    else context.next();
                } else {
                    context.fit();
                    setTimeout(context.next, 650);
                }
            },
            propped() ? Math.min(ms, 6000) : ms
        );
    }

    function idlePage(force) {
        if (context.busy || !context.roster.length || !context.stats) return;
        if (!context.curId || !spriteOf(context.curId))
            context.curId =
                context.recentId && spriteOf(context.recentId)
                    ? context.recentId
                    : context.roster[0].id;
        var s = spriteOf(context.curId),
            key =
                context.curId +
                JSON.stringify(s.caught) +
                JSON.stringify(s.art) +
                context.stats.done;
        if (!force && key === context.pageKey) return;
        context.pageKey = key;
        drawLeft(s, null, null);
        drawRight(context.stats, s.id, 0);
    }

    function pageNo() {
        var i = 0;
        for (var j = 0; j < context.roster.length; j++)
            if (context.roster[j].id === context.curId) i = j;
        var e = document.createElement('div');
        e.className = 'pgno';
        e.textContent = '~ ' + (i + 1) + ' / ' + context.roster.length + ' ~';
        context.$('pl').appendChild(e);
    }

    function turnTo(id, done, back) {
        if (!spriteOf(id)) {
            if (done) done();
            return;
        }
        if (id === context.curId && context.$('pl').innerHTML) {
            if (done) done();
            return;
        }
        context.curId = id;
        var pl = context.$('pl');
        pl.className = 'page l';
        void pl.offsetWidth;
        pl.className = 'page l ' + (back ? 'turnBack' : 'turn');
        var pr = context.$('pr');
        pr.className = 'page r';
        void pr.offsetWidth;
        pr.className = 'page r swap';
        setTimeout(function () {
            var s = spriteOf(id);
            drawLeft(s, null, null);
            drawRight(context.stats, id, 0);
            context.pageKey = '';
        }, 310);
        setTimeout(function () {
            pl.className = 'page l';
            pr.className = 'page r';
            if (done) done();
        }, 640);
    }

    function stepId(dir) {
        var i = 0;
        for (var j = 0; j < context.roster.length; j++)
            if (context.roster[j].id === context.curId) i = j;
        return context.roster[(i + dir + context.roster.length) % context.roster.length].id;
    }

    return {
        spriteOf: spriteOf,
        drawLeft: drawLeft,
        slotEl: slotEl,
        drawRight: drawRight,
        caption: caption,
        propped: propped,
        shownOpen: shownOpen,
        bookClass: bookClass,
        placeShut: placeShut,
        openBook: openBook,
        closeLater: closeLater,
        idlePage: idlePage,
        pageNo: pageNo,
        turnTo: turnTo,
        stepId: stepId
    };
};
