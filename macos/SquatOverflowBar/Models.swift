import Foundation

/// One row of GET /leaderboard (server/src/leaderboard/leaderboard.store.ts).
struct BoardRow: Decodable, Identifiable, Equatable {
    var rank: Int
    var name: String
    var level: Int
    var xp: Int
    var streak: Int
    var isMe: Bool
    var avatar: String

    var id: Int { rank }

    private enum CodingKeys: String, CodingKey {
        case rank, name, level, xp, streak, avatar
        case isMe = "is_me"
    }
}
