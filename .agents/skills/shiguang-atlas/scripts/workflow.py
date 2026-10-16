#!/usr/bin/env python3
"""Deterministic prepare/validate/commit helper. Never generates or edits an image.

Python 3.10+; validation requires Pillow. JSON records are not authenticated tool
telemetry. A named human/agent must inspect the actual calls, references and images.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unicodedata

SKILL_ROOT = Path(__file__).resolve().parent.parent
BANNED = ("首先", "其次", "再次", "最后", "总的来说", "综上所述")
GLOBAL_CHECKS = (
    "all_images_visually_reviewed", "each_reference_attachment_verified",
    "actual_tool_inputs_inspected", "sources_checked", "full_text_complete",
    "caption_and_tags_checked", "no_postprocessing_or_external_image_api", "quantity_plan_reviewed",
)
PAGE_CHECKS = ("chinese_text_legible", "reference_layout_preserved", "facts_checked", "no_unwanted_artifacts")
BOUNDARY = (
    "Structural checks cannot prove that a tool was really called, that a reference "
    "was actually attached, that text matches pixels, or that visual/factual quality "
    "is correct. The named human/agent sign-off must come from actual inspection; "
    "never fabricate call records or set QA true automatically."
)


class WorkflowError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise WorkflowError(message)


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise WorkflowError(f"Cannot read JSON {path}: {exc}") from exc
    require(isinstance(value, dict), f"JSON root must be an object: {path}")
    return value


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def nonempty(value, name):
    require(isinstance(value, str) and bool(value.strip()), f"{name} must be a nonempty string")
    return value


def local_file(project, value, name):
    nonempty(value, name)
    path = Path(value)
    require(not path.is_absolute(), f"{name} must be relative to the project directory")
    resolved = (project / path).resolve()
    require(resolved.is_relative_to(project.resolve()), f"{name} escapes the project directory")
    require(resolved.is_file(), f"Missing {name}: {resolved}")
    return resolved


def reference_file(project, value):
    nonempty(value, "reference.path")
    if value.startswith("@skill/"):
        result = (SKILL_ROOT / value[len("@skill/"):]).resolve()
        require(result.is_relative_to(SKILL_ROOT), "@skill reference escapes the skill directory")
    else:
        result = Path(value)
        if not result.is_absolute():
            result = project / result
        result = result.resolve()
    require(result.is_file(), f"Reference does not exist: {result}")
    return result


def text_file(project, value, name, scan=False):
    path = local_file(project, value, name)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise WorkflowError(f"Cannot read UTF-8 text {path}: {exc}") from exc
    require(bool(text.strip()), f"{name} is empty")
    if scan:
        found = [word for word in BANNED if word in text]
        require(not found, f"Forbidden copy wording in {name}: {', '.join(found)}")
    return path, text


def cells_with_spans(line):
    """Split an ordinary Markdown table row, preserving exact cell offsets.

    Backslash-escaped pipes are supported. Unescaped literal pipes inside a cell
    (including code spans) are deliberately rejected by the column-count check.
    """
    raw = line.rstrip("\r\n")
    separators = []
    for pos, char in enumerate(raw):
        if char != "|":
            continue
        backslashes = 0
        cursor = pos - 1
        while cursor >= 0 and raw[cursor] == "\\":
            backslashes += 1
            cursor -= 1
        if backslashes % 2 == 0:
            separators.append(pos)
    if not separators:
        return []
    bounds = [-1] + separators + [len(raw)]
    spans = [(bounds[i] + 1, bounds[i + 1]) for i in range(len(bounds) - 1)]
    if raw[:separators[0]].strip() == "":
        spans = spans[1:]
    if raw[separators[-1] + 1:].strip() == "":
        spans = spans[:-1]
    return [(raw[start:end].strip().replace("\\|", "|"), start, end) for start, end in spans]


def first_todo(data):
    try:
        text = data.decode("utf-8-sig")
    except UnicodeError as exc:
        raise WorkflowError("Queue must be UTF-8 Markdown") from exc
    lines = text.splitlines(keepends=True)
    in_table = False
    headers = None
    saw_header = False
    for index, line in enumerate(lines):
        cells = cells_with_spans(line)
        values = [cell[0].casefold() for cell in cells]
        if not in_table:
            if all(name in values for name in ("status", "topic", "category")):
                require(len(values) == len(set(values)), "Duplicate queue table headers")
                require(index + 1 < len(lines), "Queue header lacks a separator row")
                separator = cells_with_spans(lines[index + 1])
                require(len(separator) == len(cells) and all(re.fullmatch(r":?-+:?", c[0]) for c in separator),
                        "Queue needs a valid Markdown separator row")
                headers = {name: values.index(name) for name in ("status", "topic", "category")}
                header_count = len(cells)
                separator_index = index + 1
                in_table = True
                saw_header = True
            continue
        if index == separator_index:
            continue
        if not cells:
            in_table = False
            continue
        require(len(cells) == header_count, f"Queue row {index + 1} has an unexpected column count; escape literal pipes")
        if cells[headers["status"]][0].upper() == "TODO":
            topic = nonempty(cells[headers["topic"]][0], "Queue topic")
            category = nonempty(cells[headers["category"]][0], "Queue category")
            return {"line_index": index, "status_column": headers["status"], "topic": topic, "category": category}
    require(saw_header, "Queue needs a Markdown table with Status, Topic and Category headers")
    raise WorkflowError("No TODO row remains in the queue")


def changed_queue(data, selected):
    current = first_todo(data)
    require(current == selected, "The selected first TODO changed; prepare a new project")
    bom = data.startswith(b"\xef\xbb\xbf")
    text = data.decode("utf-8-sig")
    lines = text.splitlines(keepends=True)
    index = selected["line_index"]
    line = lines[index]
    value, start, end = cells_with_spans(line)[selected["status_column"]]
    require(value.upper() == "TODO", "Selected queue cell is no longer TODO")
    segment = line[start:end]
    leading = len(segment) - len(segment.lstrip())
    trailing = len(segment) - len(segment.rstrip())
    lines[index] = line[:start + leading] + "已生成" + line[end - trailing:]
    result = "".join(lines).encode("utf-8")
    return (b"\xef\xbb\xbf" if bom else b"") + result


def safe_topic(topic):
    cleaned = unicodedata.normalize("NFC", topic)
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', "_", cleaned).strip(" .")
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned:
        cleaned = "topic-" + digest(topic.encode("utf-8"))[:10]
    if re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", cleaned):
        cleaned = "_" + cleaned
    if len(cleaned.encode("utf-8")) > 180:
        cleaned = cleaned.encode("utf-8")[:160].decode("utf-8", errors="ignore") + "-" + digest(topic.encode("utf-8"))[:10]
    return cleaned


def _prepare_once(queue, output_root, day=None, test_mode=False, prefix_file=None, edit_base_file=None, run_meta=None):
    queue = Path(queue).resolve()
    require(queue.is_file(), f"Queue not found: {queue}")
    source = queue.read_bytes()
    selected = first_todo(source)
    date = dt.date.fromisoformat(day) if day else dt.datetime.now(dt.timezone(dt.timedelta(hours=8), "Asia/Shanghai")).date()
    root = Path(output_root).resolve()
    if test_mode:
        root = root / "_test_runs"
    date_root = root / f"Published-{date.year}-{date.month}-{date.day}"
    project = date_root / safe_topic(selected["topic"])
    require(not project.exists(), f"Project already exists; choose another output root: {project}")
    prefix_path = Path(prefix_file) if prefix_file else SKILL_ROOT / "references/prompt-prefix.txt"
    edit_path = Path(edit_base_file) if edit_base_file else SKILL_ROOT / "references/edit-base-line.txt"
    prefix = prefix_path.read_text(encoding="utf-8").rstrip("\r\n")
    edit = edit_path.read_text(encoding="utf-8").rstrip("\r\n")
    require(len(prefix.splitlines()) == 3 and bool(edit.strip()) and len(edit.splitlines()) == 1,
            "Expected exactly three prefix lines and one EDIT BASE line")
    require("EDIT BASE" in edit, "EDIT BASE line must identify the reference as EDIT BASE")
    canonical_prefix = (SKILL_ROOT / "references/prompt-prefix.txt").read_text(encoding="utf-8").rstrip("\r\n")
    canonical_edit = (SKILL_ROOT / "references/edit-base-line.txt").read_text(encoding="utf-8").rstrip("\r\n")
    require(prefix == canonical_prefix and edit == canonical_edit, "Alternate prefix files must preserve the exact canonical user wording")
    header = prefix + "\n" + edit + "\n"
    date_root.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".prepare-", dir=date_root))
    try:
        raw = staging / "raw_generated"
        (raw / "tool-calls").mkdir(parents=True)
        (raw / "page-copy").mkdir()
        (raw / "queue.snapshot.md").write_bytes(source)
        if test_mode:
            (raw / "queue.test.md").write_bytes(source)
        state = {
            "schema_version": 1, "mode": "test" if test_mode else "production",
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "source_queue": str(queue), "source_snapshot_sha256": digest(source),
            "target_initial_sha256": digest(source), "expected_after_sha256": digest(changed_queue(source, selected)), "selected": selected,
            "prompt_prefix": prefix + "\n", "prompt_header": header, "safe_topic": project.name,
        }
        state.update(run_meta or {})
        write_json(raw / ".prepare-state.json", state)
        manifest = {
            "schema_version": 1, "topic": selected["topic"], "category": selected["category"],
            "content_pages": None,
            "quantity_plan": {"basis": "title_count" if title_count(selected["topic"]) is not None else "editorial_range",
                              "expected": title_count(selected["topic"]), "rationale": "",
                              "evidence_path": "raw_generated/quantity-plan.md"},
            "caption_path": f"{project.name}_小红书文案.md",
            "sources_path": "raw_generated/sources.md",
            "full_text_path": "raw_generated/full_text.md",
            "tags": {"core": [], "related": []}, "images": [],
            "qa": {
                "reviewer": "", "reviewer_type": "", "reviewed_at": "",
                "evidence_path": "raw_generated/qa-review.md", "attestation": "",
                "checks": {check: False for check in GLOBAL_CHECKS}, "page_reviews": [],
            },
        }
        write_json(raw / "manifest.json", manifest)
        (raw / "required-prompt-header.txt").write_text(header, encoding="utf-8")
        (raw / "required-cover-prompt-prefix.txt").write_text(prefix + "\n", encoding="utf-8")
        (raw / "VALIDATION-BOUNDARY.txt").write_text(BOUNDARY + "\n", encoding="utf-8")
        for filename in ("sources.md", "full_text.md", "qa-review.md", "quantity-plan.md"):
            (raw / filename).touch()
        staging.rename(project)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return {"project": str(project), "manifest": str(project / "raw_generated/manifest.json"),
            "mode": state["mode"], "topic": selected["topic"], "category": selected["category"],
            "source_snapshot_sha256": state["source_snapshot_sha256"]}



def title_count(topic):
    """Recognize explicit common list cardinalities; semantic sets need review."""
    match = re.search(r"([一二三四五六七八九十百两〇零0-9]+)(?:大|杰|种|款|类|位|座|个|处|项|生肖|节气)", topic)
    if not match:
        return None
    token = match.group(1)
    if token.isdigit():
        return int(token)
    digits = {c: i for i, c in enumerate("零一二三四五六七八九")}
    digits.update({"两": 2, "〇": 0})
    total = current = 0
    for char in token:
        if char in digits:
            current = digits[char]
        elif char in ("十", "百"):
            total += (current or 1) * (10 if char == "十" else 100)
            current = 0
        else:
            return None
    result = total + current
    return result if result > 0 else None


def atomic_json(path, value):
    fd, filename = tempfile.mkstemp(prefix="." + path.name, suffix=".tmp", dir=path.parent)
    tmp = Path(filename)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def registry_for(queue, output_root=None, test_mode=False):
    if test_mode:
        root = Path(output_root).resolve() / "_test_runs"
        root.mkdir(parents=True, exist_ok=True)
        return root / (".shiguang-state-" + digest(str(queue).encode())[:16] + ".json")
    return queue.with_name("." + queue.name + ".shiguang-state.json")


def prepare(queue, output_root, day=None, test_mode=False, prefix_file=None, edit_base_file=None, slot=None):
    queue = Path(queue).resolve()
    require(queue.is_file(), f"Queue not found: {queue}")
    registry = registry_for(queue, output_root, test_mode)
    lock = registry.with_suffix(".lock") if test_mode else queue.with_name(queue.name + ".shiguang.lock")
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise WorkflowError(f"Prepare/commit lock exists: {lock}; inspect the active run before retrying") from exc
    try:
        os.write(fd, f"pid={os.getpid()}\noperation=prepare\n".encode())
        prior = read_json(registry) if registry.exists() else None
        if prior and prior.get("status") in ("in_progress", "prepared", "validated"):
            manifest_path = Path(prior["manifest"])
            receipt = manifest_path.parent / "commit-receipt.json"
            if receipt.is_file() and read_json(receipt).get("committed") is True:
                prior["status"] = "committed"
                atomic_json(registry, prior)
            else:
                require(manifest_path.is_file(), f"Active run is missing its manifest: {manifest_path}; recover that run before preparing again")
                if not test_mode:
                    prepared = read_json(manifest_path.parent / ".prepare-state.json")
                    snapshot = (manifest_path.parent / "queue.snapshot.md").read_bytes()
                    expected_after = digest(changed_queue(snapshot, prepared["selected"]))
                    require(sha256(queue) in (prior["source_snapshot_sha256"], expected_after), f"Active run has a queue conflict. Preserve and inspect {manifest_path}; no new run was started")
                return {"project": str(manifest_path.parent.parent), "manifest": str(manifest_path),
                        "mode": "test" if test_mode else "production", "resumed": True,
                        "content_id": prior["content_id"], "revision": prior["revision"],
                        "status": prior["status"], "slot": prior["slot"],
                        "topic": prior["topic"], "category": prior["category"]}
        if slot and prior and prior.get("slot") == slot and prior.get("status") == "committed":
            return {"already_committed": True, "manifest": prior["manifest"], "slot": slot,
                    "content_id": prior["content_id"], "status": "committed"}
        selected = first_todo(queue.read_bytes())
        content_id = "atlas-" + digest((str(queue) + "\n" + selected["topic"] + "\n" + selected["category"]).encode())[:20]
        revision = (prior.get("revision", 0) + 1) if prior and prior.get("content_id") == content_id else 1
        run_meta = {"content_id": content_id, "revision": revision, "status": "in_progress",
                    "slot": slot or f"manual:{content_id}:r{revision}"}
        publication_date = dt.date.fromisoformat(day) if day else dt.datetime.now(dt.timezone(dt.timedelta(hours=8), "Asia/Shanghai")).date()
        run_root = Path(output_root).resolve() / "_test_runs" if test_mode else Path(output_root).resolve()
        candidate = run_root / f"Published-{publication_date.year}-{publication_date.month}-{publication_date.day}" / safe_topic(selected["topic"])
        existing_manifest = candidate / "raw_generated/manifest.json"
        if not prior and existing_manifest.is_file():
            _, _, existing_state, _ = load_run(existing_manifest)
            require(existing_state["source_queue"] == str(queue) and existing_state["source_snapshot_sha256"] == sha256(queue)
                    and existing_state["mode"] == ("test" if test_mode else "production"), "Existing project does not match this queue; do not overwrite it")
            existing_state.update(run_meta)
            atomic_json(candidate / "raw_generated/.prepare-state.json", existing_state)
            result = {"project": str(candidate), "manifest": str(existing_manifest), "mode": existing_state["mode"],
                      "source_snapshot_sha256": existing_state["source_snapshot_sha256"], "topic": selected["topic"],
                      "category": selected["category"], "resumed": True}
        else:
            result = _prepare_once(queue, output_root, day, test_mode, prefix_file, edit_base_file, run_meta)
        record = dict(result, **run_meta)
        atomic_json(registry, record)
        return record
    finally:
        os.close(fd)
        lock.unlink(missing_ok=True)


def load_run(manifest_path):
    path = Path(manifest_path).resolve()
    require(path.parent.name == "raw_generated", "Manifest must be inside project/raw_generated")
    state = read_json(path.parent / ".prepare-state.json")
    manifest = read_json(path)
    require(state.get("schema_version") == 1 and manifest.get("schema_version") == 1, "Unsupported schema version")
    require(state.get("mode") in ("test", "production"), "Invalid prepared run mode")
    project = path.parent.parent
    snapshot = path.parent / "queue.snapshot.md"
    require(snapshot.is_file() and sha256(snapshot) == state.get("source_snapshot_sha256"), "Prepared queue snapshot changed or is missing")
    require(first_todo(snapshot.read_bytes()) == state.get("selected"), "Prepared queue selection does not match its snapshot")
    require(state.get("target_initial_sha256") == state.get("source_snapshot_sha256"), "Initial queue hash mismatch")
    expected_after = digest(changed_queue(snapshot.read_bytes(), state["selected"]))
    state.setdefault("expected_after_sha256", expected_after)
    require(state["expected_after_sha256"] == expected_after, "Prepared expected post-commit queue hash does not match its snapshot")
    require(state.get("safe_topic") == project.name, "Project directory differs from its prepared state")
    for name in ("topic", "category"):
        require(manifest.get(name) == state["selected"][name], f"Manifest {name} differs from the prepared queue row")
    canonical_prefix = (SKILL_ROOT / "references/prompt-prefix.txt").read_text(encoding="utf-8").rstrip("\r\n") + "\n"
    canonical_edit = (SKILL_ROOT / "references/edit-base-line.txt").read_text(encoding="utf-8").rstrip("\r\n") + "\n"
    require(state.get("prompt_prefix") == canonical_prefix and state.get("prompt_header") == canonical_prefix + canonical_edit,
            "Prepared prompt header differs from the exact canonical user wording")
    return path, project, state, manifest


def inspect_image(path, require_output=False):
    try:
        from PIL import Image, ImageFile
    except ImportError as exc:
        raise WorkflowError("Validation requires Pillow: python -m pip install Pillow (official PyPI package)") from exc
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    try:
        with Image.open(path) as img:
            if require_output:
                require(img.format == "PNG", f"Output is not an actual PNG: {path}")
                require(img.size == (1086, 1448), f"Wrong dimensions {img.size}; expected 1086x1448: {path}")
                require(getattr(img, "n_frames", 1) == 1, f"Animated output is not allowed: {path}")
            img.verify()
        # verify() checks file structure; reopening + load() also decodes pixels.
        with Image.open(path) as img:
            img.load()
    except WorkflowError:
        raise
    except Exception as exc:
        raise WorkflowError(f"Image cannot be fully decoded: {path}: {exc}") from exc


def validate(manifest_path):
    path, project, state, manifest = load_run(manifest_path)
    n = manifest.get("content_pages")
    require(type(n) is int and n >= 1, "content_pages must be the agent-planned positive integer N")
    plan = manifest.get("quantity_plan")
    require(isinstance(plan, dict), "An explicit quantity_plan is required")
    require(type(plan.get("expected")) is int and plan["expected"] == n, "quantity_plan.expected must equal content_pages")
    nonempty(plan.get("rationale"), "quantity_plan.rationale")
    text_file(project, plan.get("evidence_path"), "quantity_plan.evidence_path")
    explicit_count = title_count(manifest["topic"])
    if explicit_count is not None:
        require(plan.get("basis") == "title_count" and n == explicit_count,
                f"Title explicitly requires {explicit_count} content pages; do not add fillers or omit members")
    elif plan.get("basis") == "natural_set":
        # A semantic set cannot be established from text shape. Require source
        # evidence and explicit quantity-plan QA; do not claim machine proof.
        pass
    else:
        require(plan.get("basis") == "editorial_range" and 4 <= n <= 8,
                "A topic without a verified natural set requires 4–8 content pages")
    catalog_path = SKILL_ROOT / "assets/reference-images/checksums.json"
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise WorkflowError(f"Cannot read the bundled reference checksum catalog: {exc}") from exc
    require(isinstance(catalog, list) and len(catalog) == 7, "Expected the bundled seven-reference checksum catalog")
    allowed_reference_hashes = {entry["sha256"] for entry in catalog}
    require(len(allowed_reference_hashes) == 7, "Reference catalog must identify seven distinct images")
    images = manifest.get("images")
    require(isinstance(images, list) and len(images) == n + 1, "Exactly N+1 images (one cover, then N content pages) are required")
    caption_path, caption = text_file(project, manifest.get("caption_path"), "caption_path", scan=True)
    require(caption_path.parent == project and caption_path.name == f'{state["safe_topic"]}_小红书文案.md',
            "Caption must be <safe topic>_小红书文案.md at the project root")
    text_file(project, manifest.get("sources_path"), "sources_path")
    text_file(project, manifest.get("full_text_path"), "full_text_path", scan=True)
    tags = manifest.get("tags")
    require(isinstance(tags, dict), "tags must be an object")
    core, related = tags.get("core"), tags.get("related")
    require(isinstance(core, list) and len(core) == 3, "Exactly 3 core tags are required")
    require(isinstance(related, list) and 5 <= len(related) <= 10, "Between 5 and 10 related tags are required")
    normalized = []
    for tag in core + related:
        nonempty(tag, "tag")
        value = tag.removeprefix("#")
        require(bool(value) and not re.search(r"\s|#", value), f"Invalid tag: {tag!r}")
        normalized.append(value.casefold())
        require("#" + value in caption, f"Caption is missing tag #{value}")
    require(len(normalized) == len(set(normalized)), "All core and related tags must be distinct")
    hashes = []
    seen_paths = set()
    reference_records = {}
    call_ids = set()
    host_call_ids = set()
    for i, item in enumerate(images):
        require(isinstance(item, dict), f"images[{i}] must be an object")
        require(type(item.get("index")) is int and item["index"] == i, f"Images must be in order starting at cover index 0 (entry {i})")
        require(item.get("role") == ("cover" if i == 0 else "content"), f"Wrong role for image {i}")
        output = local_file(project, item.get("path"), f"image {i} path")
        require(output.parent == project, "Final image files must be at the project root")
        expected = f"00_封面_{state['safe_topic']}.png" if i == 0 else None
        require(output.name == expected if i == 0 else bool(re.fullmatch(rf"{i:02d}_.+\.png", output.name)), f"Wrong filename/order for image {i}: {output.name}")
        require(output not in seen_paths, f"Image path reused: {output}")
        seen_paths.add(output)
        inspect_image(output, require_output=True)
        output_hash = sha256(output)
        require(output_hash == item.get("sha256"), f"Output SHA-256 mismatch for image {i}")
        hashes.append(output_hash)
        text_file(project, item.get("copy_path"), f"image {i} copy_path", scan=True)
        reference = item.get("reference")
        ref_path = None
        if i > 0 or reference is not None:
            require(isinstance(reference, dict), f"Missing reference record for content image {i}")
            record_id = nonempty(reference.get("record_id"), f"image {i} reference.record_id")
            ref_path = reference_file(project, reference.get("path"))
            require(ref_path != output, f"Image {i} cannot be its own reference")
            inspect_image(ref_path)
            ref_hash = sha256(ref_path)
            require(ref_hash == reference.get("sha256"), f"Reference SHA-256 mismatch for image {i}")
            require(ref_hash in allowed_reference_hashes, f"Image {i} reference is not one of the seven authorized bundled images")
            signature = (str(ref_path), ref_hash)
            require(record_id not in reference_records or reference_records[record_id] == signature, f"Reference ID {record_id} identifies different files")
            reference_records[record_id] = signature
        generation = item.get("generation")
        require(isinstance(generation, dict), f"Missing generation record for image {i}")
        tool = nonempty(generation.get("tool"), f"image {i} generation.tool")
        require(bool(re.search(r"(^|[._])image_gen([._]|$)", tool)), f"Image {i} must record a host built-in image_gen tool identifier")
        call_id = nonempty(generation.get("local_evidence_id"), f"image {i} local_evidence_id")
        require(call_id not in call_ids, "Each page must have its own local evidence record")
        call_ids.add(call_id)
        host_id = generation.get("host_call_id")
        host_status = generation.get("host_call_id_status")
        if host_status == "available":
            nonempty(host_id, f"image {i} host_call_id")
            require(host_id not in host_call_ids, "Real host call IDs must identify distinct per-page calls")
            host_call_ids.add(host_id)
        else:
            require(host_status == "unavailable" and host_id is None, "Missing host call IDs must be explicitly unavailable/null; never invent one")
        require("called_at" in generation, f"Image {i} must explicitly record called_at or null with a real observed time window")
        called_at = generation["called_at"]
        if called_at is None:
            nonempty(generation.get("called_at_unavailable_reason"), f"image {i} called_at_unavailable_reason")
            window = generation.get("observed_time_window")
            require(isinstance(window, dict), f"Image {i} needs an observed_time_window when exact call time is unavailable")
            parsed_window = []
            for endpoint in ("start", "end"):
                value = nonempty(window.get(endpoint), f"image {i} observed_time_window.{endpoint}")
                try:
                    observed_time = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
                except ValueError as exc:
                    raise WorkflowError(f"Image {i} observed_time_window.{endpoint} must be an ISO timestamp") from exc
                require(observed_time.tzinfo is not None, f"Image {i} observed_time_window.{endpoint} must include timezone")
                parsed_window.append(observed_time)
            require(parsed_window[0] <= parsed_window[1], f"Image {i} observed_time_window start must not follow end")
        else:
            nonempty(called_at, f"image {i} called_at")
            try:
                call_time = dt.datetime.fromisoformat(called_at.replace("Z", "+00:00"))
            except ValueError as exc:
                raise WorkflowError(f"Image {i} called_at must be an ISO timestamp") from exc
            require(call_time.tzinfo is not None, f"Image {i} called_at must include timezone")
        nonempty(generation.get("execution_observation"), f"image {i} execution_observation")
        prompt = nonempty(generation.get("prompt"), f"image {i} generation.prompt")
        required_header = state["prompt_header"] if i > 0 else state["prompt_prefix"]
        require(prompt.startswith(required_header), f"Image {i} prompt lacks its exact required prefix" + (" and EDIT BASE line" if i > 0 else ""))
        require(i > 0 or not prompt.startswith(state["prompt_header"]), "Independent cover must not include the content-page EDIT BASE sentence")
        require(bool(prompt[len(required_header):].strip()), f"Image {i} prompt has no page-specific content")
        actual_input = generation.get("actual_input")
        require(isinstance(actual_input, dict) and actual_input.get("prompt") == prompt, f"Image {i} actual_input.prompt differs from its recorded prompt")
        attached = actual_input.get("referenced_image_paths")
        require("num_last_images_to_include" not in actual_input or actual_input["num_last_images_to_include"] is None,
                f"Image {i} must not rely on recent-image context")
        if ref_path is not None:
            require(isinstance(attached, list) and len(attached) == 1, f"Image {i} actual_input must explicitly attach its one recorded reference path")
            nonempty(attached[0], f"image {i} actual reference path")
            attached_path = Path(attached[0])
            require(attached_path.is_absolute(), f"Image {i} actual tool input must record the absolute path supplied at call time")
            require(attached_path.resolve() == ref_path, f"Image {i} attached reference does not match its reference record")
        else:
            require(attached is None or attached == [], "Independent cover has unrecorded reference inputs")
        evidence_path = local_file(project, generation.get("call_evidence_path"), f"image {i} call evidence")
        evidence = read_json(evidence_path)
        expected_evidence = {key: generation[key] for key in (
            "tool", "host_call_id", "host_call_id_status", "local_evidence_id", "called_at", "execution_observation")}
        if called_at is None:
            expected_evidence["called_at_unavailable_reason"] = generation["called_at_unavailable_reason"]
            expected_evidence["observed_time_window"] = generation["observed_time_window"]
        expected_evidence["input"] = actual_input
        expected_evidence["raw_output_sha256"] = output_hash
        expected_evidence["reference_sha256"] = reference["sha256"] if reference is not None else None
        require(all(evidence.get(key) == value for key, value in expected_evidence.items()),
                f"Image {i} saved call evidence does not match the recorded actual tool input/output/reference")
        raw_path = reference_file(project, generation.get("raw_output_path"))
        require(generation.get("raw_output_sha256") == output_hash and sha256(raw_path) == output_hash,
                f"Image {i} differs from its recorded raw output; postprocessing is forbidden")
    require(len(set(hashes)) == len(hashes), "Final pages must not be byte-identical duplicates")
    expected_outputs = {item["path"] for item in images}
    root_pngs = {p.name for p in project.iterdir() if p.is_file() and p.suffix.lower() == ".png"}
    require(root_pngs == expected_outputs, "Project root must contain exactly the N+1 declared PNG outputs")
    qa = manifest.get("qa")
    require(isinstance(qa, dict), "Missing QA sign-off")
    nonempty(qa.get("reviewer"), "qa.reviewer")
    require(qa.get("reviewer_type") in ("human", "agent"), "qa.reviewer_type must be human or agent")
    nonempty(qa.get("attestation"), "qa.attestation")
    timestamp = nonempty(qa.get("reviewed_at"), "qa.reviewed_at")
    try:
        reviewed_at = dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise WorkflowError("qa.reviewed_at must be an ISO 8601 timestamp") from exc
    require(reviewed_at.tzinfo is not None, "qa.reviewed_at must include its timezone")
    text_file(project, qa.get("evidence_path"), "qa.evidence_path")
    checks = qa.get("checks")
    require(isinstance(checks, dict) and all(checks.get(key) is True for key in GLOBAL_CHECKS), "Every required global QA check needs explicit human/agent sign-off")
    page_reviews = qa.get("page_reviews")
    require(isinstance(page_reviews, list) and len(page_reviews) == n + 1, "QA needs one actual review for every image")
    for i, review in enumerate(page_reviews):
        require(isinstance(review, dict) and type(review.get("index")) is int and review["index"] == i, f"QA page order mismatch at {i}")
        require(review.get("image_sha256") == hashes[i], f"QA sign-off is stale for image {i}")
        reference = images[i].get("reference")
        if reference is not None:
            require(review.get("reference_record_id") == reference["record_id"], f"QA reference mismatch for image {i}")
            require(review.get("reference_sha256") == reference["sha256"], f"QA reference sign-off is stale for image {i}")
        else:
            require(review.get("reference_record_id") is None and review.get("reference_sha256") is None,
                    "Independent cover QA must not claim a reference was attached")
        require(review.get("verdict") == "pass", f"Image {i} has not passed QA")
        nonempty(review.get("notes"), f"QA page {i} actual observations")
        per_page = review.get("checks")
        required_checks = PAGE_CHECKS if reference is not None else tuple(k for k in PAGE_CHECKS if k != "reference_layout_preserved") + ("original_cover_layout_reviewed",)
        require(isinstance(per_page, dict) and all(per_page.get(key) is True for key in required_checks), f"Image {i} lacks explicit visual check sign-offs")
    return {"valid": True, "project": str(project), "mode": state["mode"], "content_pages": n,
            "total_images": n + 1, "boundary": BOUNDARY}


def commit(manifest_path):
    report = validate(manifest_path)  # Always rerun; never trust an old validation receipt.
    path, project, state, manifest = load_run(manifest_path)
    receipt_path = path.parent / "commit-receipt.json"
    require(not receipt_path.exists(), "This project has already been committed")
    source = Path(state["source_queue"]).resolve()
    if state["mode"] == "test":
        target = path.parent / "queue.test.md"
        require(target.is_file() and not target.is_symlink(), "Test queue copy is missing or is a symlink")
        require(target.resolve().is_relative_to(project) and target.resolve() != source, "Test mode cannot target the production queue")
        require(not os.path.samefile(target, source) if source.exists() else True, "Test queue cannot be a hard link to the production queue")
    else:
        target = source
    require(target.is_file(), f"Queue target is missing: {target}")
    lock = target.with_name(target.name + ".shiguang.lock")
    temp_path = None
    lock_fd = None
    try:
        try:
            lock_fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError as exc:
            raise WorkflowError(f"Another commit may be active. Lock exists: {lock}. Inspect it; do not remove an active lock.") from exc
        os.write(lock_fd, f"pid={os.getpid()}\nmanifest={path}\n".encode("utf-8"))
        original = target.read_bytes()
        recovered = digest(original) == state["expected_after_sha256"]
        if recovered:
            # A previous run may have stopped after atomic queue replacement but
            # before its receipt. Only an EXACT whole-file expected hash is safe.
            updated = original
        else:
            require(digest(original) == state["target_initial_sha256"], "Queue conflict: source queue hash changed; no status was changed")
            updated = changed_queue(original, state["selected"])
            fd, temp_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
            temp_path = Path(temp_name)
            with os.fdopen(fd, "wb") as stream:
                stream.write(updated)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temp_path, target.stat().st_mode & 0o777)
            # This helper's writers honor the lock; arbitrary external editors
            # may not. The final comparison detects changes seen before replace.
            require(sha256(target) == state["target_initial_sha256"], "Queue conflict during commit; no status was changed")
            os.replace(temp_path, target)
            temp_path = None
        result = {"committed": True, "mode": state["mode"], "target_queue": str(target),
                  "topic": state["selected"]["topic"], "new_status": "已生成",
                  "before_sha256": state["target_initial_sha256"], "after_sha256": digest(updated),
                  "recovered_completed_queue_update": recovered,
                  "committed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                  "production_queue_written": state["mode"] == "production"}
        if state["mode"] == "test":
            result["production_source_matches_snapshot"] = source.is_file() and sha256(source) == state["source_snapshot_sha256"]
        try:
            state["status"] = "committed"
            state["committed_at"] = result["committed_at"]
            atomic_json(path.parent / ".prepare-state.json", state)
            registry = registry_for(source, project.parent.parent.parent, state["mode"] == "test")
            if registry.exists():
                record = read_json(registry)
                require(record.get("content_id") == state.get("content_id") and Path(record.get("manifest", "")).resolve() == path,
                        "Shared run registry no longer matches this project")
                record["status"] = "committed"
                record["committed_at"] = result["committed_at"]
                atomic_json(registry, record)
        except (OSError, WorkflowError) as exc:
            result["state_warning"] = f"Queue commit succeeded but run state could not be updated: {exc}"
        try:
            write_json(receipt_path, result)
        except OSError as exc:
            result["receipt_warning"] = f"Queue commit succeeded but receipt could not be written: {exc}"
        return result
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        if lock_fd is not None:
            os.close(lock_fd)
            lock.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("prepare", help="Read first TODO and create a new project; never change the source queue")
    p.add_argument("--queue", required=True)
    p.add_argument("--output-root", required=True, help="Production 文案 root; test mode adds an isolated _test_runs subtree")
    p.add_argument("--date", help="Publication date YYYY-MM-DD; defaults to Asia/Shanghai (UTC+08:00)")
    p.add_argument("--test-mode", action="store_true")
    p.add_argument("--slot", help="Optional stable host-scheduler slot ID; repeat invocations resume or report its completed run")
    p.add_argument("--prompt-prefix-file")
    p.add_argument("--edit-base-file")
    for name in ("validate", "commit"):
        sub = commands.add_parser(name)
        sub.add_argument("--manifest", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            result = prepare(args.queue, args.output_root, args.date, args.test_mode, args.prompt_prefix_file, args.edit_base_file, args.slot)
        elif args.command == "validate":
            result = validate(args.manifest)
        else:
            result = commit(args.manifest)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (WorkflowError, OSError, ValueError, TypeError, KeyError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
