const log = require("./log");

module.exports = {
  noExecutableError(error) {
    if (this.warnedAboutMissingPython) {
      return;
    }
    log.warning("No python executable found", error);
    lumine.notifications.addWarning("jedi-tools unable to find python binary.", {
      detail: `Please set the Python command in package settings.
Detailed error message: ${error}

Current config: ${lumine.config.get("jedi-tools.pythonCommand")}`,
      dismissable: true,
    });
    this.warnedAboutMissingPython = true;
  },

  spawnDaemon() {
    clearTimeout(this.daemonKillTimer);
    this.daemonKillTimer = null;
    const resolved =
      this.projectPaths.applySubstitutions([this.pythonCommand])[0] || this.pythonCommand;
    const [command, ...extraArgs] = resolved.trim().split(/\s+/);
    log.debug("Using python command", command, extraArgs);
    const daemon = new this.BufferedProcess({
      command,
      args: [...extraArgs, __dirname + "/daemon.py"],
      stdout: (data) => {
        if (this.daemon === daemon) this.deserialize(data);
      },
      stderr: (data) => {
        if (this.daemon !== daemon) return;
        log.debug(`jedi-tools traceback output: ${data}`);
        if (/[/\\]jedi[/\\]/.test(data)) {
          if (lumine.config.get("jedi-tools.showErrors")) {
            lumine.notifications.addWarning("Jedi could not complete the requested operation.", {
              detail: `${data}`,
              dismissable: true,
            });
          }
        } else {
          lumine.notifications.addError("Jedi Tools could not process the request.", {
            detail: `${data}`,
            dismissable: true,
          });
        }

        this.resolvePendingRequests();
      },

      exit: (code) => {
        if (this.daemon !== daemon) return;
        log.debug("Jedi daemon exited", code);
        this.stopDaemon();
      },
    });
    this.daemon = daemon;
    daemon.onWillThrowError(({ error, handle }) => {
      if (error.code === "ENOENT" && error.syscall.indexOf("spawn") === 0) {
        if (this.daemon === daemon) {
          this.noExecutableError(error);
          this.stopDaemon();
        }
        handle();
      } else {
        throw error;
      }
    });

    daemon.process?.stdin.on("error", (error) => {
      if (this.daemon !== daemon) return;
      log.warning("Jedi stdin failed", error);
      this.stopDaemon();
    });

    this.daemonKillTimer = setTimeout(
      () => {
        this.daemonKillTimer = null;
        if (this.daemon !== daemon) return;
        this.stopDaemon();
      },
      60 * 10 * 1000,
    );
  },

  load(getIPythonSource) {
    if (getIPythonSource) this.getIPythonSource = getIPythonSource;
    if (this.disposables) return this;
    ({
      CompositeDisposable: this.CompositeDisposable,
      BufferedProcess: this.BufferedProcess,
      Range: this.Range,
    } = require("lumine"));
    this.DefinitionsView = require("./definitions-view");
    this.UsagesView = require("./usages-view");
    this.OverrideView = require("./override-view");
    this.RenameView = require("./rename-view");
    this.projectPaths = require("./project-paths");

    this.requests = {};
    this.nextRequestId = 0;
    this.daemon = null;
    this.responseBuffer = "";
    this.daemonKillTimer = null;
    this.disposables = new this.CompositeDisposable();
    this.definitionsView = null;
    this.usagesView = null;
    this.renameView = null;

    this.disposables.add(
      lumine.config.observe("jedi-tools.pythonCommand", (value) => {
        const command = (value || "python").trim();
        if (command !== this.pythonCommand) {
          this.warnedAboutMissingPython = false;
          this.stopDaemon();
          this.pythonCommand = command;
        }
      }),
    );

    return this;
  },

  showUsages(editor = lumine.workspace.getActiveTextEditor()) {
    const bufferPosition = editor.getCursorBufferPosition();
    if (this.usagesView) {
      this.usagesView.destroy();
    }
    const view = (this.usagesView = new this.UsagesView());
    return this.getUsages(editor, bufferPosition)
      .then((usages) => {
        if (this.usagesView === view) view.setItems(usages);
      })
      .catch((error) => {
        if (this.usagesView === view) view.setError(error);
      });
  },

  showOverrideMethods(editor = lumine.workspace.getActiveTextEditor()) {
    const bufferPosition = editor.getCursorBufferPosition();
    if (this.overrideView) {
      this.overrideView.destroy();
    }
    const view = (this.overrideView = new this.OverrideView(editor));
    return this.getMethods(editor, bufferPosition)
      .then(({ methods, indent, bufferPosition }) => {
        if (this.overrideView !== view) return;
        view.indent = indent;
        view.bufferPosition = bufferPosition;
        view.setItems(methods);
      })
      .catch((error) => {
        if (this.overrideView === view) view.setError(error);
      });
  },

  rename(editor = lumine.workspace.getActiveTextEditor()) {
    const bufferPosition = editor.getCursorBufferPosition();
    const lifetime = this.disposables;
    const promise = this.getUsages(editor, bufferPosition).then((usages) => {
      if (this.disposables !== lifetime) return;
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
            const fileUsages = grouped[fileName];
            const [project] = lumine.project.relativizePath(fileName);
            if (project) {
              this.updateUsagesInFile(fileName, fileUsages, newName);
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
    // Nothing is on screen yet when this rejects, so the failure has nowhere
    // to be shown but a notification. Without it the rename is simply silent.
    promise.catch((error) =>
      lumine.notifications.addError("jedi-tools could not find usages to rename.", {
        detail: error.message,
      }),
    );
  },

  updateUsagesInFile(fileName, usages, newName) {
    return lumine.workspace.open(fileName, { activateItem: false }).then(async (editor) => {
      // An open can decline — an unreadable path, a full workspace center — and
      // a rename cannot rewrite a file it could not open.
      if (!editor) return;
      const previousProjection = usages.find((usage) => usage.sourceProjection)?.sourceProjection;
      if (previousProjection && !previousProjection.isCurrent()) {
        lumine.notifications.addWarning("Jedi rename was cancelled because the source changed.");
        return;
      }
      const projection = await this.projectionFor(editor);
      const buffer = editor.getBuffer();
      const edits = usages.map(({ name, line, column }) => ({
        oldRange: new this.Range([line - 1, column], [line - 1, column + name.length]),
        newText: newName,
        name,
      }));
      if (
        (projection && !projection.isCurrent()) ||
        edits.some((edit) => {
          if (buffer.getTextInRange(edit.oldRange) !== edit.name) return true;
          if (!projection) return false;
          const projectedRange = projection.toServerRange(edit.oldRange);
          return !projectedRange || !projection.mapEdits([{ ...edit, oldRange: projectedRange }]);
        })
      ) {
        lumine.notifications.addWarning("Jedi rename would change protected or stale source.");
        return;
      }
      edits.sort((left, right) => right.oldRange.start.compare(left.oldRange.start));
      buffer.transact(() => {
        for (const edit of edits) buffer.setTextInRange(edit.oldRange, edit.newText);
      });
      buffer.save();
    });
  },

  sendRequest(data, requestId) {
    const process = this.daemon?.process;
    if (!process || process.exitCode !== null || process.signalCode !== null) {
      const resolve = this.requests[requestId];
      delete this.requests[requestId];
      this.stopDaemon();
      if (resolve) this.requests[requestId] = resolve;
      this.spawnDaemon();
    }
    if (!this.daemon?.process?.pid) {
      this.resolvePendingRequests();
      return;
    }
    return this.daemon.process.stdin.write(data + "\n");
  },

  deserialize(response) {
    this.responseBuffer += response;
    let newline;
    while ((newline = this.responseBuffer.indexOf("\n")) !== -1) {
      const responseSource = this.responseBuffer.slice(0, newline);
      this.responseBuffer = this.responseBuffer.slice(newline + 1);
      if (!responseSource.trim()) continue;
      try {
        response = JSON.parse(responseSource);
      } catch (e) {
        throw new Error(`Failed to parse JSON from "${responseSource}".`, { cause: e });
      }

      const resolve = this.requests[response.id];
      if (typeof resolve === "function") {
        resolve(response.results);
      }
      delete this.requests[response.id];
    }
  },

  resolvePendingRequests() {
    for (const resolve of Object.values(this.requests)) resolve([]);
    this.requests = {};
  },

  stopDaemon() {
    clearTimeout(this.daemonKillTimer);
    this.daemonKillTimer = null;
    const daemon = this.daemon;
    this.daemon = null;
    this.responseBuffer = "";
    this.resolvePendingRequests();
    daemon?.kill();
  },

  generateRequestConfig() {
    const extraPaths = this.projectPaths.applySubstitutions(
      lumine.config
        .get("jedi-tools.extraPaths")
        .split(";")
        .map((path) => path.trim())
        .filter(Boolean),
    );
    return {
      extraPaths,
    };
  },

  projectionFor(editor) {
    if (editor.getGrammar().scopeName !== "source.python.ipy") return Promise.resolve(null);
    const service = this.getIPythonSource?.();
    if (!service) return Promise.reject(new Error("IPython source projection is unavailable."));
    return service.project(editor).then((projection) => {
      if (!projection || !projection.isCurrent())
        throw new Error("IPython source changed while preparing the request.");
      return projection;
    });
  },

  request(lookup, editor, bufferPosition, source) {
    if (editor.getGrammar().scopeName !== "source.python.ipy")
      return this.sendSourceRequest(lookup, editor, bufferPosition, source ?? editor.getText());
    const lifetime = this.disposables;
    return this.projectionFor(editor).then((projection) => {
      if (this.disposables !== lifetime || editor.isDestroyed()) return [];
      if (!projection.isPythonPosition(bufferPosition)) return [];
      const position = projection.toServerPosition(bufferPosition);
      if (!position) return [];
      if (source !== undefined)
        throw new Error("Custom IPython source must be prepared from its Python projection.");
      return this.sendSourceRequest(lookup, editor, position, projection.text).then((results) =>
        this.mapProjectedResults(results, lookup, editor, projection),
      );
    });
  },

  mapProjectedResults(results, lookup, editor, projection) {
    if (editor.isDestroyed() || !projection.isCurrent()) return [];
    const path = require("node:path");
    const currentPath = editor.getPath();
    const pathKey = (filename) => {
      const resolved = path.resolve(filename);
      return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    return results.flatMap((result) => {
      if (!currentPath || !result.fileName || pathKey(result.fileName) !== pathKey(currentPath))
        return [result];
      const lineOffset = lookup === "usages" ? 1 : 0;
      const position = projection.fromServerPosition({
        row: result.line - lineOffset,
        column: result.column,
      });
      if (!position || !projection.isPythonPosition(position)) return [];
      const mapped = { ...result, line: position.row + lineOffset, column: position.column };
      Object.defineProperty(mapped, "sourceProjection", { value: projection });
      return [mapped];
    });
  },

  sendSourceRequest(lookup, editor, bufferPosition, source) {
    const payload = {
      id: String(++this.nextRequestId),
      lookup,
      path: editor.getPath(),
      source,
      line: bufferPosition.row,
      column: bufferPosition.column,
      config: this.generateRequestConfig(),
    };

    return new Promise((resolve) => {
      this.requests[payload.id] = resolve;
      this.sendRequest(JSON.stringify(payload), payload.id);
    });
  },

  getDefinitions(editor, bufferPosition) {
    return this.request("definitions", editor, bufferPosition);
  },

  getUsages(editor, bufferPosition) {
    return this.request("usages", editor, bufferPosition);
  },

  getMethods(editor, bufferPosition) {
    if (editor.getGrammar().scopeName === "source.python.ipy") {
      const lifetime = this.disposables;
      return this.projectionFor(editor).then(async (projection) => {
        if (this.disposables !== lifetime || editor.isDestroyed())
          return { methods: [], indent: bufferPosition.column, bufferPosition };
        if (!projection.isPythonPosition(bufferPosition))
          return { methods: [], indent: bufferPosition.column, bufferPosition };
        const position = projection.toServerPosition(bufferPosition);
        if (!position) return { methods: [], indent: bufferPosition.column, bufferPosition };
        const lines = projection.text.split(/\r\n|\n|\r/);
        lines.splice(position.row + 1, 0, "  def __jedi_tools_override(s):", "    s.");
        const methods = await this.sendSourceRequest(
          "methods",
          editor,
          { row: position.row + 2, column: 6 },
          lines.join("\n"),
        );
        return {
          methods:
            this.disposables === lifetime && !editor.isDestroyed() && projection.isCurrent()
              ? methods
              : [],
          indent: bufferPosition.column,
          bufferPosition,
        };
      });
    }
    const indent = bufferPosition.column;
    const lines = editor.getBuffer().getLines();
    lines.splice(bufferPosition.row + 1, 0, "  def __jedi_tools_override(s):");
    lines.splice(bufferPosition.row + 2, 0, "    s.");
    return this.request(
      "methods",
      editor,
      { row: bufferPosition.row + 2, column: 6 },
      lines.join("\n"),
    ).then((methods) => ({ methods, indent, bufferPosition }));
  },

  goToDefinition(editor, bufferPosition) {
    const lifetime = this.disposables;
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
      if (this.disposables !== lifetime) return;
      if (results.length === 1) {
        const { fileName, line, column } = results[0];
        return lumine.workspace.open(fileName, { pending: true }).then((ed) => {
          // An open can decline — an unreadable path, a full workspace center —
          // and then there is nowhere to place the cursor.
          if (!ed || this.disposables !== lifetime) return;
          ed.setCursorBufferPosition([line, column], { autoscroll: false });
          ed.scrollToCursorPosition({
            zone: lumine.config.get("jedi-tools.editorScrollZone"),
          });
        });
      }
      this.definitionsView = new this.DefinitionsView();
      this.definitionsView.setItems(results);
    });
  },

  dispose() {
    this.stopDaemon();
    if (this.disposables) {
      this.disposables.dispose();
      this.disposables = null;
    }
    for (const key of ["definitionsView", "usagesView", "overrideView", "renameView"]) {
      this[key]?.destroy();
      this[key] = null;
    }
    this.getIPythonSource = null;
  },
};
