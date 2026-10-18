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


class SingleSubjectPlanTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.WorkflowTests(methodName='runTest')
        self.fixture.setUp()
        b.configure_policies(image_count_policy='single-subject-v1')

    def tearDown(self):
        b.configure_policies()
        self.fixture.tearDown()

    def plan(self, count=2, topic=None):
        f = self.fixture
        f.make_run(count=count, topic=topic)
        subjects = ['儒家', '墨家', '道家', '法家', '名家', '阴阳家', '纵横家', '杂家', '农家', '小说家'][:max(1, count)]
        paragraphs = [subject + '的核心观点与代表人物在此独立介绍，仅作结构测试。' for subject in subjects]
        full = f.project / f.manifest['full_text_path']
        full.write_text('\n'.join(paragraphs), encoding='utf-8')
        pages = []
        for index, (subject, excerpt) in enumerate(zip(subjects, paragraphs), 0 if count == 0 else 1):
            pages.append({'index': index, 'title': subject, 'summary': 'Synthetic single-subject fixture.',
                          'source_excerpt': excerpt, 'covered_items': [subject]})
            image = f.manifest['images'][index]
            generation = image['generation']
            generation['prompt'] += '\n' + b.IMAGE_PLANNING['prompt'] + '\n本图唯一介绍对象：' + subject + '\n'
            generation['actual_input']['prompt'] = generation['prompt']
            f.sync_evidence(index)
            (f.project / image['copy_path']).write_text(excerpt, encoding='utf-8')
            f.manifest['qa']['page_reviews'][index]['checks']['single_subject_per_page'] = True
        f.manifest['quantity_plan'] = {'basis': 'single_subject', 'expected': count,
            'rationale': 'Synthetic one-object-per-page fixture, not actual visual QA.',
            'evidence_path': 'raw_generated/quantity-plan.md', 'subjects': subjects, 'pages': pages}
        f.save()
        return f

    def test_single_combined_cover_validates_and_commits_only_isolated_queue(self):
        f = self.plan(0)
        before = f.queue.read_bytes()
        self.assertEqual(b.w.validate(f.manifest_path)['total_images'], 1)
        b.w.commit(f.manifest_path)
        self.assertEqual(f.queue.read_bytes(), before)

    def test_two_total_images_validate(self):
        f = self.plan(1)
        self.assertEqual(b.w.validate(f.manifest_path)['total_images'], 2)

    def test_ten_schools_need_eleven_images(self):
        f = self.plan(10, '中国古代十大哲学流派')
        self.assertEqual(b.w.validate(f.manifest_path)['total_images'], 11)
        self.assertEqual(len(f.manifest['quantity_plan']['subjects']), 10)

    def test_out_of_range_and_noninteger_counts_are_rejected(self):
        f = self.plan()
        for count in (-1, 11, True, 2.5):
            f.manifest['content_pages'] = count
            with self.assertRaisesRegex(b.w.WorkflowError, '1–11 total'):
                b.validate_subject_quantity(f.manifest, f.project)

    def test_merging_two_subjects_into_a_page_is_rejected(self):
        f = self.plan()
        f.manifest['quantity_plan']['pages'][0]['covered_items'] = ['儒家', '墨家']
        with self.assertRaisesRegex(b.w.WorkflowError, 'exactly one subject'):
            b.validate_subject_quantity(f.manifest, f.project)

    def test_repeated_subjects_are_rejected(self):
        f = self.plan()
        f.manifest['quantity_plan']['subjects'][1] = '儒家'
        with self.assertRaisesRegex(b.w.WorkflowError, 'Subjects must be distinct'):
            b.validate_subject_quantity(f.manifest, f.project)

    def test_numbered_topic_cannot_drop_or_group_objects(self):
        f = self.plan(5, '中国古代十大哲学流派')
        with self.assertRaisesRegex(b.w.WorkflowError, 'promises 10 items'):
            b.validate_subject_quantity(f.manifest, f.project)

    def test_fake_source_excerpt_is_rejected(self):
        f = self.plan()
        f.manifest['quantity_plan']['pages'][0]['source_excerpt'] = '儒家：这是正文里并不存在的一段引用。'
        with self.assertRaisesRegex(b.w.WorkflowError, 'actual excerpt'):
            b.validate_subject_quantity(f.manifest, f.project)

    def test_actual_tool_prompt_must_bind_planned_subject(self):
        f = self.plan()
        generation = f.manifest['images'][1]['generation']
        generation['prompt'] = generation['prompt'].replace('本图唯一介绍对象：儒家', '本图唯一介绍对象：墨家')
        generation['actual_input']['prompt'] = generation['prompt']
        f.sync_evidence(1)
        f.save()
        with self.assertRaisesRegex(b.w.WorkflowError, 'bind exactly one planned subject'):
            b.w.validate(f.manifest_path)

    def test_actual_single_subject_visual_review_is_required(self):
        f = self.plan()
        del f.manifest['qa']['page_reviews'][1]['checks']['single_subject_per_page']
        f.save()
        with self.assertRaisesRegex(b.w.WorkflowError, 'single_subject_per_page'):
            b.w.validate(f.manifest_path)

    def test_original_image_count_validation_is_preserved(self):
        f = self.plan()
        f.manifest['images'].pop()
        f.save()
        with self.assertRaisesRegex(b.w.WorkflowError, 'Exactly N\\+1'):
            b.w.validate(f.manifest_path)


