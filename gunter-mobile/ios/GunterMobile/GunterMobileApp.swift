import SwiftUI
import Combine
import UniformTypeIdentifiers
import QuickLook

@main
struct GunterMobileApp: App {
    @UIApplicationDelegateAdaptor(GunterAppDelegate.self) private var appDelegate
    @StateObject private var runtime = GunterRuntime()
    var body: some Scene { WindowGroup { ContentView().environmentObject(runtime) } }
}

struct ContentView: View {
    @EnvironmentObject private var runtime: GunterRuntime
    @State private var server = ""
    @State private var pairing = ""
    @State private var deviceName = UIDevice.current.name
    @State private var pickingFolder = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Estado") { Text(runtime.status).foregroundStyle(runtime.isRunning ? .green : .secondary) }
                Section("Vincular este iPhone o iPad") {
                    TextField("URL HTTPS de Gunter", text: $server).textInputAutocapitalization(.never).keyboardType(.URL)
                    SecureField("Acceso de un solo uso gp_…", text: $pairing)
                    TextField("Nombre del dispositivo", text: $deviceName)
                    Button("Vincular") { Task { await runtime.pair(server: server, token: pairing, name: deviceName) } }
                }
                Section("Permisos") {
                    Button("Elegir carpeta autorizada") { pickingFolder = true }.disabled(runtime.config == nil)
                    Button("Activar notificaciones") { Task { await runtime.requestNotifications() } }
                    Button("Desactivar avisos push") { Task { await runtime.disablePush() } }.disabled(runtime.config == nil)
                    Text("Gunter solo recibe acceso a los archivos que selecciones desde este dispositivo.").font(.footnote).foregroundStyle(.secondary)
                }
                Section("Acompañante") {
                    Button(runtime.isRunning ? "Detener Gunter" : "Iniciar Gunter") { runtime.isRunning ? runtime.stop() : runtime.start() }.disabled(runtime.config == nil)
                    Text("iOS mantiene el acompañante mientras la app está activa. Las alertas y recordatorios se entregan mediante las APIs del sistema.").font(.footnote).foregroundStyle(.secondary)
                }
            }.navigationTitle("Gunter")
        }.quickLookPreview($runtime.previewURL).onChange(of: runtime.previewURL) { value in if value == nil { runtime.closePreview() } }.fileImporter(isPresented: $pickingFolder, allowedContentTypes: [.folder], allowsMultipleSelection: false) { result in
            if case let .success(urls) = result, let url = urls.first { runtime.addFolder(url) }
        }.onReceive(NotificationCenter.default.publisher(for: .gunterAPNSToken)) { notification in
            guard let token = notification.object as? Data else { return }
            Task { await runtime.registerAPNsToken(token) }
        }.onReceive(NotificationCenter.default.publisher(for: .gunterAPNSError)) { notification in
            runtime.status = "Apple no pudo registrar APNs: \(notification.object as? String ?? "error desconocido")"
        }.onReceive(NotificationCenter.default.publisher(for: .gunterAPNSOpened)) { _ in
            runtime.resumeForPush()
        }.task { runtime.load() }
    }
}
