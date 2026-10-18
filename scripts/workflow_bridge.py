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
IMAGE_PLANNING = json.loads((ROOT / 'config/image-planning.json').read_text(encoding='utf-8'))
CAPTION_QUALITY = json.loads((ROOT / 'config/caption-quality.json').read_text(encoding='utf-8'))
CAPTION_V1 = json.loads((ROOT / 'config/caption-quality-v1.json').read_text(encoding='utf-8'))
PUBLISHING_LIMITS = json.loads((ROOT / 'config/publishing-limits.json').read_text(encoding='utf-8'))

def validate_caption_limits(manifest, project):
    _, caption = w.text_file(project, manifest.get('caption_path'), 'caption_path')
    lines = caption.strip().splitlines()
    title = re.sub(r'^(?:#{1,6}\s*|标题[:：]\s*)', '', lines[0]).strip() if lines else ''
    body = '\n'.join(lines[1:]).strip()
    w.require(0 < len(title) <= PUBLISHING_LIMITS['maxTitleChars'], 'Caption title exceeds the 20-character limit or is empty')
    w.require(0 < len(body) <= PUBLISHING_LIMITS['maxBodyChars'], 'Caption body and tags exceed the 1000-character limit or are empty')
    return {'title': len(title), 'body': len(body)}

def with_caption_limits(validator):
    def validate(manifest_path):
        report = validator(manifest_path)
        manifest, project = w.read_json(manifest_path), Path(manifest_path).resolve().parent.parent
        report['caption_counts'] = validate_caption_limits(manifest, project)
        return report
    return validate

def validate_reader_review(review, body):
    w.require(isinstance(review, dict), 'A reader_review with actual reading evidence is required')
    for field in ('question', 'takeaway', 'explanation', 'coverage', 'reading_notes'):
        w.nonempty(review.get(field), 'reader_review.' + field)
    prose = re.sub(r'(?<!\S)#[^\s#]+', '', body).strip()
    opening, answer = review.get('opening_excerpt'), review.get('answer_excerpt')
    w.require(isinstance(opening, str) and opening.strip() and prose.startswith(opening),
              'reader_review must quote the actual opening of the caption body')
    w.require(isinstance(answer, str) and answer.strip() and answer in prose,
              'reader_review must quote an actual answer in the caption body')
    w.require(isinstance(review.get('checks'), dict)
              and all(review['checks'].get(key) is True for key in CAPTION_QUALITY['readerChecks']),
              'Every reader_review check needs explicit sign-off after actual reading')

def validate_caption_review(manifest, project, policy=None):
    policy = policy or CAPTION_V1['id']
    quality = CAPTION_QUALITY if policy == CAPTION_QUALITY['id'] else CAPTION_V1
    caption_path, caption = w.text_file(project, manifest.get('caption_path'), 'caption_path')
    full_path, full_text = w.text_file(project, manifest.get('full_text_path'), 'full_text_path')
    lines = caption.strip().splitlines()
    w.require(lines and lines[0].startswith('# '), 'Caption must begin with # title')
    title = lines[0][2:].strip()
    body = '\n'.join(lines[1:]).strip()
    validate_caption_limits(manifest, project)
    review = manifest.get('caption_review')
    w.require(isinstance(review, dict), 'A caption_review with actual editorial evidence is required')
    w.require(review.get('caption_sha256') == w.sha256(caption_path)
              and review.get('full_text_sha256') == w.sha256(full_path),
              'Caption review hashes do not match the final caption and full text; review again after edits')
    # Audit notes must be able to quote rejected wording when explaining a repair.
    # Published copy is reviewed in context, without a substring word blacklist.
    w.text_file(project, review.get('evidence_path'), 'caption_review.evidence_path')
    checks = review.get('checks')
    w.require(isinstance(checks, dict) and all(checks.get(key) is True for key in quality['reviewChecks']),
              'Every editorial review check needs explicit sign-off after actual reading')
    insights = review.get('insights')
    w.require(isinstance(insights, list) and len(insights) >= quality['minInsights'],
              'Caption review needs at least three distinct substantive insights')
    # Tags and the title cannot be submitted as explanations in the published body.
    prose = re.sub(r'(?<!\S)#[^\s#]+', '', body)
    seen = []
    for insight in insights:
        w.require(isinstance(insight, dict), 'Each editorial insight must be an object')
        excerpt, source = insight.get('caption_excerpt'), insight.get('full_text_excerpt')
        w.require(isinstance(excerpt, str) and len(re.sub(r'\s', '', excerpt)) >= 20 and excerpt in prose,
                  'Insight must quote an actual caption body excerpt (at least 20 non-whitespace characters)')
        w.require(isinstance(source, str) and len(re.sub(r'\s', '', source)) >= 20 and source in full_text,
                  'Insight must quote an actual full_text excerpt (at least 20 non-whitespace characters)')
        normalized = re.sub(r'\s', '', excerpt)
        w.require(not any(normalized in prior or prior in normalized for prior in seen),
                  'Editorial insights must be distinct, not repeated or nested excerpts')
        seen.append(normalized)
        w.nonempty(insight.get('explanation'), 'insight.explanation')
    if policy == CAPTION_QUALITY['id']:
        validate_reader_review(review.get('reader_review'), body)

def with_caption_review(validator, policy):
    def validate(manifest_path):
        report = validator(manifest_path)
        manifest = w.read_json(manifest_path)
        validate_caption_review(manifest, Path(manifest_path).resolve().parent.parent, policy)
        report['caption_policy'] = policy
        return report
    return validate

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
    _, full_text = w.text_file(project, manifest.get('full_text_path'), 'full_text_path')
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

