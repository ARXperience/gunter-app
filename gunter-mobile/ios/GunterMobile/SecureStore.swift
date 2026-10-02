import Foundation
import Security

struct NodeConfig: Codable {
    let serverURL: String
    let nodeId: String
    let nodeToken: String
    let deviceName: String
    var folders: [String] = []
}

enum SecureStore {
    private static let service = "com.gunter.mobile.config"
    static func load() -> NodeConfig? {
        var query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne]
        var item: CFTypeRef?; guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(NodeConfig.self, from: data)
    }
    static func save(_ config: NodeConfig) throws {
        let data = try JSONEncoder().encode(config)
        let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service]
        SecItemDelete(query as CFDictionary)
        let add = query.merging([kSecValueData: data], uniquingKeysWith: { _, newer in newer })
        guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw NSError(domain: "Gunter", code: 1) }
    }
}
