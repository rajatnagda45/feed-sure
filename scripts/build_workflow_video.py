"""Assemble the silent, illustrated landing-page film with a local FFmpeg binary.

Usage: python scripts/build_workflow_video.py --ffmpeg PATH --font PATH
No runtime application dependencies are installed. WebP source images are committed.
"""

import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", required=True, type=Path)
    parser.add_argument("--font", required=True, type=Path)
    args = parser.parse_args()
    encoder = str(args.ffmpeg.resolve())
    media = Path(__file__).resolve().parents[1] / "frontend/public/media"
    scenes = [
        ("kitchen-ready.webp", "01 / READY", "Confirm quantity and a pickup window"),
        ("collection.webp", "02 / COLLECT", "Dispatch a route. Record actual pickups."),
        ("plant-intake.webp", "03 / RECONCILE", "Compare net intake with recorded pickups"),
    ]
    with tempfile.TemporaryDirectory(prefix="feedsure-film-") as temporary:
        work = Path(temporary)
        shutil.copyfile(args.font, work / "font.ttf")
        for index, (source, title, subtitle) in enumerate(scenes):
            (work / "title.txt").write_text(title, encoding="utf-8")
            (work / "subtitle.txt").write_text(subtitle, encoding="utf-8")
            filters = (
                "scale=1280:720,setsar=1,"
                "drawbox=x=0:y=548:w=iw:h=172:color=0x173f32@0.95:t=fill,"
                "drawtext=fontfile=font.ttf:textfile=title.txt:fontcolor=0xdef0c6:fontsize=24:x=48:y=573,"
                "drawtext=fontfile=font.ttf:textfile=subtitle.txt:fontcolor=white:fontsize=34:x=48:y=614,"
                "drawtext=fontfile=font.ttf:text='FeedSure / AI-generated illustration':fontcolor=white:fontsize=16:x=48:y=680,"
                "fade=t=in:st=0:d=0.35,fade=t=out:st=5.65:d=0.35"
            )
            subprocess.run([
                encoder, "-hide_banner", "-loglevel", "error", "-y", "-loop", "1",
                "-framerate", "24", "-i", str(media / source), "-t", "6",
                "-vf", filters, "-c:v", "libx264", "-preset", "medium", "-crf", "25",
                "-pix_fmt", "yuv420p", "-an", f"scene-{index}.mp4",
            ], cwd=work, check=True)
        (work / "scenes.txt").write_text("".join(f"file 'scene-{i}.mp4'\n" for i in range(3)), encoding="utf-8")
        subprocess.run([
            encoder, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat",
            "-safe", "0", "-i", "scenes.txt", "-c", "copy", "-movflags", "+faststart",
            str(media / "collection-workflow.mp4"),
        ], cwd=work, check=True)


if __name__ == "__main__":
    main()
