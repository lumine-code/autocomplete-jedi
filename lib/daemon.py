import os
import io
import inspect
import sys
import json
import traceback

import jedi

class JediTools(object):
    basic_types = {
        'module': 'import',
        'instance': 'variable',
        'statement': 'value',
        'param': 'variable',
    }

    def __init__(self):
        self.default_sys_path = sys.path
        self._input = io.open(sys.stdin.fileno(), encoding='utf-8')
        self._devnull = open(os.devnull, 'w')
        self.stdout, self.stderr = sys.stdout, sys.stderr

    def _get_definition_type(self, definition):
        is_built_in = definition.in_builtin_module
        if definition.type not in ['import', 'keyword'] and is_built_in():
            return 'builtin'
        if definition.type in ['statement'] and definition.name.isupper():
            return 'constant'
        return self.basic_types.get(definition.type, definition.type)

    @classmethod
    def _get_top_level_module(cls, path):
        """Recursively walk through directories looking for top level module.

        Jedi will use current filepath to look for another modules at same
        path, but it will not be able to see modules **above**, so our goal
        is to find the higher python module available from filepath.
        """
        _path, _ = os.path.split(path)
        if _path != path and os.path.isfile(os.path.join(_path, '__init__.py')):
            return cls._get_top_level_module(_path)
        return path

    def _serialize_methods(self, script, line, column, identifier=None):
        _methods = []
        try:
            completions = script.complete(line, column)
        except KeyError:
            return json.dumps({'id': identifier, 'results': []})

        for completion in completions:
            if completion.name == '__jedi_tools_override':
                instance = completion.parent().name
                break
        else:
            instance = 'self.__class__'

        for completion in completions:
            signatures = completion.get_signatures()
            params = [param.to_string() for param in signatures[0].params] if signatures else []
            call_params = []
            if signatures:
                for param in signatures[0].params:
                    if param.kind == inspect.Parameter.VAR_POSITIONAL:
                        call_params.append('*' + param.name)
                    elif param.kind == inspect.Parameter.VAR_KEYWORD:
                        call_params.append('**' + param.name)
                    elif param.kind == inspect.Parameter.KEYWORD_ONLY:
                        call_params.append(param.name + '=' + param.name)
                    else:
                        call_params.append(param.name)
            if completion.parent().type == 'class':
                _methods.append({
                    'parent': completion.parent().name,
                    'instance': instance,
                    'name': completion.name,
                    'params': params,
                    'callParams': call_params,
                    'moduleName': completion.module_name,
                    'fileName': os.fspath(completion.module_path) if completion.module_path else None,
                    'line': completion.line,
                    'column': completion.column,
                })
        return json.dumps({'id': identifier, 'results': _methods})

    def _top_definition(self, definition):
        for d in definition.goto():
            if d == definition:
                continue
            if d.type == 'import':
                return self._top_definition(d)
            else:
                return d
        return definition

    def _serialize_definitions(self, definitions, identifier=None):
        _definitions = []
        for definition in definitions:
            if definition.module_path:
                if definition.type == 'import':
                    definition = self._top_definition(definition)
                if not definition.module_path:
                    continue
                _definitions.append({
                    'text': definition.name,
                    'type': self._get_definition_type(definition),
                    'fileName': os.fspath(definition.module_path),
                    'line': definition.line - 1,
                    'column': definition.column
                })
        return json.dumps({'id': identifier, 'results': _definitions})

    def _serialize_usages(self, usages, identifier=None):
        _usages = []
        for usage in usages:
            _usages.append({
                'name': usage.name,
                'moduleName': usage.module_name,
                'fileName': os.fspath(usage.module_path),
                'line': usage.line,
                'column': usage.column,
            })
        return json.dumps({'id': identifier, 'results': _usages})

    def _deserialize(self, request):
        return json.loads(request)

    def _set_request_config(self, config):
        sys.path = self.default_sys_path
        self.extra_paths = []
        for path in config.get('extraPaths', []):
            if path and path not in sys.path:
                self.extra_paths.append(path)

    def _process_request(self, request):
        request = self._deserialize(request)
        self._set_request_config(request.get('config', {}))

        path = self._get_top_level_module(request.get('path', ''))
        if path not in sys.path:
            sys.path.insert(0, path)
        lookup = request['lookup']

        script = jedi.Script(
            code=request['source'], path=request.get('path', ''),
            project=jedi.Project(path, added_sys_path=self.extra_paths),
        )
        line = request['line'] + 1
        column = request['column']

        if lookup == 'definitions':
            return self._write_response(self._serialize_definitions(
                script.goto(line, column), request['id']))
        elif lookup == 'usages':
            return self._write_response(self._serialize_usages(
                script.get_references(line, column), request['id']))
        elif lookup == 'methods':
            return self._write_response(self._serialize_methods(
                script, line, column, request['id']))
        else:
            raise ValueError('Unknown Jedi Tools lookup: %s' % lookup)

    def _write_response(self, response):
        sys.stdout = self.stdout
        sys.stdout.write(response + '\n')
        sys.stdout.flush()

    def watch(self):
        while True:
            try:
                sys.stdout, sys.stderr = self._devnull, self._devnull
                request = self._input.readline()
                if not request:
                    return
                self._process_request(request)
            except Exception:
                sys.stderr = self.stderr
                sys.stderr.write(traceback.format_exc() + '\n')
                sys.stderr.flush()


if __name__ == '__main__':
    if sys.argv[1:]:
        for s in sys.argv[1:]:
            JediTools()._process_request(s)
    else:
        JediTools().watch()
