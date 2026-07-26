// The provider talks to a jedi daemon over stdin/stdout. The specs stub the
// transport (sendRequest) and synthesize daemon responses, so no Python
// interpreter is needed to run them.

const FIXTURE_COMPLETIONS = [
  { text: "path", type: "import", description: "os.path module", rightLabel: "" },
  { text: "pardir", type: "constant", description: "'..'", rightLabel: "" },
  { text: "getcwd", type: "function", description: "getcwd()", rightLabel: "" },
];

describe("autocomplete-jedi", () => {
  let mainModule, provider, editor;

  // Resolve pending daemon requests asynchronously: the real transport always
  // answers after getSuggestions has registered its request id.
  function stubDaemon(results) {
    return spyOn(provider, "sendRequest").and.callFake((data) => {
      const payload = JSON.parse(data);
      queueMicrotask(() => {
        provider.deserialize(JSON.stringify({ id: payload.id, results }));
      });
    });
  }

  beforeEach(async () => {
    const activation = atom.packages.activatePackage("autocomplete-jedi");
    atom.packages.triggerDeferredActivationHooks();
    atom.packages.triggerActivationHook("language-python:grammar-used");
    mainModule = (await activation).mainModule;
    provider = mainModule.provideAutocomplete().load();
    provider.requests = {};
    provider.responses = {};
    editor = await atom.workspace.open();
    editor.setText("import os\nos.pa");
  });

  function getSuggestions(prefix = "pa", bufferPosition = { row: 1, column: 5 }) {
    return provider.getSuggestions({ editor, bufferPosition, prefix });
  }

  it("exposes an autocomplete provider for Python sources", () => {
    expect(provider.scopeSelector).toBe(".source.python");
    expect(provider.disableForScopeSelector).toContain(".source.python .comment");
    expect(typeof provider.getSuggestions).toBe("function");
  });

  it("registers with the bundled autocomplete package through the services hub", async () => {
    atom.notifications.clear();
    const pack = await atom.packages.activatePackage("autocomplete");
    const { providerManager } = pack.mainModule.autocompleteManager;
    expect(providerManager.metadataForProvider(provider)).toBeTruthy();
    const errors = atom.notifications
      .getNotifications()
      .filter((notification) => notification.getType() === "error");
    expect(errors).toEqual([]);
  });

  it("resolves suggestions produced by the jedi daemon", async () => {
    const spy = stubDaemon(FIXTURE_COMPLETIONS);
    const suggestions = await getSuggestions();
    expect(spy).toHaveBeenCalled();
    const payload = JSON.parse(spy.calls.mostRecent().args[0]);
    expect(payload.lookup).toBe("completions");
    expect(Array.isArray(payload.config.extraPaths)).toBe(true);

    expect(suggestions.map((s) => s.text)).toEqual(["path", "pardir"]);
    for (const suggestion of suggestions) {
      expect(typeof suggestion.type).toBe("string");
      expect(typeof suggestion.description).toBe("string");
    }
  });

  it("filters suggestions fuzzily against the typed prefix", async () => {
    stubDaemon(FIXTURE_COMPLETIONS);
    const suggestions = await getSuggestions();
    // "getcwd" does not fuzzy-match the prefix "pa" and must be dropped.
    expect(suggestions.map((s) => s.text)).toEqual(["path", "pardir"]);
  });

  it("serves an identical request from the response cache", async () => {
    const spy = stubDaemon(FIXTURE_COMPLETIONS);
    await getSuggestions();
    const cached = await getSuggestions();
    expect(spy.calls.count()).toBe(1);
    expect(cached.map((s) => s.text)).toEqual(["path", "pardir"]);
  });

  it("returns no suggestions for a non-triggering prefix", () => {
    const spy = stubDaemon(FIXTURE_COMPLETIONS);
    expect(getSuggestions("!")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns no suggestions when completion is disabled", () => {
    atom.config.set("autocomplete-jedi.enableCompletion", false);
    const spy = stubDaemon(FIXTURE_COMPLETIONS);
    expect(getSuggestions()).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    atom.config.set("autocomplete-jedi.enableCompletion", true);
  });

  describe("hyperclick provider", () => {
    let hyperclick;

    beforeEach(() => {
      hyperclick = mainModule.provideHyperclick();
    });

    it("exposes the renamed provider", () => {
      expect(hyperclick.providerName).toBe("autocomplete-jedi");
      expect(typeof hyperclick.getSuggestionForWord).toBe("function");
    });

    it("ignores punctuation and non-Python editors", () => {
      const range = { start: { row: 0, column: 7 }, end: { row: 0, column: 9 } };
      expect(hyperclick.getSuggestionForWord(editor, ".", range)).toBeUndefined();
      // The spec editor has a plain-text grammar.
      expect(hyperclick.getSuggestionForWord(editor, "os", range)).toBeUndefined();
    });

    it("returns a go-to-definition callback for Python symbols", async () => {
      await atom.packages.activatePackage("language-python");
      const pyEditor = await atom.workspace.open("sample.py");
      pyEditor.setText("import os\nos.path\n");
      const range = { start: { row: 1, column: 0 }, end: { row: 1, column: 2 } };
      const suggestion = hyperclick.getSuggestionForWord(pyEditor, "os", range);
      expect(suggestion).toBeDefined();
      expect(suggestion.range).toBe(range);
      expect(typeof suggestion.callback).toBe("function");
    });
  });
});
