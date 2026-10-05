#!/usr/bin/env python3
"""Build extension/assets/fonts/guild-pixel-12.woff2.

The UI font is Fusion Pixel Font 12px (proportional, SIL OFL 1.1), cut down to
the characters the UI actually uses, so the page HUD loads a few kilobytes
instead of a full CJK font. Run it again whenever UI strings change.

    pip install fonttools brotli
    python3 scripts/build-font.py [--source DIR]

DIR is an unpacked @vp-tw/cjk-web-fonts-fusion-pixel-font package (the
upstream release split into per-block WOFF2 files). Without --source the
package is fetched with `npm pack` into .cache/.
"""
import argparse
import glob
import os
import shutil
import subprocess
import sys
import tarfile

from fontTools import subset
from fontTools.merge import Merger
from fontTools.merge import Options as MergeOptions
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTENSION = os.path.join(ROOT, 'extension')
OUT_DIR = os.path.join(EXTENSION, 'assets', 'fonts')
OUT_FILE = os.path.join(OUT_DIR, 'guild-pixel-12.woff2')

PACKAGE = '@vp-tw/cjk-web-fonts-fusion-pixel-font@0.0.1'
# Where UI text lives. _locales/ is shown by Chrome in its own font.
SCAN_DIRS = ['core', 'providers', 'ui', 'popup', 'content']
SCAN_EXTENSIONS = ('.js', '.html', '.css')
# Which language variant supplies a glyph when several have it.
VARIANTS = ['zh_hans', 'ja', 'zh_hant', 'latin']
# A few characters the UI may print that are not literally in the sources.
EXTRA = '0123456789:/%-+.,()[]!?…·'

FAMILY = 'WAM Guild Pixel'
POSTSCRIPT = 'WAMGuildPixel-Regular'


def fetch_package():
    cache = os.path.join(ROOT, '.cache')
    package = os.path.join(cache, 'package')
    if os.path.isdir(package):
        return package
    os.makedirs(cache, exist_ok=True)
    tarball = subprocess.check_output(['npm', 'pack', PACKAGE, '--silent'], cwd=cache, text=True).strip().splitlines()[-1]
    with tarfile.open(os.path.join(cache, tarball)) as archive:
        archive.extractall(cache, filter='data')
    return package


def used_characters():
    chars = {chr(code) for code in range(0x20, 0x7F)} | set(EXTRA)
    for folder in SCAN_DIRS:
        for path in glob.glob(os.path.join(EXTENSION, folder, '**', '*'), recursive=True):
            if path.endswith(SCAN_EXTENSIONS):
                with open(path, encoding='utf-8') as handle:
                    chars.update(handle.read())
    return {char for char in chars if char == ' ' or (ord(char) >= 0x20 and not char.isspace())}


def chunk_owners(package):
    """Map each code point to the first chunk file (by variant order) that has it."""
    base = os.path.join(package, 'dist', '12px', 'proportional')
    owners = {}
    for variant in VARIANTS:
        for path in sorted(glob.glob(os.path.join(base, variant, '*.woff2'))):
            for code in TTFont(path, lazy=True).getBestCmap():
                owners.setdefault(code, path)
    return owners


def rename(font, version):
    names = font['name']
    names.names = [record for record in names.names if record.nameID in (0, 13, 14)]
    for name_id, value in {
        1: FAMILY,
        2: 'Regular',
        3: f'{FAMILY} Regular; subset of Fusion Pixel Font {version}',
        4: f'{FAMILY} Regular',
        5: f'Version {version}',
        6: POSTSCRIPT,
    }.items():
        names.setName(value, name_id, 3, 1, 0x409)
    if 'CFF ' in font:
        cff = font['CFF '].cff
        cff.fontNames = [POSTSCRIPT]
        top = cff.topDictIndex[0]
        top.FullName = f'{FAMILY} Regular'
        top.FamilyName = FAMILY


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', help='unpacked font package directory')
    args = parser.parse_args()
    package = args.source or fetch_package()

    chars = used_characters()
    owners = chunk_owners(package)
    missing = sorted(char for char in chars if ord(char) not in owners)
    chunks = sorted({owners[ord(char)] for char in chars if ord(char) in owners})

    font = Merger(options=MergeOptions(drop_tables=['vhea', 'vmtx', 'VORG'])).merge(chunks)
    options = subset.Options()
    options.flavor = 'woff2'
    options.name_IDs = ['*']
    options.notdef_outline = True
    options.drop_tables += ['vhea', 'vmtx', 'VORG']
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=sorted(ord(char) for char in chars if ord(char) in owners))
    subsetter.subset(font)

    version = '?'
    try:
        import json
        with open(os.path.join(package, 'source.json'), encoding='utf-8') as handle:
            version = json.load(handle)['version']
    except (OSError, KeyError, ValueError):
        pass
    rename(font, version)

    os.makedirs(OUT_DIR, exist_ok=True)
    font.flavor = 'woff2'
    font.save(OUT_FILE)

    # The OFL travels with the font, along with the licences of the fonts it merges.
    shutil.copyfile(os.path.join(package, 'LICENSE.font.txt'), os.path.join(OUT_DIR, 'OFL.txt'))
    licences = os.path.join(OUT_DIR, 'LICENSES')
    shutil.rmtree(licences, ignore_errors=True)
    shutil.copytree(os.path.join(package, 'LICENSES', '12px'), licences)

    print(f'{OUT_FILE}: {len(font.getGlyphOrder())} glyphs, {os.path.getsize(OUT_FILE)} bytes, from {len(chunks)} chunks')
    if missing:
        print('not in the font (browser fallback will draw them):', ' '.join(f'U+{ord(c):04X}{c}' for c in missing))
    return 0


if __name__ == '__main__':
    sys.exit(main())
