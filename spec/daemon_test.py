import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


DAEMON_PATH = Path(__file__).resolve().parents[1] / "lib" / "daemon.py"
module_spec = importlib.util.spec_from_file_location("jedi_tools_daemon", DAEMON_PATH)
daemon = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(daemon)


class DaemonTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="jedi-tools-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()

    def write(self, relative_path, source):
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
        return path

    def request(self, lookup, source, row, column, path=None, extra_paths=()):
        return {
            "id": lookup,
            "lookup": lookup,
            "source": source,
            "path": str(path) if path else None,
            "line": row,
            "column": column,
            "config": {"extraPaths": [str(path) for path in extra_paths]},
        }

    def run_daemon(self, requests, allow_errors=False):
        process = subprocess.run(
            [sys.executable, str(DAEMON_PATH)],
            input="".join(json.dumps(request, ensure_ascii=False) + "\n" for request in requests),
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=True,
        )
        if not allow_errors:
            self.assertEqual(process.stderr, "")
        return [json.loads(line) for line in process.stdout.splitlines()], process.stderr

    def test_definition_positions_and_existing_type_labels(self):
        source = "VALUE = 1\nprint(VALUE)\n"
        path = self.write("sample.py", source)
        responses, _ = self.run_daemon([self.request("definitions", source, 1, 8, path)])
        self.assertEqual(responses, [{
            "id": "definitions",
            "results": [{"text": "VALUE", "type": "constant", "fileName": str(path), "line": 0, "column": 0}],
        }])

    def test_usage_positions_include_definition_and_reference(self):
        source = "value = 1\nprint(value)\n"
        path = self.write("sample.py", source)
        responses, _ = self.run_daemon([self.request("usages", source, 1, 8, path)])
        self.assertEqual(responses[0]["results"], [
            {"name": "value", "fileName": str(path), "line": 1, "column": 0},
            {"name": "value", "fileName": str(path), "line": 2, "column": 6},
        ])

    def test_import_alias_resolves_to_definition_inside_a_package(self):
        self.write("pkg/__init__.py", "")
        target = self.write("pkg/target.py", "def target(value):\n    return value\n")
        source = "from .target import target as alias\nresult = alias(1)\n"
        path = self.write("pkg/main.py", source)
        responses, _ = self.run_daemon([self.request("definitions", source, 1, 12, path)])
        self.assertEqual(responses[0]["results"], [
            {"text": "target", "type": "function", "fileName": str(target), "line": 0, "column": 4},
        ])

    def test_usages_find_aliases_and_symbols_across_project_files(self):
        target = self.write("target.py", "def target(value):\n    return value\n")
        source = "from target import target as alias\nresult = alias(1)\n"
        path = self.write("main.py", source)
        responses, _ = self.run_daemon([self.request("usages", source, 1, 12, path)])
        usages = {(usage["fileName"], usage["name"], usage["line"]) for usage in responses[0]["results"]}
        self.assertIn((str(path), "alias", 1), usages)
        self.assertIn((str(path), "alias", 2), usages)
        self.assertIn((str(target), "target", 1), usages)

    def test_extra_paths_are_applied_per_request_without_leaking(self):
        first = self.write("first/external_mod.py", "def target(): pass\n")
        second = self.write("second/external_mod.py", "\n\ndef target(): pass\n")
        source = "import external_mod\nexternal_mod.target()\n"
        path = self.write("project/main.py", source)
        responses, _ = self.run_daemon([
            self.request("definitions", source, 1, 16, path, [first.parent]),
            self.request("definitions", source, 1, 16, path, [second.parent]),
            self.request("definitions", source, 1, 16, path),
        ])
        self.assertEqual(responses[0]["results"][0]["fileName"], str(first))
        self.assertEqual(responses[1]["results"][0]["fileName"], str(second))
        self.assertEqual(responses[2]["results"], [])

    def test_override_lookup_keeps_inherited_methods_and_parameter_kinds(self):
        source = (
            "class Base:\n"
            "    field = 1\n"
            "    @property\n"
            "    def prop(self): return 1\n"
            "    def run(self, value, /, count=2, *args, timeout=3, **kwargs): pass\n"
            "    def strict(self, value, /, *, flag=True): pass\n"
            "class Child(Base):\n"
            "    def own(self): pass\n"
            "    def __jedi_tools_override(s):\n"
            "        s.\n"
        )
        path = self.write("sample.py", source)
        responses, _ = self.run_daemon([self.request("methods", source, 9, 10, path)])
        methods = {method["name"]: method for method in responses[0]["results"]}
        self.assertNotIn("field", methods)
        self.assertNotIn("prop", methods)
        self.assertNotIn("own", methods)
        self.assertNotIn("__jedi_tools_override", methods)
        self.assertEqual(methods["run"]["parent"], "Base")
        self.assertEqual(methods["run"]["instance"], "Child")
        self.assertEqual(methods["run"]["params"], ["value", "/", "count=2", "*args", "timeout=3", "**kwargs"])
        self.assertEqual(methods["run"]["callParams"], ["value", "count", "*args", "timeout=timeout", "**kwargs"])
        self.assertEqual(methods["strict"]["params"], ["value", "/", "*", "flag=True"])
        self.assertEqual(methods["strict"]["callParams"], ["value", "flag=flag"])

    def test_utf8_paths_and_symbols_survive_stdio(self):
        source = "średnia = 1\nprint(średnia)\n"
        path = self.write("żółć.py", source)
        responses, _ = self.run_daemon([self.request("definitions", source, 1, 9, path)])
        self.assertEqual(responses[0]["results"][0]["text"], "średnia")
        self.assertEqual(responses[0]["results"][0]["fileName"], str(path))

    def test_failed_request_does_not_corrupt_the_next_response(self):
        source = "value = 1\nprint(value)\n"
        path = self.write("sample.py", source)
        responses, errors = self.run_daemon([
            self.request("unsupported", source, 1, 8, path),
            self.request("definitions", source, 1, 8, path),
        ], allow_errors=True)
        self.assertIn("Unknown Jedi Tools lookup: unsupported", errors)
        self.assertEqual(len(responses), 1)
        self.assertEqual(responses[0]["id"], "definitions")

    def test_library_output_is_suppressed_while_protocol_errors_remain_visible(self):
        source = "value = 1\nprint(value)\n"
        path = self.write("sample.py", source)
        request = self.request("definitions", source, 1, 8, path)
        process_request = daemon.process_request

        def noisy_request(payload):
            print("library output")
            print("library warning", file=sys.stderr)
            return process_request(payload)

        output = io.StringIO()
        errors = io.StringIO()
        with patch.object(daemon, "process_request", noisy_request):
            daemon.watch(io.StringIO(json.dumps(request) + "\n"), output, errors)
        response = json.loads(output.getvalue())
        self.assertEqual(response["results"][0]["text"], "value")
        self.assertEqual(errors.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
