# Gerber vectorization

## What?
Turn a filled-copper Gerber (or SVG export - from KiCad or not) into an outline
SVG suitable for (fiber) laser cutters (or vinyl cutter).

## Why?
KiCad's SVG/Gerber export draws each copper region as a filled shape but cutters
need outlines, not fills. These tools rasterize the input at high resolution,
thresholds it into a binary edge map, and vectorize that map into an SVG
made of black stroked outlines (`fill: none`).

## How?
There are two independent implementations of the same pipeline:

| | Python CLI (`vectorize.py`) | Web app (`index.html` / `src/app.js`) |
|---|---|---|
| Runs | locally, via `python3` | in the browser, no install needed |
| Input | SVG or Gerber (`.gbr`, `.gtl`, `.gbl`, ...) | SVG or Gerber (`.gbr`) |
| Rasterizer | `cairosvg` (SVG) / `pygerber` (Gerber) | HTML `<canvas>` |
| Tracer | [`vtracer`](https://github.com/visioncortex/vtracer) | [`imagetracerjs`](https://github.com/jankovicsandras/imagetracerjs) |
| Best for | batch/scripted use, highest-quality traces | quick one-off conversions, live preview |



### Python CLI

#### Setup

```bash
pip install -r requirements.txt
```

#### Usage examples

```bash
python3 vectorize.py input.svg
python3 vectorize.py board-F_Cu.gbr --dpi 3000
```

By default the output is written next to the input as `<name>-traced.svg`.

Options:

| Flag | Default | Description |
|---|---|---|
| `-o`, `--output` | `<input>-traced.svg` | Output SVG path |
| `--dpi` | `3000` | Rasterization resolution before tracing |
| `--line-width` | `1` | Stroke width of the output lines |
| `--output-width` | source width | Rescale output width (height scales proportionally) |
| `--threshold` | `50` | Luminance threshold (0-255) used to binarize the raster before tracing |

Intermediate rasters (`raster.png`, `edges.png`, `traced.svg`) are kept in a
`<output-name>-intermediate/` folder next to the output for debugging.



### Web app

Open `dist/index.html`, import an SVG or Gerber file, adjust the raster DPI /
line weight / output width, click **Trace Outline**, then **Download SVG**.


#### Online demo
https://fibercircuits.github.io/gerber-vectorization/

#### Local demo

```bash
npm install
npm run dev     # webpack --watch, serves from ./dist
# or
npm run build   # one-off production build to ./dist
```

#### Explanations

The root `index.html` is a **build template**, not the served file — it's never
deployed as-is. On every push to `main`, a GitHub Actions workflow
(`.github/workflows/deploy-gh-pages.yml`) runs `npm run build`, which uses
`index.html` as a webpack `HtmlWebpackPlugin` template to produce a
`dist/index.html` with `src/app.js` compiled and injected as `bundle.js`. That
`dist/` output is what gets pushed to the `gh-pages` branch, which is what
GitHub Pages actually serves (Settings → Pages → source branch `gh-pages`).
Don't delete or hand-edit the root `index.html` expecting it to be live — edit
it, `src/app.js`, or `webpack.config.js`, then let the workflow rebuild
`gh-pages` for you.

