import Foundation
import SwiftUI
import UserNotifications
import UIKit
import MediaPlayer
import QuickLook

@MainActor
final class GunterRuntime: ObservableObject {
    @Published var config: NodeConfig?
    @Published var status = "Este dispositivo aún no está vinculado."
    @Published var isRunning = false
    @Published var previewURL: URL?
    private var task: Task<Void, Never>?
    private var previewAccessURL: URL?
    func load() { config = SecureStore.load(); if let config { status = "Vinculado como \(config.deviceName)" } }
    func pair(server: String, token: String, name: String) async {
        guard server.hasPrefix("https://"), token.hasPrefix("gp_") else { status = "Indica una URL HTTPS y un acceso de un solo uso válido."; return }
        status = "Vinculando…"
        do { let value = try await NodeAPI(server: normalizedServer(server)).claim(token: token, name: name.isEmpty ? UIDevice.current.name : name); try SecureStore.save(value); config = value; status = "Vinculado como \(value.deviceName)." } catch { status = "No se pudo vincular: \(error.localizedDescription)" }
    }
    private func normalizedServer(_ raw: String) -> String {
        guard let components = URLComponents(string: raw), components.scheme == "https", let host = components.host else { return raw }
        return "https://\(host)\(components.port.map { ":\($0)" } ?? "")"
    }
    func addFolder(_ url: URL) {
        guard var config else { return }
        guard url.startAccessingSecurityScopedResource() else { status = "iOS no concedió acceso a esa carpeta."; return }
        defer { url.stopAccessingSecurityScopedResource() }
        guard let bookmark = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) else { status = "No pude guardar el permiso de carpeta."; return }
        let token = bookmark.base64EncodedString(); config.folders = [token]
        do { try SecureStore.save(config); self.config = config; status = "Carpeta autorizada. Esta será la carpeta de trabajo del móvil." } catch { status = "No pude guardar la autorización." }
    }
    func requestNotifications() async {
        do {
            let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            guard allowed else { status = "El permiso de notificaciones está desactivado en Ajustes."; return }
            UIApplication.shared.registerForRemoteNotifications()
            status = "Permiso concedido; solicitando registro seguro de APNs…"
        }
        catch { status = "No pude activar las notificaciones." }
    }
    func registerAPNsToken(_ data: Data) async {
        guard let config else { status = "Vincula primero este dispositivo para activar avisos."; return }
        let token = data.map { String(format: "%02x", $0) }.joined()
        guard token.count == 64 else { status = "Apple devolvió un token APNs inválido."; return }
        do {
            let configured = try await NodeAPI(server: config.serverURL).registerAPNsToken(config, token: token)
            status = configured ? "Avisos APNs activados en este iPhone o iPad." : "Token registrado; falta configurar APNs en el servidor."
        } catch { status = "No pude registrar APNs en Gunter: \(error.localizedDescription)" }
    }
    func disablePush() async {
        guard let config else { return }
        UIApplication.shared.unregisterForRemoteNotifications()
        do {
            try await NodeAPI(server: config.serverURL).clearPushToken(config)
            status = "Avisos push desactivados en este dispositivo."
        } catch { status = "Avisos desactivados en iOS; no pude borrar el token del servidor. Conéctate y vuelve a intentarlo." }
    }
    func start() { guard config != nil, !isRunning else { return }; isRunning = true; status = "Gunter está activo mientras la app permanece abierta."; task = Task { await loop() } }
    func resumeForPush() {
        if config == nil { load() }
        guard config != nil else { status = "Vincula este dispositivo para recibir acciones push."; return }
        start()
    }
    func stop() { isRunning = false; task?.cancel(); task = nil; Task { if let config { try? await NodeAPI(server: config.serverURL).heartbeat(config, state: "DEGRADED") } } }
    private func loop() async {
        guard let config else { return }; let api = NodeAPI(server: config.serverURL); var heartbeat = Date.distantPast
        while isRunning && !Task.isCancelled {
            do {
                if Date().timeIntervalSince(heartbeat) > 20 { try await api.heartbeat(config, state: "ONLINE"); heartbeat = Date() }
                for command in try await api.pull(config) {
                    guard let id = command["id"] as? String, let skill = command["skill"] as? String else { continue }
                    do { let value = try await execute(skill: skill, payload: command["payload"] as? [String: Any] ?? [:], config: config, commandID: id); try await api.result(config, id: id, result: value.0, evidence: value.1) }
                    catch { try? await api.result(config, id: id, result: ["ok": false, "error": error.localizedDescription], evidence: ["verified": false]) }
                }
                try await Task.sleep(for: .milliseconds(2500))
            } catch { try? await Task.sleep(for: .seconds(5)) }
        }
    }
    private func execute(skill: String, payload: [String: Any], config: NodeConfig, commandID: String) async throws -> ([String: Any], [String: Any]) {
        switch skill {
        case "mobile.open_app":
            let app = (payload["appId"] as? String ?? payload["app"] as? String ?? "").lowercased()
            let aliases = ["spotify": "spotify://", "whatsapp": "whatsapp://", "telegram": "tg://", "maps": "maps://", "music": "music://", "youtube": "youtube://"]
            guard let raw = (payload["deepLink"] as? String) ?? (payload["url"] as? String) ?? aliases[app], let url = URL(string: raw), ["https", "mailto", "tel", "sms", "geo", "spotify", "whatsapp", "tg", "maps", "music", "youtube"].contains(url.scheme?.lowercased() ?? "") else { throw NodeAPIError.response("mobile_deep_link_not_allowed") }
            guard await open(url) else { throw NodeAPIError.response("mobile_app_not_opened") }; return (["opened": raw], ["appOpened": true])
        case "mobile.media.next", "mobile.media.play_pause":
            let player = MPMusicPlayerController.systemMusicPlayer
            if skill == "mobile.media.next" { player.skipToNextItem() } else if player.playbackState == .playing { player.pause() } else { player.play() }
            return (["playbackState": String(describing: player.playbackState)], ["playbackStateObserved": true])
        case "mobile.files.list":
            let url = try folder(payload["folderToken"] as? String, config); defer { url.stopAccessingSecurityScopedResource() }; let names = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.fileSizeKey, .isDirectoryKey]).prefix(250).map { ["token": $0.absoluteString, "name": $0.lastPathComponent] }; return (["items": names], ["folderRead": true, "itemCount": names.count])
        case "mobile.files.search":
            let root = try folder(payload["folderToken"] as? String, config); defer { root.stopAccessingSecurityScopedResource() }; let query = (payload["query"] as? String ?? "").lowercased(); guard !query.isEmpty else { throw NodeAPIError.response("mobile_search_query_required") }
            let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil); var items = [[String: String]](); var inspected = 0
            while let url = enumerator?.nextObject() as? URL, items.count < 100, inspected < 3000 { inspected += 1; if url.lastPathComponent.lowercased().contains(query) { items.append(["token": url.absoluteString, "name": url.lastPathComponent]) } }
            return (["items": items], ["searchCompleted": true, "itemCount": items.count, "inspected": inspected])
        case "mobile.files.open":
            let file: URL
            if let raw = payload["fileToken"] as? String, let tokenURL = URL(string: raw), tokenURL.isFileURL { file = tokenURL }
            else {
                guard let name = payload["fileName"] as? String, !name.isEmpty else { throw NodeAPIError.response("mobile_file_required") }
                let root = try folder(payload["folderToken"] as? String, config); defer { root.stopAccessingSecurityScopedResource() }
                let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil); var inspected = 0; var found: URL?
                while let candidate = enumerator?.nextObject() as? URL, inspected < 3000 { inspected += 1; if candidate.lastPathComponent.caseInsensitiveCompare(name) == .orderedSame { found = candidate; break } }
                guard let found else { throw NodeAPIError.response("mobile_file_not_found") }; file = found
            }
            guard file.isFileURL else { throw NodeAPIError.response("mobile_file_token_invalid") }
            var authorized = false
            for token in config.folders {
                guard let root = try? folder(token, config) else { continue }
                defer { root.stopAccessingSecurityScopedResource() }
                let rootPath = root.resolvingSymlinksInPath().standardizedFileURL.path
                let filePath = file.resolvingSymlinksInPath().standardizedFileURL.path
                if filePath.hasPrefix(rootPath.hasSuffix("/") ? rootPath : rootPath + "/") { authorized = true; break }
            }
            guard authorized else { throw NodeAPIError.response("mobile_file_token_invalid") }
            previewAccessURL?.stopAccessingSecurityScopedResource()
            guard file.startAccessingSecurityScopedResource() else { throw NodeAPIError.response("mobile_file_not_available") }
            previewAccessURL = file; previewURL = file
            return (["file": file.lastPathComponent], ["fileOpened": true])
        case "mobile.message.prepare":
            guard let recipient = payload["recipient"] as? String, let text = payload["text"] as? String, let url = URL(string: "sms:\(recipient)&body=\(text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") else { throw NodeAPIError.response("mobile_message_required") }
            guard await open(url) else { throw NodeAPIError.response("mobile_message_not_opened") }; return (["channel": payload["channel"] ?? "sms"], ["draftId": UUID().uuidString])
        case "mobile.reminder":
            guard let title = payload["title"] as? String, let raw = payload["runAt"] as? String, let date = ISO8601DateFormatter().date(from: raw) else { throw NodeAPIError.response("mobile_reminder_invalid") }
            let center = UNUserNotificationCenter.current(); let settings = await center.notificationSettings()
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { throw NodeAPIError.response("mobile_notifications_not_allowed_enable_in_app_settings") }
            let content = UNMutableNotificationContent(); content.title = "Gunter te recuerda"; content.body = title; let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, date.timeIntervalSinceNow), repeats: false); try await center.add(UNNotificationRequest(identifier: commandID, content: content, trigger: trigger)); return (["id": commandID], ["persistedId": commandID])
        default: throw NodeAPIError.response("mobile_skill_not_supported")
        }
    }
    private func folder(_ token: String?, _ config: NodeConfig) throws -> URL {
        let selected = token ?? (config.folders.count == 1 ? config.folders.first : nil)
        guard let selected, config.folders.contains(selected), let data = Data(base64Encoded: selected) else { throw NodeAPIError.response(config.folders.isEmpty ? "mobile_files_read_permission_required" : "mobile_folder_not_authorized") }
        var stale = false; let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale); guard url.startAccessingSecurityScopedResource() else { throw NodeAPIError.response("mobile_folder_not_available") }; return url
    }
    private func open(_ url: URL) async -> Bool {
        await withCheckedContinuation { continuation in UIApplication.shared.open(url, options: [:]) { continuation.resume(returning: $0) } }
    }
    func closePreview() { previewAccessURL?.stopAccessingSecurityScopedResource(); previewAccessURL = nil }
}