def validate_subject_quantity(manifest, project):
    n = manifest.get('content_pages')
    w.require(type(n) is int and 0 <= n <= 10,
              'Single-subject content_pages must be 0–10 (1–11 total images including cover)')
    plan = manifest.get('quantity_plan')
    w.require(isinstance(plan, dict) and plan.get('basis') == 'single_subject',
              'An explicit single_subject quantity_plan is required')
    w.require(type(plan.get('expected')) is int and plan['expected'] == n,
              'quantity_plan.expected must equal content_pages (excluding cover)')
    w.nonempty(plan.get('rationale'), 'quantity_plan.rationale')
    w.text_file(project, plan.get('evidence_path'), 'quantity_plan.evidence_path')
    _, full_text = w.text_file(project, manifest.get('full_text_path'), 'full_text_path')
    pages, subjects = plan.get('pages'), plan.get('subjects')
    count = max(1, n)
    w.require(isinstance(pages, list) and len(pages) == count,
              'Plan must describe every subject page, including the combined cover when total is one')
    w.require(isinstance(subjects, list) and len(subjects) == count,
              'Each subject needs its own page; subjects and subject pages must match')
    for subject in subjects:
        w.nonempty(subject, 'planned subject')
        w.require(subject == subject.strip() and subject in full_text, 'Each subject must appear in full_text')
    w.require(len(set(subjects)) == count, 'Subjects must be distinct; do not repeat a subject to fill pages')
    explicit_count = w.title_count(manifest['topic'])
    if explicit_count is not None:
        w.require(count == explicit_count,
                  f'Title promises {explicit_count} items; each needs a separate page without merging or omissions')
    for index, (page, subject) in enumerate(zip(pages, subjects), 0 if n == 0 else 1):
        w.require(isinstance(page, dict) and type(page.get('index')) is int and page['index'] == index,
                  'Subject page indices must match actual images (0 for a single combined cover, otherwise 1–N)')
        w.require(page.get('covered_items') == [subject], 'Each page must cover exactly one subject')
        w.nonempty(page.get('title'), 'subject page title')
        w.require(subject in page['title'], 'Page title must name its single subject')
        w.nonempty(page.get('summary'), 'subject page summary')
        excerpt = page.get('source_excerpt')
        w.require(isinstance(excerpt, str) and len(excerpt.strip()) >= 8 and excerpt in full_text and subject in excerpt,
                  'Each subject page must quote an actual excerpt containing its subject (at least 8 characters)')
    return n

def with_single_subject_review(validator):
    def validate(manifest_path):
        report = validator(manifest_path)
        manifest = w.read_json(manifest_path)
        project = Path(manifest_path).resolve().parent.parent
        for page in manifest['quantity_plan']['pages']:
            index, subject = page['index'], page['covered_items'][0]
            item = manifest['images'][index]
            prompt = item['generation']['actual_input']['prompt']
            w.require(IMAGE_PLANNING['prompt'] in prompt and f'本图唯一介绍对象：{subject}\n' in prompt,
                      f'Image {index} actual tool prompt must bind exactly one planned subject')
            _, copy = w.text_file(project, item['copy_path'], 'subject page copy')
            w.require(subject in copy, f'Image {index} copy must introduce its planned subject')
            review = manifest['qa']['page_reviews'][index]
            w.require(review['checks'].get('single_subject_per_page') is True,
                      f'Image {index} needs actual single_subject_per_page visual sign-off')
        return report
    return validate

def configure_policies(dimension_policy='prompt-strong', image_count_policy='skill', visual_policy='legacy', image_label_policy='legacy', caption_policy='legacy'):
    w.inspect_image = inspect_native if dimension_policy == 'prompt-strong' else original_inspect
    w.validate_quantity_plan = {'content-adaptive': validate_adaptive_quantity,
                                IMAGE_PLANNING['id']: validate_subject_quantity}.get(image_count_policy, original_quantity_plan)
    validators = {IMAGE_QUALITY['photorealId']: validate_photoreal,
                  IMAGE_QUALITY['illustrationId']: validate_illustration,
                  IMAGE_QUALITY['id']: validate_clean_detail}
    validator = validators.get(visual_policy, original_validate)
    if image_count_policy == IMAGE_PLANNING['id']:
        validator = with_single_subject_review(validator)
    validator = without_image_labels(validator) if image_label_policy == IMAGE_QUALITY['noLabelId'] else validator
    validator = with_caption_review(validator, caption_policy) if caption_policy in (CAPTION_V1['id'], CAPTION_QUALITY['id']) else validator
    w.validate = with_caption_limits(validator)
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
    parser.add_argument('--image-count-policy', choices=['skill','content-adaptive','single-subject-v1'], default='skill')
    parser.add_argument('--visual-policy', choices=['legacy','clean-detail-v1','photoreal-v2','illustration-v1'], default='legacy')
    parser.add_argument('--image-label-policy', choices=['legacy','none-v1'], default='legacy')
    parser.add_argument('--caption-policy', choices=['legacy', CAPTION_V1['id'], CAPTION_QUALITY['id']], default='legacy')
    args = parser.parse_args()
    configure_policies(args.dimension_policy, args.image_count_policy, args.visual_policy, args.image_label_policy, args.caption_policy)
    try:
        report = w.validate(args.manifest) if args.action == 'validate' else w.commit(args.manifest)
        report['dimensions'] = dimensions(args.manifest)
        report['dimension_policy'] = args.dimension_policy
        report['image_count_policy'] = args.image_count_policy
        report['caption_policy'] = args.caption_policy
        print(json.dumps(report, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({'ok':False, 'error':str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
if __name__ == '__main__': raise SystemExit(main())
