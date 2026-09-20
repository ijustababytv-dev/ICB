"""
Turn the raw tradeup plushie PNGs into overlay-ready sprites.

The originals are 1-2 MB each at full canvas size with lots of transparent
padding, which is fine for a reference library and terrible for a browser
source that has to load 130 of them. This does four things:

  1. Strips an opaque background if one is baked in (a couple of the files
     have solid black behind the plushie instead of transparency).
  2. Trims the transparent padding down to the actual artwork.
  3. Pads back out to a square and resizes to 256px, so every plushie
     scales consistently in the jar regardless of its original framing.
  4. Quantises to a 128-colour palette with FASTOCTREE, which — unlike
     PIL's default quantiser — preserves the alpha channel.

Result is roughly 13 KB per plushie instead of 1.5 MB.
"""
from PIL import Image
from collections import deque
import os, glob, json, sys

SRC = '/mnt/user-data/uploads/tradeup'
OUT = '/home/claude/plush-opt'
SIZE = 256
COLORS = 128


def slug(name):
    n = os.path.splitext(name)[0]
    n = n.replace(' - Copy', '').replace("'", '')
    n = ''.join(c if c.isalnum() else '-' for c in n).lower()
    while '--' in n:
        n = n.replace('--', '-')
    return n.strip('-')


def strip_background(im):
    """Flood-fill from the border, clearing pixels close to the corner colour.

    Only touches images that actually have an opaque background — a plushie
    on real transparency is returned untouched.
    """
    W, H = im.size
    corners = [im.getpixel((2, 2)), im.getpixel((W - 3, 2)),
               im.getpixel((2, H - 3)), im.getpixel((W - 3, H - 3))]
    opaque = [c for c in corners if c[3] > 200]
    if len(opaque) < 3:
        return im, False

    bg = opaque[0][:3]
    tol = 42
    px = im.load()
    seen = bytearray(W * H)
    q = deque()

    for x in range(W):
        for y in (0, H - 1):
            q.append((x, y))
    for y in range(H):
        for x in (0, W - 1):
            q.append((x, y))

    while q:
        x, y = q.popleft()
        i = y * W + x
        if seen[i]:
            continue
        seen[i] = 1
        r, g, b, a = px[x, y]
        if a < 20:
            continue
        if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > tol:
            continue
        px[x, y] = (r, g, b, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and not seen[ny * W + nx]:
                q.append((nx, ny))

    return im, True


def main():
    os.makedirs(OUT, exist_ok=True)
    rows, skipped, cleaned = [], [], []
    tin = tout = 0

    for p in sorted(glob.glob(SRC + '/*.png')):
        name = os.path.basename(p)
        try:
            im = Image.open(p).convert('RGBA')
        except Exception as e:
            skipped.append((name, str(e)))
            continue

        im, did = strip_background(im)
        if did:
            cleaned.append(name)

        bb = im.getchannel('A').point(lambda v: 255 if v > 10 else 0).getbbox()
        if not bb:
            skipped.append((name, 'fully transparent'))
            continue
        im = im.crop(bb)

        w, h = im.size
        S = max(w, h)
        sq = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        sq.paste(im, ((S - w) // 2, (S - h) // 2))
        sq = sq.resize((SIZE, SIZE), Image.LANCZOS)

        q = sq.quantize(colors=COLORS, method=Image.FASTOCTREE)
        out = os.path.join(OUT, slug(name) + '.png')
        q.save(out, optimize=True)

        si, so = os.path.getsize(p), os.path.getsize(out)
        tin += si
        tout += so
        rows.append({'source': name, 'file': os.path.basename(out),
                     'label': os.path.splitext(name)[0].replace(' - Copy', ''),
                     'bytes': so})

    json.dump(rows, open(os.path.join(OUT, '_manifest.json'), 'w'), indent=1)

    print(f'processed {len(rows)}   background-stripped {len(cleaned)}   skipped {len(skipped)}')
    if cleaned:
        print('  stripped:', cleaned)
    if skipped:
        print('  skipped:', skipped)
    print(f'in  {tin/1e6:.1f} MB')
    print(f'out {tout/1e6:.2f} MB  ({tout/tin*100:.1f}%)  avg {tout/max(len(rows),1)/1024:.0f} KB')


if __name__ == '__main__':
    main()
