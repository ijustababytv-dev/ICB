# Official Resource Tracker Skin Standard

**Status: ACTIVE — adopted 2026-08-14 by Baby (IJUSTABABY). Required default for all ICB resource trackers.**

This document is the human-readable statement of the standard. The machine-readable
single source of truth is [`local-server/config/tracker-skin-standard.json`](../local-server/config/tracker-skin-standard.json),
also served live at `GET http://127.0.0.1:8790/api/tracker-skin-standard`.

If this document and that file ever disagree, **the JSON wins** and this document is the thing to fix.

---

## The record

| Field | Value |
| --- | --- |
| **Master resolution** | **2048 × 768 px** |
| **Aspect ratio** | **8:3** (2.666…) |
| **Purpose** | Stackable stream resource tracker skins |
| **Live value** | Dynamically rendered by ICB — **NOT** baked into artwork |
| **Value box position** | Directly underneath the resource title |
| **Default status** | Required for all future standard resource trackers unless Baby explicitly overrides it |

---

## Master size

**2048 px wide × 768 px high. Aspect ratio 8:3.**

This is the **master / native artwork size** for every ICB resource tracker skin. It is
deliberately oversized so a skin stays crisp when the overlay scales it down.

**2048 × 768 is not the on-stream display size.** The overlay may scale a skin down
proportionally depending on where it sits in the scene. Whatever display width is chosen,
**the 8:3 ratio must be preserved** unless Baby explicitly approves a different tracker type.

Never stretch, letterbox, crop, or pad a skin to reach a different ratio. Scale it.

Examples of proportional display sizes (illustrative, not an approved list — any width works
provided `height = width × 3 ÷ 8`):

| Display width | Display height |
| ---: | ---: |
| 512 | 192 |
| 480 | 180 |
| 400 | 150 |
| 384 | 144 |

---

## Card structure

The current **Sweet Leaf** card establishes the canonical structure. Every tracker does **not**
need identical artwork — but the underlying card geometry and functional layout stay consistent.

### 1. Outer card

- Canvas 2048 × 768, ratio 8:3
- Wide horizontal rectangle
- Rounded corners
- Designed specifically for vertical stacking in a stream overlay

### 2. Resource title

The resource name is displayed prominently in the upper / central portion of the card, and **is**
part of the artwork. Examples: `Sweet Leaf`, `Infected Essence`, `Amber Echo`, `Gold Ore`, `Palium`.

Decorative art around the title changes freely per resource.

### 3. Live tracker value box — read this twice

There must be a clearly defined tracker-number readout box positioned **directly underneath the
resource title**.

> **The tracker value must NOT be rendered into the skin image. The box in the artwork stays BLANK.**

Do not bake in `1234`, `10,122`, `x1234`, or any other placeholder count. Not even "just as a
visual example."

The live value is drawn on top of that blank area at runtime by the ICB / Meld tracker system.
The image is the **skin/background**; ICB supplies the **data**.

A number baked into a PNG can never update, and will sit on stream silently contradicting the
real tracker. This is the single easiest way to ship a broken-looking overlay.

---

## Why this standard exists

These trackers appear on stream **together** — Sweet Leaf, Infected Essence, Amber Echo, Gold Ore,
Palium and so on, stacked vertically down one or both sides of a 1920 × 1080 scene.

Consistent card dimensions mean the overlay can swap one resource skin for another with **no**
custom resizing or repositioning.

**ONE CARD SYSTEM — MANY RESOURCE SKINS.**

---

## Per-skin value boxes (adopted 2026-08-15)

**Each card declares its own value box. There is no single fixed box position every card must share.**

The original design assumed ICB would draw the number at one fixed spot, so every card's readout panel had to
land on identical pixels. In practice that failed: the artwork is AI-generated, and image models cannot place a
rectangle at a specified pixel coordinate — three rounds of regeneration drifted by 20–40px each time and the set
never converged.

The fixed-box requirement turned out to be unnecessary. ICB simply stores each card's own box coordinates and
renders the live value into whichever card is showing. Skin swapping stays fully automatic, which was the actual
goal, and the artwork is free.

The authoritative box for any existing card is in `skins.cards[].valueBox` in
[`local-server/config/tracker-skin-standard.json`](../local-server/config/tracker-skin-standard.json), also served at
`GET /api/tracker-skin-standard`.

### How the boxes were measured

Detected as the largest solid, horizontally-centred region that is both dark (mean luminance < 95) and visually
flat (9×9 local standard deviation < 9), restricted to opaque pixels (alpha > 200) below the top 34% of the
canvas. **Every detection was verified visually** against an overlay contact sheet before being written here.

**If a card is re-exported, re-measure it and update its entry.** The coordinates come from the artwork, so any
change to the artwork can invalidate them.

### What is still mandatory for every card

The per-skin model relaxes the box position — nothing else:

- Canvas exactly **2048 × 768, 8:3**
- **Value box blank in the artwork** — ICB draws the number
- **Transparency**: PNG with alpha, corners fully transparent so the rounded card reads correctly in Meld
- Resource title baked into the art, value box directly beneath it

`local-server/test/e2e.js` enforces all of the above per card, plus that every resource the server tracks has a skin mapped to it.

### Current set

