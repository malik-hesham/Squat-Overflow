import Foundation
import SquatCore
import XCTest

/// The extension's answers from Fixtures/parity.json (macos/scripts/parity-fixtures.mjs).
enum Parity {
    struct Case { var args: [JSONValue]; var out: JSONValue }

    static let fixture: JSONValue = {
        let url = Bundle.module.url(forResource: "parity", withExtension: "json", subdirectory: "Fixtures")!
        let value = try! JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
        // Local-time rules ran in this zone when the fixtures were made.
        NSTimeZone.default = TimeZone(identifier: value["tz"]!.string!)!
        return value
    }()

    static func cases(_ name: String) -> [Case] {
        guard let list = fixture["cases"]?[name]?.array else {
            XCTFail("no fixture cases for \(name)")
            return []
        }
        return list.map { Case(args: $0["args"]?.array ?? [], out: $0["out"] ?? .null) }
    }

    static let catalogs: [[Exercise]] = fixture["catalogs"]!.array!.map { try! $0.decode([Exercise].self) }
}

/// Runs every fixture case of `name` through the Swift port and compares with the extension's
/// output. Absent keys and nulls count as equal (Swift drops nil optionals, JS writes null).
func checkParity(_ name: String, normalize: (JSONValue) -> JSONValue = { $0 }, file: StaticString = #filePath,
                 line: UInt = #line, _ port: ([JSONValue]) throws -> JSONValue) {
    let cases = Parity.cases(name)
    XCTAssertFalse(cases.isEmpty, "\(name) has no cases", file: file, line: line)
    var failures = 0
    for c in cases {
        do {
            let got = normalize(try port(c.args))
            if !sameJSON(got, normalize(c.out)) {
                failures += 1
                if failures <= 3 {
                    XCTFail("\(name)(\(JSONValue.array(c.args).canonical.prefix(600)))\n  extension: \(c.out.canonical.prefix(600))\n  swift:     \(got.canonical.prefix(600))", file: file, line: line)
                }
            }
        } catch {
            failures += 1
            if failures <= 3 { XCTFail("\(name)(\(JSONValue.array(c.args).canonical.prefix(300))) threw \(error)", file: file, line: line) }
        }
    }
    if failures > 3 { XCTFail("\(name): \(failures) of \(cases.count) cases differ", file: file, line: line) }
}

func sameJSON(_ a: JSONValue, _ b: JSONValue) -> Bool {
    switch (a, b) {
    case (.object(let x), .object(let y)):
        let keys = Set(x.keys).union(y.keys)
        return keys.allSatisfy { sameJSON(x[$0] ?? .null, y[$0] ?? .null) }
    case (.array(let x), .array(let y)):
        return x.count == y.count && zip(x, y).allSatisfy { sameJSON($0, $1) }
    case (.number(let x), .number(let y)):
        return x == y || abs(x - y) <= 1e-12 * max(abs(x), abs(y))
    default:
        return a == b
    }
}

/// Encodes a Swift result for comparison.
func json<T: Encodable>(_ value: T) throws -> JSONValue { try JSONValue(encoding: value) }

extension JSONValue {
    /// Decodes an argument, failing the case if the fixture holds something the port can't take.
    func as_<T: Decodable>(_ type: T.Type = T.self) throws -> T { try decode(T.self) }
}
