declare module "monaco-editor" {
  export const editor: {
    defineTheme: (...args: any[]) => void;
    setTheme: (...args: any[]) => void;
  };

  export const Uri: {
    parse: (...args: any[]) => any;
  };

  export namespace editor {
    type IStandaloneDiffEditor = any;
    type IStandaloneCodeEditor = any;
    type IDiffEditorConstructionOptions = any;
    type IStandaloneEditorConstructionOptions = any;
    type IEditorOverrideServices = any;
    type IModelContentChangedEvent = any;
    type IMarker = any;
  }
}

declare module "monaco-editor/esm/vs/editor/editor.api" {
  export const editor: {
    defineTheme: (...args: any[]) => void;
    setTheme: (...args: any[]) => void;
  };

  export const Uri: {
    parse: (...args: any[]) => any;
  };
}
