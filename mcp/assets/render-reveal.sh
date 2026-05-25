#!/usr/bin/env bash
#
# Render the Glassbox reveal HTML to MP4 by:
#   1. Spawning N parallel Chrome headless workers
#   2. Each captures one PNG frame at a specific virtual time
#   3. ffmpeg stitches the PNGs into an MP4 (and a fallback GIF)
#
# All frame timings deterministic via --virtual-time-budget — animations
# advance to the exact virtual clock the budget allows, so the same input
# always produces byte-identical frames.
#
# Outputs:
#   assets/frames/frame_NNNN.png   (per-frame stills)
#   assets/glassbox-reveal.mp4     (final video)
#   assets/glassbox-reveal.gif     (web-friendly fallback)
#
# Tunables:
#   FPS         frames per second (default 12 — readable, fast to render)
#   DURATION_S  total reveal length in seconds (default 25)
#   PARALLEL    max concurrent Chrome processes (default 8)
#   WIDTH/HEIGHT 1920x1080 (default)

set -euo pipefail

cd "$(dirname "$0")/.."

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Source page and output file names are parameterised so the same
# pipeline can render the reveal or the walkthrough video.
SRC=${SRC:-reveal}
HTML="$PWD/assets/${SRC}.html"
FRAME_DIR="$PWD/assets/frames-${SRC}"
MP4_OUT="$PWD/assets/glassbox-${SRC}.mp4"
GIF_OUT="$PWD/assets/glassbox-${SRC}.gif"

FPS=${FPS:-12}
DURATION_S=${DURATION_S:-25}
PARALLEL=${PARALLEL:-8}
WIDTH=${WIDTH:-1920}
HEIGHT=${HEIGHT:-1080}

if [ ! -x "$CHROME" ]; then
  echo "FAIL: Google Chrome not found at $CHROME" >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FAIL: ffmpeg not found" >&2
  exit 1
fi

TOTAL_FRAMES=$(( FPS * DURATION_S ))
FRAME_MS=$(( 1000 / FPS ))

echo "═══ Glassbox reveal render ═══"
echo "  source:   $HTML"
echo "  size:     ${WIDTH}x${HEIGHT}"
echo "  fps:      $FPS    duration: ${DURATION_S}s    frames: $TOTAL_FRAMES"
echo "  parallel: $PARALLEL workers"
echo "  output:   $MP4_OUT"
echo ""

rm -rf "$FRAME_DIR"
mkdir -p "$FRAME_DIR"

render_one_frame() {
  local idx="$1"
  local budget_ms=$(( (idx + 1) * FRAME_MS ))
  local out
  out=$(printf '%s/frame_%04d.png' "$FRAME_DIR" "$idx")

  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --no-sandbox \
    --disable-dev-shm-usage \
    --force-device-scale-factor=1 \
    --window-size="${WIDTH},${HEIGHT}" \
    --virtual-time-budget="${budget_ms}" \
    --screenshot="${out}" \
    "file://${HTML}" \
    >/dev/null 2>&1
}
export -f render_one_frame
export CHROME HTML FRAME_DIR FRAME_MS WIDTH HEIGHT

START=$(date +%s)
echo "▶ rendering $TOTAL_FRAMES frames..."

# Parallel render via xargs -P. Each worker spawns a fresh chrome process.
seq 0 $((TOTAL_FRAMES - 1)) | xargs -n1 -P "$PARALLEL" -I {} bash -c 'render_one_frame "$@"' _ {}

RENDERED=$(ls "$FRAME_DIR"/frame_*.png 2>/dev/null | wc -l | tr -d ' ')
END=$(date +%s)
ELAPSED=$((END - START))

if [ "$RENDERED" -ne "$TOTAL_FRAMES" ]; then
  echo "  rendered $RENDERED of $TOTAL_FRAMES frames in ${ELAPSED}s" >&2
  echo "FAIL: some frames missing — check Chrome output" >&2
  exit 1
fi
echo "  ✓ rendered $RENDERED frames in ${ELAPSED}s"

echo ""
echo "▶ stitching MP4 (H.264, 1920×1080, ${FPS}fps)..."
ffmpeg -y -v warning \
  -framerate "$FPS" \
  -i "${FRAME_DIR}/frame_%04d.png" \
  -c:v libx264 \
  -pix_fmt yuv420p \
  -crf 18 \
  -preset slow \
  -movflags +faststart \
  "$MP4_OUT" 2>&1 | tail -3
echo "  ✓ $MP4_OUT ($(du -h "$MP4_OUT" | awk '{print $1}'))"

echo ""
echo "▶ generating GIF fallback (lower fps for size)..."
ffmpeg -y -v warning \
  -framerate "$FPS" \
  -i "${FRAME_DIR}/frame_%04d.png" \
  -vf "fps=10,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  "$GIF_OUT" 2>&1 | tail -3
echo "  ✓ $GIF_OUT ($(du -h "$GIF_OUT" | awk '{print $1}'))"

TOTAL=$(date +%s)
TOTAL_ELAPSED=$((TOTAL - START))
echo ""
echo "═══ done in ${TOTAL_ELAPSED}s ═══"
echo "  open $MP4_OUT"
