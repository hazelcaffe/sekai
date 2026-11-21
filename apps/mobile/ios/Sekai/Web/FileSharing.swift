import QuickLook
import UIKit
import WebKit

/// Files from the page: downloads and saved files go to the share sheet (Save to Files, AirDrop, other apps);
/// files the page opens in a new window show in a preview, which can share them too.
@MainActor
final class FileSharing: NSObject {
	weak var shell: ShellViewController?
	private var downloads: [ObjectIdentifier: (preview: Bool, file: URL?)] = [:]
	private var previewItem: URL?

	/// Each file gets its own folder in here, so names never clash.
	private static let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Shared files", isDirectory: true)

	/// Files shared before are done with by the next launch.
	static func removeOldFiles() {
		try? FileManager.default.removeItem(at: folder)
	}

	/// A file the page made (bridge `saveFile`).
	func share(_ data: Data, named name: String) throws {
		let file = try Self.newFile(named: name)
		try data.write(to: file, options: .atomic)
		present(file, preview: false)
	}

	/// The server's own file link, opened in a new window: downloaded with the web view's cookies, then previewed.
	func fetch(_ url: URL, in webView: WKWebView) {
		webView.startDownload(using: URLRequest(url: url)) { [weak self] download in
			self?.track(download, preview: true)
		}
	}

	func track(_ download: WKDownload, preview: Bool) {
		download.delegate = self
		downloads[ObjectIdentifier(download)] = (preview, nil)
	}

	private static func newFile(named name: String) throws -> URL {
		let folder = Self.folder.appendingPathComponent(UUID().uuidString, isDirectory: true)
		try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
		return folder.appendingPathComponent(safeName(name))
	}

	/// A name that's safe as a file name: no folders, no hidden files, not too long.
	nonisolated static func safeName(_ name: String) -> String {
		let unsafe = CharacterSet(charactersIn: "/\\:").union(.controlCharacters).union(.newlines)
		let cleaned = name.components(separatedBy: unsafe).joined(separator: "-")
			.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ".")))
		let short = String(cleaned.prefix(200))
		return short.isEmpty ? "download" : short
	}

	private func present(_ file: URL, preview: Bool) {
		guard let shell else { return }
		if preview, QLPreviewController.canPreview(file as NSURL) {
			previewItem = file
			let controller = QLPreviewController()
			controller.dataSource = self
			shell.presentOnTop(controller)
		} else {
			shell.presentOnTop(UIActivityViewController(activityItems: [file], applicationActivities: nil))
		}
	}

	private func failed(retry: (() -> Void)? = nil) {
		let alert = UIAlertController(
			title: "Couldn't download that file",
			message: "Check you're online, then try again.",
			preferredStyle: .alert
		)
		if let retry {
			alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
			alert.addAction(UIAlertAction(title: "Try again", style: .default) { _ in retry() })
		} else { alert.addAction(UIAlertAction(title: "OK", style: .default)) }
		shell?.presentOnTop(alert)
	}
}

extension FileSharing: WKDownloadDelegate {
	func download(
		_ download: WKDownload,
		decideDestinationUsing response: URLResponse,
		suggestedFilename: String
	) async -> URL? {
		let id = ObjectIdentifier(download)
		guard let file = try? Self.newFile(named: suggestedFilename) else {
			downloads[id] = nil
			return nil
		}
		downloads[id]?.file = file
		return file
	}

	func downloadDidFinish(_ download: WKDownload) {
		guard let done = downloads.removeValue(forKey: ObjectIdentifier(download)), let file = done.file else { return }
		guard download.webView === shell?.webView else { return }
		UIAccessibility.post(notification: .announcement, argument: "Download ready.")
		present(file, preview: done.preview)
	}

	func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
		let preview = downloads.removeValue(forKey: ObjectIdentifier(download))?.preview ?? false
		guard let webView = download.webView, webView === shell?.webView else { return }
		let request = download.originalRequest
		// Never repeat a form submission; WebKit's resume data or a same-server GET is safe to retry.
		guard resumeData != nil || (request?.httpMethod == "GET" && shell?.origin?.contains(request?.url) == true) else {
			failed()
			return
		}
		failed { [weak self, weak webView] in
			guard let webView, let self, webView === self.shell?.webView else { return }
			let track: @MainActor @Sendable (WKDownload) -> Void = { [weak self] in self?.track($0, preview: preview) }
			if let resumeData { webView.resumeDownload(fromResumeData: resumeData, completionHandler: track) }
			else if let request { webView.startDownload(using: request, completionHandler: track) }
		}
	}
}

extension FileSharing: QLPreviewControllerDataSource {
	func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
		previewItem == nil ? 0 : 1
	}

	func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
		(previewItem ?? Self.folder) as NSURL
	}
}
