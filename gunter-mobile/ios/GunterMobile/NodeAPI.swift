import Foundation

enum NodeAPIError: Error { case invalidURL, response(String) }

struct NodeAPI {
    let server: String
    private func request(_ route: String, token: String, method: String = "GET", body: [String: Any]? = nil) async throws -> [String: Any] {
        guard let url = URL(string: server.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/control" + route) else { throw NodeAPIError.invalidURL }
        guard url.scheme == "https", url.user == nil, url.password == nil else { throw NodeAPIError.response("gunter_mobile_https_required") }
        var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 12; request.setValue("application/json", forHTTPHeaderField: "Accept"); request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request); let json = (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode), json["success"] as? Bool != false else { throw NodeAPIError.response(json["error"] as? String ?? "network_error") }
        return json["data"] as? [String: Any] ?? [:]
    }
    func claim(token: String, name: String) async throws -> NodeConfig {
        let data = try await request("/nodes/claim", token: token, method: "POST", body: ["nodeType": "IOS", "deviceName": name, "os": "iOS", "appVersion": "0.1.0", "protocolVersion": "1.0.0"])
        guard let node = data["node"] as? [String: Any], let id = node["nodeId"] as? String, let nodeToken = data["nodeToken"] as? String, let device = node["deviceName"] as? String else { throw NodeAPIError.response("invalid_claim") }
        return NodeConfig(serverURL: server, nodeId: id, nodeToken: nodeToken, deviceName: device)
    }
    func heartbeat(_ config: NodeConfig, state: String) async throws {
        _ = try await request("/nodes/heartbeat", token: config.nodeToken, method: "POST", body: ["nodeId": config.nodeId, "state": state, "protocolVersion": "1.0.0", "clientTime": Int(Date().timeIntervalSince1970 * 1000), "capabilities": ["mobile.apps.open", "mobile.files.read", "mobile.media.control", "mobile.messaging.prepare", "mobile.reminders.write"], "health": ["runtime": state == "ONLINE", "nativeBridge": true], "syncCursor": "clean"])
    }
    func pull(_ config: NodeConfig) async throws -> [[String: Any]] { (try await request("/commands/pull?limit=10", token: config.nodeToken))["items"] as? [[String: Any]] ?? [] }
    func result(_ config: NodeConfig, id: String, result: [String: Any], evidence: [String: Any]) async throws { _ = try await request("/commands/result", token: config.nodeToken, method: "POST", body: ["commandId": id, "result": result, "evidence": evidence]) }
    func registerAPNsToken(_ config: NodeConfig, token: String) async throws -> Bool {
        let data = try await request("/nodes/push-token", token: config.nodeToken, method: "POST", body: ["provider": "apns", "token": token])
        return (data["push"] as? [String: Any])?["deliveryConfigured"] as? Bool ?? false
    }
    func clearPushToken(_ config: NodeConfig) async throws { _ = try await request("/nodes/push-token", token: config.nodeToken, method: "DELETE") }
}
