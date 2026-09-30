// The transport is stubbed so these runtime specs do not need Python.
const manifest = require("../package.json");

describe("jedi-tools", () => {
  let mainModule, provider, providerWasDeferred, editor;

  function stubDaemon(results) {
    return spyOn(provider, "sendRequest").and.callFake((data) => {
      const payload = JSON.parse(data);
      queueMicrotask(() => {
        provider.deserialize(JSON.stringify({ id: payload.id, results }) + "\n");
      });
    });
  }

  beforeEach(async () => {
    await lumine.packages.startPackage("jedi-tools");
    mainModule = lumine.packages.getLoadedPackage("jedi-tools").mainModule;
    providerWasDeferred = mainModule.tools == null;
    provider = mainModule.ensureTools();
    provider.requests = {};
    editor = await lumine.workspace.open();
    editor.setText("value = 1\nprint(value)");
  });

  it("provides tools without registering an autocomplete service or settings", () => {
    expect(manifest.providedServices["autocomplete.provider"]).toBeUndefined();
    expect(mainModule.provideAutocomplete).toBeUndefined();
    expect(provider.getSuggestions).toBeUndefined();
    for (const key of [
      "enableCompletion",
      "priority",
      "triggerRegex",
      "showDocStrings",
      "caseInsensitive",
      "fuzzyMatching",
    ]) {
      expect(manifest.configSchema[key]).toBeUndefined();
    }
  });

  it("defers the Jedi runtime until a tool is used", () => {
    expect(providerWasDeferred).toBe(true);
  });

  it("performs no Jedi requests while text is typed", () => {
    const send = spyOn(provider, "sendRequest");
    editor.insertText("abc");
    expect(send).not.toHaveBeenCalled();
  });

  it("resolves definition requests from the daemon", async () => {
    const definitions = [
      { text: "value", type: "value", fileName: "sample.py", line: 0, column: 0 },
    ];
    const send = stubDaemon(definitions);
    expect(await provider.getDefinitions(editor, { row: 1, column: 8 })).toEqual(definitions);
    const payload = JSON.parse(send.calls.mostRecent().args[0]);
    expect(payload.lookup).toBe("definitions");
    expect(payload.source).toBe(editor.getText());
    expect(payload.line).toBe(1);
    expect(payload.column).toBe(8);
    expect(payload.config).toEqual({ extraPaths: [] });
    expect(Object.keys(provider.requests)).toEqual([]);
  });

  it("resolves usage requests for rename and reference lookup", async () => {
    const usages = [{ name: "value", fileName: "sample.py", line: 2, column: 6 }];
    const send = stubDaemon(usages);
    expect(await provider.getUsages(editor, { row: 1, column: 8 })).toEqual(usages);
    expect(JSON.parse(send.calls.mostRecent().args[0]).lookup).toBe("usages");
  });

  it("sends only the shared Python projection for an IPython document", async () => {
    spyOn(editor, "getGrammar").and.returnValue({ scopeName: "source.python.ipy" });
    const projection = {
      text: "\nvalue = 1\nprint(value)",
      isCurrent: () => true,
      isPythonPosition: () => true,
      toServerPosition: (position) => position,
      fromServerPosition: (position) => position,
    };
    const project = jasmine.createSpy("project").and.resolveTo(projection);
    const edge = mainModule.consumeIPythonSource({ project });
    const send = stubDaemon([]);
    try {
      await provider.getDefinitions(editor, { row: 2, column: 8 });
      expect(project).toHaveBeenCalledWith(editor);
      expect(JSON.parse(send.calls.mostRecent().args[0]).source).toBe(projection.text);
    } finally {
      edge.dispose();
    }
  });

  it("uses the real IPython AST to exclude Markdown, raw and foreign magic source", async () => {
    const language = await lumine.packages.activatePackage("language-ipython");
    await language.resourceLoadPromise;
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.python.ipy"));
    editor.setText(
      [
        "# %% [markdown] Notes",
        "not Python **Markdown**",
        "```python",
        "fake = 1",
        "```",
        "# %% [raw] Bytes",
        "{ raw without syntax",
        "# %% Code",
        "value = 1",
        "print(value)",
        "# %% Shell",
        "%%bash",
        "echo not_python",
        "# %% Timed",
        "%%time",
        "result = value + 1",
      ].join("\n"),
    );
    const edge = mainModule.consumeIPythonSource(language.mainModule.provideIPythonSource());
    const send = stubDaemon([]);
    try {
      await provider.getDefinitions(editor, { row: 9, column: 8 });
      const payload = JSON.parse(send.calls.mostRecent().args[0]);
      expect(payload.source).toContain("value = 1");
      expect(payload.source).toContain("result = value + 1");
      expect(payload.source).not.toContain("not Python");
      expect(payload.source).not.toContain("fake = 1");
      expect(payload.source).not.toContain("raw without syntax");
      expect(payload.source).not.toContain("echo not_python");
      expect(payload.line).toBe(9);
    } finally {
      edge.dispose();
    }
  });

  it("does not send a lookup from excluded IPython source", async () => {
    spyOn(editor, "getGrammar").and.returnValue({ scopeName: "source.python.ipy" });
    const edge = mainModule.consumeIPythonSource({
      project: async () => ({
        isCurrent: () => true,
        isPythonPosition: () => false,
        toServerPosition: () => null,
      }),
    });
    const send = spyOn(provider, "sendRequest");
    try {
      expect(await provider.getUsages(editor, { row: 0, column: 2 })).toEqual([]);
      expect(send).not.toHaveBeenCalled();
    } finally {
      edge.dispose();
    }
  });

  it("does not fall back to raw IPython source when its projection provider disappears", async () => {
    spyOn(editor, "getGrammar").and.returnValue({ scopeName: "source.python.ipy" });
    const send = spyOn(provider, "sendRequest");
    mainModule.ipythonSourceRegistration = null;
    await expectAsync(provider.getUsages(editor, { row: 0, column: 0 })).toBeRejectedWithError(
      "IPython source projection is unavailable.",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("does not launch a daemon after an awaited projection outlives the tools runtime", async () => {
    spyOn(editor, "getGrammar").and.returnValue({ scopeName: "source.python.ipy" });
    let settle;
    const edge = mainModule.consumeIPythonSource({
      project: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    });
    const send = spyOn(provider, "sendRequest");
    const pending = provider.getDefinitions(editor, { row: 0, column: 0 });
    provider.dispose();
    settle({ isCurrent: () => true });
    expect(await pending).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    edge.dispose();
  });

  it("disposes only its own source-provider edge", () => {
    const first = mainModule.consumeIPythonSource({ id: "first" });
    const second = mainModule.consumeIPythonSource({ id: "second" });
    first.dispose();
    expect(mainModule.ipythonSourceRegistration.service.id).toBe("second");
    second.dispose();
    expect(mainModule.ipythonSourceRegistration).toBeNull();
  });

  it("prepares method override requests without modifying the editor", async () => {
    editor.setText("class Base:\n    def run(self): pass\nclass Child(Base):\n");
    const source = editor.getText();
    const methods = [{ name: "run", parent: "Base", params: [], callParams: [] }];
    const send = stubDaemon(methods);
    const bufferPosition = { row: 2, column: 0 };
    expect(await provider.getMethods(editor, bufferPosition)).toEqual({
      methods,
      indent: 0,
      bufferPosition,
    });
    const payload = JSON.parse(send.calls.mostRecent().args[0]);
    expect(payload.lookup).toBe("methods");
    expect(payload.source).toContain("def __jedi_tools_override(s):");
    expect(payload.source).toContain("    s.");
    expect(editor.getText()).toBe(source);
  });

  it("gives simultaneous identical tool requests independent identifiers", async () => {
    const send = stubDaemon([]);
    await Promise.all([
      provider.getUsages(editor, { row: 1, column: 8 }),
      provider.getUsages(editor, { row: 1, column: 8 }),
    ]);
    const ids = send.calls.allArgs().map(([data]) => JSON.parse(data).id);
    expect(new Set(ids).size).toBe(2);
  });

  it("waits for complete response lines and resolves several responses in one chunk", async () => {
    const send = spyOn(provider, "sendRequest");
    const first = provider.getDefinitions(editor, { row: 1, column: 8 });
    const second = provider.getUsages(editor, { row: 1, column: 8 });
    const ids = send.calls.allArgs().map(([data]) => JSON.parse(data).id);
    const response = JSON.stringify({ id: ids[0], results: ["definition"] });
    provider.deserialize(response.slice(0, 12));
    expect(Object.keys(provider.requests).length).toBe(2);
    provider.deserialize(
      response.slice(12) + "\n" + JSON.stringify({ id: ids[1], results: ["usage"] }) + "\n",
    );
    expect(await Promise.all([first, second])).toEqual([["definition"], ["usage"]]);
    expect(Object.keys(provider.requests)).toEqual([]);
  });

  it("does not open an old definition result after the runtime is reloaded", async () => {
    spyOn(provider, "sendRequest");
    const addList = spyOn(lumine.workspace, "addSelectList").and.callThrough();
    const pending = provider.goToDefinition(editor);
    provider.dispose();
    provider.load();
    await pending;
    expect(addList).not.toHaveBeenCalled();
  });

  it("does not open an old rename result after the runtime is reloaded", async () => {
    spyOn(provider, "sendRequest");
    const addList = spyOn(lumine.workspace, "addSelectList").and.callThrough();
    provider.rename(editor);
    provider.dispose();
    provider.load();
    await flushMicrotasks();
    expect(addList).not.toHaveBeenCalled();
  });

  it("does not move the cursor when a definition opens after the runtime was reloaded", async () => {
    stubDaemon([{ fileName: "definition.py", line: 3, column: 4 }]);
    let resolveOpen;
    const opened = new Promise((resolve) => {
      resolveOpen = resolve;
    });
    const open = spyOn(lumine.workspace, "open").and.returnValue(opened);
    const pending = provider.goToDefinition(editor);
    await flushMicrotasks();
    expect(open).toHaveBeenCalled();
    provider.dispose();
    provider.load();
    const move = spyOn(editor, "setCursorBufferPosition").and.callThrough();
    resolveOpen(editor);
    await pending;
    expect(move).not.toHaveBeenCalled();
  });

  it("expands every project path independently and preserves literal dollar signs", () => {
    const path = require("path");
    const first = path.resolve("workspace", "$&");
    const second = path.resolve("workspace", "second");
    spyOn(lumine.project, "getPaths").and.returnValue([first, second]);
    expect(
      provider.projectPaths.applySubstitutions([
        "$PROJECT/$PROJECT_NAME",
        "$PROJECT/$PROJECT_NAME",
      ]),
    ).toEqual([first + "/$&", second + "/second"]);
  });

  it("warns when a workspace command is used in a non-Python editor", () => {
    const warning = spyOn(lumine.notifications, "addWarning");
    const go = spyOn(provider, "goToDefinition");
    lumine.commands.dispatch(lumine.views.getView(lumine.workspace), "jedi-tools:go-to-definition");
    expect(warning).toHaveBeenCalledWith("Jedi Tools requires a Python editor.");
    expect(go).not.toHaveBeenCalled();
  });

  it("dispatches a workspace tool to the active Python editor exactly once", async () => {
    await lumine.packages.activatePackage("language-python");
    const pyEditor = await lumine.workspace.open("sample.py");
    const go = spyOn(provider, "goToDefinition");
    lumine.commands.dispatch(lumine.views.getView(lumine.workspace), "jedi-tools:go-to-definition");
    expect(go).toHaveBeenCalledOnceWith(pyEditor);
  });

  it("resolves the Python editor from the dispatch target before the active one", async () => {
    await lumine.packages.activatePackage("language-python");
    const pyEditor = await lumine.workspace.open("sample.py");
    spyOn(lumine.workspace, "getActiveTextEditor").and.returnValue(editor);
    const callback = jasmine.createSpy("tool");
    mainModule.withPythonEditor({ target: lumine.views.getView(pyEditor) }, callback);
    expect(callback).toHaveBeenCalledOnceWith(pyEditor);
  });

  it("quietly skips a workspace tool when no editor is active", () => {
    spyOn(lumine.workspace, "getActiveTextEditor").and.returnValue(null);
    const warning = spyOn(lumine.notifications, "addWarning");
    const callback = jasmine.createSpy("tool");
    mainModule.withPythonEditor({}, callback);
    expect(callback).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it("provides a tip using the current package name and command", () => {
    const tip = mainModule.provideBackgroundTips();
    expect(tip.packageName).toBe("jedi-tools");
    expect(tip.tips[0]).toContain("jedi-tools:go-to-definition");
  });

  describe("daemon lifetime", () => {
    let originalBufferedProcess;

    beforeEach(() => {
      originalBufferedProcess = provider.BufferedProcess;
      provider.BufferedProcess = class {
        constructor(options) {
          this.options = options;
          this.process = {
            pid: 1,
            exitCode: null,
            signalCode: null,
            stdin: { on() {}, write: jasmine.createSpy("write") },
          };
          this.kill = jasmine.createSpy("kill");
        }

        onWillThrowError(callback) {
          this.errorCallback = callback;
        }
      };
      spyOn(provider.projectPaths, "applySubstitutions").and.returnValue(["python"]);
    });

    afterEach(() => {
      clearTimeout(provider.daemonKillTimer);
      provider.daemonKillTimer = null;
      provider.BufferedProcess = originalBufferedProcess;
    });

    it("only lets the current daemon's timer kill the current process", () => {
      provider.spawnDaemon();
      const first = provider.daemon;
      provider.spawnDaemon();
      const second = provider.daemon;
      advanceClock(60 * 10 * 1000);
      expect(first.kill).not.toHaveBeenCalled();
      expect(second.kill).toHaveBeenCalledTimes(1);
    });

    it("cancels the daemon timer when the provider is disposed", () => {
      provider.spawnDaemon();
      const process = provider.daemon;
      provider.dispose();
      process.kill.calls.reset();
      advanceClock(60 * 10 * 1000);
      expect(process.kill).not.toHaveBeenCalled();
    });

    it("allows more than ten concurrent tool requests without dropping promises", async () => {
      const pending = Array.from({ length: 15 }, () =>
        provider.getDefinitions(editor, { row: 1, column: 8 }),
      );
      const daemon = provider.daemon;
      expect(Object.keys(provider.requests).length).toBe(15);
      expect(daemon.kill).not.toHaveBeenCalled();
      for (const [data] of daemon.process.stdin.write.calls.allArgs()) {
        const request = JSON.parse(data);
        daemon.options.stdout(JSON.stringify({ id: request.id, results: [request.id] }) + "\n");
      }
      expect((await Promise.all(pending)).length).toBe(15);
      expect(Object.keys(provider.requests)).toEqual([]);
    });

    it("settles pending requests when the daemon exits and sends a new request after restart", async () => {
      const pending = provider.getDefinitions(editor, { row: 1, column: 8 });
      const first = provider.daemon;
      first.options.exit(1);
      expect(await pending).toEqual([]);
      const restarted = provider.getUsages(editor, { row: 1, column: 8 });
      const second = provider.daemon;
      expect(second).not.toBe(first);
      const payload = JSON.parse(second.process.stdin.write.calls.mostRecent().args[0]);
      second.options.stdout(JSON.stringify({ id: payload.id, results: ["current"] }) + "\n");
      expect(await restarted).toEqual(["current"]);
    });

    it("settles pending tool requests on disposal", async () => {
      const pending = provider.getDefinitions(editor, { row: 1, column: 8 });
      const daemon = provider.daemon;
      provider.dispose();
      expect(await pending).toEqual([]);
      expect(daemon.kill).toHaveBeenCalledOnceWith();
    });

    it("ignores delayed errors and stdout from a replaced daemon", async () => {
      provider.spawnDaemon();
      const first = provider.daemon;
      provider.stopDaemon();
      const pending = provider.getDefinitions(editor, { row: 1, column: 8 });
      const second = provider.daemon;
      const handle = jasmine.createSpy("handle");
      first.errorCallback({ error: { code: "ENOENT", syscall: "spawn python" }, handle });
      expect(handle).toHaveBeenCalled();
      expect(second.kill).not.toHaveBeenCalled();
      const payload = JSON.parse(second.process.stdin.write.calls.mostRecent().args[0]);
      first.options.stdout(JSON.stringify({ id: payload.id, results: ["stale"] }) + "\n");
      second.options.stdout(JSON.stringify({ id: payload.id, results: ["current"] }) + "\n");
      expect(await pending).toEqual(["current"]);
    });
  });

  describe("hyperclick provider", () => {
    let hyperclick;

    beforeEach(() => {
      hyperclick = mainModule.provideHyperclick();
    });

    it("exposes the renamed provider", () => {
      expect(hyperclick.providerName).toBe("jedi-tools");
      expect(typeof hyperclick.getSuggestionForWord).toBe("function");
    });

    it("ignores punctuation and non-Python editors", () => {
      const range = { start: { row: 0, column: 7 }, end: { row: 0, column: 9 } };
      expect(hyperclick.getSuggestionForWord(editor, ".", range)).toBeUndefined();
      expect(hyperclick.getSuggestionForWord(editor, "value", range)).toBeUndefined();
    });

    it("returns a go-to-definition callback for Python symbols", async () => {
      await lumine.packages.activatePackage("language-python");
      const pyEditor = await lumine.workspace.open("sample.py");
      pyEditor.setText("value = 1\nprint(value)\n");
      const range = { start: { row: 1, column: 6 }, end: { row: 1, column: 11 } };
      const suggestion = hyperclick.getSuggestionForWord(pyEditor, "value", range);
      expect(suggestion).toBeDefined();
      expect(suggestion.range).toBe(range);
      const go = spyOn(provider, "goToDefinition");
      suggestion.callback();
      expect(go).toHaveBeenCalledOnceWith(pyEditor, range.start);
    });

    it("leaves comment, string and numeric scope filtering to the hyperclick registry", async () => {
      await lumine.packages.startPackage("hyperclick");
      const packagePath = lumine.packages.getLoadedPackage("hyperclick").path;
      const ProviderRegistry = require(
        require("path").join(packagePath, "lib", "provider-registry"),
      );
      const registry = new ProviderRegistry();
      registry.add(hyperclick);
      const getSuggestion = spyOn(hyperclick, "getSuggestionForWord").and.callThrough();
      const range = { start: { row: 0, column: 0 }, end: { row: 0, column: 2 } };
      const scope = spyOn(editor, "scopeDescriptorForBufferPosition");
      for (const value of [
        "comment.line.number-sign.python",
        "string.quoted.single.python",
        "constant.numeric.integer.python",
        "constant.numeric.float.python",
      ]) {
        scope.and.returnValue({ getScopeChain: () => ".source.python ." + value });
        expect(await registry.getSuggestion(editor, "value", range)).toBeNull();
      }
      expect(getSuggestion).not.toHaveBeenCalled();
    });

    it("does not reload tools from a cached hyperclick callback after deactivation", async () => {
      await lumine.packages.activatePackage("language-python");
      const pyEditor = await lumine.workspace.open("sample.py");
      const range = { start: { row: 0, column: 0 }, end: { row: 0, column: 5 } };
      const suggestion = hyperclick.getSuggestionForWord(pyEditor, "value", range);
      mainModule.deactivate();
      const ensure = spyOn(mainModule, "ensureTools").and.callThrough();
      suggestion.callback();
      expect(ensure).not.toHaveBeenCalled();
      expect(mainModule.tools).toBeNull();
    });
  });
});

describe("jedi-tools select lists", () => {
  let view;

  afterEach(async () => {
    await view?.destroy();
  });

  it("opens a definition through a stable item primary action", async () => {
    const DefinitionsView = require("../lib/definitions-view");
    const definition = {
      text: "target",
      type: "function",
      fileName: "module.py",
      line: 4,
      column: 2,
    };
    view = new DefinitionsView();
    const navigate = spyOn(view, "navigate").and.returnValue(Promise.resolve());

    await view.setItems([definition]);
    expect(view.selectList.getItemId(definition)).toBe(
      JSON.stringify([definition.fileName, 4, 2, "function", "target"]),
    );
    expect((await view.selectList.confirmSelection()).status).toBe("success");

    expect(navigate).toHaveBeenCalledWith(definition);
    expect(view.selectListHost.isVisible()).toBe(false);
  });

  it("inserts an override through a stable item primary action", async () => {
    const OverrideView = require("../lib/override-view");
    const method = {
      parent: "Base",
      instance: "Child",
      name: "run",
      params: ["value"],
      callParams: ["value"],
      fileName: "base.py",
      line: 5,
      column: 4,
    };
    view = new OverrideView();
    const insert = spyOn(view, "insertOverride");

    await view.setItems([method]);
    expect(view.selectList.getItemId(method)).toBe(
      JSON.stringify([method.fileName, 5, 4, "Base", "Child", "run", ["value"]]),
    );
    expect((await view.selectList.confirmSelection()).status).toBe("success");

    expect(insert).toHaveBeenCalledWith(method);
    expect(view.selectListHost.isVisible()).toBe(false);
  });

  it("previews and opens a usage through the event and action APIs", async () => {
    const UsagesView = require("../lib/usages-view");
    const usage = {
      name: "target",
      fileName: "module.py",
      line: 7,
      column: 3,
    };
    view = new UsagesView();
    const preview = spyOn(view, "preview");
    const navigate = spyOn(view, "navigate").and.returnValue(Promise.resolve());

    await view.setItems([usage]);
    expect(preview).toHaveBeenCalledWith(usage);
    expect(view.selectList.getItemId(usage)).toBe(JSON.stringify([usage.fileName, 7, 3, "target"]));
    expect((await view.selectList.confirmSelection()).status).toBe("success");

    expect(navigate).toHaveBeenCalledWith(usage);
    expect(view.selectListHost.isVisible()).toBe(false);
  });

  it("forwards override arguments using their current values", async () => {
    const OverrideView = require("../lib/override-view");
    const editor = await lumine.workspace.open();
    editor.setText("class Child(Base):\n");
    editor.setCursorBufferPosition([1, 0]);
    view = new OverrideView(editor);
    view.bufferPosition = { row: 1, column: 0 };

    view.insertOverride({
      instance: "Child",
      name: "run",
      params: ["value: int", "count=2", "*args", "**kwargs"],
      callParams: ["value", "count", "*args", "**kwargs"],
    });

    expect(editor.getText()).toContain("def run(self, value: int, count=2, *args, **kwargs):");
    expect(editor.getText()).toContain(
      "return super(Child, self).run(value, count, *args, **kwargs)",
    );
  });

  it("forwards keyword-only override arguments by name", async () => {
    const OverrideView = require("../lib/override-view");
    const editor = await lumine.workspace.open();
    editor.setText("class Child(Base):\n");
    editor.setCursorBufferPosition([1, 0]);
    view = new OverrideView(editor);
    view.bufferPosition = { row: 1, column: 0 };

    view.insertOverride({
      instance: "Child",
      name: "run",
      params: ["value", "*args", "timeout=3", "**kwargs"],
      callParams: ["value", "*args", "timeout=timeout", "**kwargs"],
    });

    expect(editor.getText()).toContain(
      "return super(Child, self).run(value, *args, timeout=timeout, **kwargs)",
    );
  });
});
