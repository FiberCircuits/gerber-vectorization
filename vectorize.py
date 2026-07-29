#!/usr/bin/env python3

import argparse
import sys
import tempfile
from decimal import Decimal
from pathlib import Path
import xml.etree.ElementTree as ET

import cairosvg
from PIL import Image, ImageOps
import vtracer
from pygerber.gerberx3.api.v2 import GerberFile

GERBER_EXTENSIONS = {
    ".gbr", ".gbl", ".gtl", ".gbs", ".gts", ".gbo", ".gto",
    ".gbp", ".gtp", ".gko", ".gm1",
}


def rasterize_svg(svg_path, png_path, dpi):
    print(f"Rasterizing at {dpi} DPI...")

    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(png_path),
        dpi=dpi,
    )


def rasterize_gerber(gerber_path, png_path, dpi):
    print(f"Rasterizing at {dpi} DPI...")

    parsed = GerberFile.from_file(str(gerber_path)).parse()

    # pygerber works in dots-per-mm rather than dpi, and requires an
    # exact (Decimal) value rather than a float.
    dpmm = Decimal(dpi / 25.4)

    parsed.render_raster(str(png_path), dpmm=dpmm)


def create_edge_map(png_path, edge_path, threshold=50):
    print("Creating edge map...")

    image = Image.open(png_path).convert("RGBA")

    # Same luminance calculation as your JS:
    # 0.299 R + 0.587 G + 0.114 B
    gray = ImageOps.grayscale(image.convert("RGB"))

    gray.save(edge_path.parent / "test.png")

    binary = gray.point(
        lambda value: 0 if value < threshold else 255,
        mode="L",
    )

    binary.save(edge_path)


def trace_image(edge_path, traced_path):
    print("Tracing raster...")

    vtracer.convert_image_to_svg_py(
        str(edge_path),
        str(traced_path),
        colormode="binary",
        hierarchical="stacked",
        mode="polygon",
        filter_speckle=4,
        path_precision=2,
    )


def rewrite_svg(
    svg_path,
    output_path,
    output_width=None,
    line_width=1,
):
    """
    Convert the traced SVG into a line-only SVG.

    The viewBox remains in raster pixel coordinates.
    """

    tree = ET.parse(svg_path)
    root = tree.getroot()

    # Detect SVG namespace.
    if root.tag.startswith("{"):
        namespace = root.tag.split("}")[0][1:]
    else:
        namespace = ""

    def tag(name):
        if namespace:
            return f"{{{namespace}}}{name}"
        return name

    viewbox = root.get("viewBox")

    if viewbox:
        values = viewbox.replace(",", " ").split()

        if len(values) == 4:
            _, _, source_width, source_height = map(float, values)
        else:
            raise ValueError(
                f"Invalid SVG viewBox: {viewbox}"
            )
    else:
        source_width = float(root.get("width", 1))
        source_height = float(root.get("height", 1))

    # Preserve the original raster dimensions.
    root.set(
        "viewBox",
        f"0 0 {source_width:g} {source_height:g}",
    )

    # Optionally change the output width while preserving aspect ratio.
    if output_width is not None:
        output_height = (
            output_width
            * source_height
            / source_width
        )

        root.set("width", str(output_width))
        root.set("height", str(output_height))

    # Turn all vector geometry into black lines.
    geometry_tags = {
        tag("path"),
        tag("polygon"),
        tag("polyline"),
        tag("rect"),
        tag("circle"),
        tag("ellipse"),
    }

    for element in root.iter():
        if element.tag not in geometry_tags:
            continue

        element.set("fill", "none")
        element.set("stroke", "black")
        element.set("stroke-width", str(line_width))

        # Remove conflicting style declarations.
        style = element.get("style")

        if style:
            parts = []

            for item in style.split(";"):
                if not item.strip():
                    continue

                key, _, value = item.partition(":")

                if key.strip() in {
                    "fill",
                    "stroke",
                    "stroke-width",
                }:
                    continue

                parts.append(item)

            if parts:
                element.set("style", ";".join(parts))
            else:
                element.attrib.pop("style", None)

    tree.write(
        output_path,
        encoding="utf-8",
        xml_declaration=True,
    )


def convert(
    input_path,
    output_svg,
    dpi=3000,
    line_width=1,
    output_width=None,
    threshold=50
):
    input_path = Path(input_path).resolve()
    output_svg = Path(output_svg).resolve()

    if not input_path.exists():
        raise FileNotFoundError(input_path)

    output_svg.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp_dir = output_svg.parent / f"{output_svg.stem}-intermediate"
    temp_dir.mkdir(parents=True, exist_ok=True)

    raster_png = temp_dir / "raster.png"
    edge_png = temp_dir / "edges.png"
    traced_svg = temp_dir / "traced.svg"

    # SVG or Gerber → high-DPI raster
    if input_path.suffix.lower() in GERBER_EXTENSIONS:
        rasterize_gerber(
            input_path,
            raster_png,
            dpi,
        )
    else:
        rasterize_svg(
            input_path,
            raster_png,
            dpi,
        )

    # Raster → binary image
    create_edge_map(
        raster_png,
        edge_png,
        threshold
    )

    # Binary raster → SVG
    trace_image(
        edge_png,
        traced_svg,
    )

    # Clean up / normalize the traced SVG
    rewrite_svg(
        traced_svg,
        output_svg,
        output_width=output_width,
        line_width=line_width,
    )

    print(f"Output: {output_svg}")
    print(f"Intermediate files: {temp_dir}")


def main():
    parser = argparse.ArgumentParser(
        description="Rasterize and vectorize a KiCad-exported SVG or Gerber file."
    )

    parser.add_argument(
        "input",
        type=Path,
        help="Input SVG or Gerber (.gbr, .gtl, .gbl, ...) file exported from KiCad",
    )

    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output SVG",
    )

    parser.add_argument(
        "--dpi",
        type=int,
        default=3000,
        help="Rasterization DPI (default: 3000)",
    )

    parser.add_argument(
        "--line-width",
        type=float,
        default=1,
        help="Output SVG stroke width (default: 1)",
    )

    parser.add_argument(
        "--output-width",
        type=float,
        default=None,
        help="Output SVG width; height is scaled proportionally",
    )

    parser.add_argument(
            "--threshold",
            type=float,
            default=50,
            help="Threshold color luminance for edge detection (default: 50)",
        )

    args = parser.parse_args()

    if args.dpi <= 0:
        parser.error("--dpi must be positive")

    if args.line_width <= 0:
        parser.error("--line-width must be positive")

    if (
        args.output_width is not None
        and args.output_width <= 0
    ):
        parser.error("--output-width must be positive")

    output = args.output

    if output is None:
        output = (
            args.input.parent
            / f"{args.input.stem}-traced.svg"
        )

    try:
        convert(
            input_path=args.input,
            output_svg=output,
            dpi=args.dpi,
            line_width=args.line_width,
            output_width=args.output_width,
            threshold=args.threshold
        )

    except Exception as error:
        print(
            f"Error: {error}",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())