const log = require("./log");

module.exports = {
  scopeSelector: ".source.python",
  disableForScopeSelector: ".source.python .comment, .source.python .string",
  inclusionPriority: 2,
  // Domain-expert tier by default. See "Ranking" in autocomplete's
  // `docs/autocomplete.provider.md` for what each value claims.
  suggestionPriority: lumine.config.get("autocomplete-jedi.priority"),
  excludeLowerPriority: false,
  cacheSize: 10,

  noExecutableError(error) {
    if (this.providerNoExecutable) {
      return;
    }
    log.warning("No python executable found", error);
    lumine.notifications.addWarning("autocomplete-jedi unable to find python binary.", {
      detail: `Please set the Python command in package settings.
Detailed error message: ${error}

Current config: ${lumine.config.get("autocomplete-jedi.pythonCommand")}`,
      dismissable: true,
    });
    this.providerNoExecutable = true;
  },

  spawnDaemon() {
    const resolved =
      this.InterpreterLookup.applySubstitutions([this.pythonCommand])[0] || this.pythonCommand;
    const [command, ...extraArgs] = resolved.trim().split(/\s+/);
    log.debug("Using python command", command, extraArgs);
    this.provider = new this.BufferedProcess({
      command,
      args: [...extraArgs, __dirname + "/completion.py"],
      stdout: (data) => {
        this.deserialize(data);
      },
      stderr: (data) => {
        if (data.indexOf("is not recognized as an internal or external") > -1) {
          return this.noExecutableError(data);
        }
        log.debug(`autocomplete-jedi traceback output: ${data}`);
        if (data.indexOf("jedi") > -1) {
          if (lumine.config.get("autocomplete-jedi.showErrors")) {
            lumine.notifications.addWarning(
              `Looks like this error originated from Jedi. Please do not
report such issues in autocomplete-jedi issue tracker. Report
them directly to Jedi. Turn off \`outputProviderErrors\` setting
to hide such errors in future. Traceback output:`,
              {
                detail: `${data}`,
                dismissable: true,
              },
            );
          }
        } else {
          lumine.notifications.addError("autocomplete-jedi traceback output:", {
            detail: `${data}`,
            dismissable: true,
          });
        }

        log.debug(`Forcing to resolve ${Object.keys(this.requests).length} promises`);
        for (const requestId in this.requests) {
          const resolve = this.requests[requestId];
          if (typeof resolve === "function") {
            resolve([]);
          }
          delete this.requests[requestId];
        }
      },

      exit: (code) => {
        log.warning("Process exit with", code, this.provider);
      },
    });
    this.provider.onWillThrowError(({ error, handle }) => {
      if (error.code === "ENOENT" && error.syscall.indexOf("spawn") === 0) {
        this.noExecutableError(error);
        this.dispose();
        handle();
      } else {
        throw error;
      }
    });

    this.provider.process?.stdin.on("error", (err) => log.debug("stdin", err));

    setTimeout(
      () => {
        log.debug("Killing python process after timeout...");
        if (this.provider && this.provider.process) {
          this.provider.kill();
        }
      },
      60 * 10 * 1000,
    );
  },

  load() {
    if (!this.constructed) {
      this.constructor();
    }
    return this;
  },

  constructor() {
    ({
      CompositeDisposable: this.CompositeDisposable,
      BufferedProcess: this.BufferedProcess,
    } = require("lumine"));
    this.DefinitionsView = require("./definitions-view");
    this.UsagesView = require("./usages-view");
    this.OverrideView = require("./override-view");
    this.RenameView = require("./rename-view");
    this.InterpreterLookup = require("./interpreters-lookup");

    this.requests = {};
    this.responses = {};
    this.provider = null;
    this.disposables = new this.CompositeDisposable();
    this.definitionsView = null;
    this.usagesView = null;
    this.renameView = null;
    this.constructed = true;

    this.disposables.add(
      lumine.config.observe("autocomplete-jedi.pythonCommand", (value) => {
        this.pythonCommand = (value || "python").trim();
        if (this.provider && this.provider.process) {
          log.debug("Python command changed, restarting daemon...");
          this.provider.kill();
          this.provider = null;
        }
      }),
      lumine.config.observe("autocomplete-jedi.enableCompletion", (value) => {
        this.enableCompletion = value;
      }),
    );

    log.debug(`Init autocomplete-jedi with priority ${this.suggestionPriority}`);

    try {
      this.triggerCompletionRegex = RegExp(lumine.config.get("autocomplete-jedi.triggerRegex"));
    } catch (err) {
      lumine.notifications.addWarning(
        `autocomplete-jedi invalid regexp to trigger autocompletions.
Falling back to default value.`,
        {
          detail: `Original exception: ${err}`,
          dismissable: true,
        },
      );
      lumine.config.set("autocomplete-jedi.triggerRegex", "([\\.\\ (]|[a-zA-Z_][a-zA-Z0-9_]*)");
      this.triggerCompletionRegex = /([. (]|[a-zA-Z_][a-zA-Z0-9_]*)/;
    }

    const selector = "lumine-text-editor[data-grammar~=python]";
    this.disposables.add(
      lumine.commands.add(selector, "autocomplete-jedi:go-to-definition", {
        description: "Jump to where the symbol under the cursor is defined.",
        didDispatch: () => {
          this.goToDefinition();
        },
      }),
    );
    this.disposables.add(
      lumine.commands.add(selector, "autocomplete-jedi:show-usages", {
        description: "List everywhere the symbol under the cursor is used.",
        didDispatch: () => {
          const editor = lumine.workspace.getActiveTextEditor();
          const bufferPosition = editor.getCursorBufferPosition();
          if (this.usagesView) {
            this.usagesView.destroy();
          }
          this.usagesView = new this.UsagesView();
          this.getUsages(editor, bufferPosition)
            .then((usages) => this.usagesView.setItems(usages))
            .catch((error) => this.usagesView.setError(error));
        },
      }),
    );

    this.disposables.add(
      lumine.commands.add(selector, "autocomplete-jedi:override-method", {
        description: "Insert a stub overriding a method of the base class.",
        didDispatch: () => {
          const editor = lumine.workspace.getActiveTextEditor();
          const bufferPosition = editor.getCursorBufferPosition();
          if (this.overrideView) {
            this.overrideView.destroy();
          }
          this.overrideView = new this.OverrideView();
          this.getMethods(editor, bufferPosition)
            .then(({ methods, indent, bufferPosition }) => {
              this.overrideView.indent = indent;
              this.overrideView.bufferPosition = bufferPosition;
              this.overrideView.setItems(methods);
            })
            .catch((error) => this.overrideView.setError(error));
        },
      }),
    );

    this.disposables.add(
      lumine.commands.add(selector, "autocomplete-jedi:rename", {
        description: "Rename the symbol under the cursor everywhere it appears.",
        didDispatch: () => {
          const editor = lumine.workspace.getActiveTextEditor();
          const bufferPosition = editor.getCursorBufferPosition();
          const promise = this.getUsages(editor, bufferPosition).then((usages) => {
            if (this.renameView) {
              this.renameView.destroy();
            }
            if (usages.length > 0) {
              this.renameView = new this.RenameView(usages);
              this.renameView.onInput((newName) => {
                const grouped = {};
                for (const usage of usages) {
                  (grouped[usage.fileName] ??= []).push(usage);
                }
                for (const fileName in grouped) {
                  usages = grouped[fileName];
                  const [project] = lumine.project.relativizePath(fileName);
                  if (project) {
                    this.updateUsagesInFile(fileName, usages, newName);
                  } else {
                    log.debug("Ignoring file outside of project", fileName);
                  }
                }
              });
            } else {
              if (this.usagesView) {
                this.usagesView.destroy();
              }
              this.usagesView = new this.UsagesView();
              this.usagesView.setItems(usages);
            }
          });
          // Nothing is on screen yet when this rejects, so the failure has
          // nowhere to be shown but a notification. Without it the rename is
          // simply silent.
          promise.catch((error) =>
            lumine.notifications.addError("autocomplete-jedi could not find usages to rename.", {
              detail: error.message,
            }),
          );
        },
      }),
    );

    this.disposables.add(
      lumine.commands.add("lumine-workspace", "autocomplete-jedi:add-roots-to-extra-paths", {
        description: "Put the project folders on the paths Jedi searches.",
        didDispatch: () => {
          const current = lumine.config
            .get("autocomplete-jedi.extraPaths")
            .split(";")
            .map((p) => p.trim())
            .filter(Boolean);
          let added = 0;
          for (const root of lumine.project.getPaths()) {
            if (!current.includes(root)) {
              current.push(root);
              added++;
            }
          }
          lumine.config.set("autocomplete-jedi.extraPaths", current.join(";"));
          if (added > 0) {
            lumine.notifications.addSuccess(
              `autocomplete-jedi: added ${added} project root(s) to Extra Paths.`,
            );
          } else {
            lumine.notifications.addInfo(
              "autocomplete-jedi: all project roots are already in Extra Paths.",
            );
          }
        },
      }),
    );
  },

  updateUsagesInFile(fileName, usages, newName) {
    return lumine.workspace.open(fileName, { activateItem: false }).then(function (editor) {
      // An open can decline — an unreadable path, a full workspace center — and
      // a rename cannot rewrite a file it could not open.
      if (!editor) return;
      const buffer = editor.getBuffer();
      buffer.transact(() => {
        const columnOffset = {};
        for (const usage of usages) {
          const { name, line, column } = usage;
          columnOffset[line] ??= 0;
          log.debug("Replacing", usage, "with", newName, "in", editor.id);
          log.debug("Offset for line", line, "is", columnOffset[line]);
          buffer.setTextInRange(
            [
              [line - 1, column + columnOffset[line]],
              [line - 1, column + name.length + columnOffset[line]],
            ],
            newName,
          );
          columnOffset[line] += newName.length - name.length;
        }
      });
      buffer.save();
    });
  },

  serialize(request) {
    log.debug("Serializing request to be sent to Jedi", request);
    return JSON.stringify(request);
  },

  sendRequest(data, respawned) {
    log.debug("Pending requests:", Object.keys(this.requests).length, this.requests);
    if (Object.keys(this.requests).length > 10) {
      log.debug("Cleaning up request queue to avoid overflow, ignoring request");
      this.requests = {};
      if (this.provider && this.provider.process) {
        log.debug("Killing python process");
        this.provider.kill();
        return;
      }
    }

    if (this.provider && this.provider.process) {
      const { process } = this.provider;
      if (process.exitCode === null && process.signalCode === null) {
        if (this.provider.process.pid) {
          return this.provider.process.stdin.write(data + "\n");
        } else {
          return log.debug("Attempt to communicate with terminated process", this.provider);
        }
      } else if (respawned) {
        lumine.notifications.addWarning(
          [
            "Failed to spawn daemon for autocomplete-jedi.",
            "Completions will not work anymore",
            "unless you restart your editor.",
          ].join(" "),
          {
            detail: [`exitCode: ${process.exitCode}`, `signalCode: ${process.signalCode}`].join(
              "\n",
            ),
            dismissable: true,
          },
        );
        this.dispose();
      } else {
        this.spawnDaemon();
        this.sendRequest(data, { respawned: true });
        log.debug("Re-spawning python process...");
      }
    } else {
      log.debug("Spawning python process...");
      this.spawnDaemon();
      this.sendRequest(data);
    }
  },

  deserialize(response) {
    log.debug("Deserealizing response from Jedi", response);
    log.debug(`Got ${response.trim().split("\n").length} lines`);
    for (const responseSource of response.trim().split("\n")) {
      try {
        response = JSON.parse(responseSource);
      } catch (e) {
        throw new Error(`Failed to parse JSON from "${responseSource}".`, { cause: e });
      }

      const resolve = this.requests[response["id"]];
      if (typeof resolve === "function") {
        resolve(response["results"]);
      }
      const cacheSizeDelta = Object.keys(this.responses).length > this.cacheSize;
      if (cacheSizeDelta > 0) {
        const ids = Object.keys(this.responses).sort((a, b) => {
          return this.responses[a]["timestamp"] - this.responses[b]["timestamp"];
        });
        for (const id of ids.slice(0, cacheSizeDelta)) {
          log.debug("Removing old item from cache with ID", id);
          delete this.responses[id];
        }
      }
      this.responses[response["id"]] = {
        source: responseSource,
        timestamp: Date.now(),
      };
      log.debug("Cached request with ID", response["id"]);
      delete this.requests[response["id"]];
    }
  },

  generateRequestId(type, editor, bufferPosition, text) {
    if (!text) {
      text = editor.getText();
    }
    return require("crypto")
      .createHash("md5")
      .update([editor.getPath(), text, bufferPosition.row, bufferPosition.column, type].join())
      .digest("hex");
  },

  generateRequestConfig() {
    const extraPaths = this.InterpreterLookup.applySubstitutions(
      lumine.config.get("autocomplete-jedi.extraPaths").split(";"),
    );
    return {
      extraPaths: extraPaths,
      caseInsensitive: lumine.config.get("autocomplete-jedi.caseInsensitive"),
      showDocStrings: lumine.config.get("autocomplete-jedi.showDocStrings"),
      fuzzyMatching: lumine.config.get("autocomplete-jedi.fuzzyMatching"),
    };
  },

  fuzzyFilter(candidates, query) {
    if (candidates.length === 0 || [" ", ".", "("].includes(query)) {
      return candidates;
    }
    const matcher = lumine.tools.fuzzyMatcher.setCandidates(candidates.map((c) => c.text));
    return matcher
      .match(query, { recordMatchIndexes: false })
      .filter((r) => r.score > 0)
      .map((r) => candidates[r.id]);
  },

  getSuggestions({ editor, bufferPosition, prefix }) {
    this.load();
    if (!this.enableCompletion) {
      return [];
    }
    if (!this.triggerCompletionRegex.test(prefix)) {
      return (this.lastSuggestions = []);
    }
    bufferPosition = {
      row: bufferPosition.row,
      column: bufferPosition.column,
    };
    const lines = editor.getBuffer().getLines();
    if (lumine.config.get("autocomplete-jedi.fuzzyMatching")) {
      // we want to do our own filtering, hide any existing suffix from Jedi
      const line = lines[bufferPosition.row];
      const lastIdentifier = /\.?[a-zA-Z_][a-zA-Z0-9_]*$/.exec(
        line.slice(0, bufferPosition.column),
      );
      if (lastIdentifier) {
        bufferPosition.column = lastIdentifier.index + 1;
        lines[bufferPosition.row] = line.slice(0, bufferPosition.column);
      }
    }
    const requestId = this.generateRequestId(
      "completions",
      editor,
      bufferPosition,
      lines.join("\n"),
    );
    if (requestId in this.responses) {
      log.debug("Using cached response with ID", requestId);
      // We have to parse JSON on each request here to pass only a copy
      const matches = JSON.parse(this.responses[requestId]["source"])["results"];
      if (lumine.config.get("autocomplete-jedi.fuzzyMatching")) {
        return (this.lastSuggestions = this.fuzzyFilter(matches, prefix));
      } else {
        return (this.lastSuggestions = matches);
      }
    }
    const payload = {
      id: requestId,
      prefix,
      lookup: "completions",
      path: editor.getPath(),
      source: editor.getText(),
      line: bufferPosition.row,
      column: bufferPosition.column,
      config: this.generateRequestConfig(),
    };

    this.sendRequest(this.serialize(payload));
    return new Promise((resolve) => {
      if (lumine.config.get("autocomplete-jedi.fuzzyMatching")) {
        this.requests[payload.id] = (matches) => {
          resolve((this.lastSuggestions = this.fuzzyFilter(matches, prefix)));
        };
      } else {
        this.requests[payload.id] = (suggestions) => {
          resolve((this.lastSuggestions = suggestions));
        };
      }
    });
  },

  getDefinitions(editor, bufferPosition) {
    const payload = {
      id: this.generateRequestId("definitions", editor, bufferPosition),
      lookup: "definitions",
      path: editor.getPath(),
      source: editor.getText(),
      line: bufferPosition.row,
      column: bufferPosition.column,
      config: this.generateRequestConfig(),
    };

    this.sendRequest(this.serialize(payload));
    return new Promise((resolve) => {
      this.requests[payload.id] = resolve;
    });
  },

  getUsages(editor, bufferPosition) {
    const payload = {
      id: this.generateRequestId("usages", editor, bufferPosition),
      lookup: "usages",
      path: editor.getPath(),
      source: editor.getText(),
      line: bufferPosition.row,
      column: bufferPosition.column,
      config: this.generateRequestConfig(),
    };

    this.sendRequest(this.serialize(payload));
    return new Promise((resolve) => {
      this.requests[payload.id] = resolve;
    });
  },

  getMethods(editor, bufferPosition) {
    const indent = bufferPosition.column;
    const lines = editor.getBuffer().getLines();
    lines.splice(bufferPosition.row + 1, 0, "  def __autocomplete_python(s):");
    lines.splice(bufferPosition.row + 2, 0, "    s.");
    const payload = {
      id: this.generateRequestId("methods", editor, bufferPosition),
      lookup: "methods",
      path: editor.getPath(),
      source: lines.join("\n"),
      line: bufferPosition.row + 2,
      column: 6,
      config: this.generateRequestConfig(),
    };

    this.sendRequest(this.serialize(payload));
    return new Promise((resolve) => {
      this.requests[payload.id] = (methods) => resolve({ methods, indent, bufferPosition });
    });
  },

  goToDefinition(editor, bufferPosition) {
    if (!editor) {
      editor = lumine.workspace.getActiveTextEditor();
    }
    if (!bufferPosition) {
      bufferPosition = editor.getCursorBufferPosition();
    }
    if (this.definitionsView) {
      this.definitionsView.destroy();
      this.definitionsView = null;
    }
    return this.getDefinitions(editor, bufferPosition).then((results) => {
      if (results.length === 1) {
        const { fileName, line, column } = results[0];
        lumine.workspace.open(fileName, { pending: true }).then((ed) => {
          // An open can decline — an unreadable path, a full workspace center —
          // and then there is nowhere to place the cursor.
          if (!ed) return;
          ed.setCursorBufferPosition([line, column], { autoscroll: false });
          ed.scrollToCursorPosition({
            zone: lumine.config.get("autocomplete-jedi.editorScrollZone"),
          });
        });
        return;
      }
      this.definitionsView = new this.DefinitionsView();
      this.definitionsView.setItems(results);
    });
  },

  dispose() {
    if (this.disposables) {
      this.disposables.dispose();
      this.disposables = null;
    }
    if (this.provider) {
      this.provider.kill();
      this.provider = null;
    }
    // Allow a clean reconstruction if the package is re-activated.
    this.constructed = false;
  },
};
