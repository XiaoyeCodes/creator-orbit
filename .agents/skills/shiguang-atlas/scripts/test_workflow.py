"""Isolated structural tests. Synthetic pixels and mock records ARE NOT generation evidence.

Fixtures exist only inside TemporaryDirectory. No image API, production queue,
credentials, or publishing service is accessed by these tests.
"""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
import workflow as w


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="atlas-unit-fixture-")
        self.root = Path(self.tmp.name)
        self.queue = self.root / "topics.md"
        self.original = "# 队列\r\n\r\n| Status | Topic | Category |\r\n|-|-|-|\r\n| 已生成 | 旧主题 | 自然 |\r\n| TODO | 世界水果图鉴 | 食物 |\r\n| TODO | 下一主题 | 地理 |\r\n".encode()
        self.queue.write_bytes(self.original)

    def tearDown(self):
        self.tmp.cleanup()

    def make_run(self, test_mode=True, topic=None, count=4):
        if topic:
            self.original = self.original.replace("世界水果图鉴".encode(), topic.encode())
            self.queue.write_bytes(self.original)
        result = w.prepare(self.queue, self.root / "output", "2026-10-16", test_mode)
        self.manifest_path = Path(result["manifest"])
        self.project = self.manifest_path.parent.parent
        self.manifest = w.read_json(self.manifest_path)
        state = w.read_json(self.manifest_path.parent / ".prepare-state.json")
        self.manifest["content_pages"] = count
        self.manifest["quantity_plan"] = {
            "basis": "title_count" if w.title_count(self.manifest["topic"]) else "editorial_range",
            "expected": count, "rationale": "Synthetic structural test; not a factual publication plan.",
            "evidence_path": "raw_generated/quantity-plan.md"}
        for name in ("sources.md", "full_text.md", "quantity-plan.md", "qa-review.md"):
            (self.project / "raw_generated" / name).write_text("Synthetic isolated test fixture. Not user deliverables or genuine QA.", encoding="utf-8")
        tags = {"core": ["核心甲", "核心乙", "核心丙"], "related": ["相关甲", "相关乙", "相关丙", "相关丁", "相关戊"]}
        self.manifest["tags"] = tags
        (self.project / self.manifest["caption_path"]).write_text("测试正文\n" + " ".join("#" + t for t in tags["core"] + tags["related"]), encoding="utf-8")
        self.manifest["qa"] = {
            "reviewer": "UNIT_TEST_SYNTHETIC_REVIEWER", "reviewer_type": "agent",
            "reviewed_at": "2026-10-16T06:00:00+00:00", "evidence_path": "raw_generated/qa-review.md",
            "attestation": "Synthetic assertion for structural unit tests ONLY; not a real visual review.",
            "checks": {key: True for key in w.GLOBAL_CHECKS}, "page_reviews": []}
        reference = w.SKILL_ROOT / "assets/reference-images/fruit.jpg"
        for i in range(count + 1):
            filename = f"00_封面_{state['safe_topic']}.png" if i == 0 else f"{i:02d}_测试页.png"
            output = self.project / filename
            # Pixel fixtures only. The production helper never creates/edits images.
            Image.new("RGB", (1086, 1448), (i * 17, 100, 100)).save(output)
            image_hash = w.sha256(output)
            copy_path = f"raw_generated/page-copy/{i:02d}.md"
            (self.project / copy_path).write_text(f"第{i}页测试底文", encoding="utf-8")
            prompt = (state["prompt_prefix"] if i == 0 else state["prompt_header"]) + f"Synthetic fixture page {i}; never submit to generation."
            actual_input = {"prompt": prompt, "transparent_background": False}
            if i:
                actual_input["referenced_image_paths"] = [str(reference)]
            generation = {
                "tool": "image_gen.imagegen", "host_call_id": None, "host_call_id_status": "unavailable",
                "local_evidence_id": f"UNIT_TEST_SYNTHETIC_{i}", "called_at": "2026-10-16T05:59:00+00:00",
                "execution_observation": "No real tool call. Synthetic unit-test record to exercise structural validation.",
                "prompt": prompt, "actual_input": actual_input,
                "call_evidence_path": f"raw_generated/tool-calls/{i:02d}.json",
                "raw_output_path": filename, "raw_output_sha256": image_hash}
            item = {"index": i, "role": "cover" if i == 0 else "content", "path": filename,
                    "sha256": image_hash, "copy_path": copy_path, "generation": generation}
            if i:
                item["reference"] = {"record_id": "fruit", "path": "@skill/assets/reference-images/fruit.jpg", "sha256": w.sha256(reference)}
            self.manifest["images"].append(item)
            self.sync_evidence(i)
            page_checks = {key: True for key in w.PAGE_CHECKS if i or key != "reference_layout_preserved"}
            if not i:
                page_checks["original_cover_layout_reviewed"] = True
            review = {"index": i, "image_sha256": image_hash, "verdict": "pass",
                      "notes": "Synthetic unit-test review only; does not establish real visual inspection.", "checks": page_checks}
            if i:
                review.update(reference_record_id="fruit", reference_sha256=w.sha256(reference))
            self.manifest["qa"]["page_reviews"].append(review)
        self.save()
        return result

    def sync_evidence(self, i):
        item = self.manifest["images"][i]
        generation = item["generation"]
        record = {key: generation[key] for key in ("tool", "host_call_id", "host_call_id_status", "local_evidence_id", "called_at", "execution_observation")}
        if generation["called_at"] is None:
            for key in ("called_at_unavailable_reason", "observed_time_window"):
                if key in generation:
                    record[key] = generation[key]
        record.update(input=generation["actual_input"], raw_output_sha256=generation["raw_output_sha256"], reference_sha256=item.get("reference", {}).get("sha256"))
        w.write_json(self.project / generation["call_evidence_path"], record)

    def save(self):
        w.write_json(self.manifest_path, self.manifest)

    def rejected(self, match):
        self.save()
        before = self.queue.read_bytes()
        with self.assertRaisesRegex(w.WorkflowError, match):
            w.commit(self.manifest_path)
        self.assertEqual(before, self.queue.read_bytes())

    def test_valid_independent_cover_without_reference_or_edit_base(self):
        self.make_run()
        self.assertNotIn("reference", self.manifest["images"][0])
        self.assertNotIn("EDIT BASE", self.manifest["images"][0]["generation"]["prompt"])
        self.assertTrue(w.validate(self.manifest_path)["valid"])

    def test_test_commit_only_changes_isolated_copy(self):
        self.make_run()
        result = w.commit(self.manifest_path)
        self.assertFalse(result["production_queue_written"])
        self.assertEqual(self.queue.read_bytes(), self.original)
        target = Path(result["target_queue"])
        self.assertEqual(target.read_bytes(), self.original.replace("| TODO | 世界水果图鉴".encode(), "| 已生成 | 世界水果图鉴".encode()))
        self.assertFalse((self.queue.parent / ("." + self.queue.name + ".shiguang-state.json")).exists())
        with self.assertRaisesRegex(w.WorkflowError, "already been committed"):
            w.commit(self.manifest_path)

    def test_production_commit_changes_exactly_first_todo_preserves_crlf(self):
        self.make_run(test_mode=False)
        w.commit(self.manifest_path)
        self.assertEqual(self.queue.read_bytes(), self.original.replace("| TODO | 世界水果图鉴".encode(), "| 已生成 | 世界水果图鉴".encode()))

    def test_wrong_dimensions_rejected(self):
        self.make_run()
        Image.new("RGB", (1024, 1536)).save(self.project / self.manifest["images"][1]["path"])
        self.rejected("Wrong dimensions")

    def test_truncated_png_rejected(self):
        self.make_run()
        path = self.project / self.manifest["images"][1]["path"]
        data = path.read_bytes()
        path.write_bytes(data[:len(data) // 2])
        self.rejected("cannot be fully decoded")

    def test_non_png_disguised_as_png_rejected(self):
        self.make_run()
        Image.new("RGB", (1086, 1448)).save(self.project / self.manifest["images"][1]["path"], format="JPEG")
        self.rejected("not an actual PNG")

    def test_missing_reference_rejected(self):
        self.make_run()
        del self.manifest["images"][1]["reference"]
        self.rejected("Missing reference")

    def test_unattached_reference_rejected(self):
        self.make_run()
        self.manifest["images"][1]["generation"]["actual_input"].pop("referenced_image_paths")
        self.rejected("explicitly attach")

    def test_unknown_reference_not_allowed_even_with_matching_hash(self):
        self.make_run()
        spoof = self.project / "raw_generated/spoof.png"
        Image.new("RGB", (123, 345)).save(spoof)
        item = self.manifest["images"][1]
        item["reference"].update(path="raw_generated/spoof.png", sha256=w.sha256(spoof))
        item["generation"]["actual_input"]["referenced_image_paths"] = [str(spoof)]
        self.sync_evidence(1)
        self.rejected("not one of the seven")

    def test_reference_copy_allowed_by_checksum(self):
        self.make_run()
        original = w.SKILL_ROOT / "assets/reference-images/fruit.jpg"
        copied = self.project / "raw_generated/copied-reference.jpg"
        copied.write_bytes(original.read_bytes())
        for i in range(1, 5):
            self.manifest["images"][i]["reference"]["path"] = "raw_generated/copied-reference.jpg"
            self.manifest["images"][i]["generation"]["actual_input"]["referenced_image_paths"] = [str(copied)]
            self.sync_evidence(i)
        self.save()
        self.assertTrue(w.validate(self.manifest_path)["valid"])

    def test_prompt_header_accepts_crlf_and_mixed_newlines_without_rewriting_evidence(self):
        self.make_run()
        for i, item in enumerate(self.manifest['images']):
            generation = item['generation']
            prompt = generation['prompt'].replace('\n', '\r\n')
            if i == 0:
                prompt = prompt.replace('no blurring\r\n', 'no blurring\n')
            generation['prompt'] = generation['actual_input']['prompt'] = prompt
            self.sync_evidence(i)
        self.save()
        files = [self.manifest_path] + [self.project / item['generation']['call_evidence_path'] for item in self.manifest['images']]
        before = {file: file.read_bytes() for file in files}
        self.assertTrue(w.validate(self.manifest_path)['valid'])
        self.assertEqual(before, {file: file.read_bytes() for file in files})

    def test_crlf_header_still_rejects_changed_wording_and_cover_edit_base(self):
        self.make_run()
        generation = self.manifest['images'][0]['generation']
        original = generation['prompt'].replace('\n', '\r\n')
        generation['prompt'] = generation['actual_input']['prompt'] = original.replace('1086x1448', '1086x1449')
        self.sync_evidence(0)
        self.rejected('exact required prefix')
        state = w.read_json(self.project / 'raw_generated/.prepare-state.json')
        generation['prompt'] = generation['actual_input']['prompt'] = state['prompt_header'].replace('\n', '\r\n') + 'Synthetic cover content'
        self.sync_evidence(0)
        self.rejected('Independent cover must not include')

    def test_crlf_normalization_does_not_relax_actual_tool_evidence_equality(self):
        self.make_run()
        generation = self.manifest['images'][0]['generation']
        original = generation['prompt']
        generation['prompt'] = original.replace('\n', '\r\n')
        self.rejected('actual_input.prompt differs')
        generation['actual_input']['prompt'] = generation['prompt']
        # Saved call evidence still has the actual old LF input: do not silently normalize it.
        self.rejected('saved call evidence does not match')

    def test_exact_prompt_prefix_enforced(self):
        self.make_run()
        self.manifest["images"][1]["generation"]["prompt"] = "3:4 approx\n" + self.manifest["images"][1]["generation"]["prompt"]
        self.rejected("exact required prefix")

    def test_cover_edit_base_rejected(self):
        self.make_run()
        state = w.read_json(self.manifest_path.parent / ".prepare-state.json")
        self.manifest["images"][0]["generation"]["prompt"] = state["prompt_header"] + "Cover"
        self.rejected("Independent cover must not include")

    def test_insufficient_tags_rejected(self):
        self.make_run()
        self.manifest["tags"]["related"] = ["甲"]
        self.rejected("5 and 10")

    def test_normal_words_are_allowed_in_all_text_fields(self):
        self.make_run()
        words = "首先、其次、再次、最后、总的来说、综上所述。再次统一，最后一位。"
        fields = [self.manifest["caption_path"], self.manifest["full_text_path"]]
        fields += [image["copy_path"] for image in self.manifest["images"]]
        for name in fields:
            file = self.project / name
            file.write_text(file.read_text(encoding="utf-8") + "\n" + words, encoding="utf-8")
        self.save()
        self.assertTrue(w.validate(self.manifest_path)["valid"])

    def test_false_qa_rejected(self):
        self.make_run()
        self.manifest["qa"]["checks"]["actual_tool_inputs_inspected"] = False
        self.rejected("explicit human/agent sign-off")

    def test_no_default_qa_in_prepare(self):
        result = w.prepare(self.queue, self.root / "unfilled", "2026-10-16", True)
        manifest = w.read_json(result["manifest"])
        self.assertFalse(any(manifest["qa"]["checks"].values()))
        self.assertEqual(manifest["images"], [])
        self.assertIsNone(manifest["content_pages"])

    def test_stale_page_qa_rejected(self):
        self.make_run()
        self.manifest["qa"]["page_reviews"][1]["image_sha256"] = "0" * 64
        self.rejected("QA sign-off is stale")

    def test_production_queue_conflict_leaves_changed_queue_unchanged(self):
        self.make_run(test_mode=False)
        self.queue.write_bytes(self.original + b"\nExternal edit\n")
        self.rejected("Queue conflict")

    def test_test_queue_conflict_leaves_both_unchanged(self):
        self.make_run()
        target = self.manifest_path.parent / "queue.test.md"
        target.write_bytes(target.read_bytes() + b"\nChanged test copy\n")
        before = target.read_bytes()
        self.rejected("Queue conflict")
        self.assertEqual(target.read_bytes(), before)

    def test_unrelated_production_change_does_not_block_test_copy(self):
        self.make_run()
        self.queue.write_bytes(self.original + b"\nExternal edit\n")
        before = self.queue.read_bytes()
        result = w.commit(self.manifest_path)
        self.assertFalse(result["production_source_matches_snapshot"])
        self.assertEqual(self.queue.read_bytes(), before)

    def test_test_symlink_to_source_is_rejected(self):
        self.make_run()
        target = self.manifest_path.parent / "queue.test.md"
        target.unlink()
        try:
            target.symlink_to(self.queue)
        except OSError as exc:
            if getattr(exc, "winerror", None) == 1314:
                self.skipTest("Windows account lacks symbolic-link privilege; production rejection remains unchanged")
            raise
        self.rejected("missing or is a symlink")

    def test_resume_after_queue_replace_before_receipt(self):
        self.make_run(test_mode=False)
        with patch.object(w, "atomic_json", side_effect=SystemExit("Simulated interruption after queue replacement")):
            with self.assertRaises(SystemExit):
                w.commit(self.manifest_path)
        expected = self.original.replace("| TODO | 世界水果图鉴".encode(), "| 已生成 | 世界水果图鉴".encode())
        self.assertEqual(self.queue.read_bytes(), expected)
        self.assertFalse((self.manifest_path.parent / "commit-receipt.json").exists())
        resumed = w.prepare(self.queue, self.root / "somewhere-else", "2026-10-17", False)
        self.assertEqual(resumed["manifest"], str(self.manifest_path))
        with patch.object(w.os, "replace", wraps=w.os.replace) as replace:
            result = w.commit(self.manifest_path)
            self.assertTrue(result["recovered_completed_queue_update"])
            self.assertFalse(any(Path(call.args[1]) == self.queue for call in replace.call_args_list))
        self.assertEqual(self.queue.read_bytes(), expected)
        self.assertTrue((self.manifest_path.parent / "commit-receipt.json").is_file())

    def test_failed_atomic_replace_preserves_queue(self):
        self.make_run(test_mode=False)
        with patch.object(w.os, "replace", side_effect=OSError("Simulated replace failure")):
            with self.assertRaisesRegex(OSError, "Simulated"):
                w.commit(self.manifest_path)
        self.assertEqual(self.queue.read_bytes(), self.original)
        self.assertFalse(self.queue.with_name(self.queue.name + ".shiguang.lock").exists())
        self.assertEqual(list(self.queue.parent.glob(".topics.md.*.tmp")), [])

    def test_prepare_resumes_across_output_root_date_and_slot(self):
        first = w.prepare(self.queue, self.root / "a", "2026-10-16", False, slot="slot-1")
        second = w.prepare(self.queue, self.root / "b", "2026-10-17", False, slot="slot-2")
        self.assertEqual(first["manifest"], second["manifest"])
        self.assertTrue(second["resumed"])
        self.assertEqual(second["slot"], "slot-1")
        self.assertFalse((self.root / "b").exists())

    def test_explicit_title_quantity_enforced(self):
        self.make_run(topic="十大测试主题", count=4)
        self.rejected("requires 10 content pages")

    def test_ordinary_topic_four_to_eight_pages(self):
        self.make_run(count=1)
        self.rejected("4–8 content pages")

    def test_chinese_title_numbers(self):
        for title, expected in (("世界十大奇迹", 10), ("中国六大古都", 6), ("八大菜系", 8), ("文艺复兴三杰", 3), ("二十四节气", 24), ("十二生肖", 12), ("10种水果", 10)):
            self.assertEqual(w.title_count(title), expected)
        self.assertIsNone(w.title_count("世界水果图鉴"))

    def test_queue_bom_and_escaped_pipe(self):
        queue = b"\xef\xbb\xbf" + "| Status | Topic | Category |\n|-|-|-|\n| TODO | A \\| B | 科普 |\n".encode()
        selected = w.first_todo(queue)
        self.assertEqual(selected["topic"], "A | B")
        self.assertEqual(w.changed_queue(queue, selected), queue.replace(b"TODO", "已生成".encode()))

    def test_test_mode_prepare_does_not_touch_source_directory(self):
        before = {p.name for p in self.queue.parent.iterdir()}
        w.prepare(self.queue, self.root / "test-only", "2026-10-16", True)
        after = {p.name for p in self.queue.parent.iterdir()}
        self.assertEqual(after - before, {"test-only"})
        self.assertEqual(self.queue.read_bytes(), self.original)

    def test_host_missing_id_is_honest_and_valid(self):
        self.make_run()
        self.assertTrue(w.validate(self.manifest_path)["valid"])
        self.manifest["images"][1]["generation"]["host_call_id"] = "fabricated"
        self.rejected("never invent one")

    def set_observed_time_window(self):
        self.make_run()
        generation = self.manifest["images"][1]["generation"]
        generation.update(called_at=None, called_at_unavailable_reason="The synthetic host record exposes no exact timestamp; test transcript bounds only.",
                          observed_time_window={"start": "2026-10-16T05:58:00+00:00", "end": "2026-10-16T06:00:00+00:00"})
        self.sync_evidence(1)
        return generation

    def test_missing_exact_time_with_real_window_is_supported(self):
        self.set_observed_time_window()
        self.save()
        self.assertTrue(w.validate(self.manifest_path)["valid"])

    def test_missing_time_without_window_rejected(self):
        generation = self.set_observed_time_window()
        generation.pop("observed_time_window")
        self.sync_evidence(1)
        self.rejected("needs an observed_time_window")

    def test_missing_time_without_reason_rejected(self):
        generation = self.set_observed_time_window()
        generation.pop("called_at_unavailable_reason")
        self.sync_evidence(1)
        self.rejected("called_at_unavailable_reason")

    def test_reversed_observed_window_rejected(self):
        generation = self.set_observed_time_window()
        generation["observed_time_window"].update(start="2026-10-16T07:00:00Z", end="2026-10-16T06:00:00Z")
        self.sync_evidence(1)
        self.rejected("start must not follow end")

    def test_observed_window_without_timezone_rejected(self):
        generation = self.set_observed_time_window()
        generation["observed_time_window"]["start"] = "2026-10-16T05:58:00"
        self.sync_evidence(1)
        self.rejected("must include timezone")

    def test_observed_window_must_match_call_evidence(self):
        generation = self.set_observed_time_window()
        generation["observed_time_window"]["start"] = "2026-10-16T05:57:00Z"
        self.rejected("saved call evidence does not match")

    def test_cli_validation_failure_nonzero(self):
        result = w.prepare(self.queue, self.root / "unfilled", "2026-10-16", True)
        with contextlib.redirect_stderr(io.StringIO()) as errors:
            code = w.main(["validate", "--manifest", result["manifest"]])
        self.assertEqual(code, 1)
        self.assertIn("content_pages", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
