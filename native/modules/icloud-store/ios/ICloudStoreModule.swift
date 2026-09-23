// THE APP <-> iCLOUD DRIVE SEAM, Apple side.
//
// A small, dumb file store inside the app's own ubiquity container: list,
// read, write, remove. iCloud does the syncing between the user's devices;
// nothing here merges, diffs or interprets a byte, because what the files mean
// is the web app's business (`src/storage/icloud/` at the repository root).
// When encryption is on, the web app seals every note and attachment before it
// asks for a write, so what arrives here is already ciphertext.
//
// Everything lands under the container's `Documents` folder, which is what
// `NSUbiquitousContainers` in `app.config.js` declares as a document scope — so the synced notes
// are visible in the Files app under "Notes" rather than hidden inside the
// container. A file the user can see is a file they can back up, and that is
// worth more than the privacy of an opaque folder for data they already own.
//
// Two Foundation rules shape the code:
//
//   • `url(forUbiquityContainerIdentifier:)` HITS THE DISK AND THE ACCOUNT and
//     may block for a while, so it must never run on the main thread. Every
//     entry point here is an Expo `AsyncFunction`, which runs on the module's
//     own queue, and the resolved URL is cached.
//   • A file in a ubiquity container may not be downloaded yet — it exists as
//     a `.name.ext.icloud` placeholder. `NSFileCoordinator`'s coordinated read
//     triggers the download and waits for it, which is why every read goes
//     through one rather than through `Data(contentsOf:)`.

import ExpoModulesCore

/// The container the notes sync through. Kept in step with `../index.ts` and
/// `../../app.config.js` (the entitlements and the Files-app declaration) —
/// changing it after release strands every synced copy in the old container.
/// A literal, never derived from the bundle id: Swift cannot read a build
/// variable, and the bundle id is one.
private let CONTAINER_ID = "iCloud.se.agilator.notes"

/// Everything is filed under the container's document scope, so it shows up in
/// the Files app.
private let DOCUMENTS = "Documents"

public class ICloudStoreModule: Module {
  /// The container's `Documents` URL, resolved once. `nil` means "not resolved
  /// yet"; a resolution that fails is simply retried on the next call, because
  /// the user may sign in to iCloud while the app is running.
  private var cachedRoot: URL?

  public func definition() -> ModuleDefinition {
    Name("ICloudStore")

    AsyncFunction("isAvailable") { () -> Bool in
      self.root() != nil
    }

    AsyncFunction("list") { () -> [[String: Any]] in
      guard let root = self.root() else { throw ICloudUnavailableException() }
      return self.enumerate(root)
    }

    AsyncFunction("readText") { (path: String) -> String? in
      guard let data = try self.readData(path) else { return nil }
      // A note, a sealed note or a settings file written by this app is UTF-8.
      // Anything that is not is not ours, and reporting it as missing would
      // have the app overwrite it — so it is an error the sync engine surfaces
      // instead.
      guard let text = String(data: data, encoding: .utf8) else {
        throw ICloudNotTextException(path)
      }
      return text
    }

    AsyncFunction("writeText") { (path: String, text: String) in
      try self.writeData(path, Data(text.utf8))
    }

    AsyncFunction("readBytes") { (path: String) -> String? in
      try self.readData(path)?.base64EncodedString()
    }

    AsyncFunction("writeBytes") { (path: String, base64: String) in
      guard let data = Data(base64Encoded: base64) else {
        throw ICloudBadBase64Exception(path)
      }
      try self.writeData(path, data)
    }

    AsyncFunction("remove") { (path: String) in
      try self.removeItem(path)
    }
  }

  // MARK: - the container

  /// The container's `Documents` URL, creating the folder on first use.
  private func root() -> URL? {
    if let cached = cachedRoot { return cached }
    guard
      let container = FileManager.default.url(
        forUbiquityContainerIdentifier: CONTAINER_ID)
    else {
      return nil
    }
    let documents = container.appendingPathComponent(DOCUMENTS, isDirectory: true)
    try? FileManager.default.createDirectory(
      at: documents, withIntermediateDirectories: true)
    cachedRoot = documents
    return documents
  }

  /// Resolve one `/`-separated relative path against the container root.
  ///
  /// Rejects anything that could climb out of the container. The web app only
  /// ever asks for paths it composed itself, so this can only fire on a bug —
  /// but the container holds every note the user keeps there, and a store that
  /// trusts its caller about paths is one refactor away from writing outside
  /// it.
  private func resolve(_ path: String) throws -> URL {
    guard let root = root() else { throw ICloudUnavailableException() }
    let parts = path.split(separator: "/", omittingEmptySubsequences: true)
    guard !parts.isEmpty else { throw ICloudBadPathException(path) }
    for part in parts where part == ".." || part == "." {
      throw ICloudBadPathException(path)
    }
    return parts.reduce(root) { $0.appendingPathComponent(String($1)) }
  }

  // MARK: - reads and writes

