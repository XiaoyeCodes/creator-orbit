"""Isolated structural fixtures, not generated images or factual QA evidence."""
import importlib.util
from pathlib import Path
import sys
import unittest
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / '.agents/skills/shiguang-atlas/scripts'))
import workflow
from test_workflow import WorkflowTests
spec = importlib.util.spec_from_file_location('bridge', ROOT / 'scripts/workflow_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
class AdapterTests(unittest.TestCase):
    def test_prompt_policy_accepts_native_dimensions_but_not_corrupt_images(self):
        from PIL import Image
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / 'synthetic-only.png'
            Image.new('RGB', (1024,1536)).save(p)
            bridge.inspect_native(p, require_output=True)
            with self.assertRaises(workflow.WorkflowError):
                workflow.inspect_image(p, require_output=True)
            p.write_bytes(b'not a PNG')
            with self.assertRaises(bridge.w.WorkflowError):
                bridge.inspect_native(p, require_output=True)
    def test_copy_reference_checks_and_original_workflow_unchanged(self):
        self.assertIsNot(bridge.w.inspect_image, bridge.inspect_native)
        self.assertIn('each_reference_attachment_verified', bridge.w.GLOBAL_CHECKS)
if __name__ == '__main__': unittest.main()
