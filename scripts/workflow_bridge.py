"""ORBIT adapters for user-requested dimensions and content-based image counts.
The skill's default policies and all other quality/queue checks remain.
"""
import argparse
import importlib.util
import json
import re
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / '.agents/skills/shiguang-atlas'
spec = importlib.util.spec_from_file_location('atlas_workflow', SKILL / 'scripts/workflow.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
original_inspect = w.inspect_image
original_quantity_plan = w.validate_quantity_plan
original_validate = w.validate
IMAGE_QUALITY = json.loads((ROOT / 'config/image-quality.json').read_text(encoding='utf-8'))

def validate_clean_detail(manifest_path):
    report = original_validate(manifest_path)
    manifest = w.read_json(manifest_path)
    for index, image in enumerate(manifest['images']):
        actual_prompt = image['generation']['actual_input'].get('prompt', '')
        w.require(IMAGE_QUALITY['prompt'] in actual_prompt,
                  f'Image {index} actual tool prompt is missing the required clean-detail guidance')
    report['visual_policy'] = IMAGE_QUALITY['id']
    return report

def validate_photoreal(manifest_path):
    report = validate_clean_detail(manifest_path)
    manifest = w.read_json(manifest_path)
    for index, image in enumerate(manifest['images']):
        w.require(IMAGE_QUALITY['photorealPrompt'] in image['generation']['actual_input'].get('prompt', ''),
                  f'Image {index} actual tool prompt is missing the required photoreal guidance')
    report['visual_policy'] = IMAGE_QUALITY['photorealId']
    return report

def validate_illustration(manifest_path):
    report = validate_clean_detail(manifest_path)
    manifest = w.read_json(manifest_path)
    for index, image in enumerate(manifest['images']):
        w.require(IMAGE_QUALITY['illustrationPrompt'] in image['generation']['actual_input'].get('prompt', ''),
                  f'Image {index} actual tool prompt is missing the required illustration guidance')
    report['visual_policy'] = IMAGE_QUALITY['illustrationId']
    return report

def without_image_labels(validator):
    def validate(manifest_path):
        report = validator(manifest_path)
        manifest = w.read_json(manifest_path)
        project = Path(manifest_path).resolve().parent.parent
        for index, image in enumerate(manifest['images']):
            w.require(IMAGE_QUALITY['noLabelPrompt'] in image['generation']['actual_input'].get('prompt', ''),
                      f'Image {index} actual tool prompt is missing the no-label guidance')
            _, copy = w.text_file(project, image.get('copy_path'), 'image.copy_path')
            w.require(not re.search(r'(?:(?<![a-z])ai\s*[-_：:]?\s*(?:生成|复原|示意|制作|合成|绘制|generated|created|illustration|reconstruction)|人工智能\s*(?:生成|制作|绘制))', copy, re.I),
                      f'Image {index} page copy contains an AI origin label')
        report['image_label_policy'] = IMAGE_QUALITY['noLabelId']
        return report
    return validate

def validate_adaptive_quantity(manifest, project):
    n = manifest.get('content_pages')
    w.require(type(n) is int and 3 <= n <= 7,
              'Adaptive content_pages must be 3–7 (4–8 total images including one cover)')
    plan = manifest.get('quantity_plan')
    w.require(isinstance(plan, dict) and plan.get('basis') == 'content_adaptive',
              'An explicit content_adaptive quantity_plan is required')
    w.require(type(plan.get('expected')) is int and plan['expected'] == n,
              'quantity_plan.expected must equal content_pages (excluding cover)')
    w.nonempty(plan.get('rationale'), 'quantity_plan.rationale')
    w.text_file(project, plan.get('evidence_path'), 'quantity_plan.evidence_path')
    _, full_text = w.text_file(project, manifest.get('full_text_path'), 'full_text_path', scan=True)
    pages = plan.get('pages')
    w.require(isinstance(pages, list) and len(pages) == n,
              'quantity_plan.pages must describe every content page')
    covered, titles = [], []
    explicit_count = w.title_count(manifest['topic'])
    for index, page in enumerate(pages, 1):
        w.require(isinstance(page, dict) and type(page.get('index')) is int and page['index'] == index,
                  'Planned pages must be numbered consecutively from 1')
        w.nonempty(page.get('title'), f'Planned page {index} title')
        w.nonempty(page.get('summary'), f'Planned page {index} summary')
        excerpt = page.get('source_excerpt')
        w.nonempty(excerpt, f'Planned page {index} source_excerpt')
        w.require(len(excerpt.strip()) >= 8 and excerpt in full_text,
                  f'Planned page {index} must quote an actual excerpt from full_text (at least 8 characters)')
        titles.append(page['title'].strip())
        if explicit_count is not None:
            items = page.get('covered_items')
            w.require(isinstance(items, list), f'Planned page {index} needs covered_items for the numbered topic')
            for item in items:
                w.nonempty(item, f'Planned page {index} covered item')
                w.require(item in full_text, f'Covered item must appear in full_text: {item}')
                covered.append(item.strip())
    w.require(len(set(titles)) == n, 'Planned content page titles must be distinct')
    if explicit_count is not None:
        w.require(len(set(covered)) == explicit_count,
                  f'Title promises {explicit_count} items; group them across pages without dropping members')
    return n

def configure_policies(dimension_policy='prompt-strong', image_count_policy='skill', visual_policy='legacy', image_label_policy='legacy'):
    w.inspect_image = inspect_native if dimension_policy == 'prompt-strong' else original_inspect
    w.validate_quantity_plan = validate_adaptive_quantity if image_count_policy == 'content-adaptive' else original_quantity_plan
    validators = {IMAGE_QUALITY['photorealId']: validate_photoreal,
                  IMAGE_QUALITY['illustrationId']: validate_illustration,
                  IMAGE_QUALITY['id']: validate_clean_detail}
    validator = validators.get(visual_policy, original_validate)
    w.validate = without_image_labels(validator) if image_label_policy == IMAGE_QUALITY['noLabelId'] else validator
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
    parser.add_argument('--image-count-policy', choices=['skill','content-adaptive'], default='skill')
    parser.add_argument('--visual-policy', choices=['legacy','clean-detail-v1','photoreal-v2','illustration-v1'], default='legacy')
    parser.add_argument('--image-label-policy', choices=['legacy','none-v1'], default='legacy')
    args = parser.parse_args()
    configure_policies(args.dimension_policy, args.image_count_policy, args.visual_policy, args.image_label_policy)
    try:
        report = w.validate(args.manifest) if args.action == 'validate' else w.commit(args.manifest)
        report['dimensions'] = dimensions(args.manifest)
        report['dimension_policy'] = args.dimension_policy
        report['image_count_policy'] = args.image_count_policy
        print(json.dumps(report, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({'ok':False, 'error':str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
if __name__ == '__main__': raise SystemExit(main())
