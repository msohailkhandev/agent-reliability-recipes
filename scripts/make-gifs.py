"""
Regenerates the README demo GIFs from the REAL output of `npm run demo:NN`.

    pip install pillow
    python3 scripts/make-gifs.py

Nothing in the GIFs is typed by hand: each one replays the command and the exact
lines the demo printed. Optional tooling — the recipes themselves don't need Python.
Set GIF_FONT to a monospace .ttf if DejaVu Sans Mono isn't at the default path.
"""

import os
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"
FONT_PATH = os.environ.get("GIF_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")
FONT_BOLD_PATH = os.environ.get("GIF_FONT_BOLD", FONT_PATH.replace("Mono.ttf", "Mono-Bold.ttf"))

RECIPES = [
    ("01", "# 01 · agent loops on the same tool call and burns money"),
    ("02", "# 02 · timeout after sending → model retries → customer gets 2 emails"),
    ("03", "# 03 · blind retries on an error that can never succeed"),
]

BG = (13, 17, 23)
BAR = (22, 27, 34)
TEXT = (201, 209, 217)
DIM = (139, 148, 158)
GREEN = (63, 185, 80)
RED = (248, 81, 73)
DOTS = [(255, 95, 86), (255, 189, 46), (39, 201, 63)]

FONT_SIZE = 18
LINE_H = 28
PAD_X = 28
BAR_H = 36

font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
font_bold = ImageFont.truetype(FONT_BOLD_PATH, FONT_SIZE) if Path(FONT_BOLD_PATH).exists() else font
char_w = font.getlength("M")
# Set in main() from the real output, so no line is ever cut off.
ROWS = 0
WIDTH = 0
HEIGHT = 0


def run_demo(n: str) -> list[str]:
    out = subprocess.run(
        ["npm", "run", "-s", f"demo:{n}"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout
    return out.rstrip("\n").split("\n")


def style(line: str) -> tuple[tuple[int, int, int], ImageFont.FreeTypeFont]:
    if line.startswith("#"):
        return DIM, font
    if line.startswith("$"):
        return TEXT, font_bold
    if line.startswith("BROKEN"):
        return RED, font_bold
    if line.startswith("FIXED"):
        return GREEN, font_bold
    return TEXT, font


def render(lines: list[str], cursor: bool = False) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, WIDTH, BAR_H], fill=BAR)
    for i, color in enumerate(DOTS):
        cx = 22 + i * 22
        d.ellipse([cx - 6, BAR_H // 2 - 6, cx + 6, BAR_H // 2 + 6], fill=color)
    title = "agent-reliability-recipes"
    d.text(((WIDTH - font.getlength(title)) / 2, 8), title, fill=DIM, font=font)

    visible = lines[-ROWS:]
    y = BAR_H + 20
    for line in visible:
        color, f = style(line)
        if line.startswith("$ "):
            d.text((PAD_X, y), "$", fill=GREEN, font=font_bold)
            d.text((PAD_X + char_w * 2, y), line[2:], fill=TEXT, font=f)
        else:
            d.text((PAD_X, y), line, fill=color, font=f)
        y += LINE_H
    if cursor:
        last = visible[-1] if visible else ""
        x = PAD_X + char_w * len(last)
        d.rectangle([x + 2, y - LINE_H + 4, x + char_w, y - 6], fill=TEXT)
    return img


def frames_for(n: str, comment: str, output: list[str]) -> list[tuple[Image.Image, int]]:
    frames: list[tuple[Image.Image, int]] = []
    screen: list[str] = []
    screen += [comment]
    frames.append((render(screen + ["$ "], cursor=True), 500))
    command = f"npm run demo:{n}"
    for i in range(1, len(command) + 1, 2):
        frames.append((render(screen + ["$ " + command[:i]], cursor=True), 60))
    screen += ["$ " + command]
    frames.append((render(screen, cursor=False), 400))
    for line in output:
        screen.append(line)
        frames.append((render(screen), 140))
    frames[-1] = (frames[-1][0], 3200)  # hold on the result
    return frames


def save(frames: list[tuple[Image.Image, int]], path: Path) -> None:
    images = [f.convert("P", palette=Image.Palette.ADAPTIVE, colors=32) for f, _ in frames]
    images[0].save(
        path,
        save_all=True,
        append_images=images[1:],
        duration=[ms for _, ms in frames],
        loop=0,
        optimize=True,
    )
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB, {len(frames)} frames)")


def main() -> None:
    global ROWS, WIDTH, HEIGHT
    OUT.mkdir(exist_ok=True)
    outputs = {n: run_demo(n) for n, _ in RECIPES}
    longest = max(len(line) for n, comment in RECIPES for line in [comment, f"$ npm run demo:{n}", *outputs[n]])
    ROWS = max(len(lines) for lines in outputs.values()) + 2  # + comment and command lines
    WIDTH = int(PAD_X * 2 + char_w * (longest + 1))
    HEIGHT = BAR_H + 20 + LINE_H * ROWS + 26
    everything: list[tuple[Image.Image, int]] = []
    for n, comment in RECIPES:
        frames = frames_for(n, comment, outputs[n])
        save(frames, OUT / f"demo-{n}.gif")
        everything += frames
    save(everything, OUT / "demo-all.gif")


if __name__ == "__main__":
    main()
