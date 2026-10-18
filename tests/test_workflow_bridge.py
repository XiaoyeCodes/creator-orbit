"""Synthetic structural fixtures only; never generation or visual QA evidence."""
import copy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / '.agents/skills/shiguang-atlas/scripts'))
import workflow_bridge as b
import test_workflow as fixtures


class AdaptivePlanTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.WorkflowTests(methodName='runTest')
        self.fixture.setUp()
        b.configure_policies(image_count_policy='content-adaptive')

    def tearDown(self):
        b.configure_policies()
        self.fixture.tearDown()

    def plan(self, count=3, topic=None):
        f = self.fixture
        f.make_run(count=count, topic=topic)
        f.manifest['quantity_plan'] = {
            'basis': 'content_adaptive', 'expected': count,
            'rationale': 'Synthetic planning fixture, not real content reasoning.',
            'evidence_path': 'raw_generated/quantity-plan.md',
            'pages': [{'index': i, 'title': f'Fixture page {i}', 'summary': f'Fixture content {i}',
                       'source_excerpt': 'Synthetic isolated test fixture.'} for i in range(1, count + 1)]}
        f.save()
        return f

    def test_four_total_images_validate_and_commit_only_isolated_queue(self):
        f = self.plan(3)
        before = f.queue.read_bytes()
        self.assertEqual(b.w.validate(f.manifest_path)['total_images'], 4)
        b.w.commit(f.manifest_path)
        self.assertEqual(f.queue.read_bytes(), before)

    def test_eight_total_images_validate(self):
        f = self.plan(7)
        self.assertEqual(b.w.validate(f.manifest_path)['total_images'], 8)

    def test_out_of_range_counts_and_fake_plan_are_rejected(self):
        f = self.plan()
        original = copy.deepcopy(f.manifest)
        for count in (2, 8, True):
            f.manifest = copy.deepcopy(original)
            f.manifest['content_pages'] = count
            with self.assertRaisesRegex(b.w.WorkflowError, '4–8 total'):
                b.validate_adaptive_quantity(f.manifest, f.project)
        f.manifest = copy.deepcopy(original)
        f.manifest['quantity_plan']['pages'][0]['source_excerpt'] = 'This passage does not exist in the actual article.'
        with self.assertRaisesRegex(b.w.WorkflowError, 'actual excerpt'):
            b.validate_adaptive_quantity(f.manifest, f.project)
        f.manifest = copy.deepcopy(original)
        f.manifest['quantity_plan']['pages'].pop()
        with self.assertRaisesRegex(b.w.WorkflowError, 'every content page'):
            b.validate_adaptive_quantity(f.manifest, f.project)

    def test_ten_items_can_be_grouped_but_must_not_be_omitted(self):
        f = self.plan(3, '十大测试对象')
        items = [f'对象{letter}' for letter in '甲乙丙丁戊己庚辛壬癸']
        full = f.project / f.manifest['full_text_path']
        full.write_text(full.read_text(encoding='utf-8') + '\n' + ' '.join(items), encoding='utf-8')
        for page, group in zip(f.manifest['quantity_plan']['pages'], [items[:4], items[4:7], items[7:]]):
            page['covered_items'] = group
        f.save()
        self.assertEqual(b.w.validate(f.manifest_path)['total_images'], 4)
        f.manifest['quantity_plan']['pages'][-1]['covered_items'].pop()
        with self.assertRaisesRegex(b.w.WorkflowError, 'promises 10 items'):
            b.validate_adaptive_quantity(f.manifest, f.project)

    def test_original_image_and_qa_checks_still_apply(self):
        f = self.plan()
        f.manifest['images'].pop()
        f.save()
        with self.assertRaisesRegex(b.w.WorkflowError, 'Exactly N\\+1'):
            b.w.validate(f.manifest_path)

    def test_legacy_policy_still_accepts_existing_plan(self):
        f = self.fixture
        f.make_run(count=4)
        b.configure_policies(image_count_policy='skill')
        self.assertEqual(b.w.validate(f.manifest_path)['total_images'], 5)
        f.manifest['content_pages'] = 3
        f.manifest['quantity_plan']['expected'] = 3
        with self.assertRaisesRegex(b.w.WorkflowError, '4–8 content pages'):
            b.w.validate_quantity_plan(f.manifest, f.project)

    def test_clean_detail_is_verified_in_every_actual_tool_prompt(self):
        f = self.plan()
        b.configure_policies(image_count_policy='content-adaptive', visual_policy='clean-detail-v1')
        with self.assertRaisesRegex(b.w.WorkflowError, 'actual tool prompt'):
            b.w.validate(f.manifest_path)
        for index, image in enumerate(f.manifest['images']):
            image['generation']['prompt'] += '\n' + b.IMAGE_QUALITY['prompt']
            image['generation']['actual_input']['prompt'] = image['generation']['prompt']
            f.sync_evidence(index)
        f.save()
        self.assertEqual(b.w.validate(f.manifest_path)['visual_policy'], 'clean-detail-v1')

    def test_photoreal_requires_both_style_and_clarity_prompts(self):
        f = self.plan()
        b.configure_policies(image_count_policy='content-adaptive', visual_policy='photoreal-v2')
        for index, image in enumerate(f.manifest['images']):
            image['generation']['prompt'] += '\n' + b.IMAGE_QUALITY['prompt']
            image['generation']['actual_input']['prompt'] = image['generation']['prompt']
            f.sync_evidence(index)
        f.save()
        with self.assertRaisesRegex(b.w.WorkflowError, 'photoreal guidance'):
            b.w.validate(f.manifest_path)
        for index, image in enumerate(f.manifest['images']):
            image['generation']['prompt'] += '\n' + b.IMAGE_QUALITY['photorealPrompt']
            image['generation']['actual_input']['prompt'] = image['generation']['prompt']
            f.sync_evidence(index)
        f.save()
        self.assertEqual(b.w.validate(f.manifest_path)['visual_policy'], 'photoreal-v2')

    def test_illustration_requires_its_own_style_prompt(self):
        f = self.plan()
        b.configure_policies(image_count_policy='content-adaptive', visual_policy='illustration-v1')
        for index, image in enumerate(f.manifest['images']):
            image['generation']['prompt'] += '\n' + b.IMAGE_QUALITY['prompt']
            image['generation']['actual_input']['prompt'] = image['generation']['prompt']
            f.sync_evidence(index)
        f.save()
        with self.assertRaisesRegex(b.w.WorkflowError, 'illustration guidance'):
            b.w.validate(f.manifest_path)
        for index, image in enumerate(f.manifest['images']):
            image['generation']['prompt'] += '\n' + b.IMAGE_QUALITY['illustrationPrompt']
            image['generation']['actual_input']['prompt'] = image['generation']['prompt']
            f.sync_evidence(index)
        f.save()
        self.assertEqual(b.w.validate(f.manifest_path)['visual_policy'], 'illustration-v1')

    def test_new_no_label_policy_requires_prompt_and_rejects_visible_copy_labels(self):
        f = self.plan()
        b.configure_policies(image_count_policy='content-adaptive', image_label_policy='none-v1')
        with self.assertRaisesRegex(b.w.WorkflowError, 'no-label guidance'):
            b.w.validate(f.manifest_path)
        for index, image in enumerate(f.manifest['images']):
            image['generation']['prompt'] += '\n' + b.IMAGE_QUALITY['noLabelPrompt']
            image['generation']['actual_input']['prompt'] = image['generation']['prompt']
            f.sync_evidence(index)
        f.save()
        self.assertEqual(b.w.validate(f.manifest_path)['image_label_policy'], 'none-v1')
        copy = f.project / f.manifest['images'][0]['copy_path']
        original = copy.read_text(encoding='utf-8')
        for label in ['AI生成', '本图ai 复原', 'AI示意', 'AI-generated', '人工智能生成']:
            copy.write_text(original + '\n' + label, encoding='utf-8')
            with self.assertRaisesRegex(b.w.WorkflowError, 'AI origin label'):
                b.w.validate(f.manifest_path)
        # Existing outputs retain their legacy policy and are still readable.
        b.configure_policies(image_count_policy='content-adaptive')
        self.assertTrue(b.w.validate(f.manifest_path)['valid'])


if __name__ == '__main__':
    unittest.main()
