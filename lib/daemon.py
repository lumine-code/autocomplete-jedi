import contextlib
import inspect
import json
import os
from pathlib import Path
import sys
import traceback

import jedi


DEFINITION_TYPES = {
    "module": "import",
    "instance": "variable",
    "statement": "value",
    "param": "variable",
}
OVERRIDE_PROBE = "__jedi_tools_override"


def definition_type(definition):
    if definition.type not in ("import", "keyword") and definition.in_builtin_module():
        return "builtin"
    if definition.type == "statement" and definition.name.isupper():
        return "constant"
    return DEFINITION_TYPES.get(definition.type, definition.type)


def project_root(file_path):
    root = Path(file_path).resolve().parent if file_path else Path.cwd()
    while (root / "__init__.py").is_file() and root.parent != root:
        root = root.parent
    return root


def serialize_definitions(definitions):
    return [
        {
            "text": definition.name,
            "type": definition_type(definition),
            "fileName": str(definition.module_path),
            "line": definition.line - 1,
            "column": definition.column,
        }
        for definition in definitions
        if definition.module_path
    ]


def serialize_usages(usages):
    return [
        {
            "name": usage.name,
            "fileName": str(usage.module_path),
            "line": usage.line,
            "column": usage.column,
        }
        for usage in usages
        if usage.module_path
    ]


def method_parameters(signature):
    params = []
    call_params = []
    keyword_only = False
    for index, param in enumerate(signature.params):
        if param.kind == inspect.Parameter.KEYWORD_ONLY and not keyword_only:
            params.append("*")
            keyword_only = True
        params.append(param.to_string())
        if param.kind == inspect.Parameter.POSITIONAL_ONLY:
            next_param = signature.params[index + 1] if index + 1 < len(signature.params) else None
            if next_param is None or next_param.kind != inspect.Parameter.POSITIONAL_ONLY:
                params.append("/")
        if param.kind == inspect.Parameter.VAR_POSITIONAL:
            call_params.append("*" + param.name)
            keyword_only = True
        elif param.kind == inspect.Parameter.VAR_KEYWORD:
            call_params.append("**" + param.name)
        elif param.kind == inspect.Parameter.KEYWORD_ONLY:
            call_params.append(param.name + "=" + param.name)
        else:
            call_params.append(param.name)
    return params, call_params


def serialize_methods(script, line, column):
    # Jedi's public member lookup includes inherited methods. This is invoked
    # only by Override Method, against the synthetic receiver supplied by JS.
    members = script.complete(line, column)
    probe = next((member for member in members if member.name == OVERRIDE_PROBE), None)
    if probe is None:
        return []
    current_class = probe.parent()
    methods = []
    for member in members:
        if member.name == OVERRIDE_PROBE or member.type != "function":
            continue
        owner = member.parent()
        if owner.type != "class" or owner.full_name == current_class.full_name:
            continue
        signatures = member.get_signatures()
        if not signatures:
            continue
        params, call_params = method_parameters(signatures[0])
        methods.append({
            "parent": owner.name,
            "instance": current_class.name,
            "name": member.name,
            "params": params,
            "callParams": call_params,
            "fileName": str(member.module_path) if member.module_path else None,
            "line": member.line,
            "column": member.column,
        })
    return methods


def process_request(request):
    file_path = request.get("path") or None
    extra_paths = request.get("config", {}).get("extraPaths", [])
    project = jedi.Project(project_root(file_path), added_sys_path=extra_paths)
    script = jedi.Script(code=request["source"], path=file_path, project=project)
    line = request["line"] + 1
    column = request["column"]
    lookup = request["lookup"]
    if lookup == "definitions":
        results = serialize_definitions(script.goto(line, column, follow_imports=True))
    elif lookup == "usages":
        results = serialize_usages(script.get_references(line, column))
    elif lookup == "methods":
        results = serialize_methods(script, line, column)
    else:
        raise ValueError("Unknown Jedi Tools lookup: " + lookup)
    return {"id": request["id"], "results": results}


def watch(input_stream, output_stream, error_stream):
    # Keep library output out of the newline-delimited JSON protocol. Responses
    # and tracebacks go directly to the original streams after redirection ends.
    with open(os.devnull, "w") as quiet:
        for source in input_stream:
            try:
                with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
                    response = process_request(json.loads(source))
                output_stream.write(json.dumps(response) + "\n")
                output_stream.flush()
            except Exception:
                traceback.print_exc(file=error_stream)
                error_stream.flush()


if __name__ == "__main__":
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    watch(sys.stdin, sys.stdout, sys.stderr)
