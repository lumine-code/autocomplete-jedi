# jedi-tools

Navigate and refactor Python with Jedi.

Find definitions and usages, rename symbols across your project, and insert method overrides with [Jedi](https://github.com/davidhalter/jedi).

## Features

- **Go-to-definition**: navigate to the definition of any symbol.
- **Show usages**: list all usages of the symbol under cursor across the project.
- **Rename**: rename a symbol across multiple files in the project.
- **Method override**: insert method overrides from parent classes.
- **Hyperclick integration**: click on any symbol to go-to-definition when a hyperclick consumer is installed.
- **Virtual environment support**: set the `Python Command` to the interpreter inside your virtualenv, e.g. `.venv/Scripts/python.exe`, or use `$PROJECT/.venv/Scripts/python.exe` for project-relative paths.
- **Cross-platform**: works on macOS, Linux and Windows.

## Installation

To install `jedi-tools` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/jedi-tools`.

The package requires [Jedi](https://pypi.org/project/jedi/) to be installed.

## Commands

Commands available in `lumine-workspace`:

- `jedi-tools:go-to-definition`: navigate to the definition of the symbol under cursor in a Python editor,
- `jedi-tools:show-usages`: list all usages of the symbol under cursor in a Python editor,
- `jedi-tools:rename`: rename a symbol across all files in the project,
- `jedi-tools:override-method`: insert a method override from a parent class,
- `jedi-tools:add-roots-to-extra-paths`: add all current project root directories to the `Extra Paths` setting.

## Customization

The rename dialog can be restyled from your stylesheet, e.g.:

```css
.jedi-tools-rename {
  .jedi-tools-rename-label {
    color: var(--accent-only-text-color);
  }
}
```

## Services

- `hyperclick.provider`: provided to hyperclick consumers to jump to the definition of a clicked symbol.
- `background-tips.provider`: provided to background tips to introduce symbol navigation.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