  private func readData(_ path: String) throws -> Data? {
    let url = try resolve(path)
    // Ask for the file before reading it: an item that has not been downloaded
    // to this device exists only as a placeholder, and the coordinated read
    // below is what waits for the real bytes to arrive.
    try? FileManager.default.startDownloadingUbiquitousItem(at: url)

    var result: Data?
    var readError: Error?
    var coordinationError: NSError?
    NSFileCoordinator().coordinate(
      readingItemAt: url, options: [], error: &coordinationError
    ) { actual in
      do {
        result = try Data(contentsOf: actual)
      } catch {
        // A missing file is not a failure — the caller reads it as "nothing
        // stored yet", which is exactly what a first launch sees.
        if (error as NSError).code == NSFileReadNoSuchFileError {
          result = nil
        } else {
          readError = error
        }
      }
    }
    if let error = coordinationError { throw ICloudIOException(describe(path, error)) }
    if let error = readError { throw ICloudIOException(describe(path, error)) }
    return result
  }

  private func writeData(_ path: String, _ data: Data) throws {
    let url = try resolve(path)
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)

    var writeError: Error?
    var coordinationError: NSError?
    NSFileCoordinator().coordinate(
      writingItemAt: url, options: .forReplacing, error: &coordinationError
    ) { actual in
      do {
        // `.atomic` writes to a temporary file and renames it into place, so a
        // device reading the same folder never sees half a document — and neither
        // does iCloud's own uploader.
        try data.write(to: actual, options: .atomic)
      } catch {
        writeError = error
      }
    }
    if let error = coordinationError { throw ICloudIOException(describe(path, error)) }
    if let error = writeError { throw ICloudIOException(describe(path, error)) }
  }

  private func removeItem(_ path: String) throws {
    let url = try resolve(path)
    var removeError: Error?
    var coordinationError: NSError?
    NSFileCoordinator().coordinate(
      writingItemAt: url, options: .forDeleting, error: &coordinationError
    ) { actual in
      do {
        try FileManager.default.removeItem(at: actual)
      } catch {
        // Already gone is the outcome the caller wanted.
        if (error as NSError).code != NSFileNoSuchFileError {
          removeError = error
        }
      }
    }
    if let error = coordinationError { throw ICloudIOException(describe(path, error)) }
    if let error = removeError { throw ICloudIOException(describe(path, error)) }
  }

  // MARK: - listing

  /// Every file under `root`, recursively, as `{ path, rev }` dictionaries.
  ///
  /// A file that has not been downloaded appears on disk as a hidden
  /// `.name.ext.icloud` placeholder; it is reported under its LOGICAL name, so
  /// the caller sees one stable path whether or not the bytes are here yet.
  /// Its revision token is derived from the placeholder, so it changes once
  /// the real file lands — which costs at most one extra read and can never
  /// hide a change.
  private func enumerate(_ root: URL) -> [[String: Any]] {
    let manager = FileManager.default
    guard
      let walker = manager.enumerator(
        at: root,
        includingPropertiesForKeys: [
          .isRegularFileKey, .contentModificationDateKey, .fileSizeKey,
        ],
        options: [])
    else {
      return []
    }

    var entries: [[String: Any]] = []
    for case let url as URL in walker {
      let values = try? url.resourceValues(forKeys: [
        .isRegularFileKey, .contentModificationDateKey, .fileSizeKey,
      ])
      guard values?.isRegularFile == true else { continue }

      let relative = url.path.hasPrefix(root.path + "/")
        ? String(url.path.dropFirst(root.path.count + 1))
        : url.lastPathComponent
      guard let logical = logicalPath(relative) else { continue }

      let stamp = values?.contentModificationDate?.timeIntervalSince1970 ?? 0
      let size = values?.fileSize ?? 0
      entries.append(["path": logical, "rev": "\(stamp)-\(size)"])
    }
    return entries
  }

  /// Turn an on-disk path into the logical one, or `nil` for a file the store
  /// does not own. `notes/.a.md.icloud` is `notes/a.md`; any other
  /// dot-file (`.DS_Store`, a coordination temporary) is skipped.
  private func logicalPath(_ relative: String) -> String? {
    var parts = relative.split(separator: "/", omittingEmptySubsequences: true)
      .map(String.init)
    guard var name = parts.popLast() else { return nil }
    if name.hasPrefix(".") && name.hasSuffix(".icloud") {
      name = String(name.dropFirst().dropLast(".icloud".count))
    }
    if name.hasPrefix(".") { return nil }
    parts.append(name)
    return parts.joined(separator: "/")
  }
}

/// One line naming the file and what Foundation said about it — the whole
/// payload of an `ICloudIOException`, composed here so the throw sites stay on
/// one line and the exception itself stays a plain `GenericException`.
private func describe(_ path: String, _ error: Error) -> String {
  "\(path): \(error.localizedDescription)"
}

// MARK: - errors

internal final class ICloudUnavailableException: Exception {
  override var reason: String {
    "iCloud Drive is unavailable — check that the device is signed in to iCloud "
      + "and that the app's container entitlement is in the build."
  }
}

internal final class ICloudBadPathException: GenericException<String> {
  override var reason: String { "Not a valid path inside the container: \(param)" }
}

internal final class ICloudBadBase64Exception: GenericException<String> {
  override var reason: String { "The bytes for \(param) were not valid base64." }
}

internal final class ICloudNotTextException: GenericException<String> {
  override var reason: String { "\(param) is not UTF-8 text." }
}

/// An operation that failed for a reason Foundation reported. The path and the
/// underlying description are folded into one string at the throw site, because
/// `GenericException` carries exactly one parameter.
internal final class ICloudIOException: GenericException<String> {
  override var reason: String {
    "iCloud could not complete an operation: \(param)"
  }
}