class CaptionReviewTests(unittest.TestCase):
    def reader_evidence(self):
        return {'question': 'Synthetic core question', 'takeaway': 'Synthetic reader takeaway',
                'opening_excerpt': self.paragraphs[0], 'answer_excerpt': self.paragraphs[2],
                'explanation': 'Synthetic progression, not real editorial QA.',
                'coverage': 'Fixture only: caption selects examples; full text and images cover the topic.',
                'reading_notes': 'Synthetic fixture, not a claimed real edit.',
                'checks': {key: True for key in b.CAPTION_QUALITY['readerChecks']}}

    def test_v2_requires_reading_evidence_even_without_independent_review(self):
        f = self.draft()
        b.configure_policies(caption_policy='reader-narrative-v2')
        with self.assertRaisesRegex(b.w.WorkflowError, 'reader_review'):
            b.w.validate(f.manifest_path)
        f.manifest['caption_review']['reader_review'] = self.reader_evidence()
        f.save()
        before = f.queue.read_bytes()
        self.assertEqual(b.w.validate(f.manifest_path)['caption_policy'], 'reader-narrative-v2')
        b.w.commit(f.manifest_path)
        self.assertEqual(f.queue.read_bytes(), before)

    def test_v2_rejects_fake_opening_answer_missing_notes_and_failed_reading_checks(self):
        f = self.draft()
        cases = [('opening_excerpt', self.paragraphs[1]), ('answer_excerpt', '不存在的正文'),
                 ('answer_excerpt', '#测试'), ('reading_notes', ''), ('coverage', ''),
                 ('checks', {key: False for key in b.CAPTION_QUALITY['readerChecks']})]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                evidence = self.reader_evidence()
                evidence[field] = value
                f.manifest['caption_review']['reader_review'] = evidence
                with self.assertRaises(b.w.WorkflowError):
                    b.validate_caption_review(f.manifest, f.project, 'reader-narrative-v2')

    def test_v1_does_not_require_v2_evidence_but_keeps_existing_checks(self):
        f = self.draft()
        self.assertNotIn('reader_review', f.manifest['caption_review'])
        self.assertEqual(b.w.validate(f.manifest_path)['caption_policy'], 'reader-analysis-v1')
        f.manifest['caption_review']['checks']['claims_grounded_and_qualified'] = False
        with self.assertRaisesRegex(b.w.WorkflowError, 'explicit sign-off'):
            b.validate_caption_review(f.manifest, f.project, 'reader-analysis-v1')

    def setUp(self):
        self.fixture = fixtures.WorkflowTests(methodName='runTest')
        self.fixture.setUp()
        b.configure_policies(caption_policy='reader-analysis-v1')

    def tearDown(self):
        b.configure_policies()
        self.fixture.tearDown()

    def draft(self):
        f = self.fixture
        f.make_run()
        self.paragraphs = [
            '测试段落甲：这里用明确事实说明观察现象与背后机制的关系，仅为结构夹具。',
            '测试段落乙：这里解释比较对象之间的区别，以及这一差异为何影响理解。',
            '测试段落丙：这里指出解释的适用条件和边界，避免把局部例子写成普遍结论。']
        caption = f.project / f.manifest['caption_path']
        tags = caption.read_text(encoding='utf-8').splitlines()[-1]
        caption.write_text('# 解读结构测试\n\n' + '\n\n'.join(self.paragraphs) + '\n\n' + tags, encoding='utf-8')
        full = f.project / f.manifest['full_text_path']
        full.write_text('\n'.join(self.paragraphs), encoding='utf-8')
        (f.project / 'raw_generated/caption-review.md').write_text('Synthetic review fixture, not real editorial QA.', encoding='utf-8')
        f.manifest['caption_review'] = {
            'caption_sha256': b.w.sha256(caption), 'full_text_sha256': b.w.sha256(full),
            'evidence_path': 'raw_generated/caption-review.md',
            'checks': {key: True for key in b.CAPTION_QUALITY['reviewChecks']},
            'insights': [{'caption_excerpt': text, 'full_text_excerpt': text,
                          'explanation': 'Synthetic structural assertion only.'} for text in self.paragraphs]}
        f.save()
        return f

    def test_valid_review_and_commit_leave_production_queue_unchanged(self):
        f = self.draft()
        before = f.queue.read_bytes()
        self.assertEqual(b.w.validate(f.manifest_path)['caption_policy'], 'reader-analysis-v1')
        b.w.commit(f.manifest_path)
        self.assertEqual(f.queue.read_bytes(), before)

    def test_missing_review_is_rejected_but_legacy_still_works(self):
        f = self.draft()
        del f.manifest['caption_review']
        f.save()
        with self.assertRaisesRegex(b.w.WorkflowError, 'caption_review'):
            b.w.validate(f.manifest_path)
        b.configure_policies()
        self.assertTrue(b.w.validate(f.manifest_path)['valid'])

    def test_changed_caption_or_full_text_invalidates_review(self):
        f = self.draft()
        for field in ('caption_path', 'full_text_path'):
            file = f.project / f.manifest[field]
            original = file.read_bytes()
            file.write_bytes(original + '\n修改了文稿'.encode())
            with self.assertRaisesRegex(b.w.WorkflowError, 'hashes do not match'):
                b.validate_caption_review(f.manifest, f.project)
            file.write_bytes(original)

    def test_fake_quotes_and_repeated_insights_are_rejected(self):
        f = self.draft()
        original = copy.deepcopy(f.manifest['caption_review'])
        for field in ('caption_excerpt', 'full_text_excerpt'):
            f.manifest['caption_review'] = copy.deepcopy(original)
            f.manifest['caption_review']['insights'][0][field] = '这是一段不存在于正文或者底稿中的虚假引用，不能用来证明解读质量。'
            with self.assertRaisesRegex(b.w.WorkflowError, 'actual .* excerpt'):
                b.validate_caption_review(f.manifest, f.project)
        f.manifest['caption_review'] = copy.deepcopy(original)
        f.manifest['caption_review']['insights'][1] = copy.deepcopy(original['insights'][0])
        with self.assertRaisesRegex(b.w.WorkflowError, 'must be distinct'):
            b.validate_caption_review(f.manifest, f.project)

    def test_incomplete_review_or_too_few_insights_is_rejected(self):
        f = self.draft()
        checks = f.manifest['caption_review']['checks']
        checks['explains_beyond_listing'] = False
        with self.assertRaisesRegex(b.w.WorkflowError, 'explicit sign-off'):
            b.validate_caption_review(f.manifest, f.project)
        checks['explains_beyond_listing'] = True
        f.manifest['caption_review']['insights'].pop()
        with self.assertRaisesRegex(b.w.WorkflowError, 'at least three'):
            b.validate_caption_review(f.manifest, f.project)

    def test_title_and_body_editorial_budgets(self):
        f = self.draft()
        file = f.project / f.manifest['caption_path']
        original = file.read_text(encoding='utf-8')
        for text, error in [('# ' + '题' * 21 + '\n正文', '20-character'),
                            ('# 标题\n\n' + '文' * 1001, '1000-character')]:
            file.write_text(text, encoding='utf-8')
            with self.assertRaisesRegex(b.w.WorkflowError, error):
                b.validate_caption_review(f.manifest, f.project)
        # No artificial minimum length: concise explanations can pass.
        file.write_text(original, encoding='utf-8')
        b.validate_caption_review(f.manifest, f.project)

    def test_title_and_tags_cannot_count_as_analysis(self):
        f = self.draft()
        file = f.project / f.manifest['caption_path']
        tag = '#' + '这是测试标签并非正文解释不能用来作为专业解读审查证据'
        file.write_text(file.read_text(encoding='utf-8') + '\n' + tag, encoding='utf-8')
        f.manifest['caption_review']['caption_sha256'] = b.w.sha256(file)
        f.manifest['caption_review']['insights'][0]['caption_excerpt'] = tag
        with self.assertRaisesRegex(b.w.WorkflowError, 'actual caption body excerpt'):
            b.validate_caption_review(f.manifest, f.project)

    def test_platform_limit_is_enforced_even_for_legacy_without_extra_review(self):
        f = self.draft()
        b.configure_policies(caption_policy='legacy')
        file = f.project / f.manifest['caption_path']
        tags = file.read_text(encoding='utf-8').splitlines()[-1]
        body = '😀' * (1000 - len(tags) - 1) + '\n' + tags
        file.write_text('# ' + '题' * 20 + '\n\n' + body, encoding='utf-8')
        self.assertEqual(b.w.validate(f.manifest_path)['caption_counts']['body'], 1000)
        file.write_text(file.read_text(encoding='utf-8') + '字', encoding='utf-8')
        with self.assertRaisesRegex(b.w.WorkflowError, '1000-character'):
            b.w.validate(f.manifest_path)

    def test_all_text_allows_normal_words_without_blacklist(self):
        f = self.draft()
        words = '首先、其次、再次、最后、总的来说、综上所述；再次统一，最后一位。'
        paths = [f.manifest['caption_path'], f.manifest['full_text_path'], 'raw_generated/caption-review.md']
        paths += [image['copy_path'] for image in f.manifest['images']]
        for name in paths:
            file = f.project / name
            file.write_text(file.read_text(encoding='utf-8') + '\n' + words, encoding='utf-8')
        # A real edit still requires updated review hashes; no other gate is relaxed.
        with self.assertRaisesRegex(b.w.WorkflowError, 'hashes do not match'):
            b.w.validate(f.manifest_path)
        f.manifest['caption_review']['caption_sha256'] = b.w.sha256(f.project / f.manifest['caption_path'])
        f.manifest['caption_review']['full_text_sha256'] = b.w.sha256(f.project / f.manifest['full_text_path'])
        f.save()
        self.assertTrue(b.w.validate(f.manifest_path)['valid'])
        b.configure_policies(caption_policy='legacy')
        self.assertTrue(b.w.validate(f.manifest_path)['valid'])



if __name__ == '__main__':
    unittest.main()