16 cards, all verified: canvas correct, alpha present, boxes blank and detected cleanly.

Mapped to live resources: **Amber Echo → `amber`**, **Infected Essence → `essence`**, **Sweet Leaf → `sweetLeaf`**.
The other 13 are art for future trackers that are not yet wired into the server.

Two are flagged `ready-but-undersized` — their artwork fills noticeably less of the canvas than the rest
(Sweet Leaf ≈79%, Infected Essence ≈90%, versus 95–100% for the others) and their readout panels are short
(137px and 195px against a set range of 232–325px). They work, but they will read as smaller than their
neighbours when stacked. Regenerating them to fill the canvas with a taller panel is recommended.

---

## Card geometry — CONFIRMED (design guidance for new artwork)

✅ **Confirmed 2026-08-14 by Baby**, via the *Tracker Card Master Template (Measurements & Scales)*.
Every tracker card must follow this exact geometry. **Do not move or resize the value box.**

Coordinate space: master pixels, **origin (0,0) at the top-left corner of the full canvas**.

| Zone | x | y | width | height | right | bottom | centre x |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Safe area | 64 | 64 | 1920 | 640 | 1984 | 704 | 1024 |
| Title zone | 128 | 96 | 1792 | 260 | 1920 | 356 | 1024 |
| Value box zone | 448 | 392 | 1152 | 280 | 1600 | 672 | 1024 |

**Corner radius: 64 px.** Both zones are horizontally centred on **x = 1024**.

### Derived spacing

| Measurement | Value |
| --- | ---: |
| Canvas edge → safe area (all sides) | 64 |
| Safe area top → title zone top | 32 |
| Title zone bottom → value box top | **36** |
| Value box bottom → safe area bottom | 32 |
| Value box bottom → canvas bottom | 96 |
| Value box side margins (each) | 448 |

> ✅ **Annotation discrepancy — RESOLVED by Baby, 2026-08-14. The gap is 36px.**
> The master template image labels the title-to-value-box gap as **48px**, but the zone coordinates
> stated on that same image (title `y=96 h=260` → bottom 356; value box `y=392`) give **36px**.
> Baby confirmed the coordinates are authoritative — they appear twice and are self-consistent with
> the template's other callouts (32px top gap, 96px to canvas bottom, 448px side margins). The 48px
> label is an annotation error in that image.
>
> **The value box stays at `y=392`. Do not "correct" this to 48px.**

### Artwork rules

- Keep all key text and artwork **inside the safe area**.
- Do not place important elements outside the safe area.
- The **value box must remain completely blank** in the artwork.
- **Do not move or resize the value box.**
- ICB injects the live value at runtime.

### Scaling the geometry

Every coordinate above scales by the same factor as the card:
`scale = displayWidth ÷ 2048`. At a 512 px display width (scale 0.25), the value box zone becomes
`112, 98 · 288 × 70` and the corner radius becomes 16.

### Layout guide

[`docs/tracker-skin-template.svg`](tracker-skin-template.svg) reproduces this geometry at true master
size with dimension annotations. Open it in any browser or art tool as a reference.
**It is a guide, not a skin — never ship it as artwork.**

---

## Scope

Applies to every ICB resource tracker skin, current and future, unless Baby explicitly exempts it.

**Currently wired into the server:** Sweet Leaf, Infected Essence, Amber Echo.

**Named but not yet built:** Gold Ore, Palium, Celebration Cakes.

**Exemptions on record:** none.

---

## Future tracker development rule

When Baby asks for a new ICB resource tracker, **assume this standard automatically.** Do not ask
what size the skin should be. Default to 2048 × 768, 8:3, and also assume:

- rounded rectangular card
- horizontally oriented
- designed for vertical stacking
- resource title clearly visible
- dedicated tracker-number box underneath the title
- **readout box blank in the artwork**
- live value supplied dynamically by ICB
- decorative artwork may change by resource
- geometry stays compatible with the shared tracker component

Each new tracker is still a **deliberate, one-at-a-time build** — there is no generic
tracker-creation dashboard, by standing instruction. Per new tracker, record and verify:

1. The exact Palia Assistant `itemtype_...` token from a real log line. Never guess a token from an item name.
2. The current in-game starting total.
3. The skin artwork (2048 × 768, blank value box) and intended Meld overlay dimensions.
4. Server definition, API output, SSE update, persistence behaviour, and automated test.
5. The Browser-layer URL and any cache-busting version used by Meld.

---

## How this is enforced in code

- `local-server/config/tracker-skin-standard.json` is the single source of truth.
- `local-server/src/config.js` loads it into the `TRACKER_SKIN_STANDARD` constant. No dimension is hardcoded anywhere else.
- `GET /api/tracker-skin-standard` serves the full spec so any tracker component inherits it at runtime.
- `GET /api/diagnostics` includes a summary, so the standard is visible in routine health output.
- `local-server/test/e2e.js` asserts the master size, the confirmed zone geometry, the corner radius, horizontal centring, that zones sit inside the safe area, that `derivedSpacing` agrees with the coordinates, and that the value box is not baked into artwork. **A future session that quietly changes the standard will fail the test suite** — verified by deliberately nudging the value box, shifting the title zone off-centre, and altering the corner radius, each of which produced a named assertion failure.
