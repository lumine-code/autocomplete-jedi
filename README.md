# autocomplete-jedi

Python autocompletion powered by Jedi.

Completes packages, variables, methods, and functions with their arguments, powered by [Jedi](https://github.com/davidhalter/jedi).

## Features

- **Autocomplete**: complete packages, variables, methods and functions with their arguments.
- **Go-to-definition**: navigate to the definition of any symbol.
- **Show usages**: list all usages of the symbol under cursor across the project.
- **Rename**: rename a symbol across multiple files in the project.
- **Method override**: insert method overrides from parent classes.
- **Hyperclick integration**: click on any symbol to go-to-definition when a hyperclick consumer is installed.
- **Virtual environment support**: set the `Python Command` to the interpreter inside your virtualenv, e.g. `.venv/Scripts/python.exe`, or use `$PROJECT/.venv/Scripts/python.exe` for project-relative paths.
- **Cross-platform**: works on macOS, Linux and Windows.

## Installation

To install `autocomplete-jedi` search for _autocomplete-jedi_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/autocomplete-jedi`.

The package requires [Jedi](https://pypi.org/project/jedi/) to be installed.

## Commands

Commands available in `atom-workspace`:

- `autocomplete-jedi:add-roots-to-extra-paths`: add all current project root directories to the `Extra Paths` setting.

Commands available in `atom-text-editor[data-grammar~=python]`:

- `autocomplete-jedi:go-to-definition`: navigate to the definition of the symbol under cursor,
- `autocomplete-jedi:show-usages`: list all usages of the symbol under cursor,
- `autocomplete-jedi:override-method`: insert a method override from a parent class,
- `autocomplete-jedi:rename`: rename a symbol across all files in the project.

## Customization

The rename dialog can be restyled from your stylesheet, e.g.:

```less
.autocomplete-jedi-rename {
  .autocomplete-jedi-rename-label {
    color: var(--text-color-info);
  }
}
```

## Services

- **[autocomplete.provider](https://lumine-code.github.io/docs.html#services/autocomplete.provider)** (`1.0.0`): provided to the autocomplete system to supply Python suggestions from the Jedi daemon.
- **[hyperclick.provider](https://lumine-code.github.io/docs.html#services/hyperclick.provider)** (`1.0.0`): provided to hyperclick consumers to jump to the definition of a clicked symbol.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
