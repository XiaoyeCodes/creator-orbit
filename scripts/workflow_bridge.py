"""ORBIT adapter: the user made exact pixels a strong prompt requirement.
The original skill stays intact. All non-size quality and queue checks remain.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / '.agents/skills/shiguang-atlas'
spec = importlib.util.spec_from_file_location('atlas_workflow', SKILL / 'scripts/workflow.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
original_inspect = w.inspect_image
def inspect_native(path, require_output=False):
    original_inspect(path, require_output=False)
    if require_output:
        from PIL import Image
        with Image.open(path) as image:
            w.require(image.format == 'PNG', f'Output is not an actual PNG: {path}')
            w.require(getattr(image, 'n_frames', 1) == 1, f'Animated output is not allowed: {path}')
            w.require(min(image.size) >= 768, f'Output resolution is too low: {image.size}')
def dimensions(manifest_path):
    from PIL import Image
    manifest = w.read_json(manifest_path)
    project = Path(manifest_path).resolve().parent.parent
    result = []
    for item in manifest.get('images', []):
        file = w.local_file(project, item.get('path'), 'output')
        with Image.open(file) as image:
            result.append({'path': item['path'], 'width': image.width, 'height': image.height,
                           'requested': '1086x1448', 'exact': image.size == (1086, 1448)})
    return result
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['validate','commit'])
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--dimension-policy', choices=['strict','prompt-strong'], default='prompt-strong')
    args = parser.parse_args()
    if args.dimension_policy == 'prompt-strong': w.inspect_image = inspect_native
    try:
        report = w.validate(args.manifest) if args.action == 'validate' else w.commit(args.manifest)
        report['dimensions'] = dimensions(args.manifest)
        report['dimension_policy'] = args.dimension_policy
        print(json.dumps(report, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({'ok':False, 'error':str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
if __name__ == '__main__': raise SystemExit(main())
