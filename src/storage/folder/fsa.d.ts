// Augment lib.dom with the File System Access API surface the folder backend
// uses. The base `FileSystemHandle` / `FileSystemDirectoryHandle` interfaces
// ship with TypeScript, but the permission methods, the directory picker
// entry point, and the async-iteration helpers (`values()` / `entries()`)
// sit in spec layers this project's `lib` doesn't pull in. Only the slice the
// backend touches is declared here.

declare global {
  type FileSystemPermissionMode = "read" | "readwrite";

  interface FileSystemHandlePermissionDescriptor {
    mode?: FileSystemPermissionMode;
  }

  interface FileSystemHandle {
    queryPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>;
    requestPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>;
  }

  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<
      FileSystemFileHandle | FileSystemDirectoryHandle
    >;
    entries(): AsyncIterableIterator<
      [string, FileSystemFileHandle | FileSystemDirectoryHandle]
    >;
  }

  interface DirectoryPickerOptions {
    id?: string;
    mode?: FileSystemPermissionMode;
    startIn?:
      | FileSystemHandle
      | "desktop"
      | "documents"
      | "downloads"
      | "music"
      | "pictures"
      | "videos";
  }

  interface Window {
    showDirectoryPicker?(
      options?: DirectoryPickerOptions,
    ): Promise<FileSystemDirectoryHandle>;
  }
}

export {};
