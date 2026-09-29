// The transport is stubbed so these runtime specs do not need Python.
const manifest = require("../package.json");

describe("jedi-tools", () => {
  let mainModule, provider, providerWasDeferred, editor;

  function stubDaemon(results) {
    return spyOn(provider, "sendRequest").and.callFake((data) => {
      const payload = JSON.parse(data);
      queueMicrotask(() => {
        provider.deserialize(JSON.stringify({ id: payload.id, results }));
      });
    });
  }

  beforeEach(async () => {
    await lumine.packages.startPackage("jedi-tools");
    mainModule = lumine.packages.getLoadedPackage("jedi-tools").mainModule;
    providerWasDeferred = mainModule.provider == null;
    provider = mainModule.ensureProvider();
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

  it("prepares method override requests without modifying the editor", async () => {
    editor.setText("class Base:\n    def run(self): pass\nclass Child(Base):\n");
    const source = editor.getText();
    const methods = [{ name: "run", parent: "Base", params: [] }];
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
        constructor() {
          this.process = { stdin: { on() {} } };
          this.kill = jasmine.createSpy("kill");
        }

        onWillThrowError() {}
      };
      spyOn(provider.InterpreterLookup, "applySubstitutions").and.returnValue(["python"]);
    });

    afterEach(() => {
      clearTimeout(provider.daemonKillTimer);
      provider.daemonKillTimer = null;
      provider.BufferedProcess = originalBufferedProcess;
    });

    it("only lets the current daemon's timer kill the current process", () => {
      provider.spawnDaemon();
      const first = provider.provider;
      provider.spawnDaemon();
      const second = provider.provider;
      advanceClock(60 * 10 * 1000);
      expect(first.kill).not.toHaveBeenCalled();
      expect(second.kill).toHaveBeenCalledTimes(1);
    });

    it("cancels the daemon timer when the provider is disposed", () => {
      provider.spawnDaemon();
      const process = provider.provider;
      provider.dispose();
      process.kill.calls.reset();
      advanceClock(60 * 10 * 1000);
      expect(process.kill).not.toHaveBeenCalled();
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
      instance: "self.__class__",
      name: "run",
      params: ["value"],
      fileName: "base.py",
      line: 5,
      column: 4,
    };
    view = new OverrideView();
    const insert = spyOn(view, "insertOverride");

    await view.setItems([method]);
    expect(view.selectList.getItemId(method)).toBe(
      JSON.stringify([method.fileName, 5, 4, "Base", "self.__class__", "run", ["value"]]),
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
